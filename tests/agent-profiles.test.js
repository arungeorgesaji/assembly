import assert from "node:assert/strict";
import test from "node:test";

import { attachAgentProfiles, validateAgentProfiles } from "../src/agent-profiles.js";
import { createExecutionPlan, createTask } from "../src/models.js";

test("attachAgentProfiles creates dynamic profiles from task scope", () => {
  const baseTasks = [
    createTask({
      id: "change-github",
      title: "Change GitHub integration",
      owner: "implementation-agent",
      description: "Update GitHub behavior.",
      scope: { paths: [], allowlist: ["src/github.js"], denylist: [".env", ".git/"] },
      acceptanceCriteria: ["GitHub behavior is updated."],
    }),
    createTask({
      id: "test-github",
      title: "Test GitHub integration",
      owner: "implementation-agent",
      description: "Update GitHub tests.",
      scope: { paths: [], allowlist: ["tests/github.test.js"], denylist: [".env", ".git/"] },
      acceptanceCriteria: ["GitHub tests cover behavior."],
    }),
  ];

  const { tasks, agentProfiles } = attachAgentProfiles(baseTasks);

  assert.equal(agentProfiles.length, 2);
  assert.ok(tasks.every((task) => task.agentProfileId));
  assert.notEqual(tasks[0].agentProfileId, tasks[1].agentProfileId);
  assert.deepEqual(agentProfiles[0].ownedPaths, ["src/github.js"]);
  assert.ok(agentProfiles[0].tags.includes("area:src"));
  assert.ok(agentProfiles[0].tags.includes("ext:js"));
  assert.ok(agentProfiles[0].tags.includes("term:github"));
});

test("validateAgentProfiles catches broken task references", () => {
  const task = createTask({
    id: "docs",
    title: "Update docs",
    owner: "implementation-agent",
    description: "Update docs.",
    scope: { paths: [], allowlist: ["README.md"], denylist: [".env"] },
    acceptanceCriteria: ["Docs are updated."],
    agentProfileId: "missing-profile",
  });
  const plan = createExecutionPlan({
    request: "Update docs",
    summary: "Update docs",
    tasks: [task],
    agentProfiles: [],
  });

  assert.deepEqual(validateAgentProfiles(plan), [
    "task docs references unknown agent profile missing-profile",
  ]);
});
