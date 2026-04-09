import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PatchPactEngine, defaultPatchPactConfig, type PatchPactJob } from "@patchpact/core";
import {
  InlineJobBus,
  MemoryArtifactStore,
  MemoryGitHubPlatform,
  MockModelProvider,
  type PatchPactEnv,
} from "@patchpact/adapters";
import { createWebApp } from "../src/app.js";

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

function createHarness() {
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
        content: "PatchPact helps maintainers make review decisions faster.",
      },
      {
        path: "docs/testing.md",
        content: "Tests are required for user-visible changes.",
      },
    ],
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

  return { env, store, github, app: createWebApp({ env, store, github, engine }) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dashboard console", () => {
  it("renders setup guidance and setup json", async () => {
    const { app, store } = createHarness();
    await store.upsertRepository({
      owner: "acme",
      repo: "patchpact-demo",
      installationId: 1001,
      config: defaultPatchPactConfig,
    });

    const pageResponse = await request(app).get("/setup");
    const apiResponse = await request(app).get("/api/setup");
    const manifestResponse = await request(app).get("/api/setup/github-app-manifest");
    const overviewResponse = await request(app).get("/api/overview");
    const readyResponse = await request(app).get("/readyz");

    expect(pageResponse.status).toBe(200);
    expect(pageResponse.text).toContain("PatchPact Instance Readiness");
    expect(pageResponse.text).toContain("GitHub App Manifest");
    expect(pageResponse.text).toContain("Onboarding Summary");
    expect(pageResponse.text).toContain("Repository Action Plan");
    expect(apiResponse.status).toBe(200);
    expect(apiResponse.body.webhookUrl).toBe("http://localhost:3000/webhooks/github");
    expect(apiResponse.body.requiredEvents).toContain("pull_request");
    expect(apiResponse.body.registrationUrl).toBe("https://github.com/settings/apps/new");
    expect(apiResponse.body.onboarding.repositoryCount).toBe(1);
    expect(manifestResponse.status).toBe(200);
    expect(manifestResponse.body.name).toBe("PatchPact Test");
    expect(pageResponse.text).toContain("PatchPact Test");
    expect(pageResponse.text).toContain("Register GitHub App from Manifest");
    expect(manifestResponse.body.hook_attributes.url).toBe(
      "http://localhost:3000/webhooks/github",
    );
    expect(overviewResponse.status).toBe(200);
    expect(overviewResponse.body.repositoryCount).toBe(1);
    expect(overviewResponse.body.installedRepositoryCount).toBe(1);
    expect(overviewResponse.body.repositories[0].recommendedActionLabel).toBeDefined();
    expect(overviewResponse.body.repositories[0].summary).toContain("installed");
    expect(overviewResponse.body.repositories[0].recommendedActionHref).toBe(
      "/setup/repositories/acme/patchpact-demo",
    );
    expect(readyResponse.status).toBe(503);
    expect(readyResponse.body.ready).toBe(false);
  });

  it("filters overview repositories by status and query", async () => {
    const { app, store } = createHarness();
    await store.upsertRepository({
      owner: "acme",
      repo: "patchpact-demo",
      installationId: 1001,
      config: defaultPatchPactConfig,
    });
    await store.upsertRepository({
      owner: "acme",
      repo: "needs-install",
      config: defaultPatchPactConfig,
    });

    const statusResponse = await request(app)
      .get("/api/overview")
      .query({ status: "needs-installation" });
    const queryResponse = await request(app)
      .get("/api/overview")
      .query({ q: "needs-install" });

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.repositoryCount).toBe(2);
    expect(statusResponse.body.visibleRepositoryCount).toBe(1);
    expect(statusResponse.body.repositories[0].repo).toBe("needs-install");
    expect(queryResponse.status).toBe(200);
    expect(queryResponse.body.visibleRepositoryCount).toBe(1);
    expect(queryResponse.body.repositories[0].repo).toBe("needs-install");
  });

  it("renders repository onboarding checklist in html and json", async () => {
    const { app, store } = createHarness();
    await store.upsertRepository({
      owner: "acme",
      repo: "patchpact-demo",
      installationId: 1001,
      config: defaultPatchPactConfig,
    });

    const pageResponse = await request(app).get("/setup/repositories/acme/patchpact-demo");
    const apiResponse = await request(app).get("/api/setup/repositories/acme/patchpact-demo");

    expect(pageResponse.status).toBe(200);
    expect(pageResponse.text).toContain("Repository Onboarding");
    expect(pageResponse.text).toContain("Checklist");
    expect(pageResponse.text).toContain("Sync Knowledge Now");
    expect(apiResponse.status).toBe(200);
    expect(apiResponse.body.repository.owner).toBe("acme");
    expect(apiResponse.body.repository.repo).toBe("patchpact-demo");
    expect(apiResponse.body.checklistItems.length).toBeGreaterThan(0);
  });

  it("renders GitHub App manifest callback results in html and json", async () => {
    const { app } = createHarness();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          id: 12345,
          slug: "patchpact-test",
          client_id: "Iv1.client",
          client_secret: "client-secret",
          webhook_secret: "webhook-secret",
          pem: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
          name: "PatchPact Test",
          html_url: "https://github.com/settings/apps/patchpact-test",
        }),
      })),
    );

    const pageResponse = await request(app).get("/setup/github-app/callback?code=test-code");
    const apiResponse = await request(app).get(
      "/api/setup/github-app-manifest/exchange?code=test-code",
    );

    expect(pageResponse.status).toBe(200);
    expect(pageResponse.text).toContain("GitHub App Created");
    expect(pageResponse.text).toContain("PATCHPACT_GITHUB_APP_ID=12345");
    expect(pageResponse.text).toContain("patchpact-test");
    expect(apiResponse.status).toBe(200);
    expect(apiResponse.body.exchange.id).toBe(12345);
    expect(apiResponse.body.installUrl).toBe(
      "https://github.com/apps/patchpact-test/installations/new",
    );
  });

  it("renders a repository console page", async () => {
    const { store, app } = createHarness();
    await store.upsertRepository({
      owner: "acme",
      repo: "patchpact-demo",
      installationId: 1001,
      config: defaultPatchPactConfig,
    });

    const response = await request(app).get("/dashboard/acme/patchpact-demo");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Repository Console");
    expect(response.text).toContain("Save Repository Policy");
    expect(response.text).toContain("Sync Knowledge Now");
  });

  it("renders contract and packet detail pages", async () => {
    const { store, app } = createHarness();
    await store.upsertRepository({
      owner: "acme",
      repo: "patchpact-demo",
      installationId: 1001,
      config: defaultPatchPactConfig,
    });
    await store.saveContract({
      owner: "acme",
      repo: "patchpact-demo",
      issueNumber: 42,
      version: 1,
      status: "approved",
      generatedBy: "maintainer",
      content: {
        issueNumber: 42,
        title: "Contract title",
        problemStatement: "Add a safer review workflow",
        scopeBoundaries: ["Stay within review tooling"],
        impactedAreas: ["src/review"],
        acceptanceCriteria: ["Maintainers can inspect output"],
        testExpectations: ["Add coverage"],
        nonGoals: ["Do not refactor auth"],
        repoSignals: ["README reviewed"],
        relatedIssueNumbers: [],
        rationale: "Seeded test contract",
        confidence: "high",
        suggestedNextStep: "Review it",
      },
    });
    await store.saveDecisionPacket({
      owner: "acme",
      repo: "patchpact-demo",
      pullRequestNumber: 77,
      generatedBy: "maintainer",
      content: {
        pullRequestNumber: 77,
        summary: "PR aligns with the contract.",
        contractMatchScore: 88,
        verdict: "aligned",
        risks: ["No major risks"],
        missingTests: [],
        relatedArtifacts: [],
        suggestedAction: "merge-ready",
        confidence: "high",
        blockingReasons: [],
      },
    });

    const contractPage = await request(app).get(
      "/dashboard/acme/patchpact-demo/contracts/42",
    );
    const packetPage = await request(app).get(
      "/dashboard/acme/patchpact-demo/packets/77",
    );

    expect(contractPage.status).toBe(200);
    expect(contractPage.text).toContain("Contract Detail");
    expect(packetPage.status).toBe(200);
    expect(packetPage.text).toContain("Decision Packet Detail");
  });

  it("updates repository config from the dashboard form", async () => {
    const { store, app } = createHarness();
    await store.upsertRepository({
      owner: "acme",
      repo: "patchpact-demo",
      installationId: 1001,
      config: defaultPatchPactConfig,
    });

    const response = await request(app)
      .post("/dashboard/acme/patchpact-demo/config")
      .type("form")
      .send({
        mode: "soft-gate",
        provider: "ollama",
        model: "qwen2.5-coder:14b",
        repoRules: "Require maintainer approval\nRequire tests",
        docsGlobs: "README.md\ndocs/*",
        testGlobs: "**/*.test.ts\n**/test_*.py",
      });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/dashboard/acme/patchpact-demo");
    const saved = await store.getRepository("acme", "patchpact-demo");
    expect(saved?.config.mode).toBe("soft-gate");
    expect(saved?.config.provider).toBe("ollama");
    expect(saved?.config.repoRules).toEqual([
      "Require maintainer approval",
      "Require tests",
    ]);
  });

  it("syncs knowledge from the dashboard action", async () => {
    const { store, app } = createHarness();
    await store.upsertRepository({
      owner: "acme",
      repo: "patchpact-demo",
      installationId: 1001,
      config: defaultPatchPactConfig,
    });

    const response = await request(app)
      .post("/dashboard/acme/patchpact-demo/actions/sync-knowledge")
      .type("form")
      .send({});

    expect(response.status).toBe(303);
    const results = await store.searchKnowledgeChunks(
      "acme",
      "patchpact-demo",
      "tests review",
      10,
    );
    expect(results.length).toBeGreaterThan(0);
  });

  it("triggers manual contract refresh and packet regeneration from dashboard actions", async () => {
    const { store, github, app } = createHarness();
    github.seedRepository({
      owner: "acme",
      repo: "patchpact-demo",
      configText: `mode: advisory\nprovider: mock\nmodel: heuristic-v1\n`,
      documents: [
        { path: "README.md", content: "PatchPact helps maintainers make review decisions faster." },
        { path: "docs/testing.md", content: "Tests are required for user-visible changes." },
      ],
      issues: [
        {
          number: 42,
          title: "Add review summary export",
          body: "Need export support.\n- Keep implementation centered in src/review",
          author: "maintainer",
          labels: ["backend"],
        },
      ],
      pullRequests: [
        {
          number: 77,
          title: "Closes #42 add review summary export",
          body: "Implements the requested export.",
          author: "contributor",
          headSha: "manual-action-sha",
          baseRef: "main",
          labels: ["backend"],
          changedFiles: [
            {
              path: "src/review/export.ts",
              status: "added",
              additions: 30,
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

    const refreshResponse = await request(app)
      .post("/dashboard/acme/patchpact-demo/actions/refresh-contract")
      .type("form")
      .send({
        issueNumber: "42",
        redirectTo: "/dashboard/acme/patchpact-demo/contracts/42",
      });

    const regenerateResponse = await request(app)
      .post("/dashboard/acme/patchpact-demo/actions/regenerate-packet")
      .type("form")
      .send({
        pullRequestNumber: "77",
        redirectTo: "/dashboard/acme/patchpact-demo/packets/77",
      });

    expect(refreshResponse.status).toBe(303);
    expect(regenerateResponse.status).toBe(303);
    expect(await store.getLatestContract("acme", "patchpact-demo", 42)).not.toBeNull();
    expect(await store.getLatestDecisionPacket("acme", "patchpact-demo", 77)).not.toBeNull();
  });

  it("renders a job detail page and retries a stored job", async () => {
    const { store, github, app } = createHarness();
    github.seedRepository({
      owner: "acme",
      repo: "patchpact-demo",
      configText: `mode: advisory\nprovider: mock\nmodel: heuristic-v1\n`,
      documents: [
        { path: "README.md", content: "PatchPact helps maintainers make review decisions faster." },
      ],
      issues: [
        {
          number: 52,
          title: "Add export control",
          body: "Need export control.\n- Keep implementation centered in src/export",
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
    await store.saveJobRun({
      id: "failed-job-1",
      dedupeKey: "failed-job-1",
      type: "create-contract",
      status: "failed",
      error: "Synthetic failure for retry testing",
      payload: {
        type: "create-contract",
        owner: "acme",
        repo: "patchpact-demo",
        installationId: 1001,
        issueNumber: 52,
        requestedBy: "maintainer",
      },
    });

    const jobPage = await request(app).get("/dashboard/jobs/failed-job-1");
    const retryResponse = await request(app).post("/dashboard/jobs/failed-job-1/retry");
    const apiResponse = await request(app).get("/api/jobs/failed-job-1");

    expect(jobPage.status).toBe(200);
    expect(jobPage.text).toContain("Job Detail");
    expect(retryResponse.status).toBe(303);
    expect(apiResponse.status).toBe(200);
    expect(apiResponse.body.job.error).toContain("Synthetic failure");
    expect(await store.getLatestContract("acme", "patchpact-demo", 52)).not.toBeNull();
  });
});
