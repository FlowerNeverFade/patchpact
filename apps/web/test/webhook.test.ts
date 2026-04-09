import crypto from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { PatchPactEngine, defaultPatchPactConfig, type PatchPactJob } from "@patchpact/core";
import {
  InlineJobBus,
  MemoryArtifactStore,
  MemoryGitHubPlatform,
  MockModelProvider,
  type PatchPactEnv,
} from "@patchpact/adapters";
import { createWebApp } from "../src/app.js";

function sign(secret: string, payload: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
}

function createEnv(): PatchPactEnv {
  return {
    NODE_ENV: "test",
    PORT: 3000,
    PATCHPACT_BASE_URL: "http://localhost:3000",
    PATCHPACT_GITHUB_APP_NAME: "PatchPact Test",
    PATCHPACT_GITHUB_APP_DESCRIPTION: "Contract-first GitHub App for tests.",
    PATCHPACT_GITHUB_APP_PUBLIC: false,
    PATCHPACT_INLINE_JOBS: true,
    PATCHPACT_STORAGE: "memory",
    PATCHPACT_GITHUB_WEBHOOK_SECRET: "test-secret",
    PATCHPACT_DEFAULT_PROVIDER: "mock",
    PATCHPACT_OPENAI_BASE_URL: "https://api.openai.com/v1",
    PATCHPACT_OPENAI_MODEL: "gpt-4.1-mini",
    PATCHPACT_ANTHROPIC_MODEL: "claude-3-5-sonnet-latest",
    PATCHPACT_OLLAMA_BASE_URL: "http://localhost:11434",
    PATCHPACT_OLLAMA_MODEL: "qwen2.5-coder:7b",
  };
}

describe("GitHub webhook flow", () => {
  it("creates a draft contract from an issue comment command", async () => {
    const env = createEnv();
    const store = new MemoryArtifactStore();
    const github = new MemoryGitHubPlatform();
    github.seedRepository({
      owner: "acme",
      repo: "patchpact-demo",
      configText: `mode: advisory\nprovider: mock\nmodel: heuristic-v1\n`,
      documents: [
        { path: "README.md", content: "Repository readme" },
        { path: "CONTRIBUTING.md", content: "Please add tests." },
      ],
      issues: [
        {
          number: 42,
          title: "Add audit trail to moderation workflow",
          body: "Need an audit trail with tests.\n- Keep scope to moderation workflow",
          author: "maintainer",
          labels: ["backend"],
        },
      ],
    });
    await store.upsertRepository({
      owner: "acme",
      repo: "patchpact-demo",
      installationId: 1001,
      config: defaultPatchPactConfig,
    });

    const jobs = new InlineJobBus();
    const engine = new PatchPactEngine({
      store,
      github,
      model: new MockModelProvider(),
      jobs,
    });
    jobs.setHandler((job: PatchPactJob, dedupeKey: string) =>
      engine.runJob(job, dedupeKey),
    );

    const app = createWebApp({
      env,
      engine,
      store,
      github,
    });

    const body = JSON.stringify({
      action: "created",
      installation: { id: 1001 },
      repository: {
        name: "patchpact-demo",
        owner: { login: "acme" },
      },
      issue: {
        number: 42,
      },
      comment: {
        body: "/contract create",
        user: { login: "maintainer" },
      },
    });

    const response = await request(app)
      .post("/webhooks/github")
      .set("x-github-event", "issue_comment")
      .set("x-github-delivery", "delivery-1")
      .set("x-hub-signature-256", sign(env.PATCHPACT_GITHUB_WEBHOOK_SECRET, body))
      .send(body);

    expect(response.status).toBe(202);
    expect(github.comments).toHaveLength(1);
    expect(github.comments[0]?.body).toContain("PatchPact Contribution Contract");
    expect(await store.getLatestContract("acme", "patchpact-demo", 42)).not.toBeNull();
    expect((await store.listJobRuns(10))[0]?.status).toBe("completed");
  });

  it("creates a decision packet for a pull request with an approved contract", async () => {
    const env = createEnv();
    const store = new MemoryArtifactStore();
    const github = new MemoryGitHubPlatform();
    github.seedRepository({
      owner: "acme",
      repo: "patchpact-demo",
      configText: `mode: soft-gate\nprovider: mock\nmodel: heuristic-v1\n`,
      documents: [
        { path: "README.md", content: "Repository readme" },
        { path: "CONTRIBUTING.md", content: "Please add tests." },
      ],
      issues: [
        {
          number: 42,
          title: "Add audit trail to moderation workflow",
          body: "Need an audit trail with tests.\n- Keep implementation centered in src/moderation",
          author: "maintainer",
          labels: ["backend"],
        },
      ],
      pullRequests: [
        {
          number: 77,
          title: "Fixes #42 add moderation audit trail",
          body: "Closes #42",
          author: "contributor",
          headSha: "abc123",
          baseRef: "main",
          labels: ["backend"],
          changedFiles: [
            {
              path: "src/moderation/audit.ts",
              status: "added",
              additions: 40,
              deletions: 0,
            },
            {
              path: "src/moderation/audit.test.ts",
              status: "added",
              additions: 20,
              deletions: 0,
            },
          ],
        },
      ],
    });

    await store.upsertRepository({
      owner: "acme",
      repo: "patchpact-demo",
      installationId: 1001,
      config: defaultPatchPactConfig,
    });
    const issue = await github.fetchIssueContext({
      owner: "acme",
      repo: "patchpact-demo",
      issueNumber: 42,
    });
    const model = new MockModelProvider();
    const contract = await model.generateContract({
      config: defaultPatchPactConfig,
      issue,
      prompt: "test",
    });
    const savedContract = await store.saveContract({
      owner: "acme",
      repo: "patchpact-demo",
      issueNumber: 42,
      version: 1,
      status: "approved",
      generatedBy: "maintainer",
      content: contract,
    });
    expect(savedContract.status).toBe("approved");

    const jobs = new InlineJobBus();
    const engine = new PatchPactEngine({
      store,
      github,
      model,
      jobs,
    });
    jobs.setHandler((job: PatchPactJob, dedupeKey: string) =>
      engine.runJob(job, dedupeKey),
    );

    const app = createWebApp({
      env,
      engine,
      store,
      github,
    });

    const body = JSON.stringify({
      action: "opened",
      installation: { id: 1001 },
      repository: {
        name: "patchpact-demo",
        owner: { login: "acme" },
      },
      pull_request: {
        number: 77,
        user: { login: "contributor" },
      },
    });

    const response = await request(app)
      .post("/webhooks/github")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", "delivery-2")
      .set("x-hub-signature-256", sign(env.PATCHPACT_GITHUB_WEBHOOK_SECRET, body))
      .send(body);

    expect(response.status).toBe(202);
    expect(github.checks).toHaveLength(1);
    expect(github.comments.at(-1)?.body).toContain("PatchPact Decision Packet");
    expect(await store.getLatestDecisionPacket("acme", "patchpact-demo", 77)).not.toBeNull();
  });

  it("uses an explicit PatchPact contract link from the pull request body", async () => {
    const env = createEnv();
    const store = new MemoryArtifactStore();
    const github = new MemoryGitHubPlatform();
    github.seedRepository({
      owner: "acme",
      repo: "patchpact-demo",
      configText: `mode: advisory\nprovider: mock\nmodel: heuristic-v1\n`,
      documents: [
        { path: "README.md", content: "Repository readme" },
        { path: "CONTRIBUTING.md", content: "Please add tests." },
      ],
      issues: [
        {
          number: 42,
          title: "Add audit trail to moderation workflow",
          body: "Need an audit trail with tests.\n- Keep implementation centered in src/moderation",
          author: "maintainer",
          labels: ["backend"],
        },
      ],
      pullRequests: [
        {
          number: 78,
          title: "Add moderation audit trail",
          body: "PatchPact-Contract: #42\n\nImplements the approved scope without closing keywords.",
          author: "contributor",
          headSha: "manual-link-sha",
          baseRef: "main",
          labels: ["backend"],
          changedFiles: [
            {
              path: "src/moderation/audit.ts",
              status: "added",
              additions: 25,
              deletions: 0,
            },
            {
              path: "src/moderation/audit.test.ts",
              status: "added",
              additions: 15,
              deletions: 0,
            },
          ],
        },
      ],
    });
    await store.upsertRepository({
      owner: "acme",
      repo: "patchpact-demo",
      installationId: 1001,
      config: defaultPatchPactConfig,
    });
    const model = new MockModelProvider();
    const issue = await github.fetchIssueContext({
      owner: "acme",
      repo: "patchpact-demo",
      issueNumber: 42,
    });
    const contract = await model.generateContract({
      config: defaultPatchPactConfig,
      issue,
      prompt: "test",
    });
    await store.saveContract({
      owner: "acme",
      repo: "patchpact-demo",
      issueNumber: 42,
      version: 1,
      status: "approved",
      generatedBy: "maintainer",
      content: contract,
    });
    const jobs = new InlineJobBus();
    const engine = new PatchPactEngine({
      store,
      github,
      model,
      jobs,
    });
    jobs.setHandler((job: PatchPactJob, dedupeKey: string) =>
      engine.runJob(job, dedupeKey),
    );
    const app = createWebApp({ env, engine, store, github });

    const body = JSON.stringify({
      action: "opened",
      installation: { id: 1001 },
      repository: {
        name: "patchpact-demo",
        owner: { login: "acme" },
      },
      pull_request: {
        number: 78,
        user: { login: "contributor" },
      },
    });

    const response = await request(app)
      .post("/webhooks/github")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", "delivery-2b")
      .set("x-hub-signature-256", sign(env.PATCHPACT_GITHUB_WEBHOOK_SECRET, body))
      .send(body);

    expect(response.status).toBe(202);
    const packet = await store.getLatestDecisionPacket("acme", "patchpact-demo", 78);
    expect(packet?.content.verdict).not.toBe("missing-contract");
    expect(packet?.content.suggestedAction).not.toBe("needs-contract");
    expect(packet?.linkedContractId).toBeDefined();
  });

  it("allows a maintainer waiver on a pull request thread", async () => {
    const env = createEnv();
    const store = new MemoryArtifactStore();
    const github = new MemoryGitHubPlatform();
    github.seedRepository({
      owner: "acme",
      repo: "patchpact-demo",
      configText: `mode: soft-gate\nprovider: mock\nmodel: heuristic-v1\n`,
      documents: [
        { path: "README.md", content: "Repository readme" },
        { path: "CONTRIBUTING.md", content: "Please add tests." },
      ],
      pullRequests: [
        {
          number: 79,
          title: "Small docs cleanup",
          body: "Touches only docs, no linked issue.",
          author: "contributor",
          headSha: "waiver-sha",
          baseRef: "main",
          labels: ["docs"],
          changedFiles: [
            {
              path: "README.md",
              status: "modified",
              additions: 4,
              deletions: 2,
            },
          ],
        },
      ],
    });
    await store.upsertRepository({
      owner: "acme",
      repo: "patchpact-demo",
      installationId: 1001,
      config: defaultPatchPactConfig,
    });
    const jobs = new InlineJobBus();
    const engine = new PatchPactEngine({
      store,
      github,
      model: new MockModelProvider(),
      jobs,
    });
    jobs.setHandler((job: PatchPactJob, dedupeKey: string) =>
      engine.runJob(job, dedupeKey),
    );
    const app = createWebApp({ env, engine, store, github });

    const waiveBody = JSON.stringify({
      action: "created",
      installation: { id: 1001 },
      repository: {
        name: "patchpact-demo",
        owner: { login: "acme" },
      },
      issue: {
        number: 79,
        pull_request: { url: "https://example.test/pr/79" },
      },
      comment: {
        body: "/contract waive docs-only change",
        user: { login: "maintainer" },
      },
    });

    const waiveResponse = await request(app)
      .post("/webhooks/github")
      .set("x-github-event", "issue_comment")
      .set("x-github-delivery", "delivery-waive")
      .set("x-hub-signature-256", sign(env.PATCHPACT_GITHUB_WEBHOOK_SECRET, waiveBody))
      .send(waiveBody);

    expect(waiveResponse.status).toBe(202);

    const prBody = JSON.stringify({
      action: "opened",
      installation: { id: 1001 },
      repository: {
        name: "patchpact-demo",
        owner: { login: "acme" },
      },
      pull_request: {
        number: 79,
        user: { login: "contributor" },
      },
    });

    const prResponse = await request(app)
      .post("/webhooks/github")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", "delivery-waive-pr")
      .set("x-hub-signature-256", sign(env.PATCHPACT_GITHUB_WEBHOOK_SECRET, prBody))
      .send(prBody);

    expect(prResponse.status).toBe(202);
    const packet = await store.getLatestDecisionPacket("acme", "patchpact-demo", 79);
    expect(packet?.content.waiverApplied).toBe(true);
    expect(packet?.content.waiverReason).toContain("docs-only change");
    expect(github.checks.at(-1)?.result.conclusion).not.toBe("action_required");
  });

  it("syncs repository knowledge on push and exposes searchable knowledge results", async () => {
    const env = createEnv();
    const store = new MemoryArtifactStore();
    const github = new MemoryGitHubPlatform();
    github.seedRepository({
      owner: "acme",
      repo: "patchpact-demo",
      configText: `mode: advisory\nprovider: mock\nmodel: heuristic-v1\n`,
      documents: [
        {
          path: "README.md",
          content: "PatchPact helps maintainers create contracts and review pull requests with tests.",
        },
        {
          path: "docs/testing.md",
          content: "Tests are expected for user-visible behavior changes.",
        },
      ],
    });
    await store.upsertRepository({
      owner: "acme",
      repo: "patchpact-demo",
      installationId: 1001,
      config: defaultPatchPactConfig,
    });
    const jobs = new InlineJobBus();
    const engine = new PatchPactEngine({
      store,
      github,
      model: new MockModelProvider(),
      jobs,
    });
    jobs.setHandler((job: PatchPactJob, dedupeKey: string) =>
      engine.runJob(job, dedupeKey),
    );
    const app = createWebApp({ env, engine, store, github });

    const body = JSON.stringify({
      ref: "refs/heads/main",
      installation: { id: 1001 },
      repository: {
        name: "patchpact-demo",
        default_branch: "main",
        owner: { login: "acme" },
      },
      pusher: { name: "maintainer" },
    });

    const response = await request(app)
      .post("/webhooks/github")
      .set("x-github-event", "push")
      .set("x-github-delivery", "delivery-3")
      .set("x-hub-signature-256", sign(env.PATCHPACT_GITHUB_WEBHOOK_SECRET, body))
      .send(body);

    expect(response.status).toBe(202);

    const knowledgeResponse = await request(app)
      .get("/api/repositories/acme/patchpact-demo/knowledge")
      .query({ q: "tests maintainers" });

    expect(knowledgeResponse.status).toBe(200);
    expect(knowledgeResponse.body.results.length).toBeGreaterThan(0);
    expect(knowledgeResponse.body.results[0].path).toBeDefined();
  });

  it("refreshes an existing contract when the issue is edited", async () => {
    const env = createEnv();
    const store = new MemoryArtifactStore();
    const github = new MemoryGitHubPlatform();
    github.seedRepository({
      owner: "acme",
      repo: "patchpact-demo",
      configText: `mode: advisory\nprovider: mock\nmodel: heuristic-v1\n`,
      documents: [
        { path: "README.md", content: "Repository readme" },
        { path: "CONTRIBUTING.md", content: "Please add tests." },
      ],
      issues: [
        {
          number: 42,
          title: "Add audit trail to moderation workflow",
          body: "Need an audit trail with tests.\n- Keep implementation centered in src/moderation",
          author: "maintainer",
          labels: ["backend"],
        },
      ],
    });
    await store.upsertRepository({
      owner: "acme",
      repo: "patchpact-demo",
      installationId: 1001,
      config: defaultPatchPactConfig,
    });
    const model = new MockModelProvider();
    const issue = await github.fetchIssueContext({
      owner: "acme",
      repo: "patchpact-demo",
      issueNumber: 42,
    });
    const contract = await model.generateContract({
      config: defaultPatchPactConfig,
      issue,
      prompt: "seed",
    });
    await store.saveContract({
      owner: "acme",
      repo: "patchpact-demo",
      issueNumber: 42,
      version: 1,
      status: "approved",
      generatedBy: "maintainer",
      content: contract,
    });
    github.seedRepository({
      owner: "acme",
      repo: "patchpact-demo",
      configText: `mode: advisory\nprovider: mock\nmodel: heuristic-v1\n`,
      documents: [
        { path: "README.md", content: "Repository readme" },
        { path: "CONTRIBUTING.md", content: "Please add tests." },
      ],
      issues: [
        {
          number: 42,
          title: "Add audit trail to moderation workflow",
          body: "Need an audit trail with tests.\n- Keep implementation centered in src/moderation\n- Add export support for weekly audit summaries",
          author: "maintainer",
          labels: ["backend"],
        },
      ],
    });

    const jobs = new InlineJobBus();
    const engine = new PatchPactEngine({
      store,
      github,
      model,
      jobs,
    });
    jobs.setHandler((job: PatchPactJob, dedupeKey: string) =>
      engine.runJob(job, dedupeKey),
    );
    const app = createWebApp({ env, engine, store, github });

    const body = JSON.stringify({
      action: "edited",
      installation: { id: 1001 },
      repository: {
        name: "patchpact-demo",
        owner: { login: "acme" },
      },
      issue: {
        number: 42,
        user: { login: "maintainer" },
      },
    });

    const response = await request(app)
      .post("/webhooks/github")
      .set("x-github-event", "issues")
      .set("x-github-delivery", "delivery-4")
      .set("x-hub-signature-256", sign(env.PATCHPACT_GITHUB_WEBHOOK_SECRET, body))
      .send(body);

    expect(response.status).toBe(202);
    const contracts = await store.listContracts("acme", "patchpact-demo", 42);
    expect(contracts).toHaveLength(2);
    expect(contracts[0].version).toBe(2);
    expect(github.comments.at(-1)?.body).toContain("PatchPact Contribution Contract v2");
  });
});
