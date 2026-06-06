import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ENV = [
  "ASSEMBLY_AGENT_PROVIDER=stub",
  "ASSEMBLY_APPROVAL_MODE=auto",
  "OPENAI_API_KEY=",
  "OPENAI_MODEL=gpt-4.1-mini",
  "GITHUB_WEBHOOK_SECRET=",
  "SLACK_SIGNING_SECRET=",
  "SLACK_BOT_TOKEN=",
  "",
].join("\n");

export async function initializeAssembly({ rootDir = process.cwd(), force = false } = {}) {
  await mkdir(path.join(rootDir, ".assembly"), { recursive: true });

  const envPath = path.join(rootDir, ".env");
  const existingEnv = await readFile(envPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });

  if (existingEnv !== null && !force) {
    return {
      rootDir,
      createdEnv: false,
      createdStateDir: true,
      nextSteps: [
        ".env already exists; no values were overwritten.",
        "Run `assembly doctor` to see missing setup.",
      ],
    };
  }

  const envContents = existingEnv === null ? DEFAULT_ENV : mergeEnvDefaults(existingEnv);
  await writeFile(envPath, envContents);

  return {
    rootDir,
    createdEnv: existingEnv === null,
    updatedEnv: existingEnv !== null,
    createdStateDir: true,
    nextSteps: [
      "Fill in .env values for OpenAI, GitHub webhooks, and Slack.",
      "Run `assembly doctor` to verify setup.",
      "Run `assembly webhook --port 3000` when doctor passes.",
    ],
  };
}

export function formatInitResult(result) {
  const lines = [
    `Initialized Assembly in ${result.rootDir}`,
    result.createdEnv ? "Created .env" : result.updatedEnv ? "Updated .env with missing defaults" : "Kept existing .env",
    "Ensured .assembly/ exists",
    "",
    "Next steps:",
    ...result.nextSteps.map((step) => `- ${step}`),
    "",
  ];
  return lines.join("\n");
}

function mergeEnvDefaults(existingEnv) {
  const existingKeys = new Set(
    existingEnv
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => line.slice(0, line.indexOf("=")).trim()),
  );
  const missingLines = DEFAULT_ENV
    .split("\n")
    .filter((line) => {
      if (!line.trim()) {
        return false;
      }
      const key = line.slice(0, line.indexOf("=")).trim();
      return !existingKeys.has(key);
    });

  if (missingLines.length === 0) {
    return existingEnv.endsWith("\n") ? existingEnv : `${existingEnv}\n`;
  }

  const separator = existingEnv.endsWith("\n") ? "" : "\n";
  return `${existingEnv}${separator}\n# Assembly defaults\n${missingLines.join("\n")}\n`;
}
