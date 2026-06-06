import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getRunDir, readRun } from "./run-store.js";

const execFileAsync = promisify(execFile);

export async function createGitHubPullRequest(runId, { rootDir = process.cwd(), exec = execFileAsync } = {}) {
  const run = await readRun(runId, rootDir);
  if (run.state.status !== "complete") {
    throw new Error(`run ${runId} must be complete before creating a pull request`);
  }

  const branchName = `assembly/${runId}`;
  const title = `Assembly: ${run.request.request}`;
  const reportPath = path.join(getRunDir(runId, rootDir), "final-report.md");
  const body = await readFile(reportPath, "utf8");
  const bodyPath = path.join(getRunDir(runId, rootDir), "github-pr-body.md");
  await writeFile(bodyPath, body);

  await exec("git", ["checkout", "-B", branchName], { cwd: rootDir });
  await exec("git", ["add", "."], { cwd: rootDir });
  await exec("git", ["commit", "-m", title], { cwd: rootDir });
  await exec("git", ["push", "-u", "origin", branchName], { cwd: rootDir });

  const { stdout } = await exec(
    "gh",
    ["pr", "create", "--title", title, "--body-file", bodyPath],
    { cwd: rootDir },
  );

  return {
    runId,
    branchName,
    title,
    url: stdout.trim(),
  };
}

export async function getGitHubComment(commentId, { rootDir = process.cwd(), exec = execFileAsync } = {}) {
  const { stdout } = await exec(
    "gh",
    ["api", `repos/{owner}/{repo}/issues/comments/${commentId}`],
    { cwd: rootDir },
  );
  const comment = JSON.parse(stdout);
  return {
    id: String(comment.id),
    body: comment.body,
    url: comment.html_url,
  };
}
