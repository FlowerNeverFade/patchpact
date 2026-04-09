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
  renderContractDetailPage,
  renderDashboard,
  renderDecisionPacketDetailPage,
  renderGitHubAppCallbackConsole,
  renderJobDetailPage,
  renderRepositoryConsole,
  renderSetupConsole,
} from "./dashboard.js";
import { buildInstanceOverview } from "./overview.js";

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

async function buildSetupData(env: PatchPactEnv, store: ArtifactStore) {
  const manifest = buildGitHubAppManifest(env);
  const overview = await buildInstanceOverview(store);
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
    response
      .type("html")
      .send(renderSetupConsole(await buildSetupData(options.env, options.store)));
  });

  app.get("/setup/github-app/callback", async (request, response) => {
    const code = String(request.query.code ?? "").trim();
    if (!code) {
      response.status(400).type("html").send("Missing GitHub App manifest exchange code.");
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
        }),
      );
    } catch (error) {
      response
        .status(502)
        .type("html")
        .send(
          `GitHub manifest exchange failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
    }
  });

  app.get("/api/setup", async (_request, response) => {
    response.json(await buildSetupData(options.env, options.store));
  });

  app.get("/api/overview", async (_request, response) => {
    response.json(await buildInstanceOverview(options.store));
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
      response.status(404).type("html").send("Job not found");
      return;
    }
    response.type("html").send(renderJobDetailPage(job));
  });

  app.get("/dashboard/:owner/:repo", async (request, response) => {
    const repo = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    if (!repo) {
      response.status(404).type("html").send("Repository not found");
      return;
    }
    const knowledgeQuery = String(request.query.q ?? "").trim();
    response.type("html").send(
      renderRepositoryConsole({
        repo,
        contracts: await options.store.listContracts(repo.owner, repo.repo),
        packets: await options.store.listDecisionPackets(repo.owner, repo.repo),
        waivers: await options.store.listWaivers(repo.owner, repo.repo),
        knowledgeQuery,
        knowledgeResults: await options.store.searchKnowledgeChunks(
          repo.owner,
          repo.repo,
          knowledgeQuery,
          knowledgeQuery ? 10 : 6,
        ),
      }),
    );
  });

  app.get("/dashboard/:owner/:repo/contracts/:issueNumber", async (request, response) => {
    const repo = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    if (!repo) {
      response.status(404).type("html").send("Repository not found");
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
      ),
    );
  });

  app.get("/dashboard/:owner/:repo/packets/:pullRequestNumber", async (request, response) => {
    const repo = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    if (!repo) {
      response.status(404).type("html").send("Repository not found");
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
    response.json({
      repository: repo,
      contracts: await options.store.listContracts(repo.owner, repo.repo),
      packets: await options.store.listDecisionPackets(repo.owner, repo.repo),
      waivers: await options.store.listWaivers(repo.owner, repo.repo),
    });
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
      response.status(400).type("html").send(parsed.error.message);
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
      `/dashboard/${encodeURIComponent(request.params.owner)}/${encodeURIComponent(request.params.repo)}`,
    );
  });

  app.post("/dashboard/:owner/:repo/actions/sync-knowledge", async (request, response) => {
    const repo = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    await options.engine.queueKnowledgeSync({
      owner: request.params.owner,
      repo: request.params.repo,
      installationId: repo?.installationId,
      requestedBy: "dashboard",
      dedupeKey: `dashboard-sync:${request.params.owner}/${request.params.repo}:${Date.now()}`,
    });
    response.redirect(
      303,
      `/dashboard/${encodeURIComponent(request.params.owner)}/${encodeURIComponent(request.params.repo)}`,
    );
  });

  app.post("/dashboard/:owner/:repo/actions/refresh-contract", async (request, response) => {
    const issueNumber = Number(request.body.issueNumber);
    if (!Number.isFinite(issueNumber)) {
      response.status(400).type("html").send("issueNumber is required");
      return;
    }
    const repo = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    await options.engine.queueCommand({
      owner: request.params.owner,
      repo: request.params.repo,
      issueNumber,
      installationId: repo?.installationId,
      requestedBy: "dashboard",
      command: { kind: "contract", action: "refresh" },
      dedupeKey: `dashboard-refresh-contract:${request.params.owner}/${request.params.repo}:${issueNumber}:${Date.now()}`,
    });
    response.redirect(
      303,
      String(
        request.body.redirectTo ||
          `/dashboard/${encodeURIComponent(request.params.owner)}/${encodeURIComponent(request.params.repo)}`,
      ),
    );
  });

  app.post("/dashboard/:owner/:repo/actions/regenerate-packet", async (request, response) => {
    const pullRequestNumber = Number(request.body.pullRequestNumber);
    if (!Number.isFinite(pullRequestNumber)) {
      response.status(400).type("html").send("pullRequestNumber is required");
      return;
    }
    const repo = await options.store.getRepository(
      request.params.owner,
      request.params.repo,
    );
    await options.engine.queueDecisionPacket({
      owner: request.params.owner,
      repo: request.params.repo,
      pullRequestNumber,
      installationId: repo?.installationId,
      requestedBy: "dashboard",
      dedupeKey: `dashboard-regenerate-packet:${request.params.owner}/${request.params.repo}:${pullRequestNumber}:${Date.now()}`,
    });
    response.redirect(
      303,
      String(
        request.body.redirectTo ||
          `/dashboard/${encodeURIComponent(request.params.owner)}/${encodeURIComponent(request.params.repo)}`,
      ),
    );
  });

  app.post("/dashboard/jobs/:dedupeKey/retry", async (request, response) => {
    const job = await options.store.getJobRun(request.params.dedupeKey);
    if (!job) {
      response.status(404).type("html").send("Job not found");
      return;
    }
    await options.engine.requeueStoredJob(
      job.payload,
      `dashboard-retry:${job.type}:${Date.now()}`,
    );
    response.redirect(303, `/dashboard/jobs/${encodeURIComponent(request.params.dedupeKey)}`);
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
