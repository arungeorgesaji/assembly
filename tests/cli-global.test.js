import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { main } from "../src/cli.js";

const execFileAsync = promisify(execFile);

test("cli resolves the target git root when launched from a subdirectory", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-global-cli-"));
  const nestedDir = path.join(rootDir, "packages", "app");
  await execFileAsync("git", ["init"], { cwd: rootDir });
  await mkdir(nestedDir, { recursive: true });
  await writeFile(path.join(rootDir, ".env"), "ASSEMBLY_AGENT_PROVIDER=stub\n");
  await writeFile(path.join(rootDir, "README.md"), "# Target Repo\n");

  const previousCwd = process.cwd();
  const savedEnv = saveEnv(["ASSEMBLY_AGENT_PROVIDER", "OPENAI_API_KEY"]);
  const stdout = { text: "", write(chunk) { this.text += chunk; } };
  const stderr = { text: "", write(chunk) { this.text += chunk; } };

  try {
    clearEnv(Object.keys(savedEnv));
    process.chdir(nestedDir);

    const code = await main(["run", "Add", "README", "note"], { stdout, stderr });
    const runId = JSON.parse(stdout.text).runId;

    assert.equal(code, 0);
    assert.equal(stderr.text, "");
    await access(path.join(rootDir, ".assembly", "runs", runId, "state.json"));
    await assert.rejects(access(path.join(nestedDir, ".assembly")));

    const request = JSON.parse(await readFile(path.join(rootDir, ".assembly", "runs", runId, "request.json"), "utf8"));
    assert.equal(request.request, "Add README note");
  } finally {
    process.chdir(previousCwd);
    restoreEnv(savedEnv);
  }
});

test("cli supports explicit --repo target", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-global-cli-repo-"));
  const outsideDir = await mkdtemp(path.join(tmpdir(), "assembly-global-cli-outside-"));
  await writeFile(path.join(rootDir, ".env"), "ASSEMBLY_AGENT_PROVIDER=stub\n");
  await writeFile(path.join(rootDir, "README.md"), "# Target Repo\n");

  const previousCwd = process.cwd();
  const savedEnv = saveEnv(["ASSEMBLY_AGENT_PROVIDER", "OPENAI_API_KEY", "ASSEMBLY_REPO"]);
  const stdout = { text: "", write(chunk) { this.text += chunk; } };
  const stderr = { text: "", write(chunk) { this.text += chunk; } };

  try {
    clearEnv(Object.keys(savedEnv));
    process.chdir(outsideDir);

    const code = await main(["--repo", rootDir, "run", "Add", "README", "note"], { stdout, stderr });
    const runId = JSON.parse(stdout.text).runId;

    assert.equal(code, 0);
    assert.equal(stderr.text, "");
    await access(path.join(rootDir, ".assembly", "runs", runId, "state.json"));
    await assert.rejects(access(path.join(outsideDir, ".assembly")));
  } finally {
    process.chdir(previousCwd);
    restoreEnv(savedEnv);
  }
});

function saveEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function clearEnv(keys) {
  for (const key of keys) {
    delete process.env[key];
  }
}

function restoreEnv(savedEnv) {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
