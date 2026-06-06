import { getApprovalMode } from "./config.js";

const VALID_APPROVAL_MODES = new Set(["auto", "manual", "never"]);

export function resolveApproval({ task, result, mode = getApprovalMode() }) {
  if (!VALID_APPROVAL_MODES.has(mode)) {
    return {
      approved: false,
      status: "failed",
      reason: `unknown ASSEMBLY_APPROVAL_MODE: ${mode}`,
    };
  }

  const hasEdits = Boolean(result.patch) || result.fileUpdates?.length > 0;
  if (!hasEdits || result.status !== "complete") {
    return {
      approved: true,
      status: "approved",
      reason: "No edits require approval.",
    };
  }

  if (mode === "auto") {
    return {
      approved: true,
      status: "approved",
      reason: "Auto approval mode approved validated edits.",
    };
  }

  if (mode === "never") {
    return {
      approved: false,
      status: "dry_run",
      reason: "Approval mode never records edits without applying them.",
    };
  }

  return {
    approved: false,
    status: "pending",
    reason: `Manual approval required before applying edits for task ${task.id}.`,
  };
}

