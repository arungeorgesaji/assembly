import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadEnv(rootDir = process.cwd()) {
  const envPath = path.join(rootDir, ".env");
  let contents;

  try {
    contents = await readFile(envPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed || process.env[parsed.key] !== undefined) {
      continue;
    }
    process.env[parsed.key] = parsed.value;
  }
}

export function getAgentProvider() {
  return process.env.ASSEMBLY_AGENT_PROVIDER || "stub";
}

export function getApprovalMode() {
  return process.env.ASSEMBLY_APPROVAL_MODE || "auto";
}

export function getGitHubWebhookSecret() {
  return process.env.GITHUB_WEBHOOK_SECRET || "";
}

export function getSlackSigningSecret() {
  return process.env.SLACK_SIGNING_SECRET || "";
}

export function getSlackBotToken() {
  return process.env.SLACK_BOT_TOKEN || "";
}

export function getOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when ASSEMBLY_AGENT_PROVIDER=openai");
  }

  return {
    apiKey,
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  };
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex === -1) {
    return null;
  }

  const key = trimmed.slice(0, equalsIndex).trim();
  const rawValue = trimmed.slice(equalsIndex + 1).trim();
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
    return null;
  }

  return {
    key,
    value: unquote(rawValue),
  };
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
