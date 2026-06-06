import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getRunDir, readRun } from "./run-store.js";
import { validateChangedFilesWithinScope } from "./scope.js";

const execFileAsync = promisify(execFile);

export async function createGitHubPullRequest(runId, { rootDir = process.cwd(), exec = execFileAsync } = {}) {
  const run = await readRun(runId, rootDir);
  const changedFiles = getRunOwnedChangedFiles(run);
  await validateRunReadyForPullRequest(run, changedFiles, rootDir, exec);

  const startingBranch = await getCurrentBranch(rootDir, exec);
  const branchName = `assembly/${runId}`;
  const title = `Assembly: ${run.request.request}`;
  const reportPath = path.join(getRunDir(runId, rootDir), "final-report.md");
  const report = await readFile(reportPath, "utf8");
  const body = buildGitHubPullRequestBody(report, {
    runId,
    branchName,
  });
  const bodyPath = path.join(getRunDir(runId, rootDir), "github-pr-body.md");
  await writeFile(bodyPath, body);

  try {
    await exec("git", ["checkout", "-B", branchName], { cwd: rootDir });
    await exec("git", ["add", "--", ...changedFiles], { cwd: rootDir });
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
      restoredBranch: startingBranch,
    };
  } finally {
    if (startingBranch) {
      await exec("git", ["checkout", startingBranch], { cwd: rootDir });
    }
  }
}

export async function updateGitHubPullRequestFromRun(
  runId,
  { rootDir = process.cwd(), branchName, prNumber, commentUrl, exec = execFileAsync } = {},
) {
  const run = await readRun(runId, rootDir);
  const changedFiles = getRunOwnedChangedFiles(run);
  await validateRunReadyForPullRequest(run, changedFiles, rootDir, exec);

  if (!branchName) {
    throw new Error("branchName is required to update a pull request");
  }

  await exec("git", ["add", "--", ...changedFiles], { cwd: rootDir });
  await exec("git", ["commit", "-m", `Assembly follow-up: ${getRunTitleText(run)}`], { cwd: rootDir });
  await exec("git", ["push", "origin", branchName], { cwd: rootDir });

  const reportPath = path.join(getRunDir(runId, rootDir), "final-report.md");
  const report = await readFile(reportPath, "utf8");
  const bodyPath = path.join(getRunDir(runId, rootDir), "github-pr-body.md");
  const prBody = buildGitHubPullRequestBody(report, {
    runId,
    branchName,
    parentRunId: run.request.parentRunId,
  });
  await writeFile(bodyPath, prBody);
  await exec("gh", ["pr", "edit", String(prNumber ?? branchName), "--body-file", bodyPath], { cwd: rootDir });

  const body = [`Assembly handled this feedback with run ${runId}.`, "", report].join("\n");

  if (commentUrl) {
    await exec("gh", ["pr", "comment", "--body", body], { cwd: rootDir });
  }

  return {
    runId,
    branchName,
    prNumber,
    commentUrl,
  };
}

function getRunTitleText(run) {
  const title = run.request.followUpFeedback ?? run.request.request;
  if (typeof title === "string") {
    return title;
  }
  return JSON.stringify(title);
}

export async function validateRunReadyForPullRequest(run, changedFiles, rootDir, exec) {
  if (run.state.status !== "complete") {
    throw new Error(`run ${run.state.runId} must be complete before creating a pull request`);
  }

  if (changedFiles.length === 0) {
    throw new Error(`run ${run.state.runId} has no owned changed files to commit`);
  }

  const scopeErrors = validateRunChangedFileScopes(run, changedFiles);
  if (scopeErrors.length > 0) {
    throw new Error(scopeErrors.join("\n"));
  }

  if (hasFailedVerification(run)) {
    throw new Error(`run ${run.state.runId} has failed verification`);
  }

  if (!hasCompletedReview(run)) {
    throw new Error(`run ${run.state.runId} does not have a completed review`);
  }

  const dirtyFiles = await getDirtyFiles(rootDir, exec);
  const unrelatedDirtyFiles = dirtyFiles.filter((file) => !changedFiles.includes(file));
  if (unrelatedDirtyFiles.length > 0) {
    throw new Error(`working tree has unrelated changes: ${unrelatedDirtyFiles.join(", ")}`);
  }

  const finalDiffFiles = await getFinalDiffFiles(rootDir, exec);
  const missingDiffFiles = changedFiles.filter((file) => !finalDiffFiles.includes(file));
  if (missingDiffFiles.length > 0) {
    throw new Error(
      `run ${run.state.runId} owns files with no current git diff: ${missingDiffFiles.join(", ")}. ` +
      "Create the PR before committing those changes to the base branch, or create a new run from the current branch.",
    );
  }

  const unownedDiffFiles = finalDiffFiles.filter((file) => !changedFiles.includes(file));
  if (unownedDiffFiles.length > 0) {
    throw new Error(`final diff includes files not owned by run ${run.state.runId}: ${unownedDiffFiles.join(", ")}`);
  }
}

export function getRunOwnedChangedFiles(run) {
  const files = new Set();
  for (const event of run.events) {
    if (!["task.complete", "files.updated", "patch.applied"].includes(event.type)) {
      continue;
    }
    for (const file of event.data?.changedFiles ?? []) {
      files.add(file);
    }
  }
  return [...files].sort();
}

function validateRunChangedFileScopes(run, changedFiles) {
  const errors = [];
  const taskById = new Map(run.plan.tasks.map((task) => [task.id, task]));

  for (const event of run.events) {
    if (!["task.complete", "files.updated", "patch.applied"].includes(event.type)) {
      continue;
    }

    const task = taskById.get(event.taskId);
    if (!task) {
      continue;
    }

    const eventChangedFiles = (event.data?.changedFiles ?? []).filter((file) => changedFiles.includes(file));
    errors.push(...validateChangedFilesWithinScope(task, eventChangedFiles));
  }

  return errors;
}

function hasFailedVerification(run) {
  return run.events
    .filter((event) => event.type === "verification.completed")
    .some((event) => event.data.results.some((result) => result.exitCode !== 0));
}

function hasCompletedReview(run) {
  return run.events.some((event) => {
    if (event.type !== "task.complete") {
      return false;
    }
    const task = run.plan.tasks.find((candidate) => candidate.id === event.taskId);
    return task?.owner === "review-agent" && event.data?.status === "complete";
  });
}

async function getDirtyFiles(rootDir, exec) {
  const { stdout } = await exec("git", ["status", "--porcelain"], { cwd: rootDir });
  return stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => parsePorcelainChangedFiles(line))
    .sort();
}

async function getFinalDiffFiles(rootDir, exec) {
  const { stdout } = await exec("git", ["diff", "--name-only", "HEAD"], { cwd: rootDir });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function parsePorcelainChangedFiles(line) {
  const pathText = line.slice(3);
  if (line.startsWith("R ") || line.startsWith(" R") || line.startsWith("RM") || line.startsWith("AM")) {
    const [from, to] = pathText.split(" -> ");
    return [from, to].filter(Boolean);
  }
  return [pathText];
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

export async function getGitHubPullRequest(prNumber, { rootDir = process.cwd(), exec = execFileAsync } = {}) {
  const { stdout } = await exec(
    "gh",
    ["pr", "view", String(prNumber), "--json", "body,headRefName"],
    { cwd: rootDir },
  );
  const pr = JSON.parse(stdout);
  return {
    number: Number(prNumber),
    body: pr.body ?? "",
    branchName: pr.headRefName,
    runId: extractAssemblyMetadata(pr.body ?? "").runId,
  };
}

export function extractAssemblyMetadata(body) {
  const metadata = {};
  for (const match of String(body ?? "").matchAll(/<!--\s*assembly:([a-zA-Z0-9_-]+)=([^>]+?)\s*-->/g)) {
    metadata[match[1]] = match[2].trim();
  }
  return metadata;
}

export function buildGitHubPullRequestBody(body, metadata) {
  const lines = Object.entries(metadata).map(([key, value]) => `<!-- assembly:${key}=${value} -->`);
  return [...lines, "", body].join("\n");
}

async function getCurrentBranch(rootDir, exec) {
  const { stdout } = await exec("git", ["branch", "--show-current"], { cwd: rootDir });
  return stdout.trim();
}
