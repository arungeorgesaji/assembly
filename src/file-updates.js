import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateChangedFilesWithinScope } from "./scope.js";

export function validateFileUpdatesForTask(task, result) {
  const errors = [];

  if (result.fileUpdates === undefined) {
    return errors;
  }
  if (!Array.isArray(result.fileUpdates)) {
    return [`task ${task.id} result fileUpdates must be an array when provided`];
  }

  const updatePaths = [];
  for (const update of result.fileUpdates) {
    if (!update || typeof update !== "object" || Array.isArray(update)) {
      errors.push(`task ${task.id} fileUpdates entries must be objects`);
      continue;
    }
    if (typeof update.path !== "string" || update.path.trim() === "") {
      errors.push(`task ${task.id} fileUpdates entry must include a path`);
      continue;
    }
    if (typeof update.content !== "string") {
      errors.push(`task ${task.id} fileUpdates entry for ${update.path} must include string content`);
      continue;
    }
    updatePaths.push(update.path);
  }

  errors.push(...validateChangedFilesWithinScope(task, updatePaths));

  const declaredFiles = new Set(result.changedFiles);
  for (const updatePath of updatePaths) {
    if (!declaredFiles.has(updatePath)) {
      errors.push(`task ${task.id} updates ${updatePath} but result.changedFiles does not list it`);
    }
  }

  return errors;
}

export async function applyFileUpdates(fileUpdates, rootDir = process.cwd()) {
  for (const update of fileUpdates) {
    const destination = path.join(rootDir, update.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, update.content);
  }
}

export async function validateAdditiveFileUpdates(task, result, rootDir = process.cwd()) {
  if (task.changePolicy !== "additive" || !Array.isArray(result.fileUpdates)) {
    return [];
  }

  const errors = [];
  for (const update of result.fileUpdates) {
    const original = await readFile(path.join(rootDir, update.path), "utf8").catch(() => null);
    if (original === null) {
      continue;
    }

    if (!isLineSubsequence(original, update.content)) {
      errors.push(`task ${task.id} additive update for ${update.path} removes or rewrites existing lines`);
    }
  }

  return errors;
}

function isLineSubsequence(originalContent, updatedContent) {
  const originalLines = originalContent.split("\n");
  const updatedLines = updatedContent.split("\n");
  let updatedIndex = 0;

  for (const originalLine of originalLines) {
    while (updatedIndex < updatedLines.length && updatedLines[updatedIndex] !== originalLine) {
      updatedIndex += 1;
    }
    if (updatedIndex >= updatedLines.length) {
      return false;
    }
    updatedIndex += 1;
  }

  return true;
}
