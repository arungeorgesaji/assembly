import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const MAX_FILES = 24;
const MAX_TOTAL_CHARS = 60000;
const SKIP_DIRS = new Set([".git", ".assembly", "node_modules", "coverage", "dist", "build"]);

export async function buildTaskContext(task, rootDir = process.cwd()) {
  const candidatePaths = [...task.scope.allowlist, ...task.scope.paths];
  const files = [];
  let totalChars = 0;

  for (const candidatePath of candidatePaths) {
    if (files.length >= MAX_FILES || totalChars >= MAX_TOTAL_CHARS) {
      break;
    }

    const discovered = await discoverFiles(rootDir, candidatePath);
    for (const filePath of discovered) {
      if (files.length >= MAX_FILES || totalChars >= MAX_TOTAL_CHARS) {
        break;
      }

      const content = await readFile(path.join(rootDir, filePath), "utf8").catch(() => null);
      if (content === null) {
        continue;
      }

      const remainingChars = MAX_TOTAL_CHARS - totalChars;
      const truncatedContent = content.slice(0, remainingChars);
      files.push({
        path: filePath,
        content: truncatedContent,
        truncated: truncatedContent.length < content.length,
      });
      totalChars += truncatedContent.length;
    }
  }

  return {
    files,
    limits: {
      maxFiles: MAX_FILES,
      maxTotalChars: MAX_TOTAL_CHARS,
      truncated: files.length >= MAX_FILES || totalChars >= MAX_TOTAL_CHARS,
    },
  };
}

async function discoverFiles(rootDir, scopePath) {
  const normalized = scopePath.replaceAll("\\", "/");
  const absolutePath = path.join(rootDir, normalized);
  const stats = await stat(absolutePath).catch(() => null);
  if (!stats) {
    return [];
  }

  if (stats.isFile()) {
    return [normalized];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  return walkDirectory(rootDir, normalized);
}

async function walkDirectory(rootDir, relativeDir) {
  const entries = await readdir(path.join(rootDir, relativeDir), { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const childPath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDirectory(rootDir, childPath)));
    } else if (entry.isFile() && isTextFile(childPath)) {
      files.push(childPath);
    }
  }

  return files.sort();
}

function isTextFile(filePath) {
  return /\.(cjs|css|js|json|jsx|md|mjs|ts|tsx|txt|yaml|yml)$/i.test(filePath);
}
