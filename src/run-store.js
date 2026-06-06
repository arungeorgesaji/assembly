import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = ".assembly";
const RUNS_DIR = "runs";

export function createRunId(date = new Date()) {
  const timestamp = date.toISOString().replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${suffix}`;
}

export function getRunDir(runId, rootDir = process.cwd()) {
  return path.join(rootDir, ROOT_DIR, RUNS_DIR, runId);
}

export async function initializeRun({ runId, request, plan, metadata = {} }, rootDir = process.cwd()) {
  const runDir = getRunDir(runId, rootDir);
  await mkdir(path.join(runDir, "artifacts"), { recursive: true });

  const state = {
    runId,
    status: "created",
    currentTaskId: null,
    tasks: Object.fromEntries(
      plan.tasks.map((task) => [
        task.id,
        {
          status: "pending",
          owner: task.owner,
          title: task.title,
        },
      ]),
    ),
  };

  await writeJson(path.join(runDir, "request.json"), {
    id: runId,
    request,
    createdAt: new Date().toISOString(),
    ...metadata,
  });
  await writeJson(path.join(runDir, "plan.json"), plan);
  await writeJson(path.join(runDir, "state.json"), state);
  await appendEvent(runId, { type: "run.created", data: { request, metadata } }, rootDir);

  return state;
}

export async function readRun(runId, rootDir = process.cwd()) {
  const runDir = getRunDir(runId, rootDir);
  const [request, plan, state, eventsText] = await Promise.all([
    readJson(path.join(runDir, "request.json")),
    readJson(path.join(runDir, "plan.json")),
    readJson(path.join(runDir, "state.json")),
    readFile(path.join(runDir, "events.jsonl"), "utf8").catch(() => ""),
  ]);

  return {
    request,
    plan,
    state,
    events: eventsText
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  };
}

export async function writeState(runId, state, rootDir = process.cwd()) {
  await writeJson(path.join(getRunDir(runId, rootDir), "state.json"), state);
}

export async function writeArtifact(runId, taskId, name, data, rootDir = process.cwd()) {
  const artifactDir = path.join(getRunDir(runId, rootDir), "artifacts", taskId);
  await mkdir(artifactDir, { recursive: true });
  await writeJson(path.join(artifactDir, name), data);
}

export async function writeRunFile(runId, name, content, rootDir = process.cwd()) {
  await writeFile(path.join(getRunDir(runId, rootDir), name), content);
}

export async function appendEvent(runId, event, rootDir = process.cwd()) {
  const enrichedEvent = {
    runId,
    timestamp: new Date().toISOString(),
    ...event,
  };
  await writeFile(
    path.join(getRunDir(runId, rootDir), "events.jsonl"),
    `${JSON.stringify(enrichedEvent)}\n`,
    { flag: "a" },
  );
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}
