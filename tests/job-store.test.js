import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { enqueueJob, readJob, updateJob } from "../src/job-store.js";

test("job store enqueues and updates jobs", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-jobs-"));

  const queued = await enqueueJob({ type: "test.job", payload: { ok: true } }, rootDir);
  assert.equal(queued.status, "queued");

  const read = await readJob(queued.id, rootDir);
  assert.equal(read.type, "test.job");

  const updated = await updateJob(queued.id, { status: "complete" }, rootDir);
  assert.equal(updated.status, "complete");
});

