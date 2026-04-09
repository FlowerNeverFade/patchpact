import { defaultPatchPactConfig, mergePatchPactConfig, parsePatchPactConfig } from "./config.js";
import { generateContractHeuristically, generateDecisionPacketHeuristically } from "./heuristics.js";
import {
  chunkRepositoryDocuments,
  extractKnowledgeQuery,
  filterRepositoryDocuments,
  mergeKnowledgeIntoDocuments,
} from "./knowledge.js";
import {
  renderContractApprovalComment,
  renderContractComment,
  renderDecisionPacketComment,
  renderWaiverComment,
} from "./markdown.js";
import { deriveCheckResult } from "./policy.js";
import { buildContractPrompt, buildDecisionPacketPrompt } from "./prompts.js";
import type {
  ArtifactStore,
  ContractRecord,
  GitHubPlatform,
  IssueContext,
  JobBus,
  ModelProvider,
  PatchPactCommand,
  PatchPactConfig,
  PatchPactJob,
  PullRequestContext,
} from "./types.js";

export interface PatchPactDependencies {
  store: ArtifactStore;
  github: GitHubPlatform;
  model: ModelProvider;
  jobs: JobBus;
}

export class PatchPactEngine {
  constructor(private readonly deps: PatchPactDependencies) {}

  private stableSerialize(value: unknown): string {
    return JSON.stringify(value);
  }

  async getEffectiveConfig(owner: string, repo: string): Promise<PatchPactConfig> {
    const storedRepo = await this.deps.store.getRepository(owner, repo);
    const repoText = await this.deps.github.fetchRepositoryConfig(owner, repo);
    const repoConfig = repoText ? parsePatchPactConfig(repoText) : defaultPatchPactConfig;
    return mergePatchPactConfig(repoConfig, storedRepo?.config);
  }

  async queueCommand(input: {
    owner: string;
    repo: string;
    issueNumber: number;
    installationId?: number;
    requestedBy: string;
    command: PatchPactCommand;
    isPullRequest?: boolean;
    dedupeKey: string;
  }): Promise<boolean> {
    let job: PatchPactJob;
    if (input.command.kind === "contract") {
      if (input.command.action === "create") {
        job = {
          type: "create-contract",
          owner: input.owner,
          repo: input.repo,
          installationId: input.installationId,
          issueNumber: input.issueNumber,
          requestedBy: input.requestedBy,
        };
      } else if (input.command.action === "refresh") {
        job = {
          type: "refresh-contract",
          owner: input.owner,
          repo: input.repo,
          installationId: input.installationId,
          issueNumber: input.issueNumber,
          requestedBy: input.requestedBy,
        };
      } else if (input.command.action === "approve") {
        job = {
          type: "approve-contract",
          owner: input.owner,
          repo: input.repo,
          issueNumber: input.issueNumber,
          requestedBy: input.requestedBy,
        };
      } else {
        job = {
          type: "waive-contract",
          owner: input.owner,
          repo: input.repo,
          issueNumber: input.issueNumber,
          pullRequestNumber: input.isPullRequest ? input.issueNumber : undefined,
          requestedBy: input.requestedBy,
          reason:
            input.command.kind === "contract"
              ? input.command.argumentText
              : undefined,
        };
      }
    } else {
      job = {
        type: "explain-decision-packet",
        owner: input.owner,
        repo: input.repo,
        pullRequestNumber: input.issueNumber,
        requestedBy: input.requestedBy,
      };
    }
    return this.deps.jobs.enqueue(job, input.dedupeKey);
  }

  async queueDecisionPacket(input: {
    owner: string;
    repo: string;
    pullRequestNumber: number;
    installationId?: number;
    requestedBy: string;
    dedupeKey: string;
  }): Promise<boolean> {
    return this.deps.jobs.enqueue(
      {
        type: "generate-decision-packet",
        owner: input.owner,
        repo: input.repo,
        installationId: input.installationId,
        pullRequestNumber: input.pullRequestNumber,
        requestedBy: input.requestedBy,
      },
      input.dedupeKey,
    );
  }

  async queueKnowledgeSync(input: {
    owner: string;
    repo: string;
    installationId?: number;
    requestedBy: string;
    dedupeKey: string;
  }): Promise<boolean> {
    return this.deps.jobs.enqueue(
      {
        type: "sync-repository-knowledge",
        owner: input.owner,
        repo: input.repo,
        installationId: input.installationId,
        requestedBy: input.requestedBy,
      },
      input.dedupeKey,
    );
  }

  async requeueStoredJob(job: PatchPactJob, dedupeKey: string): Promise<boolean> {
    return this.deps.jobs.enqueue(job, dedupeKey);
  }

  async runJob(job: PatchPactJob, dedupeKey: string): Promise<void> {
    await this.deps.store.saveJobRun({
      id: dedupeKey,
      dedupeKey,
      payload: job,
      status: "processing",
      type: job.type,
    });

    try {
      switch (job.type) {
        case "create-contract":
        case "refresh-contract":
          await this.generateContract(job);
          break;
        case "approve-contract":
          await this.approveContract(job);
          break;
        case "waive-contract":
          await this.waiveContract(job);
          break;
        case "generate-decision-packet":
          await this.generateDecisionPacket(job);
          break;
        case "explain-decision-packet":
          await this.explainDecisionPacket(job);
          break;
        case "sync-installation":
          await this.deps.store.upsertRepository({
            owner: job.owner,
            repo: job.repo,
            installationId: job.installationId,
            config: defaultPatchPactConfig,
          });
          break;
        case "sync-repository-knowledge":
          await this.syncRepositoryKnowledge(job.owner, job.repo, job.installationId);
          break;
      }
      await this.deps.store.updateJobRun(dedupeKey, "completed");
    } catch (error) {
      await this.deps.store.updateJobRun(
        dedupeKey,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private async generateContract(
    job: Extract<PatchPactJob, { type: "create-contract" | "refresh-contract" }>,
  ): Promise<ContractRecord> {
    const config = await this.getEffectiveConfig(job.owner, job.repo);
    const issue = await this.deps.github.fetchIssueContext({
      owner: job.owner,
      repo: job.repo,
      issueNumber: job.issueNumber,
      installationId: job.installationId,
    });
    const enrichedIssue = await this.enrichIssueContext(issue, config);
    const prompt = buildContractPrompt(config, enrichedIssue);
    const content =
      this.deps.model.name === "mock"
        ? generateContractHeuristically({ config, issue: enrichedIssue })
        : await this.deps.model.generateContract({
            config,
            issue: enrichedIssue,
            prompt,
          });

    const latest = await this.deps.store.getLatestContract(job.owner, job.repo, job.issueNumber);
    if (
      latest &&
      this.stableSerialize(latest.content) === this.stableSerialize(content) &&
      job.type === "refresh-contract"
    ) {
      await this.deps.github.addIssueComment({
        owner: job.owner,
        repo: job.repo,
        issueNumber: job.issueNumber,
        body:
          "PatchPact refreshed the contract context and found no material contract changes, so the current draft or approved version still stands.",
      });
      return latest;
    }

    const contract = await this.deps.store.saveContract({
      owner: job.owner,
      repo: job.repo,
      issueNumber: job.issueNumber,
      generatedBy: job.requestedBy,
      version: (latest?.version ?? 0) + 1,
      status: "draft",
      content,
    });

    await this.deps.github.addIssueComment({
      owner: job.owner,
      repo: job.repo,
      issueNumber: job.issueNumber,
      body: renderContractComment(contract, config),
    });
    return contract;
  }

  private async approveContract(
    job: Extract<PatchPactJob, { type: "approve-contract" }>,
  ): Promise<void> {
    const contract = await this.deps.store.getLatestContract(job.owner, job.repo, job.issueNumber);
    if (!contract) {
      await this.deps.github.addIssueComment({
        owner: job.owner,
        repo: job.repo,
        issueNumber: job.issueNumber,
        body: "PatchPact could not find a draft contract to approve. Run `/contract create` first.",
      });
      return;
    }
    const updated = await this.deps.store.updateContractStatus(
      contract.id,
      "approved",
      job.requestedBy,
    );
    if (!updated) {
      return;
    }
    await this.deps.github.addIssueComment({
      owner: job.owner,
      repo: job.repo,
      issueNumber: job.issueNumber,
      body: renderContractApprovalComment(updated),
    });
  }

  private async waiveContract(
    job: Extract<PatchPactJob, { type: "waive-contract" }>,
  ): Promise<void> {
    if (job.pullRequestNumber) {
      await this.deps.store.saveWaiver({
        owner: job.owner,
        repo: job.repo,
        targetType: "pull_request",
        targetNumber: job.pullRequestNumber,
        requestedBy: job.requestedBy,
        reason: job.reason,
      });
      await this.deps.github.addIssueComment({
        owner: job.owner,
        repo: job.repo,
        issueNumber: job.pullRequestNumber,
        body: renderWaiverComment(
          job.pullRequestNumber,
          job.requestedBy,
          job.reason,
          "pull_request",
        ),
      });
      return;
    }

    const contract = await this.deps.store.getLatestContract(job.owner, job.repo, job.issueNumber);
    if (contract) {
      await this.deps.store.updateContractStatus(contract.id, "waived", job.requestedBy);
    }
    await this.deps.store.saveWaiver({
      owner: job.owner,
      repo: job.repo,
      targetType: "issue",
      targetNumber: job.issueNumber,
      requestedBy: job.requestedBy,
      reason: job.reason,
    });
    await this.deps.github.addIssueComment({
      owner: job.owner,
      repo: job.repo,
      issueNumber: job.issueNumber,
      body: renderWaiverComment(job.issueNumber, job.requestedBy, job.reason, "issue"),
    });
  }

  private async generateDecisionPacket(
    job: Extract<PatchPactJob, { type: "generate-decision-packet" }>,
  ): Promise<void> {
    const config = await this.getEffectiveConfig(job.owner, job.repo);
    const pullRequest = await this.deps.github.fetchPullRequestContext({
      owner: job.owner,
      repo: job.repo,
      pullRequestNumber: job.pullRequestNumber,
      installationId: job.installationId,
    });
    const enrichedPullRequest = await this.enrichPullRequestContext(pullRequest, config);
    const relatedIssueNumber =
      enrichedPullRequest.linkedContractIssueNumber ??
      enrichedPullRequest.referencedIssueNumbers[0];
    const approvedContract = relatedIssueNumber
      ? await this.deps.store.getApprovedContract(job.owner, job.repo, relatedIssueNumber)
      : null;
    const pullRequestWaiver = await this.deps.store.getLatestWaiver(
      job.owner,
      job.repo,
      "pull_request",
      job.pullRequestNumber,
    );
    const issueWaiver =
      relatedIssueNumber !== undefined
        ? await this.deps.store.getLatestWaiver(
            job.owner,
            job.repo,
            "issue",
            relatedIssueNumber,
          )
        : null;
    const waiver = pullRequestWaiver ?? issueWaiver;
    const prompt = buildDecisionPacketPrompt(
      config,
      enrichedPullRequest,
      approvedContract?.content ?? null,
    );
    const content =
      this.deps.model.name === "mock"
        ? generateDecisionPacketHeuristically({
            config,
            pullRequest: enrichedPullRequest,
            contract: approvedContract?.content ?? null,
          })
        : await this.deps.model.generateDecisionPacket({
            config,
            pullRequest: enrichedPullRequest,
            contract: approvedContract?.content ?? null,
            prompt,
          });
    const normalizedContent = waiver
      ? {
          ...content,
          waiverApplied: true,
          waiverReason: waiver.reason,
          suggestedAction:
            content.suggestedAction === "needs-contract"
              ? "needs-follow-up"
              : content.suggestedAction,
          summary:
            content.verdict === "missing-contract"
              ? `${content.summary} Maintainer waiver recorded for this pull request.`
              : content.summary,
          blockingReasons:
            content.verdict === "missing-contract" ? [] : content.blockingReasons,
        }
      : content;

    const latestPacket = await this.deps.store.getLatestDecisionPacket(
      job.owner,
      job.repo,
      job.pullRequestNumber,
    );
    if (
      latestPacket &&
      latestPacket.linkedContractId === approvedContract?.id &&
      this.stableSerialize(latestPacket.content) === this.stableSerialize(normalizedContent)
    ) {
      await this.deps.github.upsertCheckRun({
        owner: job.owner,
        repo: job.repo,
        pullRequestNumber: job.pullRequestNumber,
        headSha: enrichedPullRequest.headSha,
        result: deriveCheckResult(config, normalizedContent),
      });
      return;
    }

    const packet = await this.deps.store.saveDecisionPacket({
      owner: job.owner,
      repo: job.repo,
      pullRequestNumber: job.pullRequestNumber,
      linkedContractId: approvedContract?.id,
      generatedBy: job.requestedBy,
      content: normalizedContent,
    });

    await this.deps.github.upsertCheckRun({
      owner: job.owner,
      repo: job.repo,
      pullRequestNumber: job.pullRequestNumber,
      headSha: enrichedPullRequest.headSha,
      result: deriveCheckResult(config, normalizedContent),
    });

    await this.deps.github.addIssueComment({
      owner: job.owner,
      repo: job.repo,
      issueNumber: job.pullRequestNumber,
      body: renderDecisionPacketComment(packet, config),
    });
  }

  private async explainDecisionPacket(
    job: Extract<PatchPactJob, { type: "explain-decision-packet" }>,
  ): Promise<void> {
    const config = await this.getEffectiveConfig(job.owner, job.repo);
    const packet = await this.deps.store.getLatestDecisionPacket(
      job.owner,
      job.repo,
      job.pullRequestNumber,
    );
    if (!packet) {
      await this.deps.github.addIssueComment({
        owner: job.owner,
        repo: job.repo,
        issueNumber: job.pullRequestNumber,
        body: "PatchPact does not have a decision packet for this pull request yet.",
      });
      return;
    }
    await this.deps.github.addIssueComment({
      owner: job.owner,
      repo: job.repo,
      issueNumber: job.pullRequestNumber,
      body: renderDecisionPacketComment(packet, config),
    });
  }

  private async syncRepositoryKnowledge(
    owner: string,
    repo: string,
    installationId?: number,
  ): Promise<void> {
    const config = await this.getEffectiveConfig(owner, repo);
    const documents = await this.deps.github.fetchRepositoryDocuments({
      owner,
      repo,
      installationId,
    });
    const filtered = filterRepositoryDocuments(documents, config.docsGlobs);
    if (!filtered.length) {
      return;
    }
    await this.deps.store.replaceKnowledgeChunks(
      owner,
      repo,
      chunkRepositoryDocuments(filtered),
    );
  }

  private async enrichIssueContext(
    issue: IssueContext,
    config: PatchPactConfig,
  ): Promise<IssueContext> {
    const filtered = filterRepositoryDocuments(issue.documents, config.docsGlobs);
    if (filtered.length) {
      await this.deps.store.replaceKnowledgeChunks(
        issue.owner,
        issue.repo,
        chunkRepositoryDocuments(filtered),
      );
    }
    const knowledge = await this.deps.store.searchKnowledgeChunks(
      issue.owner,
      issue.repo,
      extractKnowledgeQuery(`${issue.title} ${issue.body} ${issue.labels.join(" ")}`),
      6,
    );
    return {
      ...issue,
      documents: mergeKnowledgeIntoDocuments(
        filtered.length ? filtered : issue.documents,
        knowledge,
      ),
    };
  }

  private async enrichPullRequestContext(
    pullRequest: PullRequestContext,
    config: PatchPactConfig,
  ): Promise<PullRequestContext> {
    const filtered = filterRepositoryDocuments(pullRequest.documents, config.docsGlobs);
    if (filtered.length) {
      await this.deps.store.replaceKnowledgeChunks(
        pullRequest.owner,
        pullRequest.repo,
        chunkRepositoryDocuments(filtered),
      );
    }
    const query = extractKnowledgeQuery(
      `${pullRequest.title} ${pullRequest.body} ${pullRequest.changedFiles.map((file) => file.path).join(" ")}`,
    );
    const knowledge = await this.deps.store.searchKnowledgeChunks(
      pullRequest.owner,
      pullRequest.repo,
      query,
      6,
    );
    return {
      ...pullRequest,
      documents: mergeKnowledgeIntoDocuments(
        filtered.length ? filtered : pullRequest.documents,
        knowledge,
      ),
    };
  }
}
