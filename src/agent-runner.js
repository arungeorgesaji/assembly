import { getAgentProvider } from "./config.js";
import { createOpenAIAgentRunner } from "./openai-agent-runner.js";
import { createOpenAIReviewRunner } from "./review-agent-runner.js";

export async function runStubAgent(task) {
  return {
    taskId: task.id,
    status: "complete",
    summary: `${task.owner} completed placeholder work for "${task.title}".`,
    changedFiles: [],
    artifacts: ["result.json"],
    risks: [
      "Stub agent did not modify repository files. Replace with provider-backed execution before real delivery.",
    ],
  };
}

export function createAgentRunner() {
  const provider = getAgentProvider();
  if (provider === "stub") {
    return runStubAgent;
  }
  if (provider === "openai") {
    const openAIAgentRunner = createOpenAIAgentRunner();
    const openAIReviewRunner = createOpenAIReviewRunner();
    return async (task, context) => {
      if (task.owner === "implementation-agent") {
        return openAIAgentRunner(task, context);
      }
      if (task.owner === "review-agent") {
        return openAIReviewRunner(task, context);
      }
      return runStubAgent(task);
    };
  }
  throw new Error(`unknown ASSEMBLY_AGENT_PROVIDER: ${provider}`);
}
