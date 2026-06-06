import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createRun } from "./orchestrator.js";
import { createFollowUpRun } from "./follow-up.js";
import { copyRunRecord, withTemporaryGitWorktree } from "./git-worktree.js";
import { createGitHubPullRequest, getGitHubPullRequest, updateGitHubPullRequestFromRun } from "./github.js";
import { readJob, updateJob } from "./job-store.js";

const execFileAsync = promisify(execFile);

export async function processJob(jobId, { rootDir = process.cwd(), exec = execFileAsync, agentRunner } = {}) {
  const job = await updateJob(jobId, { status: "running", startedAt: new Date().toISOString() }, rootDir);

  try {
    const result = await processTypedJob(job, { rootDir, exec, agentRunner });
    return updateJob(jobId, {
      status: "complete",
      completedAt: new Date().toISOString(),
      result,
    }, rootDir);
  } catch (error) {
    const latestJob = await readJob(jobId, rootDir).catch(() => job);
    await notifyGitHubJobFailure(latestJob, error, { rootDir, exec });
    return updateJob(jobId, {
      status: "failed",
      failedAt: new Date().toISOString(),
      error: error.message,
    }, rootDir);
  }
}

async function notifyGitHubJobFailure(job, error, { rootDir, exec }) {
  if (!job.type?.startsWith("github.")) {
    return;
  }

  const body = formatGitHubJobFailureComment(job, error);

  try {
    if (job.payload?.issueNumber) {
      await exec("gh", ["issue", "comment", String(job.payload.issueNumber), "--body", body], { cwd: rootDir });
      return;
    }

    if (job.payload?.prNumber) {
      await exec("gh", ["pr", "comment", String(job.payload.prNumber), "--body", body], { cwd: rootDir });
    }
  } catch {
    // Keep the original job failure as the source of truth.
  }
}

export function formatGitHubJobFailureComment(job, error) {
  const retryable = isRetryableJobFailure(error);
  return [
    "Assembly could not complete this request.",
    "",
    `Job: ${job.id}`,
    job.runId ? `Run: ${job.runId}` : null,
    job.parentRunId ? `Parent run: ${job.parentRunId}` : null,
    `Retryable: ${retryable ? "yes" : "no"}`,
    "",
    `Error: ${error.message}`,
    "",
    `Suggested next action: ${getFailureSuggestedAction(job, error, retryable)}`,
  ].filter(Boolean).join("\n");
}

function isRetryableJobFailure(error) {
  const message = String(error.message ?? "");
  if (/does not include Assembly run metadata|unsupported job type|invalid signature|invalid JSON/i.test(message)) {
    return false;
  }
  return true;
}

function getFailureSuggestedAction(job, error, retryable) {
  const message = String(error.message ?? "");
  if (/does not include Assembly run metadata/i.test(message)) {
    return "Open a new Assembly issue request or recreate the PR through Assembly so the PR body includes Assembly metadata.";
  }
  if (/working tree has unrelated changes/i.test(message)) {
    return `Retry this job after the branch/worktree is clean: node src/cli.js job retry ${job.id}`;
  }
  if (retryable) {
    return `Inspect the job, fix the underlying setup or code issue, then retry it: node src/cli.js job inspect ${job.id} --pretty && node src/cli.js job retry ${job.id}`;
  }
  return "Create a new request after correcting the event or repository state.";
}

export async function getJob(jobId, rootDir = process.cwd()) {
  return readJob(jobId, rootDir);
}

async function processTypedJob(job, context) {
  if (job.type === "github.pr_feedback") {
    return withTemporaryGitWorktree(context.rootDir, context.exec, (worktreeRootDir) => {
      return processGitHubPrFeedbackJob(job, {
        ...context,
        rootDir: worktreeRootDir,
        stateRootDir: context.rootDir,
      });
    });
  }
  if (job.type === "github.issue_request") {
    return withTemporaryGitWorktree(context.rootDir, context.exec, (worktreeRootDir) => {
      return processGitHubIssueRequestJob(job, {
        ...context,
        rootDir: worktreeRootDir,
        stateRootDir: context.rootDir,
      });
    });
  }
  throw new Error(`unsupported job type: ${job.type}`);
}

async function processGitHubPrFeedbackJob(job, { rootDir, stateRootDir, exec, agentRunner }) {
  const pr = await getGitHubPullRequest(job.payload.prNumber, { rootDir, exec });
  if (!pr.runId) {
    throw new Error(`pull request ${job.payload.prNumber} does not include Assembly run metadata`);
  }
  await updateJob(job.id, { parentRunId: pr.runId }, stateRootDir);

  await exec("git", ["fetch", "origin", pr.branchName], { cwd: rootDir });
  await exec("git", ["checkout", pr.branchName], { cwd: rootDir });
  await exec("git", ["pull", "--ff-only"], { cwd: rootDir });
  await copyRunRecord(pr.runId, stateRootDir, rootDir);

  const followUp = await createFollowUpRun(pr.runId, job.payload.feedback, {
    rootDir,
    agentRunner,
    source: {
      provider: "github",
      kind: job.payload.kind,
      id: job.payload.commentId ?? job.payload.reviewId,
      url: job.payload.commentUrl,
    },
  });
  await updateJob(job.id, { runId: followUp.runId }, stateRootDir);

  const delivery = await updateGitHubPullRequestFromRun(followUp.runId, {
    rootDir,
    branchName: pr.branchName,
    prNumber: pr.number,
    commentUrl: job.payload.commentUrl,
    exec,
  });
  await copyRunRecord(followUp.runId, rootDir, stateRootDir);

  return {
    parentRunId: pr.runId,
    followUpRunId: followUp.runId,
    delivery,
  };
}

async function processGitHubIssueRequestJob(job, { rootDir, stateRootDir, exec, agentRunner }) {
  const request = [
    `GitHub issue #${job.payload.issueNumber}: ${job.payload.issueTitle}`,
    job.payload.issueBody,
    job.payload.feedback,
  ].filter(Boolean).join("\n\n");

  const run = await createRun(request, {
    rootDir,
    agentRunner,
    metadata: {
      source: {
        provider: "github",
        kind: job.payload.kind,
        issueNumber: job.payload.issueNumber,
        url: job.payload.url,
      },
    },
  });

  await updateJob(job.id, { runId: run.runId }, stateRootDir);
  await copyRunRecord(run.runId, rootDir, stateRootDir);
  const pr = await createGitHubPullRequest(run.runId, { rootDir, exec });
  await copyRunRecord(run.runId, rootDir, stateRootDir);
  await exec("gh", [
    "issue",
    "comment",
    String(job.payload.issueNumber),
    "--body",
    `Assembly created ${pr.url} for run ${run.runId}.`,
  ], { cwd: rootDir });

  return {
    runId: run.runId,
    issueNumber: job.payload.issueNumber,
    pullRequest: pr,
  };
}
