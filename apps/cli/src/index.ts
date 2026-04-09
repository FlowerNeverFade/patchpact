#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import {
  PatchPactEngine,
  parseSlashCommand,
  defaultPatchPactConfig,
  parsePatchPactConfig,
  buildContractPrompt,
  buildDecisionPacketPrompt,
  type PatchPactJob,
} from "@patchpact/core";
import {
  GitHubApiPlatform,
  InlineJobBus,
  MemoryGitHubPlatform,
  MockModelProvider,
  createArtifactStore,
  loadAndParseEnv,
  parseEnv,
  type SeedRepository,
} from "@patchpact/adapters";

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolveCliPath(path), "utf8")) as T;
}

function resolveCliPath(path: string): string {
  const base = process.env.INIT_CWD || process.cwd();
  return resolve(base, path);
}

async function replayWebhook(
  eventName: string,
  deliveryId: string,
  payload: any,
  input: {
    env: ReturnType<typeof parseEnv>;
    engine: PatchPactEngine;
    store: ReturnType<typeof createArtifactStore>;
    github: GitHubApiPlatform;
  },
): Promise<void> {
  const rememberRepository = async (
    owner: string,
    repo: string,
    installationId?: number,
  ) => {
    const existing = await input.store.getRepository(owner, repo);
    await input.store.upsertRepository({
      owner,
      repo,
      installationId: installationId ?? existing?.installationId,
      config: existing?.config ?? defaultPatchPactConfig,
    });
    if (installationId) {
      input.github.rememberInstallation(owner, repo, installationId);
    }
  };

  if (eventName === "installation") {
    for (const repo of (payload.repositories ?? []) as Array<{
      name: string;
      owner: { login: string };
    }>) {
      await rememberRepository(repo.owner.login, repo.name, payload.installation?.id);
      await input.engine.queueKnowledgeSync({
        owner: repo.owner.login,
        repo: repo.name,
        installationId: payload.installation?.id,
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
    await rememberRepository(owner, repo, installationId);
    const latestContract = await input.store.getLatestContract(owner, repo, payload.issue.number);
    if (latestContract && latestContract.status !== "waived") {
      await input.engine.queueCommand({
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
    await rememberRepository(owner, repo, installationId);
    await input.engine.queueCommand({
      owner,
      repo,
      issueNumber: payload.issue.number,
      installationId,
      requestedBy: payload.comment.user?.login ?? "unknown",
      command,
      isPullRequest: Boolean(payload.issue.pull_request),
      dedupeKey: deliveryId,
    });
    return;
  }

  if (eventName === "pull_request") {
    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const installationId = payload.installation?.id;
    await rememberRepository(owner, repo, installationId);
    await input.engine.queueDecisionPacket({
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
    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const installationId = payload.installation?.id;
    await rememberRepository(owner, repo, installationId);
    await input.engine.queueDecisionPacket({
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
    await rememberRepository(owner, repo, installationId);
    const defaultBranchRef = `refs/heads/${payload.repository.default_branch}`;
    if (payload.ref === defaultBranchRef) {
      await input.engine.queueKnowledgeSync({
        owner,
        repo,
        installationId,
        requestedBy: payload.pusher?.name ?? "push",
        dedupeKey: `${deliveryId}:knowledge`,
      });
    }
  }
}

async function main() {
  const program = new Command();
  program.name("patchpact").description("PatchPact maintenance CLI");

  program
    .command("validate-config")
    .argument("[file]", "Path to .patchpact.yml", ".patchpact.yml")
    .action(async (file) => {
      const text = await readFile(resolveCliPath(file), "utf8");
      const config = parsePatchPactConfig(text);
      console.log(JSON.stringify(config, null, 2));
    });

  program
    .command("debug-contract")
    .requiredOption("--fixture <file>", "Path to a seeded repository fixture JSON file")
    .requiredOption("--issue <number>", "Issue number to evaluate")
    .action(async (options) => {
      const fixture = await loadJson<SeedRepository>(options.fixture);
      const github = new MemoryGitHubPlatform();
      github.seedRepository(fixture);
      const issueNumber = Number(options.issue);
      const config = fixture.configText
        ? parsePatchPactConfig(fixture.configText)
        : defaultPatchPactConfig;
      const issue = await github.fetchIssueContext({
        owner: fixture.owner,
        repo: fixture.repo,
        issueNumber,
      });
      const prompt = buildContractPrompt(config, issue);
      const model = new MockModelProvider();
      const contract = await model.generateContract({ config, issue, prompt });
      console.log(JSON.stringify(contract, null, 2));
    });

  program
    .command("debug-packet")
    .requiredOption("--fixture <file>", "Path to a seeded repository fixture JSON file")
    .requiredOption("--pr <number>", "Pull request number to evaluate")
    .option("--issue <number>", "Approved contract issue number to link")
    .action(async (options) => {
      const fixture = await loadJson<SeedRepository>(options.fixture);
      const github = new MemoryGitHubPlatform();
      github.seedRepository(fixture);
      const config = fixture.configText
        ? parsePatchPactConfig(fixture.configText)
        : defaultPatchPactConfig;
      const pr = await github.fetchPullRequestContext({
        owner: fixture.owner,
        repo: fixture.repo,
        pullRequestNumber: Number(options.pr),
      });
      const model = new MockModelProvider();
      const contract =
        options.issue !== undefined
          ? await model.generateContract({
              config,
              issue: await github.fetchIssueContext({
                owner: fixture.owner,
                repo: fixture.repo,
                issueNumber: Number(options.issue),
              }),
              prompt: "offline-debug",
            })
          : null;
      const packet = await model.generateDecisionPacket({
        config,
        pullRequest: pr,
        contract,
        prompt: buildDecisionPacketPrompt(config, pr, contract),
      });
      console.log(JSON.stringify(packet, null, 2));
    });

  program
    .command("search-knowledge")
    .requiredOption("--owner <owner>", "Repository owner")
    .requiredOption("--repo <repo>", "Repository name")
    .requiredOption("--query <query>", "Search query")
    .option("--limit <number>", "Max results", "6")
    .action(async (options) => {
      const env = loadAndParseEnv(process.env);
      const store = createArtifactStore(env);
      const results = await store.searchKnowledgeChunks(
        options.owner,
        options.repo,
        options.query,
        Number(options.limit),
      );
      console.log(JSON.stringify(results, null, 2));
    });

  program
    .command("replay-webhook")
    .requiredOption("--event <name>", "GitHub event name, for example issue_comment")
    .requiredOption("--file <path>", "Path to a raw GitHub webhook payload JSON file")
    .option("--delivery <id>", "Synthetic delivery id", `cli-${Date.now()}`)
    .action(async (options) => {
      const env = loadAndParseEnv(process.env);
      const store = createArtifactStore({ ...env, PATCHPACT_INLINE_JOBS: true });
      const github = new GitHubApiPlatform({
        appId: env.PATCHPACT_GITHUB_APP_ID,
        privateKey: env.PATCHPACT_GITHUB_PRIVATE_KEY,
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

      await replayWebhook(options.event, options.delivery, await loadJson(options.file), {
        env: { ...env, PATCHPACT_INLINE_JOBS: true },
        engine,
        store,
        github,
      });

      console.log("Webhook replayed successfully.");
      console.log(JSON.stringify(await store.listJobRuns(10), null, 2));
    });

  program
    .command("reindex")
    .requiredOption("--owner <owner>", "Repository owner")
    .requiredOption("--repo <repo>", "Repository name")
    .option("--installation <id>", "GitHub installation id")
    .action(async (options) => {
      const env = loadAndParseEnv(process.env);
      const store = createArtifactStore(env);
      const github = new GitHubApiPlatform({
        appId: env.PATCHPACT_GITHUB_APP_ID,
        privateKey: env.PATCHPACT_GITHUB_PRIVATE_KEY,
      });
      if (options.installation) {
        github.rememberInstallation(options.owner, options.repo, Number(options.installation));
      }
      const configText = await github.fetchRepositoryConfig(options.owner, options.repo);
      const config = configText ? parsePatchPactConfig(configText) : defaultPatchPactConfig;
      await store.upsertRepository({
        owner: options.owner,
        repo: options.repo,
        installationId: options.installation ? Number(options.installation) : undefined,
        config,
      });
      console.log(
        JSON.stringify(
          {
            owner: options.owner,
            repo: options.repo,
            config,
            note: "PatchPact will refresh repository docs during issue, pull request, and push-driven knowledge sync.",
          },
          null,
          2,
        ),
      );
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
