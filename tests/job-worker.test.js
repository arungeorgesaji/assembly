import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { enqueueJob } from "../src/job-store.js";
import { formatGitHubJobFailureComment, formatSlackJobFailureMessage, processJob } from "../src/job-worker.js";

test("processJob creates a run and PR for GitHub issue requests", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-issue-job-"));
  await mkdir(path.join(rootDir, "src"));
  await mkdir(path.join(rootDir, "tests"));
  await writeFile(path.join(rootDir, "README.md"), "# Demo\n");
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));

  const job = await enqueueJob({
    type: "github.issue_request",
    payload: {
      kind: "issues.opened",
      issueNumber: 12,
      issueTitle: "@assembly Add docs",
      issueBody: "Please add docs",
      feedback: "@assembly Add docs",
      url: "https://github.com/example/repo/issues/12",
    },
  }, rootDir);

  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (command === "git" && args.join(" ") === "status --porcelain") {
      return { stdout: "" };
    }
    if (command === "git" && args.join(" ") === "branch --show-current") {
      return { stdout: "main\n" };
    }
    if (command === "gh" && args[0] === "pr") {
      return { stdout: "https://github.com/example/repo/pull/2\n" };
    }
    return { stdout: "" };
  };

  const processed = await processJob(job.id, { rootDir, exec, agentRunner: async (task) => {
    if (task.owner === "implementation-agent") {
      return {
        taskId: task.id,
        status: "complete",
        summary: "Updated README.",
        changedFiles: ["README.md"],
        artifacts: ["result.json", "file-updates.json"],
        risks: [],
        fileUpdates: [{ path: "README.md", content: "# Demo\n\nAdded docs.\n" }],
      };
    }

    return {
      taskId: task.id,
      status: "complete",
      summary: "Completed.",
      changedFiles: [],
      artifacts: ["result.json"],
      risks: [],
    };
  } });

  assert.equal(processed.status, "complete");
  assert.equal(processed.result.issueNumber, 12);
  assert.equal(processed.result.pullRequest.url, "https://github.com/example/repo/pull/2");
  assert.ok(calls.some((call) => call.command === "gh" && call.args[0] === "issue" && call.args[1] === "comment"));
});

test("processJob comments on GitHub issue when issue request fails", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-issue-job-fail-"));
  await writeFile(path.join(rootDir, "README.md"), "# Demo\n");

  const job = await enqueueJob({
    type: "github.issue_request",
    payload: {
      kind: "issues.opened",
      issueNumber: 12,
      issueTitle: "@assembly Add docs",
      issueBody: "Please add docs",
      feedback: "@assembly Add docs",
      url: "https://github.com/example/repo/issues/12",
    },
  }, rootDir);

  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (command === "git" && args.join(" ") === "status --porcelain") {
      return { stdout: " M unrelated.js\n" };
    }
    if (command === "git" && args.join(" ") === "branch --show-current") {
      return { stdout: "main\n" };
    }
    return { stdout: "" };
  };

  const processed = await processJob(job.id, { rootDir, exec, agentRunner: async (task) => {
    if (task.owner === "implementation-agent") {
      return {
        taskId: task.id,
        status: "complete",
        summary: "Updated README.",
        changedFiles: ["README.md"],
        artifacts: ["result.json", "file-updates.json"],
        risks: [],
        fileUpdates: [{ path: "README.md", content: "# Demo\n\nAdded docs.\n" }],
      };
    }

    return {
      taskId: task.id,
      status: "complete",
      summary: "Completed.",
      changedFiles: [],
      artifacts: ["result.json"],
      risks: [],
    };
  } });

  assert.equal(processed.status, "failed");
  const commentCall = calls.find((call) => call.command === "gh" && call.args[0] === "issue" && call.args[1] === "comment");
  assert.ok(commentCall);
  const body = commentCall.args.at(-1);
  assert.match(body, /Job: /);
  assert.match(body, /Run: /);
  assert.match(body, /Retryable: yes/);
  assert.match(body, /Suggested next action: /);
});

test("processJob creates a run and replies to Slack requests", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-slack-job-"));
  await mkdir(path.join(rootDir, "src"));
  await mkdir(path.join(rootDir, "tests"));
  await writeFile(path.join(rootDir, "README.md"), "# Demo\n");
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));

  const job = await enqueueJob({
    type: "slack.request",
    payload: {
      kind: "app_mention",
      eventId: "Ev1",
      channel: "C1",
      user: "U1",
      teamId: "T1",
      text: "Add README docs",
      threadTs: "123.456",
    },
  }, rootDir);

  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (command === "git" && args.join(" ") === "status --porcelain") {
      return { stdout: "" };
    }
    if (command === "git" && args.join(" ") === "diff --name-only HEAD") {
      return { stdout: "README.md\n" };
    }
    if (command === "git" && args.join(" ") === "branch --show-current") {
      return { stdout: "main\n" };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "create") {
      return { stdout: "https://github.com/example/repo/pull/4\n" };
    }
    return { stdout: "" };
  };

  const previousToken = process.env.SLACK_BOT_TOKEN;
  const previousFetch = globalThis.fetch;
  const slackPosts = [];
  try {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    globalThis.fetch = async (url, options) => {
      slackPosts.push({ url, options, body: JSON.parse(options.body) });
      return { json: async () => ({ ok: true, ts: "124.000" }) };
    };

    const processed = await processJob(job.id, { rootDir, exec, agentRunner: async (task) => {
      if (task.owner === "implementation-agent") {
        return {
          taskId: task.id,
          status: "complete",
          summary: "Updated README.",
          changedFiles: ["README.md"],
          artifacts: ["result.json", "file-updates.json"],
          risks: [],
          fileUpdates: [{ path: "README.md", content: "# Demo\n\nAdded docs.\n" }],
        };
      }

      return {
        taskId: task.id,
        status: "complete",
        summary: "Completed.",
        changedFiles: [],
        artifacts: ["result.json"],
        risks: [],
      };
    } });

    assert.equal(processed.status, "complete");
    assert.equal(processed.result.channel, "C1");
    assert.equal(processed.result.pullRequest.url, "https://github.com/example/repo/pull/4");
    assert.equal(slackPosts.length, 1);
    assert.equal(slackPosts[0].body.channel, "C1");
    assert.equal(slackPosts[0].body.thread_ts, "123.456");
    assert.match(slackPosts[0].body.text, /Assembly created https:\/\/github\.com\/example\/repo\/pull\/4/);
  } finally {
    restoreEnv("SLACK_BOT_TOKEN", previousToken);
    globalThis.fetch = previousFetch;
  }
});

test("processJob updates the same PR for later Slack requests in the same thread", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-slack-follow-up-job-"));
  await mkdir(path.join(rootDir, "src"));
  await mkdir(path.join(rootDir, "tests"));
  await writeFile(path.join(rootDir, "README.md"), "# Demo\n");
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));

  const previousToken = process.env.SLACK_BOT_TOKEN;
  const previousFetch = globalThis.fetch;
  const slackPosts = [];
  try {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    globalThis.fetch = async (url, options) => {
      slackPosts.push({ url, options, body: JSON.parse(options.body) });
      return { json: async () => ({ ok: true, ts: "124.000" }) };
    };

    const firstJob = await enqueueJob({
      type: "slack.request",
      payload: {
        kind: "app_mention",
        eventId: "Ev1",
        channel: "C1",
        user: "U1",
        teamId: "T1",
        text: "Add README docs",
        threadTs: "123.456",
      },
    }, rootDir);
    const secondJob = await enqueueJob({
      type: "slack.request",
      payload: {
        kind: "app_mention",
        eventId: "Ev2",
        channel: "C1",
        user: "U1",
        teamId: "T1",
        text: "Tighten the wording",
        threadTs: "123.456",
      },
    }, rootDir);

    const calls = [];
    const exec = async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      if (command === "git" && args.join(" ") === "status --porcelain") {
        return { stdout: "" };
      }
      if (command === "git" && args.join(" ") === "diff --name-only HEAD") {
        return { stdout: "README.md\n" };
      }
      if (command === "git" && args.join(" ") === "branch --show-current") {
        return { stdout: "main\n" };
      }
      if (command === "gh" && args[0] === "pr" && args[1] === "create") {
        return { stdout: "https://github.com/example/repo/pull/4\n" };
      }
      if (command === "gh" && args[0] === "pr" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
            body: "<!-- assembly:runId=FIRST_RUN -->\n<!-- assembly:branchName=assembly/FIRST_RUN -->\n# Body",
            headRefName: "assembly/FIRST_RUN",
          }),
        };
      }
      return { stdout: "" };
    };
    const agentRunner = createReadmeAgentRunner();

    const first = await processJob(firstJob.id, { rootDir, exec, agentRunner });
    const firstRunId = first.result.runId;
    const second = await processJob(secondJob.id, { rootDir, exec: async (command, args, options) => {
      if (command === "gh" && args[0] === "pr" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
            body: `<!-- assembly:runId=${firstRunId} -->\n<!-- assembly:branchName=assembly/${firstRunId} -->\n# Body`,
            headRefName: `assembly/${firstRunId}`,
          }),
        };
      }
      return exec(command, args, options);
    }, agentRunner });

    assert.equal(second.status, "complete");
    assert.equal(second.result.pullRequest.number, 4);
    assert.equal(second.result.parentRunId, firstRunId);
    assert.ok(calls.some((call) => call.command === "gh" && call.args[0] === "pr" && call.args[1] === "edit"));
    assert.match(slackPosts.at(-1).body.text, /Assembly updated PR #4/);
  } finally {
    restoreEnv("SLACK_BOT_TOKEN", previousToken);
    globalThis.fetch = previousFetch;
  }
});

test("processJob comments on PR conversation comment failures", async () => {
  const result = await runFailingPrFeedbackJob({
    kind: "issue_comment",
    commentId: "101",
    feedback: "@assembly fix this",
    commentUrl: "https://github.com/example/repo/pull/5#issuecomment-101",
    prNumber: 5,
  });

  assert.equal(result.processed.status, "failed");
  assertFailureComment(result.calls, { retryable: false });
});

test("processJob comments on inline PR review comment failures", async () => {
  const result = await runFailingPrFeedbackJob({
    kind: "pull_request_review_comment",
    commentId: "102",
    feedback: "Inline review comment on src/app.js:4.\n\nFeedback: @assembly fix this",
    commentUrl: "https://github.com/example/repo/pull/5#discussion_r102",
    prNumber: 5,
    path: "src/app.js",
    line: 4,
    diffHunk: "@@ -1 +1 @@",
  });

  assert.equal(result.processed.status, "failed");
  assertFailureComment(result.calls, { retryable: false });
});

test("processJob comments on PR review submission failures", async () => {
  const result = await runFailingPrFeedbackJob({
    kind: "pull_request_review",
    reviewId: "103",
    feedback: "@assembly address requested changes",
    commentUrl: "https://github.com/example/repo/pull/5#pullrequestreview-103",
    prNumber: 5,
    reviewState: "changes_requested",
  });

  assert.equal(result.processed.status, "failed");
  assertFailureComment(result.calls, { retryable: false });
});

test("formatGitHubJobFailureComment includes useful recovery fields", () => {
  const body = formatGitHubJobFailureComment(
    {
      id: "job-1",
      runId: "run-2",
      parentRunId: "run-1",
      type: "github.pr_feedback",
    },
    new Error("gh failed"),
  );

  assert.match(body, /Assembly could not complete this request/);
  assert.match(body, /Job: job-1/);
  assert.match(body, /Run: run-2/);
  assert.match(body, /Parent run: run-1/);
  assert.match(body, /Retryable: yes/);
  assert.match(body, /node src\/cli\.js job retry job-1/);
});

test("formatSlackJobFailureMessage includes useful recovery fields", () => {
  const body = formatSlackJobFailureMessage(
    {
      id: "job-1",
      runId: "run-1",
      type: "slack.request",
    },
    new Error("OpenAI setup failed"),
  );

  assert.match(body, /Assembly could not complete this Slack request/);
  assert.match(body, /Job: job-1/);
  assert.match(body, /Run: run-1/);
  assert.match(body, /Retryable: yes/);
  assert.match(body, /node src\/cli\.js job retry job-1/);
});

async function runFailingPrFeedbackJob(payload) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-pr-feedback-fail-"));
  const job = await enqueueJob({
    type: "github.pr_feedback",
    payload,
  }, rootDir);

  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (command === "gh" && args[0] === "pr" && args[1] === "view") {
      return {
        stdout: JSON.stringify({
          body: "# Missing Assembly metadata",
          headRefName: "assembly/run-1",
        }),
      };
    }
    return { stdout: "" };
  };

  const processed = await processJob(job.id, { rootDir, exec });
  return { processed, calls };
}

function assertFailureComment(calls, { retryable }) {
  const commentCall = calls.find((call) => call.command === "gh" && call.args[0] === "pr" && call.args[1] === "comment");
  assert.ok(commentCall);
  const body = commentCall.args.at(-1);
  assert.match(body, /Job: /);
  assert.match(body, new RegExp(`Retryable: ${retryable ? "yes" : "no"}`));
  assert.match(body, /Suggested next action: /);
}

function createReadmeAgentRunner() {
  return async (task) => {
    if (task.owner === "implementation-agent") {
      return {
        taskId: task.id,
        status: "complete",
        summary: "Updated README.",
        changedFiles: ["README.md"],
        artifacts: ["result.json", "file-updates.json"],
        risks: [],
        fileUpdates: [{ path: "README.md", content: "# Demo\n\nAdded docs.\n" }],
      };
    }

    return {
      taskId: task.id,
      status: "complete",
      summary: "Completed.",
      changedFiles: [],
      artifacts: ["result.json"],
      risks: [],
    };
  };
}

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
