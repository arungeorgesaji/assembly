import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { enqueueJob, findJobByDelivery, listJobs, readJob, resetJobForRetry, updateJob } from "../src/job-store.js";

test("job store enqueues and updates jobs", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-jobs-"));

  const queued = await enqueueJob({ type: "test.job", payload: { ok: true } }, rootDir);
  assert.equal(queued.status, "queued");

  const read = await readJob(queued.id, rootDir);
  assert.equal(read.type, "test.job");

  const updated = await updateJob(queued.id, { status: "complete" }, rootDir);
  assert.equal(updated.status, "complete");
});

test("job store lists jobs, finds deliveries, and resets retry state", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-jobs-retry-"));

  const first = await enqueueJob({ type: "test.job", delivery: "delivery-1", payload: { ok: true } }, rootDir);
  const second = await enqueueJob({ type: "test.job", payload: { ok: false } }, rootDir);
  await updateJob(first.id, {
    status: "failed",
    startedAt: "2026-01-01T00:00:00.000Z",
    failedAt: "2026-01-01T00:01:00.000Z",
    error: "boom",
    result: { ok: false },
  }, rootDir);

  const jobs = await listJobs(rootDir);
  assert.equal(jobs.length, 2);
  assert.deepEqual(await findJobByDelivery("delivery-1", rootDir), await readJob(first.id, rootDir));
  assert.equal(await findJobByDelivery("missing", rootDir), null);

  const reset = await resetJobForRetry(first.id, rootDir);
  assert.equal(reset.status, "queued");
  assert.equal(reset.retryCount, 1);
  assert.equal(reset.error, undefined);
  assert.equal(reset.result, undefined);
  assert.equal(reset.startedAt, undefined);
  assert.equal(reset.failedAt, undefined);
  assert.equal(second.status, "queued");
});
