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
  agentProfileId = null,
  status = TaskStatus.Pending,
}) {
  const task = {
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
  if (agentProfileId) {
    task.agentProfileId = agentProfileId;
  }
  return task;
}

export function createExecutionPlan({
  request,
  summary,
  tasks = [],
  agentProfiles = [],
  risks = [],
  verification = [],
}) {
  return {
    request,
    summary,
    tasks,
    agentProfiles,
    risks,
    verification,
  };
}
