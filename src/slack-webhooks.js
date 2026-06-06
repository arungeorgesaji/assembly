import { createHmac, timingSafeEqual } from "node:crypto";

import { getSlackSigningSecret } from "./config.js";
import { enqueueJob, findJobByDelivery } from "./job-store.js";

const FIVE_MINUTES_SECONDS = 60 * 5;

export function verifySlackSignature(
  rawBody,
  signature,
  timestamp,
  secret = getSlackSigningSecret(),
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!secret) {
    throw new Error("SLACK_SIGNING_SECRET is required for webhook verification");
  }
  if (!signature?.startsWith("v0=") || !timestamp) {
    return false;
  }
  if (Math.abs(nowSeconds - Number(timestamp)) > FIVE_MINUTES_SECONDS) {
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export async function handleSlackWebhook({ signature, timestamp, rawBody }, rootDir = process.cwd()) {
  if (!verifySlackSignature(rawBody, signature, timestamp)) {
    return { status: 401, body: { error: "invalid signature" } };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "invalid JSON payload" } };
  }

  if (payload.type === "url_verification") {
    return { status: 200, body: { challenge: payload.challenge } };
  }

  const normalized = normalizeSlackWebhook(payload);
  if (normalized.ignored) {
    return { status: 202, body: normalized };
  }

  const existingJob = await findJobByDelivery(normalized.delivery, rootDir);
  if (existingJob) {
    return { status: 202, body: { queued: false, duplicate: true, jobId: existingJob.id } };
  }

  const job = await enqueueJob({
    type: normalized.type,
    delivery: normalized.delivery,
    payload: normalized.payload,
  }, rootDir);

  return { status: 202, body: { queued: true, jobId: job.id } };
}

export function normalizeSlackWebhook(payload) {
  if (payload.type !== "event_callback") {
    return { ignored: true, reason: "unsupported slack payload type" };
  }

  const event = payload.event ?? {};
  if (event.bot_id || event.subtype === "bot_message") {
    return { ignored: true, reason: "bot messages are ignored" };
  }
  if (!["app_mention", "message"].includes(event.type)) {
    return { ignored: true, reason: "unsupported slack event type" };
  }
  if (event.type === "message" && event.channel_type !== "im") {
    return { ignored: true, reason: "non-DM messages must mention the app" };
  }

  const text = stripSlackAppMention(event.text ?? "").trim();
  if (!text) {
    return { ignored: true, reason: "slack event does not include a request" };
  }

  return {
    type: "slack.request",
    delivery: payload.event_id,
    payload: {
      kind: event.type,
      teamId: payload.team_id,
      eventId: payload.event_id,
      channel: event.channel,
      user: event.user,
      text,
      threadTs: event.thread_ts ?? event.ts,
      ts: event.ts,
    },
  };
}

function stripSlackAppMention(text) {
  return String(text).replace(/<@[A-Z0-9]+>\s*/gi, "");
}
