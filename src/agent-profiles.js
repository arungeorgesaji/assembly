import path from "node:path";

export function attachAgentProfiles(tasks) {
  const profileByKey = new Map();
  const profiledTasks = tasks.map((task) => {
    const key = profileKey(task);
    let profile = profileByKey.get(key);
    if (!profile) {
      profile = createAgentProfile(task, key);
      profileByKey.set(key, profile);
    }
    profile.taskIds.push(task.id);
    return {
      ...task,
      agentProfileId: profile.id,
    };
  });

  return {
    tasks: profiledTasks,
    agentProfiles: [...profileByKey.values()],
  };
}

export function validateAgentProfiles(plan) {
  const errors = [];
  const profiles = plan.agentProfiles ?? [];
  const profileIds = new Set();
  const taskIds = new Set(plan.tasks.map((task) => task.id));

  for (const profile of profiles) {
    if (!profile.id) {
      errors.push("agent profile id cannot be empty");
      continue;
    }
    if (profileIds.has(profile.id)) {
      errors.push(`agent profile ${profile.id} is duplicated`);
    }
    profileIds.add(profile.id);

    if (!profile.dispatchOwner) {
      errors.push(`agent profile ${profile.id} must include a dispatchOwner`);
    }
    if (!Array.isArray(profile.taskIds) || profile.taskIds.length === 0) {
      errors.push(`agent profile ${profile.id} must include taskIds`);
    } else {
      for (const taskId of profile.taskIds) {
        if (!taskIds.has(taskId)) {
          errors.push(`agent profile ${profile.id} references unknown task ${taskId}`);
        }
      }
    }
    for (const ownedPath of profile.ownedPaths ?? []) {
      if (!isSafeRelativePath(ownedPath)) {
        errors.push(`agent profile ${profile.id} ownedPaths contains unsafe path ${ownedPath}`);
      }
    }
    for (const deniedPath of profile.deniedPaths ?? []) {
      if (!isSafeRelativePath(deniedPath)) {
        errors.push(`agent profile ${profile.id} deniedPaths contains unsafe path ${deniedPath}`);
      }
    }
  }

  for (const task of plan.tasks) {
    if (!task.agentProfileId) {
      errors.push(`task ${task.id} must reference an agentProfileId`);
      continue;
    }
    const profile = profiles.find((candidate) => candidate.id === task.agentProfileId);
    if (!profile) {
      errors.push(`task ${task.id} references unknown agent profile ${task.agentProfileId}`);
      continue;
    }
    if (profile.dispatchOwner !== task.owner) {
      errors.push(`task ${task.id} owner does not match agent profile ${profile.id}`);
    }
    if (!profile.taskIds.includes(task.id)) {
      errors.push(`agent profile ${profile.id} does not list task ${task.id}`);
    }
  }

  return errors;
}

function createAgentProfile(task, key) {
  const ownedPaths = unique([...(task.scope?.paths ?? []), ...(task.scope?.allowlist ?? [])]).sort();
  const deniedPaths = unique(task.scope?.denylist ?? []).sort();
  const focus = ownedPaths.length > 0 ? ownedPaths.join(", ") : task.title;

  return {
    id: `agent-${slugify(task.owner)}-${hashKey(key)}`,
    label: `${task.owner}: ${focus}`,
    dispatchOwner: task.owner,
    focus,
    ownedPaths,
    deniedPaths,
    changePolicy: task.changePolicy,
    tags: inferTags(ownedPaths),
    taskIds: [],
    instructions: [
      `Work only inside: ${ownedPaths.join(", ") || "the task scope"}.`,
      `Do not modify: ${deniedPaths.join(", ") || "paths outside the task scope"}.`,
      `Use change policy: ${task.changePolicy}.`,
    ],
  };
}

function profileKey(task) {
  return JSON.stringify({
    owner: task.owner,
    changePolicy: task.changePolicy,
    paths: unique([...(task.scope?.paths ?? []), ...(task.scope?.allowlist ?? [])]).sort(),
    denylist: unique(task.scope?.denylist ?? []).sort(),
  });
}

function inferTags(ownedPaths) {
  const tags = new Set();
  for (const ownedPath of ownedPaths) {
    const normalized = ownedPath.replaceAll("\\", "/");
    const [area] = normalized.split("/");
    if (area) {
      tags.add(`area:${area.replace(/\/$/, "")}`);
    }
    const extension = path.posix.extname(normalized).slice(1);
    if (extension) {
      tags.add(`ext:${extension}`);
    }
    for (const token of normalized.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length >= 3)) {
      tags.add(`term:${token}`);
    }
  }
  return [...tags].sort();
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }
  const normalized = value.replaceAll("\\", "/");
  if (path.posix.isAbsolute(normalized)) {
    return false;
  }
  const collapsed = path.posix.normalize(normalized);
  return collapsed !== "." && collapsed !== ".." && !collapsed.startsWith("../");
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "agent";
}

function hashKey(value) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
