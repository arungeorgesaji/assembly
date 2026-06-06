import { validateChangedFilesWithinScope } from "./scope.js";

const TERMINAL_STATUSES = new Set(["complete", "blocked", "failed"]);

export function validateTaskResult(task, result) {
  const errors = [];

  if (!isObject(result)) {
    return [`task ${task.id} returned a non-object result`];
  }

  if (result.taskId !== task.id) {
    errors.push(`result taskId must match dispatched task ${task.id}`);
  }
  if (!TERMINAL_STATUSES.has(result.status)) {
    errors.push(`task ${task.id} result status must be complete, blocked, or failed`);
  }
  if (!isNonEmptyString(result.summary)) {
    errors.push(`task ${task.id} result must include a summary`);
  }
  if (!Array.isArray(result.changedFiles)) {
    errors.push(`task ${task.id} result changedFiles must be an array`);
  }
  if (!Array.isArray(result.artifacts)) {
    errors.push(`task ${task.id} result artifacts must be an array`);
  }
  if (!Array.isArray(result.risks)) {
    errors.push(`task ${task.id} result risks must be an array`);
  }
  if (result.status === "complete" && Array.isArray(result.artifacts) && result.artifacts.length === 0) {
    errors.push(`completed task ${task.id} must include at least one artifact`);
  }
  if (Array.isArray(result.changedFiles)) {
    errors.push(...validateChangedFilesWithinScope(task, result.changedFiles));
  }

  return errors;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
