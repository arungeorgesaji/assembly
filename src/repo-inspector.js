import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export function inspectRepository(rootDir = process.cwd()) {
  const files = listTopLevelFiles(rootDir);
  const hasPackageJson = files.includes("package.json");
  const hasTests = existsSync(path.join(rootDir, "tests"));
  const allFiles = listRepositoryFiles(rootDir);
  const packageJson = readPackageJson(rootDir);

  return {
    rootDir,
    files,
    sourceFiles: allFiles.filter((file) => file.startsWith("src/")),
    testFiles: allFiles.filter((file) => file.startsWith("tests/")),
    documentationFiles: allFiles.filter((file) => /(^|\/)(readme|docs?|documentation)|\.md$/i.test(file)),
    configFiles: allFiles.filter((file) => /(^|\/)(package(-lock)?\.json|\.gitignore|eslint|prettier|tsconfig|vite|webpack|rollup)/i.test(file)),
    language: hasPackageJson ? "javascript" : "unknown",
    packageManager: hasPackageJson ? "npm" : null,
    scripts: packageJson?.scripts ?? {},
    verificationCommands: hasPackageJson ? ["npm test"] : [],
    suggestedScopes: {
      implementation: {
        paths: ["src/", "tests/"],
        allowlist: ["package.json", "package-lock.json", "README.md", ".gitignore"],
        denylist: [".env", ".env.*", ".git/", ".assembly/"],
      },
      review: {
        paths: hasTests ? ["tests/", ".assembly/"] : [".assembly/"],
        allowlist: ["README.md"],
        denylist: [".env", ".env.*", ".git/"],
      },
    },
  };
}

function listTopLevelFiles(rootDir) {
  try {
    return readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort();
  } catch {
    return [];
  }
}

function listRepositoryFiles(rootDir) {
  const ignoredDirectories = new Set([".git", ".assembly", "node_modules", "dist", "build", "coverage"]);
  const results = [];

  function visit(relativeDir = "") {
    const absoluteDir = path.join(rootDir, relativeDir);
    let entries;
    try {
      entries = readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && ![".gitignore"].includes(entry.name)) {
        continue;
      }
      const relativePath = path.posix.join(relativeDir.split(path.sep).join(path.posix.sep), entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          visit(relativePath);
        }
        continue;
      }
      if (entry.isFile()) {
        results.push(relativePath);
      }
    }
  }

  visit();
  return results.sort();
}

function readPackageJson(rootDir) {
  try {
    return JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}
