import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitHubPullRequest, getGitHubComment } from "../src/github.js";
import { initializeRun, writeRunFile, writeState } from "../src/run-store.js";

test("createGitHubPullRequest creates branch, commit, push, and PR with gh", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "assembly-github-"));
  await mkdir(path.join(rootDir, ".assembly", "runs", "run-1"), { recursive: true });
  const plan = {
    request: "Add docs",
    tasks: [],
    verification: [],
  };
  const state = await initializeRun({ runId: "run-1", request: "Add docs", plan }, rootDir);
  state.status = "complete";
  await writeState("run-1", state, rootDir);
  await writeRunFile("run-1", "final-report.md", "# Report\n", rootDir);

  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (command === "gh") {
      return { stdout: "https://github.com/example/repo/pull/1\n" };
    }
    return { stdout: "" };
  };

  const result = await createGitHubPullRequest("run-1", { rootDir, exec });

  assert.equal(result.branchName, "assembly/run-1");
  assert.equal(result.url, "https://github.com/example/repo/pull/1");
  assert.deepEqual(
    calls.map((call) => [call.command, call.args[0], call.args[1]]),
    [
      ["git", "checkout", "-B"],
      ["git", "add", "."],
      ["git", "commit", "-m"],
      ["git", "push", "-u"],
      ["gh", "pr", "create"],
    ],
  );
});

test("getGitHubComment reads comment body through gh api", async () => {
  const exec = async (command, args) => {
    assert.equal(command, "gh");
    assert.deepEqual(args, ["api", "repos/{owner}/{repo}/issues/comments/123"]);
    return {
      stdout: JSON.stringify({
        id: 123,
        body: "Please address this feedback",
        html_url: "https://github.com/example/repo/pull/1#issuecomment-123",
      }),
    };
  };

  assert.deepEqual(await getGitHubComment("123", { exec }), {
    id: "123",
    body: "Please address this feedback",
    url: "https://github.com/example/repo/pull/1#issuecomment-123",
  });
});

