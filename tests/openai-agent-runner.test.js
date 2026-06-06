import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createOpenAIAgentRunner } from "../src/openai-agent-runner.js";

test("OpenAI agent runner posts task and parses structured output", async () => {
  const previousFetch = globalThis.fetch;
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-openai-runner-"));
  await mkdir(path.join(rootDir, "src"));
  await writeFile(path.join(rootDir, "src", "task.js"), "export const task = true;\n");
  const task = {
    id: "task-1",
    title: "Do scoped work",
    owner: "implementation-agent",
    agentProfileId: "agent-impl-src",
    scope: { paths: ["src/"], allowlist: [], denylist: [".env"] },
  };
  const agentProfile = {
    id: "agent-impl-src",
    dispatchOwner: "implementation-agent",
    focus: "src/",
    ownedPaths: ["src/"],
    deniedPaths: [".env"],
    instructions: ["Work only inside: src/."],
  };

  try {
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);

      assert.equal(url, "https://example.test/v1/responses");
      assert.equal(options.headers.Authorization, "Bearer test-key");
      assert.equal(body.model, "test-model");
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.strict, true);
      const userPayload = JSON.parse(body.input[1].content[0].text);
      assert.equal(userPayload.request, "Test request");
      assert.deepEqual(userPayload.agentProfile, agentProfile);
      assert.equal(userPayload.scopedFiles[0].path, "src/task.js");

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
            fileUpdates: [],
          }),
        }),
      };
    };

    const runner = createOpenAIAgentRunner({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://example.test/v1",
    });

    assert.deepEqual(await runner(task, { rootDir, plan: { request: "Test request", verification: [], agentProfiles: [agentProfile] } }), {
      taskId: "task-1",
      status: "complete",
      summary: "Structured result.",
      changedFiles: [],
      artifacts: ["result.json"],
      risks: [],
      patch: "",
      fileUpdates: [],
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
