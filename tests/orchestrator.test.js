import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";
import { runStubAgent } from "../src/agent-runner.js";
import { createRun } from "../src/orchestrator.js";
import { getRunDir, readRun } from "../src/run-store.js";

test("createRun persists request, plan, state, events, and artifacts", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-run-"));

  const { runId } = await createRun("Add persisted workflow runs", { rootDir, agentRunner: runStubAgent });
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
      "approval.approved",
      "task.complete",
      "task.started",
      "approval.approved",
      "task.complete",
      "task.started",
      "approval.approved",
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
  const previousProvider = process.env.ASSEMBLY_AGENT_PROVIDER;
  const stdout = { text: "", write(chunk) { this.text += chunk; } };
  const stderr = { text: "", write(chunk) { this.text += chunk; } };

  try {
    process.chdir(rootDir);
    process.env.ASSEMBLY_AGENT_PROVIDER = "stub";
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
    if (previousProvider === undefined) {
      delete process.env.ASSEMBLY_AGENT_PROVIDER;
    } else {
      process.env.ASSEMBLY_AGENT_PROVIDER = previousProvider;
    }
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
    ["run.created", "run.started", "task.started", "approval.approved", "task.blocked", "run.blocked"],
  );
});

test("createRun applies a valid task patch", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-apply-patch-"));
  await mkdir(path.join(rootDir, "src"));
  await mkdir(path.join(rootDir, "tests"));
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  await writeFile(path.join(rootDir, "src/local.js"), "export const value = 1;\n");

  const patch = [
    "diff --git a/src/local.js b/src/local.js",
    "index 1471b8a..c97e022 100644",
    "--- a/src/local.js",
    "+++ b/src/local.js",
    "@@ -1 +1 @@",
    "-export const value = 1;",
    "+export const value = 2;",
    "",
  ].join("\n");

  const { runId } = await createRun("Update local value", {
    rootDir,
    agentRunner: async (task) => {
      if (task.owner === "implementation-agent") {
        return {
          taskId: task.id,
          status: "complete",
          summary: "Updated local value.",
          changedFiles: ["src/local.js"],
          artifacts: ["result.json", "patch.diff"],
          risks: [],
          patch,
        };
      }

      return {
        taskId: task.id,
        status: "complete",
        summary: "No code changes needed.",
        changedFiles: [],
        artifacts: ["result.json"],
        risks: [],
      };
    },
  });

  const run = await readRun(runId, rootDir);
  assert.equal(run.state.status, "complete");
  assert.equal(await readFile(path.join(rootDir, "src/local.js"), "utf8"), "export const value = 2;\n");
  assert.ok(run.events.some((event) => event.type === "patch.applied"));
});

test("createRun applies valid file updates", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-apply-file-updates-"));
  await mkdir(path.join(rootDir, "src"));
  await mkdir(path.join(rootDir, "tests"));
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  await writeFile(path.join(rootDir, "src/local.js"), "export const value = 1;\n");

  const { runId } = await createRun("Update local value with file updates", {
    rootDir,
    agentRunner: async (task) => {
      if (task.owner === "implementation-agent") {
        return {
          taskId: task.id,
          status: "complete",
          summary: "Updated local value.",
          changedFiles: ["src/local.js"],
          artifacts: ["result.json", "file-updates.json"],
          risks: [],
          fileUpdates: [{ path: "src/local.js", content: "export const value = 3;\n" }],
        };
      }

      return {
        taskId: task.id,
        status: "complete",
        summary: "No code changes needed.",
        changedFiles: [],
        artifacts: ["result.json"],
        risks: [],
      };
    },
  });

  const run = await readRun(runId, rootDir);
  assert.equal(run.state.status, "complete");
  assert.equal(await readFile(path.join(rootDir, "src/local.js"), "utf8"), "export const value = 3;\n");
  assert.ok(run.events.some((event) => event.type === "files.updated"));
});

test("createRun blocks before applying edits in manual approval mode", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-manual-approval-"));
  const previousApprovalMode = process.env.ASSEMBLY_APPROVAL_MODE;
  await mkdir(path.join(rootDir, "src"));
  await writeFile(path.join(rootDir, "src/local.js"), "export const value = 1;\n");

  try {
    process.env.ASSEMBLY_APPROVAL_MODE = "manual";
    const { runId } = await createRun("Update local value manually", {
      rootDir,
      agentRunner: async (task) => {
        if (task.owner === "implementation-agent") {
          return {
            taskId: task.id,
            status: "complete",
            summary: "Updated local value.",
            changedFiles: ["src/local.js"],
            artifacts: ["result.json", "file-updates.json"],
            risks: [],
            fileUpdates: [{ path: "src/local.js", content: "export const value = 9;\n" }],
          };
        }

        return {
          taskId: task.id,
          status: "complete",
          summary: "No code changes needed.",
          changedFiles: [],
          artifacts: ["result.json"],
          risks: [],
        };
      },
    });

    const run = await readRun(runId, rootDir);
    assert.equal(run.state.status, "blocked");
    assert.equal(await readFile(path.join(rootDir, "src/local.js"), "utf8"), "export const value = 1;\n");
    assert.ok(run.events.some((event) => event.type === "approval.pending"));
  } finally {
    if (previousApprovalMode === undefined) {
      delete process.env.ASSEMBLY_APPROVAL_MODE;
    } else {
      process.env.ASSEMBLY_APPROVAL_MODE = previousApprovalMode;
    }
  }
});

test("createRun records dry-run before applying edits in never approval mode", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-never-approval-"));
  const previousApprovalMode = process.env.ASSEMBLY_APPROVAL_MODE;
  await mkdir(path.join(rootDir, "src"));
  await writeFile(path.join(rootDir, "src/local.js"), "export const value = 1;\n");

  try {
    process.env.ASSEMBLY_APPROVAL_MODE = "never";
    const { runId } = await createRun("Update local value dry run", {
      rootDir,
      agentRunner: async (task) => {
        if (task.owner === "implementation-agent") {
          return {
            taskId: task.id,
            status: "complete",
            summary: "Updated local value.",
            changedFiles: ["src/local.js"],
            artifacts: ["result.json", "file-updates.json"],
            risks: [],
            fileUpdates: [{ path: "src/local.js", content: "export const value = 9;\n" }],
          };
        }

        return {
          taskId: task.id,
          status: "complete",
          summary: "No code changes needed.",
          changedFiles: [],
          artifacts: ["result.json"],
          risks: [],
        };
      },
    });

    const run = await readRun(runId, rootDir);
    assert.equal(run.state.status, "blocked");
    assert.equal(await readFile(path.join(rootDir, "src/local.js"), "utf8"), "export const value = 1;\n");
    assert.ok(run.events.some((event) => event.type === "approval.dry_run"));
  } finally {
    if (previousApprovalMode === undefined) {
      delete process.env.ASSEMBLY_APPROVAL_MODE;
    } else {
      process.env.ASSEMBLY_APPROVAL_MODE = previousApprovalMode;
    }
  }
});

test("createRun fails when verification command fails", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-verification-fail-"));
  await mkdir(path.join(rootDir, "src"));
  await mkdir(path.join(rootDir, "tests"));
  await writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify({ scripts: { test: "node -e \"process.exit(1)\"" } }),
  );

  const { runId } = await createRun("Fail verification", {
    rootDir,
    agentRunner: async (task) => ({
      taskId: task.id,
      status: "complete",
      summary: "Completed without changes.",
      changedFiles: [],
      artifacts: ["result.json"],
      risks: [],
    }),
  });

  const run = await readRun(runId, rootDir);
  assert.equal(run.state.status, "failed");
  assert.ok(run.events.some((event) => event.type === "verification.completed"));

  const verification = JSON.parse(
    await readFile(path.join(getRunDir(runId, rootDir), "artifacts", "verification", "result.json"), "utf8"),
  );
  assert.equal(verification[0].command, "npm test");
  assert.equal(verification[0].exitCode, 1);
});
