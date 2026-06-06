import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyFileUpdates,
  validateAdditiveFileUpdates,
  validateFileUpdatesForTask,
} from "../src/file-updates.js";

const task = {
  id: "implementation",
  scope: {
    paths: ["src/"],
    allowlist: ["README.md"],
    denylist: [".env", ".assembly/"],
  },
};

test("validateFileUpdatesForTask accepts scoped updates", () => {
  assert.deepEqual(
    validateFileUpdatesForTask(task, {
      changedFiles: ["src/app.js", "README.md"],
      fileUpdates: [
        { path: "src/app.js", content: "export const app = true;\n" },
        { path: "README.md", content: "# Demo\n" },
      ],
    }),
    [],
  );
});

test("validateFileUpdatesForTask rejects unlisted and out-of-scope updates", () => {
  assert.deepEqual(
    validateFileUpdatesForTask(task, {
      changedFiles: [],
      fileUpdates: [{ path: "package.json", content: "{}\n" }],
    }),
    [
      "task implementation changed file package.json outside assigned scope",
      "task implementation updates package.json but result.changedFiles does not list it",
    ],
  );
});

test("applyFileUpdates writes files", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-file-updates-"));

  await applyFileUpdates([{ path: "src/app.js", content: "export const app = true;\n" }], rootDir);

  assert.equal(await readFile(path.join(rootDir, "src", "app.js"), "utf8"), "export const app = true;\n");
});

test("validateAdditiveFileUpdates rejects removals", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-additive-"));
  await applyFileUpdates([{ path: "README.md", content: "A\nB\nC\n" }], rootDir);

  assert.deepEqual(
    await validateAdditiveFileUpdates(
      { ...task, changePolicy: "additive" },
      {
        fileUpdates: [{ path: "README.md", content: "A\nC\nD\n" }],
      },
      rootDir,
    ),
    ["task implementation additive update for README.md removes or rewrites existing lines"],
  );
});

test("validateAdditiveFileUpdates accepts inserted lines", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-additive-ok-"));
  await applyFileUpdates([{ path: "README.md", content: "A\nB\nC\n" }], rootDir);

  assert.deepEqual(
    await validateAdditiveFileUpdates(
      { ...task, changePolicy: "additive" },
      {
        fileUpdates: [{ path: "README.md", content: "A\nB\nD\nC\n" }],
      },
      rootDir,
    ),
    [],
  );
});
