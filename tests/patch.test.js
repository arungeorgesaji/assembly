import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { applyPatch, extractPatchChangedFiles, validatePatchForTask } from "../src/patch.js";

const task = {
  id: "implementation",
  scope: {
    paths: ["src/"],
    allowlist: ["package.json"],
    denylist: [".env", ".assembly/"],
  },
};

test("extractPatchChangedFiles reads unified diff paths", () => {
  const patch = [
    "diff --git a/src/example.js b/src/example.js",
    "--- a/src/example.js",
    "+++ b/src/example.js",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  assert.deepEqual(extractPatchChangedFiles(patch), ["src/example.js"]);
});

test("validatePatchForTask rejects patches outside task scope", () => {
  const patch = [
    "diff --git a/README.md b/README.md",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  assert.deepEqual(
    validatePatchForTask(task, {
      changedFiles: ["README.md"],
      patch,
    }),
    ["task implementation changed file README.md outside assigned scope"],
  );
});

test("applyPatch applies valid unified diff", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-patch-"));
  await mkdir(path.join(rootDir, "src"));
  await writeFile(path.join(rootDir, "src/example.js"), "const value = 1;\n");

  const patch = [
    "diff --git a/src/example.js b/src/example.js",
    "index 53f149a..3be9c81 100644",
    "--- a/src/example.js",
    "+++ b/src/example.js",
    "@@ -1 +1 @@",
    "-const value = 1;",
    "+const value = 2;",
    "",
  ].join("\n");

  await applyPatch(patch, rootDir);

  assert.equal(await readFile(path.join(rootDir, "src/example.js"), "utf8"), "const value = 2;\n");
});

