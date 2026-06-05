# Assembly

Assembly is a coordination layer for AI software engineering teams.

Modern coding agents are powerful, but they usually work alone with broad access to an entire codebase. Assembly introduces the structure used by effective engineering organizations: planning, ownership, specialization, review, testing, traceability, and human-controlled delivery.

Assembly decomposes software development work into focused tasks, assigns those tasks to specialized agents, validates their outputs, and produces merge-ready pull requests with complete execution history.

## What Assembly Does

Assembly turns a requested software change into a structured engineering workflow.

1. A Planner Agent analyzes the repository and the requested change.
2. The planner creates an execution plan with tasks, dependencies, file ownership, and acceptance criteria.
3. Specialized agents receive only the context required for their assigned work.
4. Agents produce patches, reports, tests, review notes, and other artifacts.
5. Assembly validates outputs against the original plan and routes them to downstream agents.
6. Testing and review agents verify behavior, regressions, code quality, architecture, and security.
7. Assembly creates a merge-ready pull request with a full summary of changes and findings.

Human engineers remain in control of the final merge decision.

## Why Assembly

AI engineering work needs more than code generation. It needs coordination.

Without structure, agents can make unrelated edits, miss dependencies, duplicate work, overlook regressions, or lose the reasoning behind implementation decisions. Assembly is designed to give AI agents the same operating model that makes human engineering teams effective:

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

The Planner Agent is responsible for understanding the repository, interpreting the requested change, and producing an execution plan. The plan defines what needs to happen, which agents should do the work, what files or systems they own, and how success will be verified.

### Specialized Agents

Assembly assigns work to agents with focused responsibilities, such as:

- Frontend development
- Backend implementation
- Database migrations
- Infrastructure changes
- Test generation and execution
- Security review
- Documentation
- Code review

Each agent receives scoped context for its task instead of unrestricted access to the entire project history and plan.

### Structured Contracts

Agents do not coordinate through unstructured back-and-forth communication. Assembly uses structured contracts: tasks, dependencies, artifacts, patches, reports, acceptance criteria, and validation results.

This keeps collaboration auditable and reduces unintended changes across unrelated parts of the codebase.

### Validation And Review

Assembly validates agent outputs before they are passed forward. Testing agents verify acceptance criteria and regressions. Review agents inspect code quality, architecture, security concerns, and conflicts between changes from different agents.

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

Developers can see what each agent is doing, why a decision was made, and how the system arrived at the final pull request.

## Slack Workflow

Assembly integrates with Slack for teams that already coordinate engineering work there.

Developers can request changes, ask questions, or provide feedback from Slack. Assembly routes those requests to the relevant agents, updates the execution plan, generates new changes, refreshes validation, and updates the pull request while preserving traceability.

## Pull Request Feedback

Developers can also request changes directly from the pull request. Assembly treats PR comments and review feedback as part of the active workflow, routes them to the relevant agents, updates the plan when needed, generates follow-up changes, reruns validation, and refreshes the pull request with the latest results.

## Pull Request Output

When work is complete, Assembly prepares a merge-ready pull request that includes:

- Summary of changes
- Agent contributions
- Files changed
- Test results
- Security findings
- Review recommendations
- Known risks or blockers
- Links to relevant artifacts and decisions

The pull request is intended to be understandable, auditable, and ready for human review.

## Project Status

Assembly is under active development.

The goal is not to replace engineers. The goal is to make AI-assisted development more structured, accountable, reviewable, and safe for real software teams.

## License

See [LICENSE](LICENSE).
