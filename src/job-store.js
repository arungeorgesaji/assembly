import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const JOBS_DIR = ".assembly/jobs";

export function createJobId(date = new Date()) {
  const timestamp = date.toISOString().replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${suffix}`;
}

export async function enqueueJob(job, rootDir = process.cwd()) {
  const jobId = job.id ?? createJobId();
  const queuedJob = {
    id: jobId,
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...job,
    id: jobId,
  };
  await writeJob(queuedJob, rootDir);
  return queuedJob;
}

export async function readJob(jobId, rootDir = process.cwd()) {
  return JSON.parse(await readFile(getJobPath(jobId, rootDir), "utf8"));
}

export async function listJobs(rootDir = process.cwd()) {
  let entries;
  try {
    entries = await readdir(path.join(rootDir, JOBS_DIR));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const jobs = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => JSON.parse(await readFile(path.join(rootDir, JOBS_DIR, entry), "utf8"))),
  );
  return jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function findJobByDelivery(delivery, rootDir = process.cwd()) {
  if (!delivery) {
    return null;
  }
  const jobs = await listJobs(rootDir);
  return jobs.find((job) => job.delivery === delivery) ?? null;
}

export async function updateJob(jobId, updates, rootDir = process.cwd()) {
  const job = await readJob(jobId, rootDir);
  const updatedJob = {
    ...job,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  await writeJob(updatedJob, rootDir);
  return updatedJob;
}

export async function resetJobForRetry(jobId, rootDir = process.cwd()) {
  const job = await readJob(jobId, rootDir);
  const retryCount = (job.retryCount ?? 0) + 1;
  const retriedAt = new Date().toISOString();
  const resetJob = {
    ...job,
    status: "queued",
    retryCount,
    retriedAt,
    updatedAt: retriedAt,
  };

  delete resetJob.startedAt;
  delete resetJob.completedAt;
  delete resetJob.failedAt;
  delete resetJob.error;
  delete resetJob.result;

  await writeJob(resetJob, rootDir);
  return resetJob;
}

async function writeJob(job, rootDir) {
  await mkdir(path.join(rootDir, JOBS_DIR), { recursive: true });
  await writeFile(getJobPath(job.id, rootDir), `${JSON.stringify(job, null, 2)}\n`);
}

function getJobPath(jobId, rootDir) {
  return path.join(rootDir, JOBS_DIR, `${jobId}.json`);
}
