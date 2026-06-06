import assert from "node:assert/strict";
import test from "node:test";

import { createOpenAIAgentRunner } from "../src/openai-agent-runner.js";

test("OpenAI agent runner posts task and parses structured output", async () => {
  const previousFetch = globalThis.fetch;
  const task = {
    id: "task-1",
    title: "Do scoped work",
    owner: "implementation-agent",
    scope: { paths: ["src/"], allowlist: [], denylist: [".env"] },
  };

  try {
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);

      assert.equal(url, "https://example.test/v1/responses");
      assert.equal(options.headers.Authorization, "Bearer test-key");
      assert.equal(body.model, "test-model");
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.strict, true);

      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            taskId: "task-1",
            status: "complete",
            summary: "Structured result.",
            changedFiles: [],
            artifacts: ["result.json"],
            risks: [],
            patch: "",
          }),
        }),
      };
    };

    const runner = createOpenAIAgentRunner({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://example.test/v1",
    });

    assert.deepEqual(await runner(task), {
      taskId: "task-1",
      status: "complete",
      summary: "Structured result.",
      changedFiles: [],
      artifacts: ["result.json"],
      risks: [],
      patch: "",
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
