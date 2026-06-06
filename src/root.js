import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function resolveRootDir({ cwd = process.cwd(), repo, env = process.env, exec = execFileAsync } = {}) {
  const explicitRepo = repo || env.ASSEMBLY_REPO;
  if (explicitRepo) {
    return path.resolve(cwd, explicitRepo);
  }

  try {
    const { stdout } = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
    const gitRoot = stdout.trim();
    return gitRoot ? path.resolve(gitRoot) : cwd;
  } catch {
    return cwd;
  }
}

export function parseGlobalOptions(argv) {
  const args = [];
  const errors = [];
  let repo;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) {
        errors.push("--repo requires a path");
        continue;
      }
      repo = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--repo=")) {
      const value = arg.slice("--repo=".length);
      if (!value) {
        errors.push("--repo requires a path");
        continue;
      }
      repo = value;
      continue;
    }
    args.push(arg);
  }

  return { args, repo, errors };
}
