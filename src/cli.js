#!/usr/bin/env node

import { createPlan } from "./planner.js";
import { createRun } from "./orchestrator.js";
import { readRun } from "./run-store.js";
import { loadEnv } from "./config.js";
import { validatePlan } from "./validation.js";

export async function main(argv = process.argv.slice(2), io = process) {
  await loadEnv();
  const [command, ...args] = argv;

  if (!["plan", "run", "status", "inspect"].includes(command)) {
    io.stderr.write("usage: assembly <plan|run|status|inspect> ...\n");
    return 2;
  }

  if (command === "plan") {
    return handlePlan(args, io);
  }
  if (command === "run") {
    return handleRun(args, io);
  }
  if (command === "status") {
    return handleStatus(args, io);
  }
  return handleInspect(args, io);
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
