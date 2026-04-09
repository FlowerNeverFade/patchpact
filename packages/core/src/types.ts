import { z } from "zod";

export const patchPactModeSchema = z.enum(["advisory", "soft-gate"]);
export type PatchPactMode = z.infer<typeof patchPactModeSchema>;

export const providerTypeSchema = z.enum([
  "openai-compatible",
  "anthropic",
  "ollama",
  "mock",
]);
export type ProviderType = z.infer<typeof providerTypeSchema>;

export const contractStatusSchema = z.enum(["draft", "approved", "waived"]);
export type ContractStatus = z.infer<typeof contractStatusSchema>;

export const confidenceSchema = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export const patchPactConfigSchema = z.object({
  mode: patchPactModeSchema.default("advisory"),
  requiredContractSections: z
    .array(
      z.enum([
        "problemStatement",
        "scopeBoundaries",
        "impactedAreas",
        "acceptanceCriteria",
        "testExpectations",
        "nonGoals",
      ]),
    )
    .default([
      "problemStatement",
      "scopeBoundaries",
      "impactedAreas",
      "acceptanceCriteria",
      "testExpectations",
      "nonGoals",
    ]),
  docsGlobs: z
    .array(z.string())
    .default([
      "README.md",
      "CONTRIBUTING.md",
      "CODEOWNERS",
      ".github/ISSUE_TEMPLATE/*",
      ".github/PULL_REQUEST_TEMPLATE*",
      "docs/*",
    ]),
  testGlobs: z
    .array(z.string())
    .default([
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/*.test.tsx",
      "**/*.spec.tsx",
      "**/test_*.py",
      "**/*_test.py",
    ]),
  provider: providerTypeSchema.default("mock"),
  model: z.string().default("heuristic-v1"),
  repoRules: z.array(z.string()).default([]),
});
export type PatchPactConfig = z.infer<typeof patchPactConfigSchema>;

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RepositoryRecord extends RepoRef {
  installationId?: number;
  config: PatchPactConfig;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryDocument {
  path: string;
  content: string;
}

export interface RepositoryKnowledgeChunk extends RepoRef {
  id: string;
  path: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  score?: number;
  createdAt: string;
}

export interface RepositoryPullRequestSummary {
  number: number;
  title: string;
  mergedAt?: string;
  summary: string;
}

export interface IssueContext extends RepoRef {
  installationId?: number;
  issueNumber: number;
  title: string;
  body: string;
  author: string;
  labels: string[];
  documents: RepositoryDocument[];
  recentMergedPullRequests: RepositoryPullRequestSummary[];
  recentClosedIssues: Array<{
    number: number;
    title: string;
    summary: string;
  }>;
  commentId?: number;
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch?: string;
}

export interface PullRequestContext extends RepoRef {
  installationId?: number;
  pullRequestNumber: number;
  title: string;
  body: string;
  author: string;
  headSha: string;
  baseRef: string;
  labels: string[];
  changedFiles: ChangedFile[];
  documents: RepositoryDocument[];
  referencedIssueNumbers: number[];
  linkedContractIssueNumber?: number;
  recentMergedPullRequests: RepositoryPullRequestSummary[];
}

export interface RelatedArtifact {
  type: "issue" | "pull_request" | "document";
  identifier: string;
  reason: string;
}

export interface ContributionContract {
  issueNumber: number;
  title: string;
  problemStatement: string;
  scopeBoundaries: string[];
  impactedAreas: string[];
  acceptanceCriteria: string[];
  testExpectations: string[];
  nonGoals: string[];
  repoSignals: string[];
  relatedIssueNumbers: number[];
  rationale: string;
  confidence: Confidence;
  suggestedNextStep: string;
}

export interface DecisionPacket {
  pullRequestNumber: number;
  summary: string;
  contractMatchScore: number;
  verdict: "aligned" | "partial" | "missing-contract" | "misaligned";
  risks: string[];
  missingTests: string[];
  relatedArtifacts: RelatedArtifact[];
  suggestedAction:
    | "merge-ready"
    | "needs-follow-up"
    | "needs-contract"
    | "needs-waiver";
  confidence: Confidence;
  blockingReasons: string[];
  waiverApplied?: boolean;
  waiverReason?: string;
}

export interface ContractRecord extends RepoRef {
  id: string;
  issueNumber: number;
  version: number;
  status: ContractStatus;
  generatedBy: string;
  approvedBy?: string;
  content: ContributionContract;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionPacketRecord extends RepoRef {
  id: string;
  pullRequestNumber: number;
  linkedContractId?: string;
  generatedBy: string;
  content: DecisionPacket;
  createdAt: string;
}

export interface JobRunRecord {
  id: string;
  type: PatchPactJob["type"];
  dedupeKey: string;
  status: "queued" | "processing" | "completed" | "failed";
  payload: PatchPactJob;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface PatchPactCheckResult {
  title: string;
  summary: string;
  conclusion: "success" | "neutral" | "action_required" | "failure";
}

export interface ContractCommand {
  kind: "contract";
  action: "create" | "refresh" | "approve" | "waive";
  argumentText?: string;
}

export interface PacketCommand {
  kind: "packet";
  action: "explain";
}

export type PatchPactCommand = ContractCommand | PacketCommand;

export type PatchPactJob =
  | {
      type: "sync-installation";
      installationId: number;
      owner: string;
      repo: string;
    }
  | {
      type: "create-contract";
      owner: string;
      repo: string;
      installationId?: number;
      issueNumber: number;
      requestedBy: string;
    }
  | {
      type: "refresh-contract";
      owner: string;
      repo: string;
      installationId?: number;
      issueNumber: number;
      requestedBy: string;
    }
  | {
      type: "approve-contract";
      owner: string;
      repo: string;
      issueNumber: number;
      requestedBy: string;
    }
  | {
      type: "waive-contract";
      owner: string;
      repo: string;
      issueNumber: number;
      requestedBy: string;
      pullRequestNumber?: number;
      reason?: string;
    }
  | {
      type: "generate-decision-packet";
      owner: string;
      repo: string;
      installationId?: number;
      pullRequestNumber: number;
      requestedBy: string;
    }
  | {
      type: "explain-decision-packet";
      owner: string;
      repo: string;
      pullRequestNumber: number;
      requestedBy: string;
    }
  | {
      type: "sync-repository-knowledge";
      owner: string;
      repo: string;
      installationId?: number;
      requestedBy: string;
    };

export interface ArtifactStore {
  upsertRepository(
    input: Pick<RepositoryRecord, "owner" | "repo" | "installationId" | "config">,
  ): Promise<RepositoryRecord>;
  getRepository(owner: string, repo: string): Promise<RepositoryRecord | null>;
  listRepositories(): Promise<RepositoryRecord[]>;
  saveRepositoryConfig(
    owner: string,
    repo: string,
    config: PatchPactConfig,
  ): Promise<RepositoryRecord>;
  saveContract(
    input: Omit<ContractRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<ContractRecord>;
  getLatestContract(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<ContractRecord | null>;
  getApprovedContract(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<ContractRecord | null>;
  listContracts(
    owner: string,
    repo: string,
    issueNumber?: number,
  ): Promise<ContractRecord[]>;
  updateContractStatus(
    id: string,
    status: ContractStatus,
    actor?: string,
  ): Promise<ContractRecord | null>;
  saveDecisionPacket(
    input: Omit<DecisionPacketRecord, "id" | "createdAt">,
  ): Promise<DecisionPacketRecord>;
  getLatestDecisionPacket(
    owner: string,
    repo: string,
    pullRequestNumber: number,
  ): Promise<DecisionPacketRecord | null>;
  listDecisionPackets(
    owner: string,
    repo: string,
    pullRequestNumber?: number,
  ): Promise<DecisionPacketRecord[]>;
  saveJobRun(input: Omit<JobRunRecord, "createdAt" | "updatedAt">): Promise<void>;
  updateJobRun(
    dedupeKey: string,
    status: JobRunRecord["status"],
    error?: string,
  ): Promise<void>;
  listJobRuns(limit?: number): Promise<JobRunRecord[]>;
  getJobRun(dedupeKey: string): Promise<JobRunRecord | null>;
  countKnowledgeChunks(owner: string, repo: string): Promise<number>;
  saveWaiver(input: {
    owner: string;
    repo: string;
    targetType: "issue" | "pull_request";
    targetNumber: number;
    requestedBy: string;
    reason?: string;
  }): Promise<WaiverRecord>;
  getLatestWaiver(
    owner: string,
    repo: string,
    targetType: "issue" | "pull_request",
    targetNumber: number,
  ): Promise<WaiverRecord | null>;
  listWaivers(
    owner: string,
    repo: string,
    targetType?: "issue" | "pull_request",
    targetNumber?: number,
  ): Promise<WaiverRecord[]>;
  replaceKnowledgeChunks(
    owner: string,
    repo: string,
    chunks: Array<{
      path: string;
      chunkIndex: number;
      content: string;
      contentHash: string;
    }>,
  ): Promise<void>;
  searchKnowledgeChunks(
    owner: string,
    repo: string,
    query: string,
    limit?: number,
  ): Promise<RepositoryKnowledgeChunk[]>;
}

export interface GitHubPlatform {
  fetchRepositoryConfig(owner: string, repo: string): Promise<string | null>;
  fetchRepositoryDocuments(input: {
    owner: string;
    repo: string;
    installationId?: number;
  }): Promise<RepositoryDocument[]>;
  fetchIssueContext(input: {
    owner: string;
    repo: string;
    issueNumber: number;
    installationId?: number;
  }): Promise<IssueContext>;
  fetchPullRequestContext(input: {
    owner: string;
    repo: string;
    pullRequestNumber: number;
    installationId?: number;
  }): Promise<PullRequestContext>;
  addIssueComment(input: {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
  }): Promise<void>;
  upsertCheckRun(input: {
    owner: string;
    repo: string;
    pullRequestNumber: number;
    headSha: string;
    result: PatchPactCheckResult;
  }): Promise<void>;
}

export interface WaiverRecord extends RepoRef {
  id: string;
  targetType: "issue" | "pull_request";
  targetNumber: number;
  requestedBy: string;
  reason?: string;
  createdAt: string;
}

export interface ModelProvider {
  readonly name: string;
  generateContract(input: {
    config: PatchPactConfig;
    issue: IssueContext;
    prompt: string;
  }): Promise<ContributionContract>;
  generateDecisionPacket(input: {
    config: PatchPactConfig;
    pullRequest: PullRequestContext;
    contract: ContributionContract | null;
    prompt: string;
  }): Promise<DecisionPacket>;
}

export interface JobBus {
  enqueue(job: PatchPactJob, dedupeKey: string): Promise<boolean>;
}
