import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runStubAgent } from "../src/agent-runner.js";
import { createFollowUpRun } from "../src/follow-up.js";
import { createRun } from "../src/orchestrator.js";
import { readRun } from "../src/run-store.js";

test("createFollowUpRun creates a child run with parent metadata", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-follow-up-"));
  const parent = await createRun("Add original docs", { rootDir, agentRunner: runStubAgent });

  const followUp = await createFollowUpRun(parent.runId, "Make the wording shorter", {
    rootDir,
    agentRunner: runStubAgent,
  });
  const run = await readRun(followUp.runId, rootDir);

  assert.equal(run.request.parentRunId, parent.runId);
  assert.equal(run.request.parentRequest, "Add original docs");
  assert.equal(run.request.followUpFeedback, "Make the wording shorter");
  assert.equal(run.request.source.provider, "local");
  assert.match(run.request.request, /Follow up on run/);
});

