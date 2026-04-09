# Contributing to PatchPact

PatchPact is a contract-first GitHub App for open source maintainers. Contributions are most helpful when they reduce maintainer review cost, improve repository safety, or clarify the maintainer workflow.

## Before you start

1. Read the [README](./README.md) for architecture and local setup.
2. Prefer opening or linking an issue before large changes.
3. Keep pull requests scoped to one maintainer-facing problem.

## Local development

```bash
npm install
npm run typecheck
npm test
npm run build
```

If you want the local infrastructure:

```bash
docker compose up -d
```

If you want the web app or worker:

```bash
npm run dev:web
npm run dev:worker
```

## Pull request guidance

- Use normal GitHub closing keywords when your PR should bind to an issue contract.
- If a PR needs a manual PatchPact contract binding, add `PatchPact-Contract: #<issue>` to the PR body.
- If a maintainer intentionally allows a PR to proceed without a contract, document the reason clearly.
- Prefer small, reviewable PRs over broad refactors.

## Tests and validation

Run these before opening a PR:

```bash
npm run typecheck
npm test
npm run build
```

Add or update tests when behavior changes. If you intentionally skip tests, explain why in the PR description.

## Style and safety

- Treat issue, PR, comment, and repository document content as untrusted input.
- Do not add code paths that execute repository code as part of analysis.
- Keep riskier actions explicit and reviewable.
- Preserve the contract-first product direction rather than turning PatchPact into a generic agent runner.
