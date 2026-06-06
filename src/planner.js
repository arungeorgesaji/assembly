import { createExecutionPlan, createTask } from "./models.js";

export function createPlan(request) {
  const normalizedRequest = normalizeRequest(request);
  const slug = slugify(normalizedRequest);

  const tasks = [
    createTask({
      id: `${slug}-plan`,
      title: "Define implementation plan",
      owner: "planner",
      description:
        "Inspect the repository, clarify scope, and produce task ownership with acceptance criteria.",
      files: ["README.md"],
      scope: {
        paths: ["README.md"],
        allowlist: [],
        denylist: [".env", ".env.*", ".git/"],
      },
      acceptanceCriteria: [
        "Plan lists owned files or systems for each task.",
        "Plan identifies blockers, dependencies, and verification steps.",
      ],
    }),
    createTask({
      id: `${slug}-implement`,
      title: "Implement requested change",
      owner: "implementation-agent",
      description:
        "Make the smallest coherent code changes needed to satisfy the approved plan.",
      scope: {
        paths: ["src/", "tests/"],
        allowlist: ["package.json", "package-lock.json", "README.md", ".gitignore"],
        denylist: [".env", ".env.*", ".git/", ".assembly/"],
      },
      dependencies: [`${slug}-plan`],
      acceptanceCriteria: [
        "Changes are limited to the assigned ownership area.",
        "Implementation satisfies the request and preserves existing behavior.",
      ],
    }),
    createTask({
      id: `${slug}-verify`,
      title: "Verify and review output",
      owner: "review-agent",
      description:
        "Run relevant checks, review the diff, and summarize risks before human handoff.",
      scope: {
        paths: ["tests/", ".assembly/"],
        allowlist: ["README.md"],
        denylist: [".env", ".env.*", ".git/"],
      },
      dependencies: [`${slug}-implement`],
      acceptanceCriteria: [
        "Automated checks pass or failures are documented.",
        "Review notes include known risks and follow-up recommendations.",
      ],
    }),
  ];

  return createExecutionPlan({
    request: normalizedRequest,
    summary: `Coordinate delivery for: ${normalizedRequest}`,
    tasks,
    risks: [
      "This initial planner uses deterministic templates until provider-backed agents are integrated.",
    ],
    verification: [
      "Run unit tests for the planner and CLI.",
      "Inspect generated plan JSON for complete task contracts.",
    ],
  });
}

function normalizeRequest(request) {
  const normalized = String(request ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new Error("request cannot be empty");
  }
  return normalized;
}

function slugify(value) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug.slice(0, 32).replace(/-$/g, "") || "request";
}
