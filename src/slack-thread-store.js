import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const THREADS_DIR = ".assembly/slack-threads";

export async function readSlackThreadState({ teamId, channel, threadTs }, rootDir = process.cwd()) {
  try {
    return JSON.parse(await readFile(getThreadPath({ teamId, channel, threadTs }, rootDir), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeSlackThreadState(state, rootDir = process.cwd()) {
  await mkdir(path.join(rootDir, THREADS_DIR), { recursive: true });
  const updatedState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(getThreadPath(state, rootDir), `${JSON.stringify(updatedState, null, 2)}\n`);
  return updatedState;
}

function getThreadPath({ teamId, channel, threadTs }, rootDir) {
  const key = [teamId || "unknown-team", channel, threadTs].map(sanitizeKeyPart).join("__");
  return path.join(rootDir, THREADS_DIR, `${key}.json`);
}

function sanitizeKeyPart(value) {
  return String(value ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_");
}
