import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { getRunDir } from "./run-store.js";

export async function withTemporaryGitWorktree(rootDir, exec, callback) {
  const worktreeDir = await mkdtemp(path.join(tmpdir(), "assembly-worktree-"));
  let created = false;

  try {
    await exec("git", ["worktree", "add", "--detach", worktreeDir, "HEAD"], { cwd: rootDir });
    created = true;
    return await callback(worktreeDir);
  } finally {
    if (created) {
      try {
        await exec("git", ["worktree", "remove", "--force", worktreeDir], { cwd: rootDir });
      } catch {
        await rm(worktreeDir, { recursive: true, force: true });
      }
    } else {
      await rm(worktreeDir, { recursive: true, force: true });
    }
  }
}

export async function copyRunRecord(runId, fromRootDir, toRootDir) {
  const toRunDir = getRunDir(runId, toRootDir);
  await mkdir(path.dirname(toRunDir), { recursive: true });
  await cp(getRunDir(runId, fromRootDir), toRunDir, {
    recursive: true,
    force: true,
  });
}
