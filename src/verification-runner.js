import { spawn } from "node:child_process";

export async function runVerificationCommands(commands, rootDir = process.cwd()) {
  const results = [];

  for (const command of commands) {
    const result = await runCommand(command, rootDir);
    results.push(result);
    if (result.exitCode !== 0) {
      break;
    }
  }

  return results;
}

function runCommand(command, rootDir) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: rootDir,
      shell: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({
        command,
        exitCode: 1,
        stdout,
        stderr: error.message,
      });
    });
    child.on("close", (exitCode) => {
      resolve({
        command,
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

