import assert from "node:assert/strict";
import test from "node:test";

import { resolveApproval } from "../src/approval.js";

const task = { id: "task-1" };

test("resolveApproval auto approves edits", () => {
  assert.deepEqual(
    resolveApproval({
      task,
      mode: "auto",
      result: { status: "complete", patch: "", fileUpdates: [{ path: "README.md", content: "x" }] },
    }),
    {
      approved: true,
      status: "approved",
      reason: "Auto approval mode approved validated edits.",
    },
  );
});

test("resolveApproval manual pauses edits", () => {
  assert.deepEqual(
    resolveApproval({
      task,
      mode: "manual",
      result: { status: "complete", patch: "diff", fileUpdates: [] },
    }),
    {
      approved: false,
      status: "pending",
      reason: "Manual approval required before applying edits for task task-1.",
    },
  );
});

test("resolveApproval never creates dry-run", () => {
  assert.deepEqual(
    resolveApproval({
      task,
      mode: "never",
      result: { status: "complete", patch: "", fileUpdates: [{ path: "README.md", content: "x" }] },
    }),
    {
      approved: false,
      status: "dry_run",
      reason: "Approval mode never records edits without applying them.",
    },
  );
});

