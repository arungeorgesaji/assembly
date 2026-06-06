import { spawn } from "node:child_process";

import { validateChangedFilesWithinScope } from "./scope.js";

export function extractPatchChangedFiles(patch) {
  const files = new Set();

  for (const line of String(patch ?? "").split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match) {
        files.add(match[1]);
        files.add(match[2]);
      }
      continue;
    }

    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      const rawPath = line.slice(4).trim().split(/\t/)[0];
      if (rawPath === "/dev/null") {
        continue;
      }
      files.add(rawPath.replace(/^a\//, "").replace(/^b\//, ""));
    }
  }

  return [...files].sort();
}

export function validatePatchForTask(task, result) {
  const errors = [];
  if (!result.patch) {
    return errors;
  }

  const patchFiles = extractPatchChangedFiles(result.patch);
  if (patchFiles.length === 0) {
    errors.push(`task ${task.id} patch does not include changed files`);
    return errors;
  }

  errors.push(...validateChangedFilesWithinScope(task, patchFiles));

  const declaredFiles = new Set(result.changedFiles);
  for (const patchFile of patchFiles) {
    if (!declaredFiles.has(patchFile)) {
      errors.push(`task ${task.id} patch changes ${patchFile} but result.changedFiles does not list it`);
    }
  }

  return errors;
}

export async function applyPatch(patch, rootDir = process.cwd()) {
  await runGitApply(["apply", "--check", "-"], patch, rootDir);
  await runGitApply(["apply", "-"], patch, rootDir);
}

function runGitApply(args, patch, rootDir) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: rootDir });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `git ${args.join(" ")} failed with code ${code}`));
      }
    });

    child.stdin.end(patch);
  });
}
