import { validateScope } from "./scope.js";

export function validatePlan(plan) {
  const errors = [];
  const taskIds = new Set(plan.tasks.map((task) => task.id));

  if (plan.tasks.length === 0) {
    errors.push("plan must include at least one task");
  }

  for (const task of plan.tasks) {
    if (!task.id) {
      errors.push("task id cannot be empty");
    }
    if (!task.owner) {
      errors.push(`task ${task.id} must have an owner`);
    }
    if (task.acceptanceCriteria.length === 0) {
      errors.push(`task ${task.id} must include acceptance criteria`);
    }
    errors.push(...validateScope(task.scope, task.id));
    for (const dependency of task.dependencies) {
      if (!taskIds.has(dependency)) {
        errors.push(`task ${task.id} depends on unknown task ${dependency}`);
      }
    }
  }

  return errors;
}
