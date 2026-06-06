import { getOpenAIConfig } from "./config.js";
import { buildTaskContext } from "./context-builder.js";
import { readRun } from "./run-store.js";

const REVIEW_SCHEMA = {
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
    patch: { type: "string" },
    fileUpdates: {
      type: "array",
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

export function createOpenAIReviewRunner(config = getOpenAIConfig()) {
  return async function runOpenAIReview(task, runContext = {}) {
    const rootDir = runContext.rootDir ?? process.cwd();
    const taskContext = await buildTaskContext(task, rootDir);
    const run = await readRun(runContext.runId, rootDir);

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
                  "You are an Assembly review agent. Return only JSON matching the schema. " +
                  "Review the completed task results, changed files, artifacts, and verification output. " +
                  "Return status complete when the work is acceptable. Return blocked for human input needed. " +
                  "Return failed for concrete correctness, scope, security, or verification problems. " +
                  "Do not edit files; patch must be empty and fileUpdates must be empty.",
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
                    request: run.plan.request,
                    task,
                    state: run.state,
                    events: run.events,
                    scopedFiles: taskContext.files,
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
            name: "assembly_review_result",
            strict: true,
            schema: REVIEW_SCHEMA,
          },
        },
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message ?? "unknown OpenAI API error";
      throw new Error(`OpenAI API request failed with status ${response.status}: ${message}`);
    }

    const outputText = payload?.output_text ?? findOutputText(payload);
    if (!outputText) {
      throw new Error("OpenAI review response did not include structured output text");
    }
    return JSON.parse(outputText);
  };
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

