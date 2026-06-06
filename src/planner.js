import { attachAgentProfiles } from "./agent-profiles.js";
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
  const targetContext = inferTargetContext(normalizedRequest, repoContext);
  const implementationTasks = createImplementationTasks({
    slug,
    requestKind,
    implementationScope,
    changePolicy,
    targetContext,
  });

  const baseTasks = [
    createTask({
      id: `${slug}-plan`,
      title: "Define implementation plan",
      owner: "planner",
      description:
        `Inspect the ${repoContext.language ?? "unknown"} repository, clarify scope, and produce task ownership with acceptance criteria.`,
      files: ["README.md"],
      scope: {
        paths: ["README.md"],
        allowlist: [],
        denylist: [".env", ".env.*", ".git/"],
      },
      acceptanceCriteria: [
        "Plan lists owned files or systems for each task.",
        "Plan identifies blockers, dependencies, and verification steps.",
        "Plan uses repository structure to narrow implementation and review scope where possible.",
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
  const { tasks, agentProfiles } = attachAgentProfiles(baseTasks);

  return createExecutionPlan({
    request: normalizedRequest,
    summary: `Coordinate delivery for: ${normalizedRequest}`,
    tasks,
    agentProfiles,
    risks: [
      targetContext.files.length > 0
        ? `Planner inferred likely target files: ${targetContext.files.join(", ")}.`
        : "Planner could not infer exact target files; implementation scope remains broader.",
      "Planner is deterministic and repository-aware; deeper semantic decomposition is still evolving.",
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

function createImplementationTasks({ slug, requestKind, implementationScope, changePolicy, targetContext }) {
  if (requestKind === "docs") {
    const docsScope = targetContext.docs.length > 0
      ? scopeForFiles(targetContext.docs, [".env", ".env.*", ".git/", ".assembly/"])
      : {
          paths: [],
          allowlist: ["README.md"],
          denylist: [".env", ".env.*", ".git/", ".assembly/"],
        };
    return [
      createTask({
        id: `${slug}-docs`,
        title: "Update documentation",
        owner: "implementation-agent",
        description: "Make the requested documentation change while preserving unrelated content.",
        scope: docsScope,
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
    const testScope = targetContext.tests.length > 0
      ? scopeForFiles(targetContext.tests, [".env", ".env.*", ".git/", ".assembly/"])
      : {
          paths: ["tests/"],
          allowlist: ["package.json", "package-lock.json"],
          denylist: [".env", ".env.*", ".git/", ".assembly/"],
        };
    return [
      createTask({
        id: `${slug}-tests`,
        title: "Update tests",
        owner: "implementation-agent",
        description: "Add or update tests for the requested behavior.",
        scope: testScope,
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
        scope: targetContext.implementation.length > 0
          ? scopeForFiles(targetContext.implementation, [".env", ".env.*", ".git/", ".assembly/"])
          : implementationScope,
        changePolicy,
        dependencies: [`${slug}-plan`],
        acceptanceCriteria: [
          "Behavior remains unchanged unless the request explicitly says otherwise.",
          "Refactor stays inside the assigned ownership scope.",
        ],
      }),
    ];
  }

  const codeScope = targetContext.implementation.length > 0
    ? scopeForFiles(targetContext.implementation, [".env", ".env.*", ".git/", ".assembly/"])
    : implementationScope;
  const tasks = [
    createTask({
      id: `${slug}-implement`,
      title: "Implement requested change",
      owner: "implementation-agent",
      description:
        "Make the smallest coherent code changes needed to satisfy the approved plan.",
      scope: codeScope,
      changePolicy,
      dependencies: [`${slug}-plan`],
      acceptanceCriteria: [
        "Changes are limited to the assigned ownership area.",
        "Implementation satisfies the request and preserves existing behavior.",
      ],
    }),
  ];

  if (targetContext.tests.length > 0) {
    tasks.push(createTask({
      id: `${slug}-tests`,
      title: "Update targeted tests",
      owner: "implementation-agent",
      description: "Update tests directly related to the inferred implementation target.",
      scope: scopeForFiles(targetContext.tests, [".env", ".env.*", ".git/", ".assembly/"]),
      changePolicy,
      dependencies: [`${slug}-implement`],
      acceptanceCriteria: [
        "Tests cover the requested behavior or regression.",
        "Test changes correspond to the inferred implementation target.",
      ],
    }));
  }

  return tasks;
}

function inferTargetContext(request, repoContext) {
  const sourceFiles = repoContext.sourceFiles ?? [];
  const testFiles = repoContext.testFiles ?? [];
  const docs = repoContext.documentationFiles ?? [];
  const configFiles = repoContext.configFiles ?? [];
  const candidates = [...sourceFiles, ...testFiles, ...docs, ...configFiles];
  const terms = new Set(tokenize(request));
  const mentionedFiles = candidates.filter((file) => fileMatchesTerms(file, terms));
  const implementation = mentionedFiles.filter((file) => file.startsWith("src/") || isConfigFile(file));
  const tests = [
    ...mentionedFiles.filter((file) => file.startsWith("tests/")),
    ...findRelatedTestFiles(implementation, testFiles),
  ];

  return {
    files: unique([...implementation, ...tests, ...mentionedFiles.filter((file) => docs.includes(file))]),
    implementation: unique(implementation),
    tests: unique(tests),
    docs: unique(mentionedFiles.filter((file) => docs.includes(file))),
  };
}

function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !GENERIC_MATCH_TERMS.has(token));
}

const GENERIC_MATCH_TERMS = new Set([
  "add",
  "change",
  "code",
  "docs",
  "file",
  "fix",
  "for",
  "implementation",
  "improve",
  "src",
  "test",
  "tests",
  "update",
]);

function fileMatchesTerms(file, terms) {
  const fileTokens = tokenize(file);
  return fileTokens.some((token) => terms.has(token));
}

function findRelatedTestFiles(implementationFiles, testFiles) {
  const implementationTerms = new Set(implementationFiles.flatMap((file) => tokenize(file)));
  return testFiles.filter((file) => tokenize(file).some((token) => implementationTerms.has(token)));
}

function scopeForFiles(files, denylist) {
  return {
    paths: [],
    allowlist: unique(files).sort(),
    denylist,
  };
}

function isConfigFile(file) {
  return /(^|\/)(package(-lock)?\.json|\.gitignore|eslint|prettier|tsconfig|vite|webpack|rollup)/i.test(file);
}

function unique(values) {
  return [...new Set(values)].sort();
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
