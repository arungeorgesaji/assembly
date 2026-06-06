import assert from "node:assert/strict";
import test from "node:test";

import { createPlan } from "../src/planner.js";
import { validatePlan } from "../src/validation.js";

test("createPlan returns a valid task graph", () => {
  const plan = createPlan("Add Slack workflow support", {
    repoContext: genericRepoContext(),
  });

  assert.equal(plan.request, "Add Slack workflow support");
  assert.deepEqual(
    plan.tasks.map((task) => task.owner),
    ["planner", "implementation-agent", "review-agent"],
  );
  assert.equal(plan.tasks[1].id, "add-slack-workflow-support-implement");
  assert.equal(plan.tasks[1].changePolicy, "additive");
  assert.equal(plan.agentProfiles.length, 3);
  assert.ok(plan.tasks.every((task) => task.agentProfileId));
  assert.deepEqual(validatePlan(plan), []);
});

test("createPlan uses a docs-specific implementation task", () => {
  const plan = createPlan("Add README note");

  assert.equal(plan.tasks[1].id, "add-readme-note-docs");
  assert.equal(plan.tasks[1].title, "Update documentation");
  assert.deepEqual(plan.tasks[1].scope.allowlist, ["README.md"]);
  assert.match(plan.agentProfiles.find((profile) => profile.id === plan.tasks[1].agentProfileId).focus, /README\.md/);
  assert.deepEqual(plan.tasks[2].dependencies, ["add-readme-note-docs"]);
  assert.deepEqual(validatePlan(plan), []);
});

test("createPlan uses a tests-specific implementation task", () => {
  const plan = createPlan("Add tests for planner");

  assert.equal(plan.tasks[1].id, "add-tests-for-planner-tests");
  assert.equal(plan.tasks[1].title, "Update tests");
  assert.deepEqual(plan.tasks[1].scope.paths, []);
  assert.deepEqual(plan.tasks[1].scope.allowlist, ["tests/planner.test.js"]);
  assert.ok(plan.agentProfiles.find((profile) => profile.id === plan.tasks[1].agentProfileId).tags.includes("term:planner"));
  assert.deepEqual(validatePlan(plan), []);
});

test("createPlan narrows code scopes from repository file matches", () => {
  const plan = createPlan("Improve github webhook duplicate handling", {
    repoContext: {
      language: "javascript",
      verificationCommands: ["npm test"],
      sourceFiles: ["src/github-webhooks.js", "src/planner.js"],
      testFiles: ["tests/github-webhooks.test.js", "tests/planner.test.js"],
      documentationFiles: ["README.md"],
      configFiles: ["package.json"],
      suggestedScopes: {
        implementation: {
          paths: ["src/", "tests/"],
          allowlist: ["package.json", "README.md"],
          denylist: [".env", ".git/"],
        },
        review: {
          paths: ["tests/", ".assembly/"],
          allowlist: ["README.md"],
          denylist: [".env", ".git/"],
        },
      },
    },
  });

  assert.equal(plan.tasks[1].id, "improve-github-webhook-duplicate-implement");
  assert.deepEqual(plan.tasks[1].scope.allowlist, ["src/github-webhooks.js"]);
  assert.equal(plan.tasks[2].id, "improve-github-webhook-duplicate-tests");
  assert.deepEqual(plan.tasks[2].scope.allowlist, ["tests/github-webhooks.test.js"]);
  assert.notEqual(plan.tasks[1].agentProfileId, plan.tasks[2].agentProfileId);
  assert.deepEqual(plan.tasks[3].dependencies, ["improve-github-webhook-duplicate-implement", "improve-github-webhook-duplicate-tests"]);
  assert.match(plan.risks[0], /src\/github-webhooks\.js/);
  assert.deepEqual(validatePlan(plan), []);
});

test("createPlan rejects an empty request", () => {
  assert.throws(() => createPlan("   "), /request cannot be empty/);
});

function genericRepoContext() {
  return {
    language: "javascript",
    verificationCommands: ["npm test"],
    sourceFiles: ["src/app.js"],
    testFiles: ["tests/app.test.js"],
    documentationFiles: ["README.md"],
    configFiles: ["package.json"],
    suggestedScopes: {
      implementation: {
        paths: ["src/", "tests/"],
        allowlist: ["package.json", "README.md"],
        denylist: [".env", ".git/"],
      },
      review: {
        paths: ["tests/", ".assembly/"],
        allowlist: ["README.md"],
        denylist: [".env", ".git/"],
      },
    },
  };
}
