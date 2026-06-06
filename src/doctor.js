import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const VALID_AGENT_PROVIDERS = new Set(["stub", "openai"]);
const VALID_APPROVAL_MODES = new Set(["auto", "manual", "never"]);
const execFileAsync = promisify(execFile);

export async function runDoctor({ rootDir = process.cwd(), env = process.env, exec = execFileAsync } = {}) {
  const checks = [];
  const envPath = path.join(rootDir, ".env");

  checks.push(await checkTargetRepository(rootDir, exec));
  checks.push(await checkEnvFile(envPath));
  checks.push(checkAgentProvider(env));
  checks.push(checkOpenAI(env));
  checks.push(checkApprovalMode(env));
  checks.push(checkRequiredEnv("GITHUB_WEBHOOK_SECRET", env, "Required for GitHub webhook signature verification."));
  checks.push(await checkGitHubAuth(env, exec));
  checks.push(checkRequiredEnv("SLACK_SIGNING_SECRET", env, "Required for Slack request signature verification."));
  checks.push(checkRequiredEnv("SLACK_BOT_TOKEN", env, "Required so Assembly can reply in Slack threads."));

  return {
    ok: !checks.some((check) => check.status === "fail"),
    checks,
  };
}

export function formatDoctorReport(report) {
  const rows = report.checks.map((check) => [
    check.status.toUpperCase(),
    check.name,
    check.message,
  ]);
  const headers = ["STATUS", "CHECK", "DETAIL"];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  const formatRow = (row) => row.map((value, index) => value.padEnd(widths[index])).join("  ");

  return [
    "Assembly doctor",
    "",
    formatRow(headers),
    formatRow(widths.map((width) => "-".repeat(width))),
    ...rows.map(formatRow),
    "",
    report.ok ? "Ready: required setup is present." : "Not ready: fix the failed checks above.",
    "",
  ].join("\n");
}

async function checkEnvFile(envPath) {
  try {
    await access(envPath);
    return pass(".env", "Found local .env file.");
  } catch {
    return warn(".env", "No .env file found; using process environment only.");
  }
}

async function checkTargetRepository(rootDir, exec) {
  try {
    const { stdout } = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: rootDir });
    const gitRoot = path.resolve(stdout.trim());
    const targetRoot = path.resolve(rootDir);
    if (gitRoot !== targetRoot) {
      return warn("Target repository", `Using ${targetRoot}, but Git root is ${gitRoot}. Run from the repo root or pass --repo.`);
    }
    return pass("Target repository", `Git repository at ${targetRoot}.`);
  } catch {
    return fail("Target repository", "Run from a Git repository or pass --repo <path>.");
  }
}

function checkAgentProvider(env) {
  const provider = env.ASSEMBLY_AGENT_PROVIDER || "stub";
  if (!VALID_AGENT_PROVIDERS.has(provider)) {
    return fail("ASSEMBLY_AGENT_PROVIDER", `Unsupported provider "${provider}". Use stub or openai.`);
  }
  if (provider === "stub") {
    return warn("ASSEMBLY_AGENT_PROVIDER", "Using stub provider; real code editing needs ASSEMBLY_AGENT_PROVIDER=openai.");
  }
  return pass("ASSEMBLY_AGENT_PROVIDER", "OpenAI provider enabled.");
}

function checkOpenAI(env) {
  const provider = env.ASSEMBLY_AGENT_PROVIDER || "stub";
  if (provider !== "openai") {
    return warn("OPENAI_API_KEY", "Skipped because ASSEMBLY_AGENT_PROVIDER is not openai.");
  }
  if (!env.OPENAI_API_KEY) {
    return fail("OPENAI_API_KEY", "Required when ASSEMBLY_AGENT_PROVIDER=openai.");
  }
  if (!env.OPENAI_API_KEY.startsWith("sk-")) {
    return warn("OPENAI_API_KEY", "Present, but it does not look like an OpenAI secret key.");
  }
  return pass("OPENAI_API_KEY", `Present. Model: ${env.OPENAI_MODEL || "gpt-4.1-mini"}.`);
}

function checkApprovalMode(env) {
  const mode = env.ASSEMBLY_APPROVAL_MODE || "auto";
  if (!VALID_APPROVAL_MODES.has(mode)) {
    return fail("ASSEMBLY_APPROVAL_MODE", `Unsupported mode "${mode}". Use auto, manual, or never.`);
  }
  return pass("ASSEMBLY_APPROVAL_MODE", `Using ${mode}.`);
}

function checkRequiredEnv(name, env, missingMessage) {
  if (!env[name]) {
    return fail(name, missingMessage);
  }
  return pass(name, "Present.");
}

async function checkGitHubAuth(env, exec) {
  if (env.GH_TOKEN || env.GITHUB_TOKEN) {
    return pass("GitHub auth", "Token environment variable present.");
  }
  try {
    await exec("gh", ["auth", "status"]);
    return pass("GitHub auth", "`gh auth status` is authenticated.");
  } catch (error) {
    if (error.code === "ENOENT") {
      return fail("GitHub auth", "GitHub CLI not found; install `gh` or set GH_TOKEN/GITHUB_TOKEN.");
    }
    return fail("GitHub auth", summarizeGitHubAuthError(error));
  }
}

function summarizeGitHubAuthError(error) {
  const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
  if (/gh auth refresh/i.test(output)) {
    return "`gh auth status` reports an invalid token. Run `gh auth refresh -h github.com` or set GH_TOKEN/GITHUB_TOKEN.";
  }
  if (/not logged into|not logged in|not authenticated/i.test(output)) {
    return "`gh auth status` is not authenticated. Run `gh auth login` or set GH_TOKEN/GITHUB_TOKEN.";
  }
  return "`gh auth status` failed. Run `gh auth status` for details or set GH_TOKEN/GITHUB_TOKEN.";
}

function pass(name, message) {
  return { status: "pass", name, message };
}

function warn(name, message) {
  return { status: "warn", name, message };
}

function fail(name, message) {
  return { status: "fail", name, message };
}
