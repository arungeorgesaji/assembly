# Assembly

Assembly is a Node.js CLI for coordinating AI coding work with scoped tasks, validation, review, and GitHub/Slack workflows.

It runs inside a target Git repository, stores state under `.assembly/`, and can create or update pull requests from local commands, GitHub comments, or Slack requests.

Assembly supports interaction via CLI, GitHub, and Slack requests, enabling flexible coordination of AI coding tasks across these platforms.

Assembly supports CLI, GitHub, and Slack requests.

## Install

Install as a dependency:

```bash
npm i @arungeorgesaji/assembly
```

Install the CLI globally:

```bash
npm install -g @arungeorgesaji/assembly
```

Then use:

```bash
assembly init
assembly doctor
assembly webhook --port 3000
```

## Quick Start

From the repository Assembly should modify:

```bash
cd my-repo
assembly init
assembly doctor
assembly plan "Add README setup notes" --pretty
assembly run "Add README setup notes" --pretty
```

`assembly init` creates:

```text
.env
.assembly/
```

Assembly resolves the target to the Git repository root. To target another checkout:

```bash
assembly --repo /path/to/repo doctor
```

## Configuration

`.env` is loaded from the target repo:

```text
ASSEMBLY_AGENT_PROVIDER=stub
ASSEMBLY_APPROVAL_MODE=auto
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
GITHUB_WEBHOOK_SECRET=
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=
```

Use `ASSEMBLY_AGENT_PROVIDER=stub` for no-op local testing. Use `openai` for provider-backed implementation and review.

Run:

```bash
assembly doctor
```

to check missing setup.

## Commands

```bash
assembly init [--force]
assembly doctor [--json] [--pretty]
assembly plan "request" --pretty
assembly run "request" --pretty
assembly follow-up <run-id> "feedback" --pretty
assembly status <run-id>
assembly inspect <run-id> --pretty
assembly github create-pr <run-id>
assembly job list
assembly job inspect <job-id> --pretty
assembly job process <job-id>
assembly job retry <job-id>
assembly webhook --port 3000
```

Runs are stored under:

```text
.assembly/runs/<run-id>/
```

Jobs are stored under:

```text
.assembly/jobs/
```

## How It Works

Assembly creates a plan from a request, assigns scoped tasks, runs agents, validates their output, runs verification, and writes a final report.

Current task owners:

- `planner`
- `implementation-agent`
- `review-agent`

Plans also include dynamic agent profiles derived from each task's scope, denylist, and change policy. These profiles are not predefined personas; they are generated per plan and passed to implementation/review agents as the delegation contract.

Assembly validates:

- task dependencies and acceptance criteria
- changed files against task scope
- denied paths such as `.env`, `.git/`, and `.assembly/`
- agent result shape
- additive edits for `Add ...` requests
- final git diff before PR creation
- review completion before PR creation

## GitHub

Create a PR from a completed run:

```bash
assembly github create-pr <run-id>
```

Requirements:

- `gh auth login` or `GH_TOKEN` / `GITHUB_TOKEN`
- clean working tree except run-owned files
- completed run
- completed review
- passing verification

Assembly stages only files owned by the run. It does not use `git add .`.

## Webhooks

Start the webhook server:

```bash
assembly webhook --port 3000
```

Expose it with a tunnel:

```bash
ngrok http 3000
```

GitHub webhook:

- Payload URL: `https://<tunnel>/github/webhook`
- Content type: `application/json`
- Secret: `GITHUB_WEBHOOK_SECRET`
- Events: issues, issue comments, pull request review comments, pull request reviews

Slack app:

- Request URL: `https://<tunnel>/slack/events`
- Bot events: `app_mention`, `message.im`
- Env: `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`

Mention `@assembly` in GitHub issues, PR comments, review comments, or Slack messages to queue work.

## Development

```bash
npm install
npm test
npm link
```
