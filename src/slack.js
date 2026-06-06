import { getSlackBotToken } from "./config.js";

export async function postSlackMessage(
  { channel, text, threadTs },
  { token = getSlackBotToken(), fetchImpl = globalThis.fetch } = {},
) {
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is required to post Slack messages");
  }
  if (!fetchImpl) {
    throw new Error("fetch is required to post Slack messages");
  }

  const response = await fetchImpl("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs,
    }),
  });
  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Slack chat.postMessage failed: ${result.error ?? "unknown_error"}`);
  }
  return result;
}
