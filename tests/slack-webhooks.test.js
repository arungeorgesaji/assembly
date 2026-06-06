import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { handleSlackWebhook, normalizeSlackWebhook, verifySlackSignature } from "../src/slack-webhooks.js";
import { readJob } from "../src/job-store.js";

test("verifySlackSignature validates Slack v0 signatures", () => {
  const rawBody = JSON.stringify({ ok: true });
  const timestamp = "1000";
  const signature = `v0=${createHmac("sha256", "secret").update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;

  assert.equal(verifySlackSignature(rawBody, signature, timestamp, "secret", 1000), true);
  assert.equal(verifySlackSignature(rawBody, signature, timestamp, "wrong", 1000), false);
  assert.equal(verifySlackSignature(rawBody, signature, timestamp, "secret", 2000), false);
});

test("handleSlackWebhook answers url verification challenges", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-slack-url-"));
  const previousSecret = process.env.SLACK_SIGNING_SECRET;
  const rawBody = JSON.stringify({ type: "url_verification", challenge: "challenge-token" });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signSlackBody(rawBody, timestamp, "secret");

  try {
    process.env.SLACK_SIGNING_SECRET = "secret";
    const result = await handleSlackWebhook({ signature, timestamp, rawBody }, rootDir);
    assert.deepEqual(result, { status: 200, body: { challenge: "challenge-token" } });
  } finally {
    restoreEnv("SLACK_SIGNING_SECRET", previousSecret);
  }
});

test("handleSlackWebhook queues Slack app mentions and deduplicates event ids", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-slack-event-"));
  const previousSecret = process.env.SLACK_SIGNING_SECRET;
  const previousToken = process.env.SLACK_BOT_TOKEN;
  const previousFetch = globalThis.fetch;
  const rawBody = JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event_id: "Ev1",
    event: {
      type: "app_mention",
      user: "U1",
      channel: "C1",
      ts: "123.456",
      text: "<@UASSEMBLY> Add README docs",
    },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signSlackBody(rawBody, timestamp, "secret");

  try {
    process.env.SLACK_SIGNING_SECRET = "secret";
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const slackPosts = [];
    globalThis.fetch = async (url, options) => {
      slackPosts.push({ url, body: JSON.parse(options.body) });
      return { json: async () => ({ ok: true, ts: "124.000" }) };
    };

    const first = await handleSlackWebhook({ signature, timestamp, rawBody }, rootDir);
    const second = await handleSlackWebhook({ signature, timestamp, rawBody }, rootDir);

    assert.equal(first.status, 202);
    assert.equal(first.body.queued, true);
    assert.deepEqual(second.body, {
      queued: false,
      duplicate: true,
      jobId: first.body.jobId,
    });

    const job = await readJob(first.body.jobId, rootDir);
    assert.equal(job.type, "slack.request");
    assert.equal(job.delivery, "Ev1");
    assert.equal(job.payload.text, "Add README docs");
    assert.equal(job.payload.threadTs, "123.456");
    assert.equal(slackPosts.length, 1);
    assert.equal(slackPosts[0].body.channel, "C1");
    assert.equal(slackPosts[0].body.thread_ts, "123.456");
    assert.match(slackPosts[0].body.text, /^On it\. Queued Assembly job /);
  } finally {
    restoreEnv("SLACK_SIGNING_SECRET", previousSecret);
    restoreEnv("SLACK_BOT_TOKEN", previousToken);
    globalThis.fetch = previousFetch;
  }
});

test("normalizeSlackWebhook supports direct messages", () => {
  const normalized = normalizeSlackWebhook({
    type: "event_callback",
    team_id: "T1",
    event_id: "Ev2",
    event: {
      type: "message",
      channel_type: "im",
      user: "U1",
      channel: "D1",
      ts: "222.333",
      text: "Add a CLI command",
    },
  });

  assert.equal(normalized.type, "slack.request");
  assert.equal(normalized.payload.kind, "message");
  assert.equal(normalized.payload.channel, "D1");
  assert.equal(normalized.payload.text, "Add a CLI command");
});

test("normalizeSlackWebhook ignores bot and non-DM message events", () => {
  assert.equal(normalizeSlackWebhook({
    type: "event_callback",
    event_id: "Ev3",
    event: { type: "app_mention", bot_id: "B1", text: "<@UASSEMBLY> hi" },
  }).ignored, true);

  assert.equal(normalizeSlackWebhook({
    type: "event_callback",
    event_id: "Ev4",
    event: { type: "message", channel_type: "channel", text: "hello" },
  }).ignored, true);
});

function signSlackBody(rawBody, timestamp, secret) {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
}

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
