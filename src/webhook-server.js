import http from "node:http";

import { loadEnv } from "./config.js";
import { handleGitHubWebhook } from "./github-webhooks.js";
import { processJob } from "./job-worker.js";

export function startWebhookServer({ port = 3000, host = "127.0.0.1", rootDir = process.cwd(), processJobs = true } = {}) {
  const server = http.createServer(async (request, response) => {
    await loadEnv(rootDir);

    if (request.method !== "POST" || request.url !== "/github/webhook") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }

    const rawBody = await readRequestBody(request);
    const result = await handleGitHubWebhook({
      event: request.headers["x-github-event"],
      delivery: request.headers["x-github-delivery"],
      signature: request.headers["x-hub-signature-256"],
      rawBody,
    }, rootDir).catch((error) => {
      console.error(`webhook error: ${error.stack ?? error.message}`);
      return { status: 500, body: { error: error.message } };
    });

    response.writeHead(result.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result.body));

    if (processJobs && result.body?.queued && result.body.jobId) {
      setImmediate(() => {
        processJob(result.body.jobId, { rootDir }).catch((error) => {
          console.error(`job ${result.body.jobId} failed: ${error.stack ?? error.message}`);
        });
      });
    }
  });

  server.listen(port, host);
  return server;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
