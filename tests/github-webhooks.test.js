import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { handleGitHubWebhook, normalizeGitHubWebhook, verifyGitHubSignature } from "../src/github-webhooks.js";
import { readJob } from "../src/job-store.js";

test("verifyGitHubSignature validates sha256 signatures", () => {
  const body = JSON.stringify({ ok: true });
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;

  assert.equal(verifyGitHubSignature(body, signature, "secret"), true);
  assert.equal(verifyGitHubSignature(body, signature, "wrong"), false);
});

test("handleGitHubWebhook queues @assembly PR comments", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-webhook-"));
  const previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const rawBody = JSON.stringify({
    action: "created",
    issue: {
      number: 7,
      pull_request: {},
    },
    comment: {
      id: 123,
      body: "@assembly please address this",
      html_url: "https://github.com/example/repo/pull/7#issuecomment-123",
    },
  });
  const signature = `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`;

  try {
    process.env.GITHUB_WEBHOOK_SECRET = "secret";
    const result = await handleGitHubWebhook({
      event: "issue_comment",
      delivery: "delivery-1",
      signature,
      rawBody,
    }, rootDir);

    assert.equal(result.status, 202);
    assert.equal(result.body.queued, true);

    const job = await readJob(result.body.jobId, rootDir);
    assert.equal(job.type, "github.pr_feedback");
    assert.equal(job.payload.prNumber, 7);
    assert.equal(job.payload.commentId, "123");
  } finally {
    if (previousSecret === undefined) {
      delete process.env.GITHUB_WEBHOOK_SECRET;
    } else {
      process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
    }
  }
});

test("handleGitHubWebhook ignores duplicate deliveries", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-webhook-duplicate-"));
  const previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const rawBody = JSON.stringify({
    action: "created",
    issue: {
      number: 7,
      pull_request: {},
    },
    comment: {
      id: 123,
      body: "@assembly please address this",
      html_url: "https://github.com/example/repo/pull/7#issuecomment-123",
    },
  });
  const signature = `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`;

  try {
    process.env.GITHUB_WEBHOOK_SECRET = "secret";
    const first = await handleGitHubWebhook({
      event: "issue_comment",
      delivery: "delivery-1",
      signature,
      rawBody,
    }, rootDir);
    const second = await handleGitHubWebhook({
      event: "issue_comment",
      delivery: "delivery-1",
      signature,
      rawBody,
    }, rootDir);

    assert.equal(first.body.queued, true);
    assert.deepEqual(second.body, {
      queued: false,
      duplicate: true,
      jobId: first.body.jobId,
    });
  } finally {
    if (previousSecret === undefined) {
      delete process.env.GITHUB_WEBHOOK_SECRET;
    } else {
      process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
    }
  }
});


test("normalizeGitHubWebhook creates issue request jobs for normal issue comments", () => {
  assert.deepEqual(
    normalizeGitHubWebhook("issue_comment", {
      action: "created",
      issue: {
        number: 8,
        title: "Add feature",
        body: "Please build this",
      },
      comment: {
        id: 456,
        body: "@assembly do this",
        html_url: "https://github.com/example/repo/issues/8#issuecomment-456",
      },
    }),
    {
      type: "github.issue_request",
      payload: {
        kind: "issue_comment",
        issueNumber: 8,
        issueTitle: "Add feature",
        issueBody: "Please build this",
        feedback: "@assembly do this",
        url: "https://github.com/example/repo/issues/8#issuecomment-456",
      },
    },
  );
});

test("normalizeGitHubWebhook creates issue request jobs for opened issues", () => {
  assert.equal(
    normalizeGitHubWebhook("issues", {
      action: "opened",
      issue: {
        number: 9,
        title: "@assembly Add CLI docs",
        body: "Please document the CLI",
        html_url: "https://github.com/example/repo/issues/9",
      },
    }).type,
    "github.issue_request",
  );
});

test("normalizeGitHubWebhook creates PR feedback jobs for inline review comments", () => {
  const normalized = normalizeGitHubWebhook("pull_request_review_comment", {
    action: "created",
    pull_request: { number: 10 },
    comment: {
      id: 789,
      body: "@assembly fix this line",
      html_url: "https://github.com/example/repo/pull/10#discussion_r789",
      path: "src/planner.js",
      line: 42,
      diff_hunk: "@@ -1 +1 @@",
    },
  });

  assert.equal(normalized.type, "github.pr_feedback");
  assert.equal(normalized.payload.kind, "pull_request_review_comment");
  assert.equal(normalized.payload.prNumber, 10);
  assert.equal(normalized.payload.path, "src/planner.js");
  assert.match(normalized.payload.feedback, /Inline review comment on src\/planner.js:42/);
});

test("normalizeGitHubWebhook creates PR feedback jobs for review submissions", () => {
  assert.deepEqual(
    normalizeGitHubWebhook("pull_request_review", {
      action: "submitted",
      pull_request: { number: 11 },
      review: {
        id: 999,
        body: "@assembly address requested changes",
        html_url: "https://github.com/example/repo/pull/11#pullrequestreview-999",
        state: "changes_requested",
      },
    }),
    {
      type: "github.pr_feedback",
      payload: {
        kind: "pull_request_review",
        reviewId: "999",
        feedback: "@assembly address requested changes",
        commentUrl: "https://github.com/example/repo/pull/11#pullrequestreview-999",
        prNumber: 11,
        reviewState: "changes_requested",
      },
    },
  );
});

test("handleGitHubWebhook ignores comments without mention", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-webhook-ignore-"));
  const previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const rawBody = JSON.stringify({
    action: "created",
    issue: { number: 7, pull_request: {} },
    comment: { id: 123, body: "looks good", html_url: "url" },
  });
  const signature = `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`;

  try {
    process.env.GITHUB_WEBHOOK_SECRET = "secret";
    const result = await handleGitHubWebhook({
      event: "issue_comment",
      delivery: "delivery-1",
      signature,
      rawBody,
    }, rootDir);

    assert.deepEqual(result, {
      status: 202,
      body: { ignored: true, reason: "comment does not mention @assembly" },
    });
  } finally {
    if (previousSecret === undefined) {
      delete process.env.GITHUB_WEBHOOK_SECRET;
    } else {
      process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
    }
  }
});
