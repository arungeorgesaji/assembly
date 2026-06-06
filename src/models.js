export const TaskStatus = Object.freeze({
  Pending: "pending",
  InProgress: "in_progress",
  Blocked: "blocked",
  Complete: "complete",
});

export function createTask({
  id,
  title,
  owner,
  description,
  files = [],
  scope = { paths: files, allowlist: [], denylist: [".env", ".env.*", ".git/"] },
  changePolicy = "modify",
  dependencies = [],
  acceptanceCriteria = [],
  status = TaskStatus.Pending,
}) {
  return {
    id,
    title,
    owner,
    description,
    files,
    scope,
    changePolicy,
    dependencies,
    acceptanceCriteria,
    status,
  };
}

export function createExecutionPlan({
  request,
  summary,
  tasks = [],
  risks = [],
  verification = [],
}) {
  return {
    request,
    summary,
    tasks,
    risks,
    verification,
  };
}
