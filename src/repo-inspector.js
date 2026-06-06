import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export function inspectRepository(rootDir = process.cwd()) {
  const files = listTopLevelFiles(rootDir);
  const hasPackageJson = files.includes("package.json");
  const hasTests = existsSync(path.join(rootDir, "tests"));

  return {
    rootDir,
    files,
    language: hasPackageJson ? "javascript" : "unknown",
    packageManager: hasPackageJson ? "npm" : null,
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

