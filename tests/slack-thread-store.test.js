import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readSlackThreadState, writeSlackThreadState } from "../src/slack-thread-store.js";

test("slack thread store persists PR mapping for a Slack thread", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-slack-thread-"));
  const thread = {
    teamId: "T1",
    channel: "C1",
    threadTs: "123.456",
  };

  assert.equal(await readSlackThreadState(thread, rootDir), null);

  const written = await writeSlackThreadState({
    ...thread,
    runId: "run-1",
    pullRequest: {
      number: 4,
      url: "https://github.com/example/repo/pull/4",
      branchName: "assembly/run-1",
    },
  }, rootDir);

  const read = await readSlackThreadState(thread, rootDir);
  assert.equal(read.runId, "run-1");
  assert.equal(read.updatedAt, written.updatedAt);
  assert.deepEqual(read.pullRequest, {
    number: 4,
    url: "https://github.com/example/repo/pull/4",
    branchName: "assembly/run-1",
  });
});
