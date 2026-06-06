import path from "node:path";

export function createScope({ paths = [], allowlist = [], denylist = [] } = {}) {
  return {
    paths,
    allowlist,
    denylist,
  };
}

export function validateChangedFilesWithinScope(task, changedFiles) {
  const errors = [];
  const scope = task.scope ?? createScope();

  for (const changedFile of changedFiles) {
    const normalized = normalizeRelativePath(changedFile);
    if (!normalized) {
      errors.push(`task ${task.id} changed file ${changedFile} is not a safe relative path`);
      continue;
    }

    if (matchesAny(normalized, scope.denylist)) {
      errors.push(`task ${task.id} changed denied path ${changedFile}`);
      continue;
    }

    if (matchesAny(normalized, scope.allowlist)) {
      continue;
    }

    if (!matchesAny(normalized, scope.paths)) {
      errors.push(`task ${task.id} changed file ${changedFile} outside assigned scope`);
    }
  }

  return errors;
}

export function validateScope(scope, taskId) {
  const errors = [];

  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return [`task ${taskId} must include a scope object`];
  }

  for (const key of ["paths", "allowlist", "denylist"]) {
    if (!Array.isArray(scope[key])) {
      errors.push(`task ${taskId} scope.${key} must be an array`);
      continue;
    }
    for (const scopePath of scope[key]) {
      if (!normalizeRelativePath(scopePath)) {
        errors.push(`task ${taskId} scope.${key} contains unsafe path ${scopePath}`);
      }
    }
  }

  if (scope.paths.length === 0 && scope.allowlist.length === 0) {
    errors.push(`task ${taskId} scope must include at least one path or allowlist entry`);
  }

  return errors;
}

function matchesAny(changedFile, scopePaths) {
  return scopePaths.some((scopePath) => matchesScopePath(changedFile, scopePath));
}

function matchesScopePath(changedFile, scopePath) {
  const normalizedScopePath = normalizeRelativePath(scopePath);
  if (!normalizedScopePath) {
    return false;
  }

  if (normalizedScopePath.includes("*")) {
    const pattern = new RegExp(`^${normalizedScopePath.split("*").map(escapeRegex).join("[^/]*")}$`);
    return pattern.test(changedFile);
  }

  if (normalizedScopePath.endsWith("/")) {
    return changedFile.startsWith(normalizedScopePath);
  }

  return changedFile === normalizedScopePath || changedFile.startsWith(`${normalizedScopePath}/`);
}

function normalizeRelativePath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const normalized = value.replaceAll("\\", "/");
  if (path.posix.isAbsolute(normalized)) {
    return null;
  }

  const collapsed = path.posix.normalize(normalized);
  if (collapsed === "." || collapsed === ".." || collapsed.startsWith("../")) {
    return null;
  }

  return normalized.endsWith("/") && !collapsed.endsWith("/") ? `${collapsed}/` : collapsed;
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
