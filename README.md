# Assembly

## Overview

Assembly is a Node.js CLI for coordinating AI coding work across local commands, GitHub, and Slack. It turns a request into scoped tasks, runs agents, validates their output, and can create or update pull requests.

## Problem Statement

AI coding agents are useful, but they often work with broad repository access and weak process boundaries. That makes it easy to get unrelated edits, unclear ownership, missing review, and poor traceability.

## Solution

Assembly adds an orchestration layer around coding agents. It creates a plan, assigns scoped task ownership, gives agents focused context, validates changed files, runs verification, records execution history, and delivers changes through pull requests.

## Features

- CLI workflow for `plan`, `run`, `status`, `inspect`, and PR creation
- GitHub issue, PR comment, review comment, and review submission handling
- Slack request handling with thread follow-ups
- Scoped task ownership with allowlists and denylists
- Dynamic agent profiles generated from each task's scope
- OpenAI-backed implementation and review agents
- Local run and job history under `.assembly/`
- Verification and review gates before PR creation

## Tech Stack

- Frontend: None
- Backend: Node.js CLI and local webhook server
- Database: Local JSON files under `.assembly/`
- APIs: OpenAI API, GitHub CLI/API, Slack Events API
- Hosting: Local machine, with optional tunnel such as ngrok for webhooks

## Codex / OpenAI Usage

Codex and OpenAI were used throughout the build for:

- Ideation and product direction
- Architecture planning for planner, worker, review, GitHub, and Slack flows
- Code generation for the Node.js CLI and orchestration modules
- Debugging run failures, GitHub PR creation, npm publishing, and webhook behavior
- Test generation for planner, job worker, GitHub, Slack, scoped edits, and CLI flows
- README and package documentation
- OpenAI API integration for implementation and review agents

Assembly itself can also use OpenAI at runtime when `ASSEMBLY_AGENT_PROVIDER=openai` is configured.

## Demo

[![Video Title](https://img.youtube.com/vi/RGeRlXx37tI/0.jpg)](https://www.youtube.com/watch?v=RGeRlXx37tI)

## Screenshots

![Assembly screenshot 1](image-1.png)

![Assembly screenshot 2](image-2.png)

![Assembly screenshot 3](image-3.png)

## How to Run Locally

Install the package:

```bash
npm i @arungeorgesaji/assembly
```

Or install the CLI globally:

```bash
npm install -g @arungeorgesaji/assembly
```

Initialize Assembly inside a target repository:

```bash
cd <project-folder>
assembly init
assembly doctor
```

Configure `.env`:

```text
ASSEMBLY_AGENT_PROVIDER=openai
ASSEMBLY_APPROVAL_MODE=auto
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-4.1-mini
GITHUB_WEBHOOK_SECRET=your_github_webhook_secret
SLACK_SIGNING_SECRET=your_slack_signing_secret
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
```

Run a local request:

```bash
assembly run "Add README setup notes" --pretty
assembly github create-pr <run-id>
```

Start webhooks:

```bash
assembly webhook --port 3000
```

Expose locally if needed:

```bash
ngrok http 3000
```

For development on Assembly itself:

```bash
git clone <repo-url>
cd assembly
npm install
npm test
npm link
```
