import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createOpenAIReviewRunner } from "../src/review-agent-runner.js";
import { initializeRun } from "../src/run-store.js";

test("OpenAI review runner posts run context and parses structured review", async () => {
  const previousFetch = globalThis.fetch;
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-review-runner-"));
  await mkdir(path.join(rootDir, "tests"));
  await writeFile(path.join(rootDir, "README.md"), "# Demo\n");

  const plan = {
    request: "Review docs",
    tasks: [
      {
        id: "review-docs-review",
        title: "Verify and review output",
        owner: "review-agent",
        agentProfileId: "agent-review-docs",
        scope: { paths: ["tests/"], allowlist: ["README.md"], denylist: [".env"] },
        dependencies: [],
        acceptanceCriteria: ["Review result is structured."],
      },
    ],
    agentProfiles: [
      {
        id: "agent-review-docs",
        dispatchOwner: "review-agent",
        focus: "tests/, README.md",
        ownedPaths: ["tests/", "README.md"],
        deniedPaths: [".env"],
        instructions: ["Review ownership boundaries."],
        taskIds: ["review-docs-review"],
      },
    ],
    verification: [],
  };
  await initializeRun({ runId: "review-run", request: plan.request, plan }, rootDir);

  try {
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      const userPayload = JSON.parse(body.input[1].content[0].text);

      assert.equal(url, "https://example.test/v1/responses");
      assert.equal(userPayload.request, "Review docs");
      assert.equal(userPayload.agentProfile.id, "agent-review-docs");
      assert.equal(userPayload.scopedFiles[0].path, "README.md");

      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            taskId: "review-docs-review",
            status: "complete",
            summary: "Review passed.",
            changedFiles: [],
            artifacts: ["result.json"],
            risks: [],
            patch: "",
            fileUpdates: [],
          }),
        }),
      };
    };

    const runner = createOpenAIReviewRunner({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://example.test/v1",
    });

    assert.deepEqual(
      await runner(plan.tasks[0], { rootDir, runId: "review-run" }),
      {
        taskId: "review-docs-review",
        status: "complete",
        summary: "Review passed.",
        changedFiles: [],
        artifacts: ["result.json"],
        risks: [],
        patch: "",
        fileUpdates: [],
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
