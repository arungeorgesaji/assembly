#!/usr/bin/env node

import { createPlan } from "./planner.js";
import { createRun } from "./orchestrator.js";
import { createFollowUpRun } from "./follow-up.js";
import { createGitHubPullRequest, getGitHubComment } from "./github.js";
import { processJob } from "./job-worker.js";
import { readRun } from "./run-store.js";
import { startWebhookServer } from "./webhook-server.js";
import { loadEnv } from "./config.js";
import { validatePlan } from "./validation.js";

export async function main(argv = process.argv.slice(2), io = process) {
  await loadEnv();
  const [command, ...args] = argv;

  if (!["plan", "run", "follow-up", "status", "inspect", "github", "job", "webhook"].includes(command)) {
    io.stderr.write("usage: assembly <plan|run|follow-up|status|inspect|github|job|webhook> ...\n");
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
  if (command === "github") {
    return handleGitHub(args, io);
  }
  if (command === "job") {
    return handleJob(args, io);
  }
  return handleWebhook(args, io);
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

async function handleJob(args, io) {
  const [subcommand, jobId] = args;
  if (subcommand !== "process" || !jobId) {
    io.stderr.write("usage: assembly job process <job-id>\n");
    return 2;
  }

  const job = await processJob(jobId);
  io.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
  return job.status === "failed" ? 1 : 0;
}

function handleWebhook(args, io) {
  const portIndex = args.indexOf("--port");
  const port = portIndex === -1 ? 3000 : Number(args[portIndex + 1]);
  if (!Number.isInteger(port) || port <= 0) {
    io.stderr.write("usage: assembly webhook [--port <port>]\n");
    return 2;
  }

  const server = startWebhookServer({ port });
  server.on("listening", () => {
    io.stdout.write(`Assembly webhook server listening on http://127.0.0.1:${port}/github/webhook\n`);
  });
  server.on("error", (error) => {
    io.stderr.write(`error: unable to start webhook server: ${error.message}\n`);
    process.exitCode = 1;
  });
  return 0;
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
