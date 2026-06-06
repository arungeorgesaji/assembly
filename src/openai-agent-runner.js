import { getOpenAIConfig } from "./config.js";

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["taskId", "status", "summary", "changedFiles", "artifacts", "risks", "patch"],
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
  },
};

export function createOpenAIAgentRunner(config = getOpenAIConfig()) {
  return async function runOpenAIAgent(task) {
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
                  "You are an Assembly task agent. Return only data matching the supplied schema. " +
                  "If you make code changes, include a unified diff in patch and list every changed file. " +
                  "Changed files must stay within the task scope.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({ task }, null, 2),
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
