# Assembly

Assembly is a coordination layer for AI software engineering teams.

Modern coding agents are powerful, but they typically work alone with broad access to an entire codebase. Assembly introduces the structure characteristic of effective engineering organizations: planning, ownership, specialization, review, testing, traceability, and human-controlled delivery.

Assembly decomposes software development work into focused tasks, assigns those tasks to specialized agents, validates their outputs, and produces merge-ready pull requests with complete execution history.

## What Assembly Does

Assembly transforms a requested software change into a structured engineering workflow.

1. A Planner Agent analyzes the repository and the requested change.
2. The planner creates an execution plan with tasks, dependencies, file ownership, and acceptance criteria.
3. Specialized agents receive only the context required for their assigned work.
4. Agents produce patches, reports, tests, review notes, and other artifacts.
5. Assembly validates outputs against the original plan and routes them to downstream agents.
6. Testing and review agents verify behavior, regressions, code quality, architecture, and security.
7. Assembly creates a merge-ready pull request with a full summary of changes and findings.

Human engineers remain in control of the final merge decision.

## Why Assembly

AI engineering requires more than code generation; it needs coordination.

Without structure, agents can make unrelated edits, miss dependencies, duplicate work, overlook regressions, or lose the reasoning behind implementation decisions. Assembly provides AI agents with the same operating model that makes human engineering teams effective:

- Clear task ownership
- Limited and relevant context
- Explicit dependencies
- Acceptance criteria
- Structured handoffs
- Test and review gates
- Traceable decisions
- Human approval before merge

## Core Concepts

### Planner Agent

The Planner Agent understands the repository, interprets the requested change, and produces an execution plan. The plan defines what needs to happen, which agents should execute the work, what files or systems they own, and how success will be verified.

### Specialized Agents

Assembly assigns work to agents with focused responsibilities such as:

- Frontend development
- Backend implementation
- Database migrations
- Infrastructure changes
- Test generation and execution
- Security review
- Documentation
- Code review

Each agent receives scoped context relevant to its task instead of unrestricted access to the entire project history and plan.

### Structured Contracts

Agents collaborate through structured contracts: tasks, dependencies, artifacts, patches, reports, acceptance criteria, and validation results.

This approach keeps collaboration auditable and reduces unintended changes across unrelated parts of the codebase.

### Validation and Review

Assembly validates agent outputs before passing them forward. Testing agents verify acceptance criteria and regressions. Review agents inspect code quality, architecture, security concerns, and conflicts between changes from different agents.

### Real-Time Visibility

Assembly provides a live view of:

- Current plan
- Task ownership
- Agent progress
- Dependencies
- Changed files
- Test status
- Review results
- Blockers
- Decisions and rationale

Developers can see what each agent is doing, why decisions were made, and how the system arrived at the final pull request.

## Slack Workflow

Assembly integrates with Slack for teams that already coordinate engineering work there.

Developers can request changes, ask questions, or provide feedback from Slack. Assembly routes those requests to relevant agents, updates the execution plan, generates new changes, refreshes validation, and updates the pull request while preserving traceability.

## Pull Request Feedback

Developers can also request changes directly from pull requests. Assembly treats PR comments and review feedback as part of the active workflow, routes them to relevant agents, updates the plan when needed, generates follow-up changes, reruns validations, and refreshes the PR with the latest results.

## Pull Request Output

When work is complete, Assembly prepares a merge-ready pull request including:

- Summary of changes
- Agent contributions
- Files changed
- Test results
- Security findings
- Review recommendations
- Known risks or blockers
- Links to relevant artifacts and decisions

The pull request is designed to be understandable, auditable, and ready for human review.

## Project Status

Assembly is under active development.

The goal is not to replace engineers but to make AI-assisted development more structured, accountable, reviewable, and safe for real software teams.

## Getting Started

Assembly currently ships as a local Node.js CLI. The deterministic stub runner works without API keys; provider-backed implementation and review require an OpenAI API key.

Prerequisites:

- Node.js 20 or newer

Run locally without installation:

```bash
node src/cli.js plan "Add Slack workflow support" --pretty
```

Install dependencies:

```bash
npm install
```

Configure optional OpenAI execution:

```bash
cp .env.example .env
```

Then set:

```text
ASSEMBLY_AGENT_PROVIDER=openai
ASSEMBLY_APPROVAL_MODE=auto
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-4.1-mini
```

Leave `ASSEMBLY_AGENT_PROVIDER=stub` to run without an API key.

Create a plan with npm:

```bash
npm run plan -- "Add Slack workflow support" --pretty
```

Create a persisted local run:

```bash
npm run run -- "Add Slack workflow support" --pretty
```

Check a run:

```bash
node src/cli.js status <run-id>
node src/cli.js inspect <run-id> --pretty
```

Each run writes:

```text
.assembly/runs/<run-id>/
  request.json
  plan.json
  state.json
  events.jsonl
  final-report.md
  artifacts/
    <task-id>/
      result.json
      patch.diff
      file-updates.json
    verification/
      result.json
```

Run tests:

```bash
npm test
```

## Current Implementation

The initial working slice includes:

- Structured execution plan model
- Task ownership, dependencies, acceptance criteria, risks, and verification steps
- Task folder/file scopes with allowlists and denylists
- Deterministic, request-aware planner converting a change request into a task graph
- Request-specific task shapes for documentation, tests, refactors, and general code changes
- Repository-aware planning inspecting source, test, documentation, config files, package scripts, narrowing task scopes based on request terms
- Lightweight repository inspection for package type and verification commands
- Plan validation for missing owners, acceptance criteria, and invalid dependencies
- CLI emitting plan JSON
- Local run store under `.assembly/runs/<run-id>/`
- Stub agent runner producing per-task artifacts
- Optional OpenAI agent runner selected via `ASSEMBLY_AGENT_PROVIDER=openai`
- Optional OpenAI review agent inspecting completed task results and verification output
- Local `.env` loading for `OPENAI_API_KEY` and `OPENAI_MODEL`
- Approval gate before applying edits, defaulting to `ASSEMBLY_APPROVAL_MODE=auto`
- Agent result validation including task id, status, summary, changed files, artifacts, and risks
- Changed-file validation against each task's assigned scope
- Final git diff validation before PR creation or update, rejecting files not owned by the completed run
- Unified diff patch validation and local application via `git apply`
- Structured full-file updates for reliable local edits when patch generation is brittle
- Additive change policy for `Add ...` requests to prevent accidental line removals
- Post-run verification command execution with stored stdout, stderr, and exit codes
- Blocked and failed run handling
- Final report generation for every run
- Status and inspect commands for persisted runs

Stronger provider-backed coding behavior, richer Slack command syntax, and production deployment hardening are upcoming.

## Agent Result Contract

Agents must return structured results:

```json
{
  "taskId": "task-id",
  "status": "complete",
  "summary": "What happened.",
  "changedFiles": [],
  "artifacts": ["result.json"],
  "risks": [],
  "patch": "",
  "fileUpdates": []
}
```

Valid statuses: `complete`, `blocked`, `failed`. Completed tasks must include at least one artifact. If `patch` is present, it must be a unified diff whose changed files are all listed in `changedFiles` and allowed by the task scope. Agents can also return `fileUpdates` with full replacement file contents. Invalid or mismatched results mark the task and run as failed.

## Task Scope Contract

Each task includes a scope:

```json
{
  "scope": {
    "paths": ["src/", "tests/"],
    "allowlist": ["package.json"],
    "denylist": [".env", ".git/", ".assembly/"]
  }
}
```

Changed files must be safe relative paths inside `paths` or explicitly listed in `allowlist`. Denylisted paths always fail validation. Absolute paths and `../` traversal are rejected.

## Local Code Editing Flow

For local execution, an agent can return a unified diff in `patch`. Assembly then:

1. Extracts changed files from the patch
2. Validates those files against the task scope
3. Verifies every patch file is listed in `changedFiles`
4. Writes `artifacts/<task-id>/patch.diff`
5. Applies the patch with `git apply --check` followed by `git apply`
6. Runs detected verification commands such as `npm test`
7. Writes verification output to `artifacts/verification/result.json`

For model-generated edits, Assembly supports `fileUpdates`:

```json
{
  "fileUpdates": [
    {
      "path": "README.md",
      "content": "full replacement file content"
    }
  ]
}
```

Assembly validates each update path against the task scope before writing. For requests beginning with `Add`, an additive change policy ensures existing lines remain in order to prevent accidental removals.

## Planning and Review

The local planner is deterministic but request-aware:

- documentation requests create a documentation task scoped to `README.md`
- test requests create a test task scoped to `tests/`
- refactor requests create a refactor task scoped to implementation files
- general code requests create an implementation task scoped to `src/`, `tests/`, and selected project files

When `ASSEMBLY_AGENT_PROVIDER=openai` is enabled, OpenAI handles implementation and review tasks. Planner tasks remain deterministic. Review runs after implementation verification to inspect run state and artifacts, possibly marking the workflow `complete`, `blocked`, or `failed`.

## Approval Modes

Assembly validates agent output before any edit is applied, then passes the result through an approval gate:

- `auto`: apply validated edits immediately
- `manual`: pause the run before applying edits and mark it blocked
- `never`: dry-run mode; write artifacts but do not apply edits

Local CLI defaults to `auto`. Slack and GitHub flows can use `manual` later for human approval before delivery.

## Follow-Up and GitHub Flow

Create a local follow-up run from feedback:

```bash
node src/cli.js follow-up <run-id> "Address this feedback" --pretty
```

Create a GitHub pull request from a completed run:

```bash
node src/cli.js github create-pr <run-id>
```

The GitHub PR command uses `gh` and `git`. It creates and pushes a branch named `assembly/<run-id>`, opens a PR using the run report, then switches your local checkout back to the original branch.

Before creating a PR, Assembly requires:

- run status is `complete`
- verification passed
- review completed successfully
- run has owned changed files
- working tree has no unrelated dirty files

Only files recorded by the completed run are staged. Assembly does not use `git add .` for PR creation.

Turn a GitHub issue or PR comment into a follow-up run:

```bash
node src/cli.js github comment-to-follow-up <run-id> <comment-id>
```

Authenticate GitHub CLI first:

```bash
gh auth login
```

## Webhook Flow

Run the webhook server:

```bash
node src/cli.js webhook --port 3000
```

Expose it with a tunnel such as:

```bash
ngrok http 3000
```

Configure a GitHub webhook:

- Payload URL: `https://<your-tunnel>/github/webhook`
- Content type: `application/json`
- Secret: same value as `GITHUB_WEBHOOK_SECRET`
- Events:
  - issues
  - issue comments
  - pull request review comments
  - pull request reviews

Configure a Slack app:

- Enable Event Subscriptions
- Request URL: `https://<your-tunnel>/slack/events`
- Subscribe to bot events:
  - `app_mention`
  - `message.im`
- Install the app to your workspace
- Copy the signing secret to `SLACK_SIGNING_SECRET`
- Copy the bot token to `SLACK_BOT_TOKEN`

Set local environment variables:

```text
GITHUB_WEBHOOK_SECRET=your_webhook_secret
SLACK_SIGNING_SECRET=your_slack_signing_secret
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
ASSEMBLY_AGENT_PROVIDER=openai
ASSEMBLY_APPROVAL_MODE=auto
```

GitHub webhook events must include `@assembly` in the issue, comment, or review body. Slack requests come from app mentions or direct messages.

Supported events:

- `issues.opened` / `issues.edited`: creates a new run and opens a new PR
- `issue_comment.created` on issues: creates a new run and opens a new PR
- `issue_comment.created` on PRs: creates a follow-up run, updates the PR branch, refreshes the PR body, and posts a completion comment
- `pull_request_review_comment.created`: creates a follow-up run with inline context, updates the PR branch, refreshes the PR body, and posts a comment
- `pull_request_review.submitted`: creates a follow-up run from the review, updates the PR branch, refreshes the PR body, and posts a comment

Webhook handling is asynchronous:

1. verify GitHub signature
2. ignore unsupported events or comments without `@assembly`
3. ignore duplicate GitHub delivery IDs with existing jobs
4. enqueue a job under `.assembly/jobs/`
5. respond to GitHub quickly
6. process the job in the background
7. create a temporary git worktree to avoid touching your dirty local checkout
8. create a run or follow-up run
9. copy the run record back into `.assembly/runs/`
10. push owned changes to a new or existing PR branch
11. refresh the PR body with the latest run report for follow-ups
12. comment back on the issue or PR

On GitHub job failure, Assembly comments with the job id, run id if any, retryability, failure reason, and suggested next action.

Slack handling verifies Slack signatures, answers URL verification challenges, deduplicates Slack event IDs, and queues `slack.request` jobs. The first request in a Slack thread creates an Assembly run, opens a GitHub PR, stores the Slack thread to PR mapping under `.assembly/slack-threads/`, and replies with the PR link. Later requests in the same thread become follow-up runs against the same PR branch, refreshing the PR body and replying in the thread. Slack job failures result in reply comments with details.

Manual retry/debugging:

```bash
node src/cli.js job list
node src/cli.js job inspect <job-id> --pretty
node src/cli.js job process <job-id>
node src/cli.js job retry <job-id>
```

## License

See [LICENSE](LICENSE).
