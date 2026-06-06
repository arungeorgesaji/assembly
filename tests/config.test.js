import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadEnv } from "../src/config.js";

test("loadEnv reads local .env without overwriting existing process env", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-env-"));
  await writeFile(
    path.join(rootDir, ".env"),
    [
      "ASSEMBLY_AGENT_PROVIDER=openai",
      "OPENAI_API_KEY=from-file",
      "OPENAI_MODEL=\"test-model\"",
      "",
    ].join("\n"),
  );

  const previousProvider = process.env.ASSEMBLY_AGENT_PROVIDER;
  const previousKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.OPENAI_MODEL;

  try {
    process.env.OPENAI_API_KEY = "already-set";
    delete process.env.ASSEMBLY_AGENT_PROVIDER;
    delete process.env.OPENAI_MODEL;

    await loadEnv(rootDir);

    assert.equal(process.env.ASSEMBLY_AGENT_PROVIDER, "openai");
    assert.equal(process.env.OPENAI_API_KEY, "already-set");
    assert.equal(process.env.OPENAI_MODEL, "test-model");
  } finally {
    restoreEnv("ASSEMBLY_AGENT_PROVIDER", previousProvider);
    restoreEnv("OPENAI_API_KEY", previousKey);
    restoreEnv("OPENAI_MODEL", previousModel);
  }
});

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

