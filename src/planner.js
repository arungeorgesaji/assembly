import { createExecutionPlan, createTask } from "./models.js";
import { inspectRepository } from "./repo-inspector.js";

export function createPlan(request, { rootDir = process.cwd(), repoContext = inspectRepository(rootDir) } = {}) {
  const normalizedRequest = normalizeRequest(request);
  const slug = slugify(normalizedRequest);
  const implementationScope = repoContext.suggestedScopes.implementation;
  const reviewScope = repoContext.suggestedScopes.review;
  const verification = repoContext.verificationCommands;
  const changePolicy = normalizedRequest.toLowerCase().startsWith("add ") ? "additive" : "modify";
  const requestKind = classifyRequest(normalizedRequest);
  const implementationTasks = createImplementationTasks({
    slug,
    requestKind,
    implementationScope,
    changePolicy,
  });

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
    ...implementationTasks,
    createTask({
      id: `${slug}-verify`,
      title: "Verify and review output",
      owner: "review-agent",
      description:
        "Run relevant checks, review the diff, and summarize risks before human handoff.",
      scope: reviewScope,
      dependencies: implementationTasks.map((task) => task.id),
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
      "Planner is deterministic and request-aware; deeper semantic decomposition is still evolving.",
    ],
    verification,
  });
}

function classifyRequest(request) {
  const lower = request.toLowerCase();
  if (/\b(readme|docs?|documentation)\b/.test(lower)) {
    return "docs";
  }
  if (/\b(test|tests|coverage|spec)\b/.test(lower)) {
    return "tests";
  }
  if (/\b(refactor|cleanup|rename)\b/.test(lower)) {
    return "refactor";
  }
  return "code";
}

function createImplementationTasks({ slug, requestKind, implementationScope, changePolicy }) {
  if (requestKind === "docs") {
    return [
      createTask({
        id: `${slug}-docs`,
        title: "Update documentation",
        owner: "implementation-agent",
        description: "Make the requested documentation change while preserving unrelated content.",
        scope: {
          paths: [],
          allowlist: ["README.md"],
          denylist: [".env", ".env.*", ".git/", ".assembly/"],
        },
        changePolicy,
        dependencies: [`${slug}-plan`],
        acceptanceCriteria: [
          "Documentation change directly addresses the request.",
          "Unrelated documentation content remains intact.",
        ],
      }),
    ];
  }

  if (requestKind === "tests") {
    return [
      createTask({
        id: `${slug}-tests`,
        title: "Update tests",
        owner: "implementation-agent",
        description: "Add or update tests for the requested behavior.",
        scope: {
          paths: ["tests/"],
          allowlist: ["package.json", "package-lock.json"],
          denylist: [".env", ".env.*", ".git/", ".assembly/"],
        },
        changePolicy,
        dependencies: [`${slug}-plan`],
        acceptanceCriteria: [
          "Tests cover the requested behavior or regression.",
          "Test changes stay within the assigned test scope.",
        ],
      }),
    ];
  }

  if (requestKind === "refactor") {
    return [
      createTask({
        id: `${slug}-refactor`,
        title: "Refactor implementation",
        owner: "implementation-agent",
        description: "Refactor the relevant implementation while preserving behavior.",
        scope: implementationScope,
        changePolicy,
        dependencies: [`${slug}-plan`],
        acceptanceCriteria: [
          "Behavior remains unchanged unless the request explicitly says otherwise.",
          "Refactor stays inside the assigned ownership scope.",
        ],
      }),
    ];
  }

  return [
    createTask({
      id: `${slug}-implement`,
      title: "Implement requested change",
      owner: "implementation-agent",
      description:
        "Make the smallest coherent code changes needed to satisfy the approved plan.",
      scope: implementationScope,
      changePolicy,
      dependencies: [`${slug}-plan`],
      acceptanceCriteria: [
        "Changes are limited to the assigned ownership area.",
        "Implementation satisfies the request and preserves existing behavior.",
      ],
    }),
  ];
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
