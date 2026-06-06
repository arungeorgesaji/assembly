import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";
import { initializeAssembly } from "../src/init.js";

test("initializeAssembly creates .env and .assembly", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-init-"));

  const result = await initializeAssembly({ rootDir });

  assert.equal(result.createdEnv, true);
  assert.equal(result.createdStateDir, true);
  assert.match(await readFile(path.join(rootDir, ".env"), "utf8"), /ASSEMBLY_AGENT_PROVIDER=stub/);
  assert.equal((await stat(path.join(rootDir, ".assembly"))).isDirectory(), true);
});

test("initializeAssembly does not overwrite existing .env by default", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-init-existing-"));
  await writeFile(path.join(rootDir, ".env"), "OPENAI_API_KEY=keep-me\n");

  const result = await initializeAssembly({ rootDir });

  assert.equal(result.createdEnv, false);
  assert.equal(await readFile(path.join(rootDir, ".env"), "utf8"), "OPENAI_API_KEY=keep-me\n");
});

test("initializeAssembly force merges missing defaults into existing .env", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-init-force-"));
  await writeFile(path.join(rootDir, ".env"), "OPENAI_API_KEY=keep-me\n");

  const result = await initializeAssembly({ rootDir, force: true });
  const env = await readFile(path.join(rootDir, ".env"), "utf8");

  assert.equal(result.updatedEnv, true);
  assert.match(env, /OPENAI_API_KEY=keep-me/);
  assert.match(env, /ASSEMBLY_AGENT_PROVIDER=stub/);
  assert.doesNotMatch(env, /OPENAI_API_KEY=\n/);
});

test("init command targets explicit repo", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-init-cli-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "assembly-init-cwd-"));
  await mkdir(rootDir, { recursive: true });
  const previousCwd = process.cwd();
  const stdout = { text: "", write(chunk) { this.text += chunk; } };
  const stderr = { text: "", write(chunk) { this.text += chunk; } };

  try {
    process.chdir(cwd);

    const code = await main(["--repo", rootDir, "init"], { stdout, stderr });

    assert.equal(code, 0);
    assert.equal(stderr.text, "");
    assert.match(stdout.text, /Initialized Assembly/);
    assert.match(await readFile(path.join(rootDir, ".env"), "utf8"), /SLACK_BOT_TOKEN=/);
  } finally {
    process.chdir(previousCwd);
  }
});
