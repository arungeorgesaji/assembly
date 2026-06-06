export function createFinalReport({ request, plan, state, events }) {
  const completedEvents = events.filter((event) =>
    ["task.complete", "task.blocked", "task.failed"].includes(event.type),
  );
  const resultByTaskId = new Map(completedEvents.map((event) => [event.taskId, event.data]));
  const risks = completedEvents.flatMap((event) => event.data?.risks ?? []);

  return [
    "# Assembly Run Report",
    "",
    `Run: ${state.runId}`,
    `Status: ${state.status}`,
    `Request: ${request.request}`,
    "",
    "## Summary",
    "",
    plan.summary,
    "",
    "## Tasks",
    "",
    ...plan.tasks.flatMap((task) => {
      const taskState = state.tasks[task.id];
      const result = resultByTaskId.get(task.id);
      return [
        `### ${task.title}`,
        "",
        `- ID: ${task.id}`,
        `- Owner: ${task.owner}`,
        `- Status: ${taskState?.status ?? "unknown"}`,
        `- Summary: ${result?.summary ?? "No result produced."}`,
        `- Artifacts: ${(result?.artifacts ?? []).join(", ") || "none"}`,
        "",
      ];
    }),
    "## Risks",
    "",
    ...(risks.length > 0 ? risks.map((risk) => `- ${risk}`) : ["- None reported."]),
    "",
    "## Verification",
    "",
    ...plan.verification.map((step) => `- ${step}`),
    "",
  ].join("\n");
}
