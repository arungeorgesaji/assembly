import { createRun } from "./orchestrator.js";
import { readRun } from "./run-store.js";

export async function createFollowUpRun(parentRunId, feedback, options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const parentRun = await readRun(parentRunId, rootDir);
  const normalizedFeedback = normalizeFeedback(feedback);
  const request = [
    `Follow up on run ${parentRunId}.`,
    `Original request: ${parentRun.request.request}`,
    `Feedback: ${normalizedFeedback}`,
  ].join(" ");

  return createRun(request, {
    ...options,
    rootDir,
    metadata: {
      parentRunId,
      parentRequest: parentRun.request.request,
      followUpFeedback: normalizedFeedback,
      source: options.source ?? { provider: "local", kind: "follow_up" },
    },
  });
}

function normalizeFeedback(feedback) {
  const normalized = String(feedback ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new Error("follow-up feedback cannot be empty");
  }
  return normalized;
}
