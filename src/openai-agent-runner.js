import { getOpenAIConfig } from "./config.js";
import { buildTaskContext } from "./context-builder.js";

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["taskId", "status", "summary", "changedFiles", "artifacts", "risks", "patch", "fileUpdates"],
  properties: {
    taskId: { type: "string" },
    status: { type: "string", enum: ["complete", "blocked", "failed"] },
    summary: { type: "string" },
    changedFiles: {
      type: "array",
      items: { type: "string" },
    },
    artifacts: {
      type: "array",
      items: { type: "string" },
    },
    risks: {
      type: "array",
      items: { type: "string" },
    },
    patch: {
      type: "string",
      description: "Unified diff patch to apply. Empty string if no code changes are needed.",
    },
    fileUpdates: {
      type: "array",
      description: "Full file replacements to write. Prefer this over patch when editing scoped files.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
      },
    },
  },
};

export function createOpenAIAgentRunner(config = getOpenAIConfig()) {
  return async function runOpenAIAgent(task, runContext = {}) {
    const rootDir = runContext.rootDir ?? process.cwd();
    const taskContext = await buildTaskContext(task, rootDir);
    const response = await fetch(`${config.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        input: [
          {
            role: "developer",
            content: [
              {
                type: "input_text",
                text:
                  "You are an Assembly task agent. Return only JSON matching the supplied schema. " +
                  "You handle implementation tasks only. You may only edit files inside the task scope. " +
                  "Prefer fileUpdates for edits: return the full replacement content for each changed file. " +
                  "For fileUpdates, preserve all unrelated existing content exactly and make the smallest requested edit. " +
                  "When task.changePolicy is additive, the updated file must keep every existing line in the same order and only insert new lines. " +
                  "Do not rewrite, summarize, restructure, or replace a whole file with new documentation unless explicitly requested. " +
                  "Use patch only if you can produce a complete unified diff that applies cleanly with git apply from the repository root. " +
                  "Never use placeholder hunks or ellipses. Include every changed file in changedFiles. " +
                  "Include result.json in artifacts, and include file-updates.json when fileUpdates is non-empty. " +
                  "If you do not have enough context to safely edit, return status blocked with an empty patch.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(
                  {
                    request: runContext.plan?.request,
                    task,
                    verification: runContext.plan?.verification ?? [],
                    scopedFiles: taskContext.files,
                    contextLimits: taskContext.limits,
                  },
                  null,
                  2,
                ),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "assembly_task_result",
            strict: true,
            schema: RESULT_SCHEMA,
          },
        },
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(formatOpenAIError(response.status, payload));
    }

    return parseStructuredResult(payload);
  };
}

function parseStructuredResult(payload) {
  const outputText = payload?.output_text ?? findOutputText(payload);
  if (!outputText) {
    throw new Error("OpenAI response did not include structured output text");
  }
  return JSON.parse(outputText);
}

function findOutputText(payload) {
  for (const item of payload?.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return null;
}

function formatOpenAIError(status, payload) {
  const message = payload?.error?.message ?? "unknown OpenAI API error";
  return `OpenAI API request failed with status ${status}: ${message}`;
}
