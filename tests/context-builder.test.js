import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildTaskContext } from "../src/context-builder.js";

test("buildTaskContext reads scoped text files and skips ignored directories", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-context-"));
  await mkdir(path.join(rootDir, "src"));
  await mkdir(path.join(rootDir, "node_modules", "pkg"), { recursive: true });
  await writeFile(path.join(rootDir, "src", "app.js"), "export const app = true;\n");
  await writeFile(path.join(rootDir, "README.md"), "# Demo\n");
  await writeFile(path.join(rootDir, "node_modules", "pkg", "index.js"), "ignored\n");

  const context = await buildTaskContext(
    {
      scope: {
        paths: ["src/"],
        allowlist: ["README.md"],
      },
    },
    rootDir,
  );

  assert.deepEqual(
    context.files.map((file) => file.path),
    ["README.md", "src/app.js"],
  );
  assert.equal(context.files[1].content, "export const app = true;\n");
});
