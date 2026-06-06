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
  assert.deepEqual(plan.tasks[1].scope.paths, ["src/", "tests/"]);
  assert.deepEqual(plan.tasks[1].scope.allowlist, [
    "package.json",
    "package-lock.json",
    "README.md",
    ".gitignore",
  ]);
  assert.deepEqual(validatePlan(plan), []);
});

test("createPlan rejects an empty request", () => {
  assert.throws(() => createPlan("   "), /request cannot be empty/);
});
