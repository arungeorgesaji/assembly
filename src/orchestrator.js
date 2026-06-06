import { createAgentRunner } from "./agent-runner.js";
import { resolveApproval } from "./approval.js";
import { applyFileUpdates, validateAdditiveFileUpdates } from "./file-updates.js";
import { applyPatch } from "./patch.js";
import { createPlan } from "./planner.js";
import { createFinalReport } from "./report.js";
import { validateTaskResult } from "./result-validation.js";
import { validatePlan } from "./validation.js";
import { runVerificationCommands } from "./verification-runner.js";
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
  const plan = createPlan(request, { rootDir });
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

    let result;
    try {
      result = await agentRunner(task, { rootDir, plan, state, runId });
    } catch (error) {
      const failure = {
        taskId: task.id,
        status: "failed",
        summary: "Agent execution failed.",
        changedFiles: [],
        artifacts: [],
        risks: [error.message],
      };
      state.tasks[task.id].status = "failed";
      state.currentTaskId = null;
      await writeState(runId, state, rootDir);
      await appendEvent(runId, { type: "task.failed", taskId: task.id, data: failure }, rootDir);
      break;
    }
    const resultErrors = validateTaskResult(task, result);
    resultErrors.push(...(await validateAdditiveFileUpdates(task, result, rootDir)));
    await writeArtifact(runId, task.id, "result.json", result, rootDir);
    if (result.patch) {
      await writeRunFile(runId, `artifacts/${task.id}/patch.diff`, result.patch, rootDir);
    }
    if (result.fileUpdates?.length > 0) {
      await writeArtifact(runId, task.id, "file-updates.json", result.fileUpdates, rootDir);
    }

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

    const approval = resolveApproval({ task, result });
    await appendEvent(runId, { type: `approval.${approval.status}`, taskId: task.id, data: approval }, rootDir);
    if (!approval.approved) {
      const status = approval.status === "dry_run" || approval.status === "pending" ? "blocked" : "failed";
      const failure = {
        taskId: task.id,
        status,
        summary: approval.reason,
        changedFiles: result.changedFiles,
        artifacts: result.artifacts,
        risks: [approval.reason],
      };
      state.tasks[task.id].status = status;
      state.currentTaskId = null;
      await writeState(runId, state, rootDir);
      await appendEvent(runId, { type: `task.${status}`, taskId: task.id, data: failure }, rootDir);
      break;
    }

    if (result.status === "complete" && result.fileUpdates?.length > 0) {
      try {
        await applyFileUpdates(result.fileUpdates, rootDir);
        await appendEvent(runId, { type: "files.updated", taskId: task.id, data: { changedFiles: result.changedFiles } }, rootDir);
      } catch (error) {
        const failure = {
          taskId: task.id,
          status: "failed",
          summary: "File updates failed to apply.",
          changedFiles: result.changedFiles,
          artifacts: ["result.json", "file-updates.json"],
          risks: [error.message],
        };
        state.tasks[task.id].status = "failed";
        state.currentTaskId = null;
        await writeArtifact(runId, task.id, "file-update-errors.json", { error: error.message }, rootDir);
        await writeState(runId, state, rootDir);
        await appendEvent(runId, { type: "task.failed", taskId: task.id, data: failure }, rootDir);
        break;
      }
    }

    if (result.status === "complete" && result.patch) {
      try {
        await applyPatch(result.patch, rootDir);
        await appendEvent(runId, { type: "patch.applied", taskId: task.id, data: { changedFiles: result.changedFiles } }, rootDir);
      } catch (error) {
        const failure = {
          taskId: task.id,
          status: "failed",
          summary: "Patch failed to apply.",
          changedFiles: result.changedFiles,
          artifacts: ["result.json", "patch.diff"],
          risks: [error.message],
        };
        state.tasks[task.id].status = "failed";
        state.currentTaskId = null;
        await writeArtifact(runId, task.id, "patch-errors.json", { error: error.message }, rootDir);
        await writeState(runId, state, rootDir);
        await appendEvent(runId, { type: "task.failed", taskId: task.id, data: failure }, rootDir);
        break;
      }
    }

    if (result.status === "complete" && task.owner === "implementation-agent" && plan.verification.length > 0) {
      await runVerification(runId, plan, rootDir);
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

  if (state.status === "complete" && hasFailedVerification(await readRun(runId, rootDir))) {
    state.status = "failed";
  }

  await writeState(runId, state, rootDir);
  await appendEvent(runId, { type: `run.${state.status}` }, rootDir);

  const run = await readRun(runId, rootDir);
  await writeRunFile(runId, "final-report.md", createFinalReport(run), rootDir);
}

async function runVerification(runId, plan, rootDir) {
  await appendEvent(runId, { type: "verification.started", data: { commands: plan.verification } }, rootDir);
  const verificationResults = await runVerificationCommands(plan.verification, rootDir);
  await writeArtifact(runId, "verification", "result.json", verificationResults, rootDir);
  await appendEvent(runId, { type: "verification.completed", data: { results: verificationResults } }, rootDir);
}

function hasFailedVerification(run) {
  return run.events
    .filter((event) => event.type === "verification.completed")
    .some((event) => event.data.results.some((result) => result.exitCode !== 0));
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
