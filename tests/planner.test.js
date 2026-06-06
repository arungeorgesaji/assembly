import assert from "node:assert/strict";
import test from "node:test";

import { createPlan } from "../src/planner.js";
import { validatePlan } from "../src/validation.js";

test("createPlan returns a valid task graph", () => {
  const plan = createPlan("Add Slack workflow support");

  assert.equal(plan.request, "Add Slack workflow support");
  assert.deepEqual(
    plan.tasks.map((task) => task.owner),
    ["planner", "implementation-agent", "review-agent"],
  );
  assert.equal(plan.tasks[1].id, "add-slack-workflow-support-implement");
  assert.equal(plan.tasks[1].changePolicy, "additive");
  assert.deepEqual(validatePlan(plan), []);
});

test("createPlan uses a docs-specific implementation task", () => {
  const plan = createPlan("Add README note");

  assert.equal(plan.tasks[1].id, "add-readme-note-docs");
  assert.equal(plan.tasks[1].title, "Update documentation");
  assert.deepEqual(plan.tasks[1].scope.allowlist, ["README.md"]);
  assert.deepEqual(plan.tasks[2].dependencies, ["add-readme-note-docs"]);
  assert.deepEqual(validatePlan(plan), []);
});

test("createPlan uses a tests-specific implementation task", () => {
  const plan = createPlan("Add tests for planner");

  assert.equal(plan.tasks[1].id, "add-tests-for-planner-tests");
  assert.equal(plan.tasks[1].title, "Update tests");
  assert.deepEqual(plan.tasks[1].scope.paths, ["tests/"]);
  assert.deepEqual(validatePlan(plan), []);
});

test("createPlan rejects an empty request", () => {
  assert.throws(() => createPlan("   "), /request cannot be empty/);
});
