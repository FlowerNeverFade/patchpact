import crypto from "node:crypto";
import express, { type Request, type Response } from "express";
import {
  defaultPatchPactConfig,
  type PatchPactConfig,
  patchPactConfigSchema,
  parseSlashCommand,
  type ArtifactStore,
  type GitHubPlatform,
  type PatchPactEngine,
  type RepositoryRecord,
  verifyGitHubSignature,
} from "@patchpact/core";
import {
  buildGitHubAppEnvSnippet,
  buildGitHubAppInstallUrl,
  buildGitHubAppManifest,
  buildGitHubAppRegistrationUrl,
  exchangeGitHubAppManifestCode,
  getRuntimeReadiness,
  type PatchPactEnv,
} from "@patchpact/adapters";
import {
  buildSetupConsoleData,
  type NoticeData,
  renderContractDetailPage,
  renderDashboard,
  renderDecisionPacketDetailPage,
  renderGitHubAppCallbackConsole,
  renderJobDetailPage,
  renderRepositoryOnboardingChecklistPage,
  renderRepositoryConsole,
  renderSetupConsole,
} from "./dashboard.js";
import {
  buildInstanceOverview,
  buildRepositoryJobsPage,
  buildRepositoryOnboardingChecklist,
  listRepositoryJobs,
  type RepositoryOnboardingPhase,
} from "./overview.js";

export interface CreateWebAppOptions {
  env: PatchPactEnv;
  engine: PatchPactEngine;
  store: ArtifactStore;
  github: GitHubPlatform & { rememberInstallation?: (owner: string, repo: string, installationId: number) => void };
}

function issueCommentMessage(message: string): string {
  return `PatchPact: ${message}`;
}

function parseTextareaList(value: unknown): string[] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mergeConfig(
  existing: PatchPactConfig | undefined,
  update: Partial<PatchPactConfig>,
): PatchPactConfig {
  return patchPactConfigSchema.parse({
    ...(existing ?? defaultPatchPactConfig),
    ...update,
  });
}

function getNoticeFromQuery(query: Record<string, unknown>): NoticeData | undefined {
  const text = String(query.notice ?? "").trim();
  if (!text) {
    return undefined;
  }
  const kindRaw = String(query.noticeType ?? "info").trim();
  const kind: NoticeData["kind"] =
    kindRaw === "success" || kindRaw === "warning" || kindRaw === "info"
      ? kindRaw
      : "info";
  return { kind, text };
}

function appendNoticeToPath(target: string, notice: NoticeData): string {
  const base = target.startsWith("/") ? target : `/${target}`;
  const url = new URL(base, "http://patchpact.local");
  url.searchParams.set("notice", notice.text);
  url.searchParams.set("noticeType", notice.kind);
  return `${url.pathname}${url.search}`;
}

function appendJobNoticeToPath(
  target: string,
  input: {
    jobKey: string;
    queuedText: string;
    processingText: string;
    completedText: string;
    failedText: string;
  },
): string {
  const base = target.startsWith("/") ? target : `/${target}`;
  const url = new URL(base, "http://patchpact.local");
  url.searchParams.set("jobKey", input.jobKey);
  url.searchParams.set("jobQueued", input.queuedText);
  url.searchParams.set("jobProcessing", input.processingText);
  url.searchParams.set("jobCompleted", input.completedText);
  url.searchParams.set("jobFailed", input.failedText);
  return `${url.pathname}${url.search}`;
}

async function resolveNotice(
  store: ArtifactStore,
  query: Record<string, unknown>,
): Promise<NoticeData | undefined> {
  const jobKey = String(query.jobKey ?? "").trim();
  if (!jobKey) {
    return getNoticeFromQuery(query);
  }

  const job = await store.getJobRun(jobKey);
  const queuedText = String(query.jobQueued ?? "").trim();
  const processingText = String(query.jobProcessing ?? queuedText).trim();
  const completedText = String(query.jobCompleted ?? queuedText).trim();
  const failedText = String(query.jobFailed ?? queuedText).trim();

  if (!job) {
    return queuedText ? { kind: "info", text: queuedText } : undefined;
  }

  if (job.status === "completed") {
    return { kind: "success", text: completedText || "PatchPact action completed." };
  }
  if (job.status === "failed") {
    return { kind: "warning", text: failedText || "PatchPact action failed." };
  }
  if (job.status === "processing") {
    return { kind: "info", text: processingText || "PatchPact action is processing." };
  }
  return { kind: "info", text: queuedText || "PatchPact action has been queued." };
}

async function buildSetupData(env: PatchPactEnv, store: ArtifactStore) {
  return buildSetupDataWithFilters(env, store, {});
}

async function buildSetupDataWithFilters(
  env: PatchPactEnv,
  store: ArtifactStore,
  filters: {
    query?: string;
    status?: RepositoryOnboardingPhase | "all";
  },
  notice?: NoticeData,
) {
  const manifest = buildGitHubAppManifest(env);
  const overview = await buildInstanceOverview(store, filters);
  return buildSetupConsoleData({
    baseUrl: env.PATCHPACT_BASE_URL,
    registrationUrl: buildGitHubAppRegistrationUrl(env),
    inlineJobs: env.PATCHPACT_INLINE_JOBS,
    storage: env.PATCHPACT_STORAGE,
    provider: env.PATCHPACT_DEFAULT_PROVIDER,
    manifest: {
      name: manifest.name,
      json: JSON.stringify(manifest, null, 2),
    },
    onboarding: {
      repositoryCount: overview.repositoryCount,
      installedRepositoryCount: overview.installedRepositoryCount,
      activeRepositoryCount: overview.activeRepositoryCount,
      visibleRepositoryCount: overview.visibleRepositoryCount,
      filters: overview.filters,
      repositories: overview.repositories.map((repo) => ({
        owner: repo.owner,
        repo: repo.repo,
        status: repo.status,
        knowledgeChunkCount: repo.knowledgeChunkCount,
        contractCount: repo.contractCount,
        packetCount: repo.packetCount,
        waiverCount: repo.waiverCount,
        summary: repo.summary,
        recommendedActionLabel: repo.recommendedActionLabel,
        recommendedActionHref: repo.recommendedActionHref,
      })),
      repositoriesNeedingInstallation: overview.repositoriesNeedingInstallation.map((repo) => ({
        owner: repo.owner,
        repo: repo.repo,
      })),
      repositoriesNeedingKnowledgeSync: overview.repositoriesNeedingKnowledgeSync.map((repo) => ({
        owner: repo.owner,
        repo: repo.repo,
        knowledgeChunkCount: repo.knowledgeChunkCount,
      })),
      recentFailedJobs: overview.recentFailedJobs.map((job) => ({
        dedupeKey: job.dedupeKey,
        type: job.type,
        error: job.error,
      })),
    },
    notice,
    envStatus: {
      githubAppId: Boolean(env.PATCHPACT_GITHUB_APP_ID),
      githubPrivateKey: Boolean(env.PATCHPACT_GITHUB_PRIVATE_KEY),
      githubClientId: Boolean(env.PATCHPACT_GITHUB_CLIENT_ID),
      githubClientSecret: Boolean(env.PATCHPACT_GITHUB_CLIENT_SECRET),
      webhookSecret: Boolean(env.PATCHPACT_GITHUB_WEBHOOK_SECRET),
      databaseUrl: Boolean(env.DATABASE_URL),
      redisUrl: Boolean(env.REDIS_URL),
      openAiKey: Boolean(env.PATCHPACT_OPENAI_API_KEY),
      anthropicKey: Boolean(env.PATCHPACT_ANTHROPIC_API_KEY),
    },
  });
}

export function createWebApp(options: CreateWebAppOptions) {
  const app = express();

  app.get("/healthz", async (_request, response) => {
    response.json({
      ok: true,
      provider: options.env.PATCHPACT_DEFAULT_PROVIDER,
      storage: options.env.PATCHPACT_STORAGE,
      inlineJobs: options.env.PATCHPACT_INLINE_JOBS,
    });
  });

  app.get("/readyz", async (_request, response) => {
    const readiness = getRuntimeReadiness(options.env);
    response.status(readiness.ready ? 200 : 503).json(readiness);
  });

  app.get("/dashboard", async (_request, response) => {
    response.type("html").send(await renderDashboard(options.store));
  });

  app.get("/setup", async (_request, response) => {
    const query = String(_request.query.q ?? "").trim();
    const statusRaw = String(_request.query.status ?? "all").trim();
    const status =
      statusRaw === "needs-installation" ||
      statusRaw === "needs-knowledge-sync" ||
      statusRaw === "configured" ||
      statusRaw === "active"
        ? statusRaw
        : "all";
    response
      .type("html")
      .send(
        renderSetupConsole(
          await buildSetupDataWithFilters(options.env, options.store, {
            query,
            status,
          }, await resolveNotice(options.store, _request.query)),
        ),
      );
  });

  app.get("/setup/repositories/:owner/:repo", async (request, response) => {
    const checklist = await buildRepositoryOnboardingChecklist(
      options.store,
      request.params.owner,
      request.params.repo,
    );
    if (!checklist) {
      response.redirect(
        303,
        appendNoticeToPath("/setup", {
          kind: "warning",
          text: `Repository ${request.params.owner}/${request.params.repo} was not found.`,
        }),
      );
      return;
    }
    response.type("html").send(
      renderRepositoryOnboardingChecklistPage({
        repository: checklist.repository,
        latestContractIssueNumber: checklist.latestContractIssueNumber,
        latestPullRequestNumber: checklist.latestPullRequestNumber,
        checklistItems: checklist.checklistItems,
        recentFailedJobs: checklist.recentFailedJobs.map((job) => ({
          dedupeKey: job.dedupeKey,
          type: job.type,
          error: job.error,
        })),
        notice: await resolveNotice(options.store, request.query),
      }),
    );
  });

  app.get("/setup/github-app/callback", async (request, response) => {
    const code = String(request.query.code ?? "").trim();
    if (!code) {
      response.redirect(
        303,
        appendNoticeToPath("/setup", {
          kind: "warning",
          text: "Missing GitHub App manifest exchange code.",
        }),
      );
      return;
    }

    try {
      const exchange = await exchangeGitHubAppManifestCode(code);
      response.type("html").send(
        renderGitHubAppCallbackConsole({
          appName: exchange.name ?? options.env.PATCHPACT_GITHUB_APP_NAME,
          slug: exchange.slug,
          appId: exchange.id,
          htmlUrl: exchange.html_url,
          installUrl: buildGitHubAppInstallUrl({ slug: exchange.slug }),
          envSnippet: buildGitHubAppEnvSnippet(exchange),
          notice: {
            kind: "success",
            text: "GitHub App manifest exchange succeeded. Copy the generated credentials into your PatchPact environment.",
          },
        }),
      );
    } catch (error) {
      response.redirect(
        303,
        appendNoticeToPath("/setup", {
          kind: "warning",
          text: `GitHub manifest exchange failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }),
      );
    }
  });

  app.get("/api/setup", async (_request, response) => {
    const query = String(_request.query.q ?? "").trim();
    const statusRaw = String(_request.query.status ?? "all").trim();
    const status =
      statusRaw === "needs-installation" ||
      statusRaw === "needs-knowledge-sync" ||
      statusRaw === "configured" ||
      statusRaw === "active"
        ? statusRaw
        : "all";
    response.json(
      await buildSetupDataWithFilters(options.env, options.store, {
        query,
        status,
      }),
    );
  });

  app.get("/api/overview", async (_request, response) => {
    const query = String(_request.query.q ?? "").trim();
    const statusRaw = String(_request.query.status ?? "all").trim();
    const status =
      statusRaw === "needs-installation" ||
      statusRaw === "needs-knowledge-sync" ||
      statusRaw === "configured" ||
      statusRaw === "active"
        ? statusRaw
        : "all";
    response.json(await buildInstanceOverview(options.store, { query, status }));
  });

  app.get("/api/setup/repositories/:owner/:repo", async (request, response) => {
    const checklist = await buildRepositoryOnboardingChecklist(
      options.store,
      request.params.owner,
      request.params.repo,
    );
    if (!checklist) {
      response.status(404).json({ error: "Repository not found" });
      return;
    }
    response.json(checklist);
  });

  app.get("/api/setup/github-app-manifest", async (_request, response) => {
    response.json(buildGitHubAppManifest(options.env));
  });

  app.get("/api/setup/github-app-manifest/exchange", async (request, response) => {
    const code = String(request.query.code ?? "").trim();
    if (!code) {
      response.status(400).json({ error: "Missing code query parameter" });
      return;
    }

    try {
      const exchange = await exchangeGitHubAppManifestCode(code);
      response.json({
        exchange,
        installUrl: buildGitHubAppInstallUrl({ slug: exchange.slug }),
        envSnippet: buildGitHubAppEnvSnippet(exchange),
      });
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/dashboard/jobs/:dedupeKey", async (request, response) => {
    const job = await options.store.getJobRun(request.params.dedupeKey);
    if (!job) {
      response.redirect(
        303,
        appendNoticeToPath("/dashboard", {
          kind: "warning",
          text: `Job ${request.params.dedupeKey} was not found.`,
        }),
      );
      return;
    }
    response.type("html").send(
      renderJobDetailPage(job, await resolveNotice(options.store, request.query)),
    );
  });

  app.get("/dashboard/:owner/:repo", async (request, response) => {
    const repo = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    if (!repo) {
      response.redirect(
        303,
        appendNoticeToPath("/setup", {
          kind: "warning",
          text: `Repository ${request.params.owner}/${request.params.repo} was not found.`,
        }),
      );
      return;
    }
    const knowledgeQuery = String(request.query.q ?? "").trim();
    const jobStatusRaw = String(request.query.jobStatus ?? "all").trim();
    const jobStatus =
      jobStatusRaw === "queued" ||
      jobStatusRaw === "processing" ||
      jobStatusRaw === "completed" ||
      jobStatusRaw === "failed"
        ? jobStatusRaw
        : "all";
    const jobType = String(request.query.jobType ?? "").trim();
    const jobViewRaw = String(request.query.jobView ?? "open").trim();
    const jobView = jobViewRaw === "all" ? "all" : "open";
    const jobSortRaw = String(request.query.jobSort ?? "attention").trim();
    const jobSort = jobSortRaw === "recent" ? "recent" : "attention";
    const jobPage = Math.max(1, Number(request.query.jobPage ?? 1) || 1);
    const checklist = await buildRepositoryOnboardingChecklist(
      options.store,
      repo.owner,
      repo.repo,
    );
    const repositoryJobs = await buildRepositoryJobsPage(options.store, repo.owner, repo.repo, {
      status: jobStatus,
      type: jobType,
      view: jobView,
      sort: jobSort,
      page: jobPage,
      pageSize: 6,
    });
    response.type("html").send(
      renderRepositoryConsole({
        repo,
        contracts: await options.store.listContracts(repo.owner, repo.repo),
        packets: await options.store.listDecisionPackets(repo.owner, repo.repo),
        waivers: await options.store.listWaivers(repo.owner, repo.repo),
        recentJobs: repositoryJobs.jobs.map((job) => ({
          dedupeKey: job.dedupeKey,
          type: job.type,
          status: job.status,
          updatedAt: job.updatedAt,
          error: job.error,
        })),
        jobsPagination: {
          total: repositoryJobs.total,
          page: repositoryJobs.page,
          pageSize: repositoryJobs.pageSize,
          totalPages: repositoryJobs.totalPages,
          status: repositoryJobs.filters.status,
          type: repositoryJobs.filters.type,
          view: repositoryJobs.filters.view,
          sort: repositoryJobs.filters.sort,
        },
        knowledgeQuery,
        knowledgeResults: await options.store.searchKnowledgeChunks(
          repo.owner,
          repo.repo,
          knowledgeQuery,
          knowledgeQuery ? 10 : 6,
        ),
        notice: await resolveNotice(options.store, request.query),
        onboarding: checklist
          ? {
              status: checklist.repository.status,
              summary: checklist.repository.summary,
              latestContractIssueNumber: checklist.latestContractIssueNumber,
              latestPullRequestNumber: checklist.latestPullRequestNumber,
              checklistItems: checklist.checklistItems,
            }
          : undefined,
      }),
    );
  });

  app.get("/dashboard/:owner/:repo/contracts/:issueNumber", async (request, response) => {
    const repo = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    if (!repo) {
      response.redirect(
        303,
        appendNoticeToPath("/setup", {
          kind: "warning",
          text: `Repository ${request.params.owner}/${request.params.repo} was not found.`,
        }),
      );
      return;
    }
    response.type("html").send(
      renderContractDetailPage(
        repo,
        await options.store.listContracts(
          repo.owner,
          repo.repo,
          Number(request.params.issueNumber),
        ),
        await resolveNotice(options.store, request.query),
      ),
    );
  });

  app.get("/dashboard/:owner/:repo/packets/:pullRequestNumber", async (request, response) => {
    const repo = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    if (!repo) {
      response.redirect(
        303,
        appendNoticeToPath("/setup", {
          kind: "warning",
          text: `Repository ${request.params.owner}/${request.params.repo} was not found.`,
        }),
      );
      return;
    }
    response.type("html").send(
      renderDecisionPacketDetailPage(
        repo,
        await options.store.listDecisionPackets(
          repo.owner,
          repo.repo,
          Number(request.params.pullRequestNumber),
        ),
        await resolveNotice(options.store, request.query),
      ),
    );
  });

  app.post(
    "/webhooks/github",
    express.raw({ type: "*/*", limit: "2mb" }),
    async (request: Request, response: Response) => {
      const rawBody = Buffer.isBuffer(request.body)
        ? request.body
        : Buffer.from(request.body ?? "");
      const signature = request.header("x-hub-signature-256") ?? undefined;
      if (
        !verifyGitHubSignature(
          rawBody,
          options.env.PATCHPACT_GITHUB_WEBHOOK_SECRET,
          signature,
        )
      ) {
        response.status(401).json({ error: "Invalid signature" });
        return;
      }

      const eventName = request.header("x-github-event");
      const deliveryId = request.header("x-github-delivery") ?? crypto.randomUUID();
      const payload = JSON.parse(rawBody.toString("utf8"));
      await handleWebhook({
        eventName,
        deliveryId,
        payload,
        options,
      });

      response.status(202).json({ accepted: true });
    },
  );

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/repositories", async (_request, response) => {
    const repositories = await options.store.listRepositories();
    const payload = await Promise.all(
      repositories.map(async (repo: RepositoryRecord) => ({
        ...repo,
        contracts: await options.store.listContracts(repo.owner, repo.repo),
        packets: await options.store.listDecisionPackets(repo.owner, repo.repo),
        waivers: await options.store.listWaivers(repo.owner, repo.repo),
      })),
    );
    response.json({ repositories: payload, jobs: await options.store.listJobRuns(50) });
  });

  app.get("/api/repositories/:owner/:repo", async (request, response) => {
    const repo = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    if (!repo) {
      response.status(404).json({ error: "Repository not found" });
      return;
    }
    const checklist = await buildRepositoryOnboardingChecklist(
      options.store,
      repo.owner,
      repo.repo,
    );
    response.json({
      repository: repo,
      contracts: await options.store.listContracts(repo.owner, repo.repo),
      packets: await options.store.listDecisionPackets(repo.owner, repo.repo),
      waivers: await options.store.listWaivers(repo.owner, repo.repo),
      onboarding: checklist,
    });
  });

  app.get("/api/repositories/:owner/:repo/jobs", async (request, response) => {
    const jobStatusRaw = String(request.query.status ?? "all").trim();
    const status =
      jobStatusRaw === "queued" ||
      jobStatusRaw === "processing" ||
      jobStatusRaw === "completed" ||
      jobStatusRaw === "failed"
        ? jobStatusRaw
        : "all";
    const type = String(request.query.type ?? "").trim();
    const viewRaw = String(request.query.view ?? "open").trim();
    const view = viewRaw === "all" ? "all" : "open";
    const sortRaw = String(request.query.sort ?? "attention").trim();
    const sort = sortRaw === "recent" ? "recent" : "attention";
    const page = Math.max(1, Number(request.query.page ?? 1) || 1);
    const pageSize = Math.max(1, Math.min(Number(request.query.limit ?? 20) || 20, 50));
    const jobPage = await buildRepositoryJobsPage(
      options.store,
      request.params.owner,
      request.params.repo,
      {
        status,
        type,
        view,
        sort,
        page,
        pageSize,
      },
    );
    response.json({
      ...jobPage,
    });
  });

  app.get("/api/repositories/:owner/:repo/onboarding", async (request, response) => {
    const checklist = await buildRepositoryOnboardingChecklist(
      options.store,
      request.params.owner,
      request.params.repo,
    );
    if (!checklist) {
      response.status(404).json({ error: "Repository not found" });
      return;
    }
    response.json(checklist);
  });

  app.get("/api/repositories/:owner/:repo/contracts/:issueNumber", async (request, response) => {
    const contracts = await options.store.listContracts(
      request.params.owner,
      request.params.repo,
      Number(request.params.issueNumber),
    );
    if (!contracts.length) {
      response.status(404).json({ error: "Contract not found" });
      return;
    }
    response.json({
      contracts,
      latest: contracts[0],
    });
  });

  app.get("/api/repositories/:owner/:repo/packets/:pullRequestNumber", async (request, response) => {
    const packets = await options.store.listDecisionPackets(
      request.params.owner,
      request.params.repo,
      Number(request.params.pullRequestNumber),
    );
    if (!packets.length) {
      response.status(404).json({ error: "Decision packet not found" });
      return;
    }
    response.json({
      packets,
      latest: packets[0],
    });
  });

  app.get("/api/repositories/:owner/:repo/knowledge", async (request, response) => {
    const query = String(request.query.q ?? "").trim();
    const limit = Number(request.query.limit ?? 8);
    response.json({
      query,
      results: await options.store.searchKnowledgeChunks(
        request.params.owner,
        request.params.repo,
        query,
        Number.isFinite(limit) ? limit : 8,
      ),
    });
  });

  app.get("/api/repositories/:owner/:repo/waivers", async (request, response) => {
    const targetType =
      request.query.targetType === "issue" || request.query.targetType === "pull_request"
        ? request.query.targetType
        : undefined;
    const targetNumber = request.query.targetNumber
      ? Number(request.query.targetNumber)
      : undefined;
    response.json({
      waivers: await options.store.listWaivers(
        request.params.owner,
        request.params.repo,
        targetType,
        targetNumber,
      ),
    });
  });

  app.get("/api/jobs/:dedupeKey", async (request, response) => {
    const job = await options.store.getJobRun(request.params.dedupeKey);
    if (!job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }
    response.json({ job });
  });

  app.post("/api/repositories/:owner/:repo/config", async (request, response) => {
    const parsed = patchPactConfigSchema.partial().safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const existing = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    const saved = await options.store.saveRepositoryConfig(
      request.params.owner,
      request.params.repo,
      mergeConfig(existing?.config, parsed.data),
    );
    response.json({ repository: saved });
  });

  app.post("/dashboard/:owner/:repo/config", async (request, response) => {
    const parsed = patchPactConfigSchema.partial().safeParse({
      mode: request.body.mode,
      provider: request.body.provider,
      model: request.body.model,
      repoRules: parseTextareaList(request.body.repoRules),
      docsGlobs: parseTextareaList(request.body.docsGlobs),
      testGlobs: parseTextareaList(request.body.testGlobs),
    });
    if (!parsed.success) {
      response.redirect(
        303,
        appendNoticeToPath(
          `/dashboard/${encodeURIComponent(request.params.owner)}/${encodeURIComponent(request.params.repo)}`,
          {
            kind: "warning",
            text: "Repository policy could not be saved because the submitted form values were invalid.",
          },
        ),
      );
      return;
    }
    const existing = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    await options.store.saveRepositoryConfig(
      request.params.owner,
      request.params.repo,
      mergeConfig(existing?.config, parsed.data),
    );
    response.redirect(
      303,
      appendNoticeToPath(
        `/dashboard/${encodeURIComponent(request.params.owner)}/${encodeURIComponent(request.params.repo)}`,
        {
          kind: "success",
          text: `Saved repository policy for ${request.params.owner}/${request.params.repo}.`,
        },
      ),
    );
  });

  app.post("/dashboard/:owner/:repo/actions/sync-knowledge", async (request, response) => {
    const repo = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    if (!repo) {
      response.redirect(
        303,
        appendNoticeToPath("/setup", {
          kind: "warning",
          text: `Repository ${request.params.owner}/${request.params.repo} was not found.`,
        }),
      );
      return;
    }
    const dedupeKey = `dashboard-sync:${request.params.owner}/${request.params.repo}:${Date.now()}`;
    await options.engine.queueKnowledgeSync({
      owner: request.params.owner,
      repo: request.params.repo,
      installationId: repo?.installationId,
      requestedBy: "dashboard",
      dedupeKey,
    });
    response.redirect(
      303,
      appendJobNoticeToPath(
        String(
          request.body.redirectTo ||
            `/dashboard/${encodeURIComponent(request.params.owner)}/${encodeURIComponent(request.params.repo)}`,
        ),
        {
          jobKey: dedupeKey,
          queuedText: `Queued knowledge sync for ${request.params.owner}/${request.params.repo}.`,
          processingText: `Knowledge sync is processing for ${request.params.owner}/${request.params.repo}.`,
          completedText: `Knowledge sync completed for ${request.params.owner}/${request.params.repo}.`,
          failedText: `Knowledge sync failed for ${request.params.owner}/${request.params.repo}.`,
        },
      ),
    );
  });

  app.post("/dashboard/:owner/:repo/actions/refresh-contract", async (request, response) => {
    const issueNumber = Number(request.body.issueNumber);
    if (!Number.isFinite(issueNumber)) {
      response.redirect(
        303,
        appendNoticeToPath(
          String(
            request.body.redirectTo ||
              `/setup/repositories/${encodeURIComponent(request.params.owner)}/${encodeURIComponent(request.params.repo)}`,
          ),
          {
            kind: "warning",
            text: "A valid issue number is required to refresh a contract.",
          },
        ),
      );
      return;
    }
    const repo = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    const dedupeKey = `dashboard-refresh-contract:${request.params.owner}/${request.params.repo}:${issueNumber}:${Date.now()}`;
    await options.engine.queueCommand({
      owner: request.params.owner,
      repo: request.params.repo,
      issueNumber,
      installationId: repo?.installationId,
      requestedBy: "dashboard",
      command: { kind: "contract", action: "refresh" },
      dedupeKey,
    });
    response.redirect(
      303,
      appendJobNoticeToPath(
        String(
          request.body.redirectTo ||
            `/dashboard/${encodeURIComponent(request.params.owner)}/${encodeURIComponent(request.params.repo)}`,
        ),
        {
          jobKey: dedupeKey,
          queuedText: `Queued contract refresh for issue #${issueNumber}.`,
          processingText: `Contract refresh is processing for issue #${issueNumber}.`,
          completedText: `Contract refresh completed for issue #${issueNumber}.`,
          failedText: `Contract refresh failed for issue #${issueNumber}.`,
        },
      ),
    );
  });

  app.post("/dashboard/:owner/:repo/actions/regenerate-packet", async (request, response) => {
    const pullRequestNumber = Number(request.body.pullRequestNumber);
    if (!Number.isFinite(pullRequestNumber)) {
      response.redirect(
        303,
        appendNoticeToPath(
          String(
            request.body.redirectTo ||
              `/setup/repositories/${encodeURIComponent(request.params.owner)}/${encodeURIComponent(request.params.repo)}`,
          ),
          {
            kind: "warning",
            text: "A valid pull request number is required to regenerate a decision packet.",
          },
        ),
      );
      return;
    }
    const repo = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    const dedupeKey = `dashboard-regenerate-packet:${request.params.owner}/${request.params.repo}:${pullRequestNumber}:${Date.now()}`;
    await options.engine.queueDecisionPacket({
      owner: request.params.owner,
      repo: request.params.repo,
      pullRequestNumber,
      installationId: repo?.installationId,
      requestedBy: "dashboard",
      dedupeKey,
    });
    response.redirect(
      303,
      appendJobNoticeToPath(
        String(
          request.body.redirectTo ||
            `/dashboard/${encodeURIComponent(request.params.owner)}/${encodeURIComponent(request.params.repo)}`,
        ),
        {
          jobKey: dedupeKey,
          queuedText: `Queued decision packet regeneration for PR #${pullRequestNumber}.`,
          processingText: `Decision packet regeneration is processing for PR #${pullRequestNumber}.`,
          completedText: `Decision packet regeneration completed for PR #${pullRequestNumber}.`,
          failedText: `Decision packet regeneration failed for PR #${pullRequestNumber}.`,
        },
      ),
    );
  });

  app.post("/dashboard/jobs/:dedupeKey/retry", async (request, response) => {
    const job = await options.store.getJobRun(request.params.dedupeKey);
    if (!job) {
      response.redirect(
        303,
        appendNoticeToPath("/dashboard", {
          kind: "warning",
          text: `Job ${request.params.dedupeKey} was not found.`,
        }),
      );
      return;
    }
    const retryKey = `dashboard-retry:${job.type}:${Date.now()}`;
    await options.engine.requeueStoredJob(
      job.payload,
      retryKey,
    );
    response.redirect(
      303,
      appendJobNoticeToPath(
        `/dashboard/jobs/${encodeURIComponent(request.params.dedupeKey)}`,
        {
          jobKey: retryKey,
          queuedText: `Queued retry for ${job.type}.`,
          processingText: `${job.type} retry is processing.`,
          completedText: `${job.type} retry completed.`,
          failedText: `${job.type} retry failed.`,
        },
      ),
    );
  });

  return app;
}
async function rememberRepository(
  options: CreateWebAppOptions,
  owner: string,
  repo: string,
  installationId?: number,
) {
  const existing = await options.store.getRepository(owner, repo);
  await options.store.upsertRepository({
    owner,
    repo,
    installationId: installationId ?? existing?.installationId,
    config: existing?.config ?? defaultPatchPactConfig,
  });
  if (installationId) {
    options.github.rememberInstallation?.(owner, repo, installationId);
  }
}

export async function handleWebhook(input: {
  eventName: string | undefined;
  deliveryId: string;
  payload: any;
  options: CreateWebAppOptions;
}) {
  const { eventName, deliveryId, payload, options } = input;
  if (!eventName) {
    return;
  }

  if (eventName === "installation") {
    const installationId = payload.installation?.id;
    for (const repo of (payload.repositories ?? []) as Array<{
      name: string;
      owner: { login: string };
    }>) {
      await rememberRepository(options, repo.owner.login, repo.name, installationId);
      await options.engine.queueKnowledgeSync({
        owner: repo.owner.login,
        repo: repo.name,
        installationId,
        requestedBy: "installation",
        dedupeKey: `${deliveryId}:${repo.owner.login}/${repo.name}:knowledge`,
      });
    }
    return;
  }

  if (eventName === "issues") {
    if (!["edited", "reopened"].includes(payload.action)) {
      return;
    }
    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const installationId = payload.installation?.id;
    await rememberRepository(options, owner, repo, installationId);
    const latestContract = await options.store.getLatestContract(owner, repo, payload.issue.number);
    if (latestContract && latestContract.status !== "waived") {
      await options.engine.queueCommand({
        owner,
        repo,
        issueNumber: payload.issue.number,
        installationId,
        requestedBy: payload.issue.user?.login ?? "unknown",
        command: { kind: "contract", action: "refresh" },
        dedupeKey: `${deliveryId}:refresh`,
      });
    }
    return;
  }

  if (eventName === "issue_comment") {
    const command = parseSlashCommand(payload.comment?.body);
    if (!command) {
      return;
    }

    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const installationId = payload.installation?.id;
    await rememberRepository(options, owner, repo, installationId);

    const issueNumber = payload.issue.number;
    const isPullRequest = Boolean(payload.issue.pull_request);
    if (
      command.kind === "contract" &&
      isPullRequest &&
      command.action !== "waive"
    ) {
      await options.github.addIssueComment({
        owner,
        repo,
        issueNumber,
        body: issueCommentMessage(
          "Contribution contracts are created on the source issue thread, not the pull request thread.",
        ),
      });
      return;
    }
    if (command.kind === "packet" && !isPullRequest) {
      await options.github.addIssueComment({
        owner,
        repo,
        issueNumber,
        body: issueCommentMessage(
          "Decision packets are available on pull requests. Use `/packet explain` on a PR thread.",
        ),
      });
      return;
    }

    await options.engine.queueCommand({
      owner,
      repo,
      issueNumber,
      installationId,
      requestedBy: payload.comment.user?.login ?? "unknown",
      command,
      isPullRequest,
      dedupeKey: deliveryId,
    });
    return;
  }

  if (eventName === "pull_request") {
    if (!["opened", "reopened", "synchronize", "edited", "ready_for_review"].includes(payload.action)) {
      return;
    }
    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const installationId = payload.installation?.id;
    await rememberRepository(options, owner, repo, installationId);
    await options.engine.queueDecisionPacket({
      owner,
      repo,
      pullRequestNumber: payload.pull_request.number,
      installationId,
      requestedBy: payload.pull_request.user?.login ?? "unknown",
      dedupeKey: deliveryId,
    });
    return;
  }

  if (eventName === "pull_request_review") {
    if (!["submitted", "edited", "dismissed"].includes(payload.action)) {
      return;
    }
    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const installationId = payload.installation?.id;
    await rememberRepository(options, owner, repo, installationId);
    await options.engine.queueDecisionPacket({
      owner,
      repo,
      pullRequestNumber: payload.pull_request.number,
      installationId,
      requestedBy: payload.review?.user?.login ?? payload.sender?.login ?? "unknown",
      dedupeKey: `${deliveryId}:review`,
    });
    return;
  }

  if (eventName === "push") {
    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const installationId = payload.installation?.id;
    await rememberRepository(options, owner, repo, installationId);
    const defaultBranchRef = `refs/heads/${payload.repository.default_branch}`;
    if (payload.ref === defaultBranchRef) {
      await options.engine.queueKnowledgeSync({
        owner,
        repo,
        installationId,
        requestedBy: payload.pusher?.name ?? "push",
        dedupeKey: `${deliveryId}:knowledge`,
      });
    }
  }
}
