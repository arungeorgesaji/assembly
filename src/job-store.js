import { mkdir, readFile, writeFile } from "node:fs/promises";
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

async function writeJob(job, rootDir) {
  await mkdir(path.join(rootDir, JOBS_DIR), { recursive: true });
  await writeFile(getJobPath(job.id, rootDir), `${JSON.stringify(job, null, 2)}\n`);
}

function getJobPath(jobId, rootDir) {
  return path.join(rootDir, JOBS_DIR, `${jobId}.json`);
}

