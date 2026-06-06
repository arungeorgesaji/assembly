import { createHmac, timingSafeEqual } from "node:crypto";

import { getGitHubWebhookSecret } from "./config.js";
import { enqueueJob } from "./job-store.js";

export function verifyGitHubSignature(rawBody, signature, secret = getGitHubWebhookSecret()) {
  if (!secret) {
    throw new Error("GITHUB_WEBHOOK_SECRET is required for webhook verification");
  }
  if (!signature?.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export async function handleGitHubWebhook({ event, delivery, signature, rawBody }, rootDir = process.cwd()) {
  if (!verifyGitHubSignature(rawBody, signature)) {
    return { status: 401, body: { error: "invalid signature" } };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "invalid JSON payload" } };
  }
  const normalized = normalizeGitHubWebhook(event, payload);
  if (normalized.ignored) {
    return { status: 202, body: normalized };
  }

  const job = await enqueueJob({
    type: normalized.type,
    delivery,
    payload: normalized.payload,
  }, rootDir);

  return { status: 202, body: { queued: true, jobId: job.id } };
}

export function normalizeGitHubWebhook(event, payload) {
  if (event === "issue_comment" && payload.action === "created") {
    const body = payload.comment?.body ?? "";
    if (!mentionsAssembly(body)) {
      return { ignored: true, reason: "comment does not mention @assembly" };
    }

    if (payload.issue?.pull_request) {
      return {
        type: "github.pr_feedback",
        payload: {
          kind: "issue_comment",
          commentId: String(payload.comment.id),
          feedback: body,
          commentUrl: payload.comment.html_url,
          prNumber: payload.issue.number,
        },
      };
    }

    return {
      type: "github.issue_request",
      payload: {
        kind: "issue_comment",
        issueNumber: payload.issue.number,
        issueTitle: payload.issue.title ?? "",
        issueBody: payload.issue.body ?? "",
        feedback: body,
        url: payload.comment.html_url,
      },
    };
  }

  if (event === "pull_request_review_comment" && payload.action === "created") {
    const body = payload.comment?.body ?? "";
    if (!mentionsAssembly(body)) {
      return { ignored: true, reason: "comment does not mention @assembly" };
    }

    return {
      type: "github.pr_feedback",
      payload: {
        kind: "pull_request_review_comment",
        commentId: String(payload.comment.id),
        feedback: formatInlineCommentFeedback(payload.comment),
        commentUrl: payload.comment.html_url,
        prNumber: payload.pull_request.number,
        path: payload.comment.path,
        line: payload.comment.line ?? payload.comment.original_line,
        diffHunk: payload.comment.diff_hunk,
      },
    };
  }

  if (event === "pull_request_review" && payload.action === "submitted") {
    const body = payload.review?.body ?? "";
    if (!mentionsAssembly(body)) {
      return { ignored: true, reason: "review does not mention @assembly" };
    }

    return {
      type: "github.pr_feedback",
      payload: {
        kind: "pull_request_review",
        reviewId: String(payload.review.id),
        feedback: body,
        commentUrl: payload.review.html_url,
        prNumber: payload.pull_request.number,
        reviewState: payload.review.state,
      },
    };
  }

  if (event === "issues" && ["opened", "edited"].includes(payload.action)) {
    if (payload.issue?.pull_request) {
      return { ignored: true, reason: "issue event is for a pull request" };
    }

    const requestText = [payload.issue?.title, payload.issue?.body].filter(Boolean).join("\n\n");
    if (!mentionsAssembly(requestText)) {
      return { ignored: true, reason: "issue does not mention @assembly" };
    }

    return {
      type: "github.issue_request",
      payload: {
        kind: `issues.${payload.action}`,
        issueNumber: payload.issue.number,
        issueTitle: payload.issue.title ?? "",
        issueBody: payload.issue.body ?? "",
        feedback: requestText,
        url: payload.issue.html_url,
      },
    };
  }

  return { ignored: true, reason: "unsupported event" };
}

function mentionsAssembly(text) {
  return /(^|\s)@assembly\b/i.test(text ?? "");
}

function formatInlineCommentFeedback(comment) {
  return [
    `Inline review comment on ${comment.path}${comment.line ? `:${comment.line}` : ""}.`,
    comment.diff_hunk ? `Diff hunk:\n${comment.diff_hunk}` : "",
    `Feedback: ${comment.body}`,
  ].filter(Boolean).join("\n\n");
}
