import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createGitHubPullRequest,
  extractAssemblyMetadata,
  getGitHubComment,
  getGitHubPullRequest,
  updateGitHubPullRequestFromRun,
} from "../src/github.js";
import { getRunDir } from "../src/run-store.js";
import { appendEvent, initializeRun, writeRunFile, writeState } from "../src/run-store.js";

test("createGitHubPullRequest restores the starting branch after creating a PR", async () => {
  const { rootDir } = await createCompletedRunFixture();

  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (command === "git" && args.join(" ") === "branch --show-current") {
      return { stdout: "main\n" };
    }
    if (command === "git" && args.join(" ") === "status --porcelain") {
      return { stdout: " M README.md\n" };
    }
    if (command === "gh") {
      return { stdout: "https://github.com/example/repo/pull/1\n" };
    }
    return { stdout: "" };
  };

  const result = await createGitHubPullRequest("run-1", { rootDir, exec });
  const prBody = await readFile(path.join(getRunDir("run-1", rootDir), "github-pr-body.md"), "utf8");

  assert.equal(result.branchName, "assembly/run-1");
  assert.equal(result.restoredBranch, "main");
  assert.equal(result.url, "https://github.com/example/repo/pull/1");
  assert.deepEqual(
    calls.map((call) => [call.command, ...call.args.slice(0, 2)]),
    [
      ["git", "status", "--porcelain"],
      ["git", "branch", "--show-current"],
      ["git", "checkout", "-B"],
      ["git", "add", "--"],
      ["git", "commit", "-m"],
      ["git", "push", "-u"],
      ["gh", "pr", "create"],
      ["git", "checkout", "main"],
    ],
  );
  const addCall = calls.find((call) => call.command === "git" && call.args[0] === "add");
  assert.deepEqual(addCall.args, ["add", "--", "README.md"]);
  assert.match(prBody, /<!-- assembly:runId=run-1 -->/);
  assert.match(prBody, /<!-- assembly:branchName=assembly\/run-1 -->/);
});

test("createGitHubPullRequest rejects unrelated dirty files", async () => {
  const { rootDir } = await createCompletedRunFixture();
  const exec = async (command, args, options) => {
    if (command === "git" && args.join(" ") === "status --porcelain") {
      return { stdout: " M README.md\n M src/unrelated.js\n" };
    }
    if (command === "git" && args.join(" ") === "branch --show-current") {
      return { stdout: "main\n" };
    }
    return { stdout: "", stderr: "", options };
  };

  await assert.rejects(
    () => createGitHubPullRequest("run-1", { rootDir, exec }),
    /working tree has unrelated changes: src\/unrelated.js/,
  );
});

test("createGitHubPullRequest rejects runs without completed review", async () => {
  const { rootDir } = await createCompletedRunFixture({ includeReview: false });
  const exec = async (command, args) => {
    if (command === "git" && args.join(" ") === "status --porcelain") {
      return { stdout: " M README.md\n" };
    }
    if (command === "git" && args.join(" ") === "branch --show-current") {
      return { stdout: "main\n" };
    }
    return { stdout: "" };
  };

  await assert.rejects(
    () => createGitHubPullRequest("run-1", { rootDir, exec }),
    /does not have a completed review/,
  );
});

test("createGitHubPullRequest rejects failed verification", async () => {
  const { rootDir } = await createCompletedRunFixture({ verificationExitCode: 1 });
  const exec = async (command, args) => {
    if (command === "git" && args.join(" ") === "status --porcelain") {
      return { stdout: " M README.md\n" };
    }
    if (command === "git" && args.join(" ") === "branch --show-current") {
      return { stdout: "main\n" };
    }
    return { stdout: "" };
  };

  await assert.rejects(
    () => createGitHubPullRequest("run-1", { rootDir, exec }),
    /has failed verification/,
  );
});

test("updateGitHubPullRequestFromRun refreshes the existing PR body with the latest report", async () => {
  const { rootDir } = await createCompletedRunFixture({
    runId: "run-2",
    request: "Address feedback",
    metadata: {
      parentRunId: "run-1",
      followUpFeedback: "@assembly tighten docs",
    },
    report: "# Latest Report\n\nUpdated from follow-up.\n",
  });

  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (command === "git" && args.join(" ") === "status --porcelain") {
      return { stdout: " M README.md\n" };
    }
    return { stdout: "" };
  };

  const result = await updateGitHubPullRequestFromRun("run-2", {
    rootDir,
    branchName: "assembly/run-1",
    prNumber: 7,
    commentUrl: "https://github.com/example/repo/pull/7#issuecomment-1",
    exec,
  });
  const prBody = await readFile(path.join(getRunDir("run-2", rootDir), "github-pr-body.md"), "utf8");

  assert.equal(result.prNumber, 7);
  assert.deepEqual(
    calls.map((call) => [call.command, ...call.args.slice(0, 3)]),
    [
      ["git", "status", "--porcelain"],
      ["git", "add", "--", "README.md"],
      ["git", "commit", "-m", "Assembly follow-up: @assembly tighten docs"],
      ["git", "push", "origin", "assembly/run-1"],
      ["gh", "pr", "edit", "7"],
      ["gh", "pr", "comment", "--body"],
    ],
  );
  assert.match(prBody, /<!-- assembly:runId=run-2 -->/);
  assert.match(prBody, /<!-- assembly:branchName=assembly\/run-1 -->/);
  assert.match(prBody, /<!-- assembly:parentRunId=run-1 -->/);
  assert.match(prBody, /# Latest Report/);

  const editCall = calls.find((call) => call.command === "gh" && call.args[0] === "pr" && call.args[1] === "edit");
  assert.deepEqual(editCall.args, [
    "pr",
    "edit",
    "7",
    "--body-file",
    path.join(getRunDir("run-2", rootDir), "github-pr-body.md"),
  ]);
});

test("getGitHubComment reads comment body through gh api", async () => {
  const exec = async (command, args) => {
    assert.equal(command, "gh");
    assert.deepEqual(args, ["api", "repos/{owner}/{repo}/issues/comments/123"]);
    return {
      stdout: JSON.stringify({
        id: 123,
        body: "Please address this feedback",
        html_url: "https://github.com/example/repo/pull/1#issuecomment-123",
      }),
    };
  };

  assert.deepEqual(await getGitHubComment("123", { exec }), {
    id: "123",
    body: "Please address this feedback",
    url: "https://github.com/example/repo/pull/1#issuecomment-123",
  });
});

test("getGitHubPullRequest extracts Assembly metadata", async () => {
  const exec = async (command, args) => {
    assert.equal(command, "gh");
    assert.deepEqual(args, ["pr", "view", "7", "--json", "body,headRefName"]);
    return {
      stdout: JSON.stringify({
        body: "<!-- assembly:runId=run-1 -->\n<!-- assembly:branchName=assembly/run-1 -->\n# Body",
        headRefName: "assembly/run-1",
      }),
    };
  };

  assert.deepEqual(await getGitHubPullRequest(7, { exec }), {
    number: 7,
    body: "<!-- assembly:runId=run-1 -->\n<!-- assembly:branchName=assembly/run-1 -->\n# Body",
    branchName: "assembly/run-1",
    runId: "run-1",
  });
});

test("extractAssemblyMetadata parses metadata comments", () => {
  assert.deepEqual(
    extractAssemblyMetadata("<!-- assembly:runId=abc -->\n<!-- assembly:branchName=assembly/abc -->"),
    {
      runId: "abc",
      branchName: "assembly/abc",
    },
  );
});

async function createCompletedRunFixture({
  includeReview = true,
  verificationExitCode = 0,
  runId = "run-1",
  request = "Add docs",
  metadata = {},
  report = "# Report\n",
} = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-github-"));
  await mkdir(path.join(rootDir, ".assembly", "runs", runId), { recursive: true });
  const plan = {
    request: typeof request === "string" ? request : request.request,
    tasks: [
      {
        id: "add-docs-docs",
        owner: "implementation-agent",
        scope: {
          paths: [],
          allowlist: ["README.md"],
          denylist: [".env", ".git/", ".assembly/"],
        },
      },
      {
        id: "add-docs-review",
        owner: "review-agent",
        scope: {
          paths: ["tests/"],
          allowlist: ["README.md"],
          denylist: [".env", ".git/"],
        },
      },
    ],
    verification: ["npm test"],
  };
  const state = await initializeRun({ runId, request, plan, metadata }, rootDir);
  state.status = "complete";
  state.tasks = {
    "add-docs-docs": { status: "complete", owner: "implementation-agent", title: "Update docs" },
    "add-docs-review": { status: includeReview ? "complete" : "pending", owner: "review-agent", title: "Review" },
  };
  await writeState(runId, state, rootDir);
  await appendEvent(runId, {
    type: "files.updated",
    taskId: "add-docs-docs",
    data: { changedFiles: ["README.md"] },
  }, rootDir);
  await appendEvent(runId, {
    type: "task.complete",
    taskId: "add-docs-docs",
    data: { status: "complete", changedFiles: ["README.md"] },
  }, rootDir);
  await appendEvent(runId, {
    type: "verification.completed",
    data: { results: [{ command: "npm test", exitCode: verificationExitCode }] },
  }, rootDir);
  if (includeReview) {
    await appendEvent(runId, {
      type: "task.complete",
      taskId: "add-docs-review",
      data: { status: "complete", changedFiles: ["README.md"] },
    }, rootDir);
  }
  await writeRunFile(runId, "final-report.md", report, rootDir);
  return { rootDir };
}
