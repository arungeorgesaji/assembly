import { createAgentRunner } from "./agent-runner.js";
import { createPlan } from "./planner.js";
import { createFinalReport } from "./report.js";
import { validateTaskResult } from "./result-validation.js";
import { validatePlan } from "./validation.js";
import {
  appendEvent,
  createRunId,
  initializeRun,
  readRun,
  writeArtifact,
  writeRunFile,
  writeState,
} from "./run-store.js";

export async function createRun(request, { rootDir = process.cwd(), agentRunner } = {}) {
  const resolvedAgentRunner = agentRunner ?? createAgentRunner();
  const plan = createPlan(request);
  const errors = validatePlan(plan);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const runId = createRunId();
  const state = await initializeRun({ runId, request: plan.request, plan }, rootDir);

  await executeReadyTasks({ runId, plan, state, rootDir, agentRunner: resolvedAgentRunner });

  return { runId, plan, state };
}

async function executeReadyTasks({ runId, plan, state, rootDir, agentRunner }) {
  state.status = "running";
  await writeState(runId, state, rootDir);
  await appendEvent(runId, { type: "run.started" }, rootDir);

  while (true) {
    const task = nextReadyTask(plan, state);
    if (!task) {
      break;
    }

    state.currentTaskId = task.id;
    state.tasks[task.id].status = "in_progress";
    await writeState(runId, state, rootDir);
    await appendEvent(runId, { type: "task.started", taskId: task.id }, rootDir);

    const result = await agentRunner(task);
    const resultErrors = validateTaskResult(task, result);
    await writeArtifact(runId, task.id, "result.json", result, rootDir);

    if (resultErrors.length > 0) {
      const failure = {
        taskId: task.id,
        status: "failed",
        summary: "Agent result failed contract validation.",
        changedFiles: [],
        artifacts: ["result.json"],
        risks: resultErrors,
      };
      state.tasks[task.id].status = "failed";
      state.currentTaskId = null;
      await writeArtifact(runId, task.id, "validation-errors.json", { errors: resultErrors }, rootDir);
      await writeState(runId, state, rootDir);
      await appendEvent(runId, { type: "task.failed", taskId: task.id, data: failure }, rootDir);
      break;
    }

    state.tasks[task.id].status = result.status;
    state.currentTaskId = null;
    await writeState(runId, state, rootDir);
    await appendEvent(runId, { type: `task.${result.status}`, taskId: task.id, data: result }, rootDir);

    if (result.status !== "complete") {
      break;
    }
  }

  state.status = determineRunStatus(state);
  await writeState(runId, state, rootDir);
  await appendEvent(runId, { type: `run.${state.status}` }, rootDir);

  const run = await readRun(runId, rootDir);
  await writeRunFile(runId, "final-report.md", createFinalReport(run), rootDir);
}

function nextReadyTask(plan, state) {
  return plan.tasks.find((task) => {
    if (state.tasks[task.id].status !== "pending") {
      return false;
    }
    return task.dependencies.every((dependency) => state.tasks[dependency]?.status === "complete");
  });
}

function allTasksComplete(state) {
  return Object.values(state.tasks).every((task) => task.status === "complete");
}

function determineRunStatus(state) {
  if (allTasksComplete(state)) {
    return "complete";
  }
  if (Object.values(state.tasks).some((task) => task.status === "failed")) {
    return "failed";
  }
  return "blocked";
}
