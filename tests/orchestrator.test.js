import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";
import { createRun } from "../src/orchestrator.js";
import { getRunDir, readRun } from "../src/run-store.js";

test("createRun persists request, plan, state, events, and artifacts", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-run-"));

  const { runId } = await createRun("Add persisted workflow runs", { rootDir });
  const run = await readRun(runId, rootDir);

  assert.equal(run.request.request, "Add persisted workflow runs");
  assert.equal(run.state.status, "complete");
  assert.equal(run.plan.tasks.length, 3);
  assert.deepEqual(
    Object.values(run.state.tasks).map((task) => task.status),
    ["complete", "complete", "complete"],
  );
  assert.deepEqual(
    run.events.map((event) => event.type),
    [
      "run.created",
      "run.started",
      "task.started",
      "task.complete",
      "task.started",
      "task.complete",
      "task.started",
      "task.complete",
      "run.complete",
    ],
  );

  const report = await readFile(path.join(getRunDir(runId, rootDir), "final-report.md"), "utf8");
  assert.match(report, /# Assembly Run Report/);
  assert.match(report, /Status: complete/);
  assert.match(report, /planner completed placeholder work/);
  assert.match(report, /Artifacts: result.json/);
});

test("status command prints run summary", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-cli-"));
  const previousCwd = process.cwd();
  const stdout = { text: "", write(chunk) { this.text += chunk; } };
  const stderr = { text: "", write(chunk) { this.text += chunk; } };

  try {
    process.chdir(rootDir);
    const runCode = await main(["run", "Add", "status", "command"], { stdout, stderr });
    assert.equal(runCode, 0);
    const runId = JSON.parse(stdout.text).runId;

    stdout.text = "";
    const statusCode = await main(["status", runId], { stdout, stderr });

    assert.equal(statusCode, 0);
    assert.match(stdout.text, new RegExp(`Run: ${runId}`));
    assert.match(stdout.text, /Status: complete/);
  } finally {
    process.chdir(previousCwd);
  }
});

test("createRun fails when an agent result violates the output contract", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-invalid-result-"));

  const { runId } = await createRun("Reject bad task results", {
    rootDir,
    agentRunner: async (task) => ({
      taskId: `${task.id}-wrong`,
      status: "complete",
      summary: "",
      changedFiles: [],
      artifacts: [],
      risks: [],
    }),
  });
  const run = await readRun(runId, rootDir);

  assert.equal(run.state.status, "failed");
  assert.equal(Object.values(run.state.tasks)[0].status, "failed");
  assert.deepEqual(
    run.events.map((event) => event.type),
    ["run.created", "run.started", "task.started", "task.failed", "run.failed"],
  );

  const report = await readFile(path.join(getRunDir(runId, rootDir), "final-report.md"), "utf8");
  assert.match(report, /Status: failed/);
});

test("createRun stops when an agent blocks a task", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-blocked-result-"));

  const { runId } = await createRun("Handle blocked task", {
    rootDir,
    agentRunner: async (task) => ({
      taskId: task.id,
      status: "blocked",
      summary: "Needs human input.",
      changedFiles: [],
      artifacts: ["result.json"],
      risks: ["Missing required setup detail."],
    }),
  });
  const run = await readRun(runId, rootDir);

  assert.equal(run.state.status, "blocked");
  assert.equal(Object.values(run.state.tasks)[0].status, "blocked");
  assert.equal(Object.values(run.state.tasks)[1].status, "pending");
  assert.deepEqual(
    run.events.map((event) => event.type),
    ["run.created", "run.started", "task.started", "task.blocked", "run.blocked"],
  );
});
