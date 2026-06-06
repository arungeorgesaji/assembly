import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { parseGlobalOptions, resolveRootDir } from "../src/root.js";

test("parseGlobalOptions extracts repo before or after the command", () => {
  assert.deepEqual(parseGlobalOptions(["--repo", "../target", "doctor"]), {
    args: ["doctor"],
    repo: "../target",
    errors: [],
  });
  assert.deepEqual(parseGlobalOptions(["doctor", "--repo=../target", "--json"]), {
    args: ["doctor", "--json"],
    repo: "../target",
    errors: [],
  });
});

test("parseGlobalOptions rejects missing repo value", () => {
  assert.deepEqual(parseGlobalOptions(["doctor", "--repo"]), {
    args: ["doctor"],
    repo: undefined,
    errors: ["--repo requires a path"],
  });
});

test("resolveRootDir prefers explicit repo path", async () => {
  const rootDir = await resolveRootDir({
    cwd: "/tmp/current",
    repo: "../target",
    exec: async () => {
      throw new Error("git should not run for explicit repo");
    },
  });

  assert.equal(rootDir, path.resolve("/tmp/current", "../target"));
});

test("resolveRootDir uses git root when repo is not explicit", async () => {
  const rootDir = await resolveRootDir({
    cwd: "/tmp/current/subdir",
    exec: async (command, args, options) => {
      assert.equal(command, "git");
      assert.deepEqual(args, ["rev-parse", "--show-toplevel"]);
      assert.equal(options.cwd, "/tmp/current/subdir");
      return { stdout: "/tmp/current\n", stderr: "" };
    },
  });

  assert.equal(rootDir, "/tmp/current");
});
