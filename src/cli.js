#!/usr/bin/env node

import { createPlan } from "./planner.js";
import { createRun } from "./orchestrator.js";
import { createFollowUpRun } from "./follow-up.js";
import { createGitHubPullRequest, getGitHubComment } from "./github.js";
import { readRun } from "./run-store.js";
import { loadEnv } from "./config.js";
import { validatePlan } from "./validation.js";

export async function main(argv = process.argv.slice(2), io = process) {
  await loadEnv();
  const [command, ...args] = argv;

  if (!["plan", "run", "follow-up", "status", "inspect", "github"].includes(command)) {
    io.stderr.write("usage: assembly <plan|run|follow-up|status|inspect|github> ...\n");
    return 2;
  }

  if (command === "plan") {
    return handlePlan(args, io);
  }
  if (command === "run") {
    return handleRun(args, io);
  }
  if (command === "follow-up") {
    return handleFollowUp(args, io);
  }
  if (command === "status") {
    return handleStatus(args, io);
  }
  if (command === "inspect") {
    return handleInspect(args, io);
  }
  return handleGitHub(args, io);
}

function handlePlan(args, io) {
  const pretty = args.includes("--pretty");
  const request = args.filter((arg) => arg !== "--pretty").join(" ");

  let plan;
  try {
    plan = createPlan(request);
  } catch (error) {
    io.stderr.write(`error: ${error.message}\n`);
    return 2;
  }

  const errors = validatePlan(plan);
  if (errors.length > 0) {
    for (const error of errors) {
      io.stderr.write(`error: ${error}\n`);
    }
    return 1;
  }

  io.stdout.write(`${JSON.stringify(plan, null, pretty ? 2 : 0)}\n`);
  return 0;
}

async function handleRun(args, io) {
  const pretty = args.includes("--pretty");
  const request = args.filter((arg) => arg !== "--pretty").join(" ");

  try {
    const run = await createRun(request);
    io.stdout.write(`${JSON.stringify(run, null, pretty ? 2 : 0)}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error.message}\n`);
    return 1;
  }
}

async function handleFollowUp(args, io) {
  const pretty = args.includes("--pretty");
  const filteredArgs = args.filter((arg) => arg !== "--pretty");
  const parentRunId = filteredArgs[0];
  const feedback = filteredArgs.slice(1).join(" ");

  if (!parentRunId || !feedback) {
    io.stderr.write("usage: assembly follow-up <run-id> <feedback> [--pretty]\n");
    return 2;
  }

  try {
    const run = await createFollowUpRun(parentRunId, feedback);
    io.stdout.write(`${JSON.stringify(run, null, pretty ? 2 : 0)}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`error: ${error.message}\n`);
    return 1;
  }
}

async function handleStatus(args, io) {
  const runId = args[0];
  if (!runId) {
    io.stderr.write("usage: assembly status <run-id>\n");
    return 2;
  }

  try {
    const run = await readRun(runId);
    io.stdout.write(formatStatus(run));
    return 0;
  } catch (error) {
    io.stderr.write(`error: unable to read run ${runId}: ${error.message}\n`);
    return 1;
  }
}

async function handleInspect(args, io) {
  const pretty = args.includes("--pretty");
  const runId = args.find((arg) => arg !== "--pretty");
  if (!runId) {
    io.stderr.write("usage: assembly inspect <run-id> [--pretty]\n");
    return 2;
  }

  try {
    const run = await readRun(runId);
    io.stdout.write(`${JSON.stringify(run, null, pretty ? 2 : 0)}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`error: unable to read run ${runId}: ${error.message}\n`);
    return 1;
  }
}

async function handleGitHub(args, io) {
  const [subcommand, ...rest] = args;
  if (subcommand === "create-pr") {
    const runId = rest[0];
    if (!runId) {
      io.stderr.write("usage: assembly github create-pr <run-id>\n");
      return 2;
    }

    try {
      const result = await createGitHubPullRequest(runId);
      io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    } catch (error) {
      io.stderr.write(`error: ${error.message}\n`);
      return 1;
    }
  }

  if (subcommand === "comment-to-follow-up") {
    const [parentRunId, commentId] = rest;
    if (!parentRunId || !commentId) {
      io.stderr.write("usage: assembly github comment-to-follow-up <run-id> <comment-id>\n");
      return 2;
    }

    try {
      const comment = await getGitHubComment(commentId);
      const run = await createFollowUpRun(parentRunId, comment.body, {
        source: {
          provider: "github",
          kind: "issue_comment",
          id: comment.id,
          url: comment.url,
        },
      });
      io.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
      return 0;
    } catch (error) {
      io.stderr.write(`error: ${error.message}\n`);
      return 1;
    }
  }

  io.stderr.write("usage: assembly github <create-pr|comment-to-follow-up> ...\n");
  return 2;
}

function formatStatus({ request, state }) {
  const taskLines = Object.entries(state.tasks)
    .map(([taskId, task]) => `- ${task.status.padEnd(11)} ${taskId} (${task.owner})`)
    .join("\n");

  return [
    `Run: ${state.runId}`,
    `Status: ${state.status}`,
    `Request: ${request.request}`,
    "",
    "Tasks:",
    taskLines,
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
