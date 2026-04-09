import crypto from "node:crypto";
import type {
  ArtifactStore,
  ContractRecord,
  ContractStatus,
  DecisionPacketRecord,
  JobRunRecord,
  PatchPactConfig,
  RepositoryKnowledgeChunk,
  RepositoryRecord,
  WaiverRecord,
} from "@patchpact/core";

function nowIso(): string {
  return new Date().toISOString();
}

export class MemoryArtifactStore implements ArtifactStore {
  private readonly repositories = new Map<string, RepositoryRecord>();
  private readonly contracts = new Map<string, ContractRecord>();
  private readonly decisionPackets = new Map<string, DecisionPacketRecord>();
  private readonly jobs = new Map<string, JobRunRecord>();
  private readonly knowledgeChunks = new Map<string, RepositoryKnowledgeChunk>();
  private readonly waivers = new Map<string, WaiverRecord>();

  private repoKey(owner: string, repo: string): string {
    return `${owner}/${repo}`.toLowerCase();
  }

  private contractKey(id: string): string {
    return id;
  }

  private packetKey(id: string): string {
    return id;
  }

  async upsertRepository(
    input: Pick<RepositoryRecord, "owner" | "repo" | "installationId" | "config">,
  ): Promise<RepositoryRecord> {
    const key = this.repoKey(input.owner, input.repo);
    const existing = this.repositories.get(key);
    const record: RepositoryRecord = {
      owner: input.owner,
      repo: input.repo,
      installationId: input.installationId ?? existing?.installationId,
      config: input.config,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    this.repositories.set(key, record);
    return record;
  }

  async getRepository(owner: string, repo: string): Promise<RepositoryRecord | null> {
    return this.repositories.get(this.repoKey(owner, repo)) ?? null;
  }

  async listRepositories(): Promise<RepositoryRecord[]> {
    return [...this.repositories.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  async saveRepositoryConfig(
    owner: string,
    repo: string,
    config: PatchPactConfig,
  ): Promise<RepositoryRecord> {
    const existing = await this.getRepository(owner, repo);
    return this.upsertRepository({
      owner,
      repo,
      installationId: existing?.installationId,
      config,
    });
  }

  async saveContract(
    input: Omit<ContractRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<ContractRecord> {
    const record: ContractRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.contracts.set(this.contractKey(record.id), record);
    return record;
  }

  async getLatestContract(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<ContractRecord | null> {
    const list = await this.listContracts(owner, repo, issueNumber);
    return list[0] ?? null;
  }

  async getApprovedContract(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<ContractRecord | null> {
    const list = await this.listContracts(owner, repo, issueNumber);
    return list.find((contract) => contract.status === "approved") ?? null;
  }

  async listContracts(
    owner: string,
    repo: string,
    issueNumber?: number,
  ): Promise<ContractRecord[]> {
    return [...this.contracts.values()]
      .filter(
        (record) =>
          record.owner === owner &&
          record.repo === repo &&
          (issueNumber === undefined || record.issueNumber === issueNumber),
      )
      .sort((a, b) => b.version - a.version);
  }

  async updateContractStatus(
    id: string,
    status: ContractStatus,
    actor?: string,
  ): Promise<ContractRecord | null> {
    const contract = this.contracts.get(this.contractKey(id));
    if (!contract) {
      return null;
    }
    const updated: ContractRecord = {
      ...contract,
      status,
      approvedBy: actor ?? contract.approvedBy,
      updatedAt: nowIso(),
    };
    this.contracts.set(this.contractKey(id), updated);
    return updated;
  }

  async saveDecisionPacket(
    input: Omit<DecisionPacketRecord, "id" | "createdAt">,
  ): Promise<DecisionPacketRecord> {
    const record: DecisionPacketRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: nowIso(),
    };
    this.decisionPackets.set(this.packetKey(record.id), record);
    return record;
  }

  async getLatestDecisionPacket(
    owner: string,
    repo: string,
    pullRequestNumber: number,
  ): Promise<DecisionPacketRecord | null> {
    const list = await this.listDecisionPackets(owner, repo, pullRequestNumber);
    return list[0] ?? null;
  }

  async listDecisionPackets(
    owner: string,
    repo: string,
    pullRequestNumber?: number,
  ): Promise<DecisionPacketRecord[]> {
    return [...this.decisionPackets.values()]
      .filter(
        (record) =>
          record.owner === owner &&
          record.repo === repo &&
          (pullRequestNumber === undefined ||
            record.pullRequestNumber === pullRequestNumber),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveJobRun(input: Omit<JobRunRecord, "createdAt" | "updatedAt">): Promise<void> {
    const current = this.jobs.get(input.dedupeKey);
    this.jobs.set(input.dedupeKey, {
      ...input,
      createdAt: current?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    });
  }

  async updateJobRun(
    dedupeKey: string,
    status: JobRunRecord["status"],
    error?: string,
  ): Promise<void> {
    const current = this.jobs.get(dedupeKey);
    if (!current) {
      return;
    }
    this.jobs.set(dedupeKey, {
      ...current,
      status,
      error,
      updatedAt: nowIso(),
    });
  }

  async listJobRuns(limit = 20): Promise<JobRunRecord[]> {
    return [...this.jobs.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async getJobRun(dedupeKey: string): Promise<JobRunRecord | null> {
    return this.jobs.get(dedupeKey) ?? null;
  }

  async countKnowledgeChunks(owner: string, repo: string): Promise<number> {
    return [...this.knowledgeChunks.values()].filter(
      (chunk) => chunk.owner === owner && chunk.repo === repo,
    ).length;
  }

  async saveWaiver(input: {
    owner: string;
    repo: string;
    targetType: "issue" | "pull_request";
    targetNumber: number;
    requestedBy: string;
    reason?: string;
  }): Promise<WaiverRecord> {
    const record: WaiverRecord = {
      id: crypto.randomUUID(),
      owner: input.owner,
      repo: input.repo,
      targetType: input.targetType,
      targetNumber: input.targetNumber,
      requestedBy: input.requestedBy,
      reason: input.reason,
      createdAt: nowIso(),
    };
    this.waivers.set(record.id, record);
    return record;
  }

  async getLatestWaiver(
    owner: string,
    repo: string,
    targetType: "issue" | "pull_request",
    targetNumber: number,
  ): Promise<WaiverRecord | null> {
    const waivers = await this.listWaivers(owner, repo, targetType, targetNumber);
    return waivers[0] ?? null;
  }

  async listWaivers(
    owner: string,
    repo: string,
    targetType?: "issue" | "pull_request",
    targetNumber?: number,
  ): Promise<WaiverRecord[]> {
    return [...this.waivers.values()]
      .filter(
        (record) =>
          record.owner === owner &&
          record.repo === repo &&
          (targetType === undefined || record.targetType === targetType) &&
          (targetNumber === undefined || record.targetNumber === targetNumber),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async replaceKnowledgeChunks(
    owner: string,
    repo: string,
    chunks: Array<{
      path: string;
      chunkIndex: number;
      content: string;
      contentHash: string;
    }>,
  ): Promise<void> {
    for (const [key, chunk] of this.knowledgeChunks.entries()) {
      if (chunk.owner === owner && chunk.repo === repo) {
        this.knowledgeChunks.delete(key);
      }
    }
    for (const chunk of chunks) {
      const record: RepositoryKnowledgeChunk = {
        id: crypto.randomUUID(),
        owner,
        repo,
        path: chunk.path,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        contentHash: chunk.contentHash,
        createdAt: nowIso(),
      };
      this.knowledgeChunks.set(record.id, record);
    }
  }

  async searchKnowledgeChunks(
    owner: string,
    repo: string,
    query: string,
    limit = 6,
  ): Promise<RepositoryKnowledgeChunk[]> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return [...this.knowledgeChunks.values()]
      .filter((chunk) => chunk.owner === owner && chunk.repo === repo)
      .map((chunk) => {
        const haystack = `${chunk.path} ${chunk.content}`.toLowerCase();
        const score = terms.reduce(
          (total, term) => total + (haystack.includes(term) ? 1 : 0),
          0,
        );
        return {
          ...chunk,
          score,
        };
      })
      .filter((chunk) => (terms.length ? (chunk.score ?? 0) > 0 : true))
      .sort(
        (a, b) =>
          (b.score ?? 0) - (a.score ?? 0) || b.createdAt.localeCompare(a.createdAt),
      )
      .slice(0, limit);
  }
}
