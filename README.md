# PatchPact

[![CI](https://github.com/FlowerNeverFade/patchpact/actions/workflows/ci.yml/badge.svg)](https://github.com/FlowerNeverFade/patchpact/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)

PatchPact is a contract-first GitHub App for open source maintainers.

Instead of waiting for a pull request to explain itself, PatchPact creates a reviewable `Contribution Contract` on the issue thread first, then generates a `Decision Packet` on the pull request to show scope fit, risk, missing tests, and suggested next action.

## Why this exists

Maintainers are increasingly dealing with low-context and AI-assisted contributions that look plausible but are expensive to review. PatchPact changes the workflow:

1. A maintainer or contributor runs `/contract create` on an issue.
2. PatchPact drafts a scoped contract from the issue text, repo guidance, and recent repository activity.
3. A maintainer locks it with `/contract approve` or skips with `/contract waive`.
4. When a PR opens, PatchPact compares the change against the approved contract and posts a `Decision Packet`.

When a pull request cannot or should not link an issue through closing keywords, maintainers still have two explicit escape hatches:

- add `PatchPact-Contract: #123` to the PR body to manually bind a contract source issue
- run `/contract waive <reason>` on the PR thread to record a maintainer override

The point is not to automate maintainer judgment away. The point is to make that judgment cheaper, faster, and more consistent.

## What is implemented

- `GitHub App` style webhook server in `apps/web`
- Lightweight HTML dashboard at `/dashboard` with per-repository console pages
- Setup and readiness guide at `/setup`
- `BullMQ` worker in `apps/worker`
- Admin and debugging CLI in `apps/cli`
- Shared core schemas, heuristics, prompt construction, markdown rendering, and policy engine in `packages/core`
- GitHub, model, queue, and storage adapters in `packages/adapters`
- Lightweight repository knowledge index with lexical retrieval backed by memory or Postgres
- `Postgres + pgvector` bootstrap schema and `Redis` compose services
- Local-friendly fallbacks: in-memory storage, inline jobs, and a deterministic mock model

## Open source workflow

- Read the contribution guide in [CONTRIBUTING.md](./CONTRIBUTING.md)
- Review community expectations in [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- Report sensitive issues privately using [SECURITY.md](./SECURITY.md)
- GitHub Actions runs `typecheck`, `test`, and `build` on pushes and pull requests

## Monorepo layout

- `apps/web`: webhook ingestion, JSON API, dashboard
- `apps/worker`: async job processing for BullMQ mode
- `apps/cli`: config validation, webhook replay, offline debugging
- `packages/core`: domain model and contract-first logic
- `packages/adapters`: GitHub, model, storage, queue adapters
- `fixtures`: demo repository and webhook payloads
- `infra/postgres/init.sql`: bootstrap schema

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Copy env defaults:

```bash
copy .env.example .env
```

3. Optional infrastructure for persistent mode:

```bash
docker compose up -d
```

4. Start the web server:

```bash
npm run dev:web
```

5. Start the worker when `PATCHPACT_INLINE_JOBS=false`:

```bash
npm run dev:worker
```

6. Open the dashboard:

```text
http://localhost:3000/dashboard
```

7. Open a repository console after the repo is connected:

```text
http://localhost:3000/dashboard/<owner>/<repo>
```

8. Open the instance setup guide:

```text
http://localhost:3000/setup
```

9. If you are contributing, check the PR template and issue forms in `.github/`

## Configuration

PatchPact reads repository policy from `.patchpact.yml`.

```yaml
mode: advisory
provider: mock
model: heuristic-v1
required_contract_sections:
  - problemStatement
  - scopeBoundaries
  - impactedAreas
  - acceptanceCriteria
  - testExpectations
  - nonGoals
docs_globs:
  - README.md
  - CONTRIBUTING.md
test_globs:
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "**/test_*.py"
repo_rules:
  - Require a linked issue or a waiver before merge.
  - Require tests for user-visible changes.
```

### Modes

- `advisory`: PatchPact comments and posts checks, but does not block by default
- `soft-gate`: PatchPact marks missing contracts, major misalignment, or missing tests as `action_required`

### Model providers

- `mock`
- `openai-compatible`
- `anthropic`
- `ollama`

If a remote provider errors or returns invalid JSON, PatchPact falls back to deterministic heuristics instead of failing closed.

## GitHub commands

- `/contract create`
- `/contract refresh`
- `/contract approve`
- `/contract waive`
- `/packet explain`

### Manual contract linking

PatchPact prefers normal GitHub closing keywords such as `Closes #42`. If a PR should bind to a contract without using a closing keyword, add this line to the PR body:

```text
PatchPact-Contract: #42
```

### PR-thread waiver

If a pull request is intentionally proceeding without a contract, a maintainer can comment:

```text
/contract waive docs-only change
```

PatchPact will record the waiver, show it on the resulting decision packet, and avoid turning a missing-contract state into a `soft-gate` block.

## Webhook behavior

- `installation`: remember connected repositories and bootstrap their knowledge index
- `issues` on `edited` or `reopened`: refresh the current contract when a contract already exists
- `issue_comment`: handle slash commands
- `pull_request`: generate or refresh decision packets
- `pull_request_review`: regenerate decision packets after new review state
- `push` to the default branch: refresh the repository knowledge index

## CLI

Validate a config file:

```bash
npm run dev:cli -- validate-config fixtures/repos/demo/.patchpact.yml
```

Generate an offline contract from the demo fixture:

```bash
npm run dev:cli -- debug-contract --fixture fixtures/repos/demo/seed.json --issue 42
```

Generate an offline decision packet from the demo fixture:

```bash
npm run dev:cli -- debug-packet --fixture fixtures/repos/demo/seed.json --pr 77 --issue 42
```

Replay a webhook payload locally:

```bash
npm run dev:cli -- replay-webhook --event issue_comment --file fixtures/github/issue_comment.contract.create.json
```

Search the stored repository knowledge:

```bash
npm run dev:cli -- search-knowledge --owner acme --repo patchpact-demo --query tests
```

## API surface

- `GET /healthz`
- `GET /dashboard`
- `GET /dashboard/:owner/:repo`
- `GET /dashboard/jobs/:dedupeKey`
- `GET /setup`
- `GET /api/setup`
- `GET /dashboard/:owner/:repo/contracts/:issueNumber`
- `GET /dashboard/:owner/:repo/packets/:pullRequestNumber`
- `GET /api/repositories`
- `GET /api/repositories/:owner/:repo`
- `GET /api/repositories/:owner/:repo/contracts/:issueNumber`
- `GET /api/repositories/:owner/:repo/packets/:pullRequestNumber`
- `GET /api/repositories/:owner/:repo/knowledge?q=tests`
- `GET /api/repositories/:owner/:repo/waivers`
- `GET /api/jobs/:dedupeKey`
- `POST /api/repositories/:owner/:repo/config`
- `POST /dashboard/:owner/:repo/config`
- `POST /dashboard/:owner/:repo/actions/sync-knowledge`
- `POST /dashboard/:owner/:repo/actions/refresh-contract`
- `POST /dashboard/:owner/:repo/actions/regenerate-packet`
- `POST /dashboard/jobs/:dedupeKey/retry`
- `POST /webhooks/github`

## Dashboard console

Each connected repository now has a dedicated console page where maintainers can:

- edit repository policy without leaving the browser
- search the current lightweight knowledge index
- trigger a manual knowledge sync
- open contract and decision packet detail pages
- manually refresh a contract draft or regenerate a decision packet
- inspect recent contracts, decision packets, and waivers in one place

The dashboard now also includes job detail pages so operators can inspect stored webhook/task payloads and retry failed jobs from the browser.

## Security boundaries

- Issue, pull request, comment, and repository document content is treated as untrusted
- Prompt construction explicitly separates system rules, repository rules, and user content
- PatchPact never executes repository code
- PatchPact does not read secrets from repositories or environments beyond its own configured credentials
- High-risk actions like merge, issue close, and code edits are intentionally out of scope for v1

## GitHub App permissions

PatchPact is designed for these GitHub App events and permissions:

- Events: `installation`, `issues`, `issue_comment`, `pull_request`, `pull_request_review`, `push`
- Permissions: `Issues read/write`, `Pull requests read/write`, `Checks read/write`, `Contents read`, `Metadata read`

## Testing

```bash
npm run typecheck
npm test
npm run build
```

## Repository hygiene

This repository includes:

- CI workflow: `.github/workflows/ci.yml`
- Dependabot updates: `.github/dependabot.yml`
- Issue forms for bug reports and feature requests
- Pull request template
- `CODEOWNERS` for review routing

## Status

This repository is a strong v1 foundation:

- contract and decision packet schemas are implemented
- webhook to job to artifact flow is implemented
- dashboard and repository config API are implemented
- mock/offline paths are implemented for demos and tests

The next layer would be stronger retrieval, richer PR explanation, GH App installation UX, and multi-repository organization views.
