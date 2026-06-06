import assert from "node:assert/strict";
import test from "node:test";

import { validateTaskResult } from "../src/result-validation.js";

const task = {
  id: "implementation",
  scope: {
    paths: ["src/", "tests/"],
    allowlist: ["package.json"],
    denylist: [".env", ".env.*", ".git/", ".assembly/"],
  },
};

function result(changedFiles) {
  return {
    taskId: "implementation",
    status: "complete",
    summary: "Implemented scoped changes.",
    changedFiles,
    artifacts: ["result.json"],
    risks: [],
  };
}

test("allows changed files inside task scope", () => {
  assert.deepEqual(
    validateTaskResult(task, result(["src/planner.js", "tests/planner.test.js", "package.json"])),
    [],
  );
});

test("rejects changed files outside task scope", () => {
  assert.deepEqual(validateTaskResult(task, result(["README.md"])), [
    "task implementation changed file README.md outside assigned scope",
  ]);
});

test("rejects denylisted changed files", () => {
  assert.deepEqual(validateTaskResult(task, result([".env"])), [
    "task implementation changed denied path .env",
  ]);
  assert.deepEqual(validateTaskResult(task, result([".env.local"])), [
    "task implementation changed denied path .env.local",
  ]);
  assert.deepEqual(validateTaskResult(task, result([".assembly/runs/demo/state.json"])), [
    "task implementation changed denied path .assembly/runs/demo/state.json",
  ]);
});

test("rejects absolute paths and traversal", () => {
  assert.deepEqual(validateTaskResult(task, result(["/tmp/file.js", "../outside.js"])), [
    "task implementation changed file /tmp/file.js is not a safe relative path",
    "task implementation changed file ../outside.js is not a safe relative path",
  ]);
});
