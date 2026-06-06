import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";
import { formatDoctorReport, runDoctor } from "../src/doctor.js";

test("runDoctor reports missing required setup", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-doctor-missing-"));
  const report = await runDoctor({
    rootDir,
    env: {
      ASSEMBLY_AGENT_PROVIDER: "openai",
    },
    exec: createDoctorExec({ gitRoot: rootDir, ghError: new Error("not authenticated") }),
  });

  assert.equal(report.ok, false);
  assert.equal(findCheck(report, "Target repository").status, "pass");
  assert.equal(findCheck(report, "OPENAI_API_KEY").status, "fail");
  assert.equal(findCheck(report, "GITHUB_WEBHOOK_SECRET").status, "fail");
  assert.equal(findCheck(report, "SLACK_SIGNING_SECRET").status, "fail");
  assert.equal(findCheck(report, "SLACK_BOT_TOKEN").status, "fail");
  assert.equal(findCheck(report, ".env").status, "warn");
});

test("runDoctor accepts complete local setup", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-doctor-complete-"));
  await writeFile(path.join(rootDir, ".env"), "OPENAI_API_KEY=ignored\n");

  const report = await runDoctor({
    rootDir,
    env: {
      ASSEMBLY_AGENT_PROVIDER: "openai",
      ASSEMBLY_APPROVAL_MODE: "auto",
      OPENAI_API_KEY: "sk-test-key",
      GITHUB_WEBHOOK_SECRET: "github-secret",
      GH_TOKEN: "gh-token",
      SLACK_SIGNING_SECRET: "slack-secret",
      SLACK_BOT_TOKEN: "xoxb-token",
    },
    exec: createDoctorExec({ gitRoot: rootDir }),
  });

  assert.equal(report.ok, true);
  assert.equal(findCheck(report, ".env").status, "pass");
  assert.match(formatDoctorReport(report), /Ready: required setup is present\./);
});

test("runDoctor accepts GitHub CLI auth when token env is absent", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-doctor-gh-auth-"));

  const report = await runDoctor({
    rootDir,
    env: {
      ASSEMBLY_AGENT_PROVIDER: "stub",
    },
    exec: createDoctorExec({ gitRoot: rootDir, ghAuthenticated: true }),
  });

  assert.equal(findCheck(report, "Target repository").status, "pass");
  assert.equal(findCheck(report, "GitHub auth").status, "pass");
  assert.match(findCheck(report, "GitHub auth").message, /gh auth status/);
});

test("runDoctor fails when GitHub CLI is missing", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-doctor-gh-missing-"));
  const error = new Error("not found");
  error.code = "ENOENT";

  const report = await runDoctor({
    rootDir,
    env: {
      ASSEMBLY_AGENT_PROVIDER: "stub",
    },
    exec: createDoctorExec({ gitRoot: rootDir, ghError: error }),
  });

  assert.equal(report.ok, false);
  assert.equal(findCheck(report, "GitHub auth").status, "fail");
  assert.match(findCheck(report, "GitHub auth").message, /GitHub CLI not found/);
});

test("runDoctor fails and explains invalid GitHub CLI token", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-doctor-gh-invalid-"));
  const error = new Error("gh auth failed");
  error.stdout = "The token in /home/arun/.config/gh/hosts.yml is invalid.\nTo re-authenticate, run: gh auth refresh -h github.com";

  const report = await runDoctor({
    rootDir,
    env: {
      ASSEMBLY_AGENT_PROVIDER: "stub",
    },
    exec: createDoctorExec({ gitRoot: rootDir, ghError: error }),
  });

  assert.equal(report.ok, false);
  assert.equal(findCheck(report, "GitHub auth").status, "fail");
  assert.match(findCheck(report, "GitHub auth").message, /gh auth refresh -h github.com/);
});

test("doctor command reads .env and exits nonzero when setup is missing", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-doctor-cli-"));
  await writeFile(
    path.join(rootDir, ".env"),
    [
      "ASSEMBLY_AGENT_PROVIDER=openai",
      "OPENAI_API_KEY=sk-test-key",
      "",
    ].join("\n"),
  );

  const previousCwd = process.cwd();
  const savedEnv = saveEnv([
    "ASSEMBLY_AGENT_PROVIDER",
    "ASSEMBLY_APPROVAL_MODE",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "GITHUB_WEBHOOK_SECRET",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "SLACK_SIGNING_SECRET",
    "SLACK_BOT_TOKEN",
  ]);
  const stdout = { text: "", write(chunk) { this.text += chunk; } };
  const stderr = { text: "", write(chunk) { this.text += chunk; } };

  try {
    clearEnv(Object.keys(savedEnv));
    process.chdir(rootDir);

    const code = await main(["doctor"], { stdout, stderr });

    assert.equal(code, 1);
    assert.match(stdout.text, /Assembly doctor/);
    assert.match(stdout.text, /FAIL\s+GITHUB_WEBHOOK_SECRET/);
    assert.match(stdout.text, /FAIL\s+SLACK_SIGNING_SECRET/);
    assert.match(stdout.text, /FAIL\s+SLACK_BOT_TOKEN/);
    assert.equal(stderr.text, "");
  } finally {
    process.chdir(previousCwd);
    restoreEnv(savedEnv);
  }
});

function findCheck(report, name) {
  return report.checks.find((check) => check.name === name);
}

function saveEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function clearEnv(keys) {
  for (const key of keys) {
    delete process.env[key];
  }
}

function restoreEnv(savedEnv) {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function createDoctorExec({ gitRoot, ghAuthenticated = false, ghError } = {}) {
  return async (command, args) => {
    if (command === "git" && args.join(" ") === "rev-parse --show-toplevel") {
      if (!gitRoot) {
        throw new Error("not a git repository");
      }
      return { stdout: `${gitRoot}\n`, stderr: "" };
    }
    if (command === "gh" && args.join(" ") === "auth status") {
      if (ghAuthenticated) {
        return { stdout: "Logged in\n", stderr: "" };
      }
      throw ghError ?? new Error("not authenticated");
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
}
