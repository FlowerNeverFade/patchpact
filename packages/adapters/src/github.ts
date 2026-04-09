import crypto from "node:crypto";
import { Octokit } from "@octokit/rest";
import type {
  ChangedFile,
  GitHubPlatform,
  IssueContext,
  PatchPactCheckResult,
  PullRequestContext,
  RepositoryDocument,
  RepositoryPullRequestSummary,
} from "@patchpact/core";

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n");
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createGitHubAppJwt(appId: string, privateKey: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 600,
      iss: appId,
    }),
  );
  const data = `${header}.${payload}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(data)
    .sign(normalizePrivateKey(privateKey), "base64url");
  return `${data}.${signature}`;
}

function decodeFileContent(content?: string): string {
  if (!content) {
    return "";
  }
  return Buffer.from(content, "base64").toString("utf8");
}

function extractIssueReferences(...texts: Array<string | null | undefined>): number[] {
  const joined = texts.filter(Boolean).join("\n");
  const references = new Set<number>();
  for (const match of joined.matchAll(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#(\d+)/gi)) {
    references.add(Number(match[1]));
  }
  for (const match of joined.matchAll(/#(\d+)/g)) {
    references.add(Number(match[1]));
  }
  return [...references];
}

function extractManualContractLink(
  ...texts: Array<string | null | undefined>
): number | undefined {
  const joined = texts.filter(Boolean).join("\n");
  const patterns = [
    /patchpact-contract\s*:\s*#?(\d+)/i,
    /patchpact\s+contract\s*:\s*#?(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = joined.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }
  return undefined;
}

function summarizeText(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ").slice(0, 180);
}

async function fetchInstallationToken(appId: string, privateKey: string, installationId: number) {
  const jwt = createGitHubAppJwt(appId, privateKey);
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${jwt}`,
        "user-agent": "patchpact",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Unable to fetch installation token: ${response.status}`);
  }
  const json = (await response.json()) as { token: string };
  return json.token as string;
}

interface ContentEntry {
  path: string;
  type: string;
}

export class GitHubApiPlatform implements GitHubPlatform {
  private readonly installationMap = new Map<string, number>();
  private readonly readonlyClient = new Octokit({ userAgent: "patchpact" });

  constructor(
    private readonly options: {
      appId?: string;
      privateKey?: string;
    } = {},
  ) {}

  rememberInstallation(owner: string, repo: string, installationId: number): void {
    this.installationMap.set(`${owner}/${repo}`.toLowerCase(), installationId);
  }

  private async getWriteClient(owner: string, repo: string): Promise<Octokit> {
    const key = `${owner}/${repo}`.toLowerCase();
    const installationId = this.installationMap.get(key);
    if (!installationId || !this.options.appId || !this.options.privateKey) {
      throw new Error(
        `Missing GitHub installation or app credentials for ${owner}/${repo}.`,
      );
    }
    const token = await fetchInstallationToken(
      this.options.appId,
      this.options.privateKey,
      installationId,
    );
    return new Octokit({ auth: token, userAgent: "patchpact" });
  }

  private async tryGetContent(
    owner: string,
    repo: string,
    path: string,
  ): Promise<any | null> {
    try {
      const result = await this.readonlyClient.repos.getContent({ owner, repo, path });
      return result.data;
    } catch {
      return null;
    }
  }

  private async listDirectory(
    owner: string,
    repo: string,
    path: string,
  ): Promise<ContentEntry[]> {
    const data = await this.tryGetContent(owner, repo, path);
    return Array.isArray(data)
      ? data
          .filter((entry): entry is ContentEntry => Boolean(entry?.path && entry?.type))
          .map((entry) => ({ path: entry.path, type: entry.type }))
      : [];
  }

  async fetchRepositoryDocuments(input: {
    owner: string;
    repo: string;
    installationId?: number;
  }): Promise<RepositoryDocument[]> {
    if (input.installationId) {
      this.rememberInstallation(input.owner, input.repo, input.installationId);
    }

    const owner = input.owner;
    const repo = input.repo;
    const documents: RepositoryDocument[] = [];
    const candidatePaths = new Set<string>([
      "README.md",
      "CONTRIBUTING.md",
      "CODEOWNERS",
      ".github/CODEOWNERS",
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".github/PULL_REQUEST_TEMPLATE.md.tmpl",
      ".github/pull_request_template.md",
    ]);

    const [rootEntries, docsEntries, githubEntries, issueTemplateEntries] = await Promise.all([
      this.listDirectory(owner, repo, ""),
      this.listDirectory(owner, repo, "docs"),
      this.listDirectory(owner, repo, ".github"),
      this.listDirectory(owner, repo, ".github/ISSUE_TEMPLATE"),
    ]);

    for (const entry of rootEntries) {
      if (entry.type === "file" && /\.(md|mdx|txt|rst|ya?ml)$/i.test(entry.path)) {
        candidatePaths.add(entry.path);
      }
    }
    for (const entry of docsEntries) {
      if (entry.type === "file") {
        candidatePaths.add(entry.path);
      }
    }
    for (const entry of githubEntries) {
      if (entry.type === "file" && /(template|codeowners|contributing|support)/i.test(entry.path)) {
        candidatePaths.add(entry.path);
      }
    }
    for (const entry of issueTemplateEntries) {
      if (entry.type === "file") {
        candidatePaths.add(entry.path);
      }
    }

    for (const path of candidatePaths) {
      const data = await this.tryGetContent(owner, repo, path);
      if (data && !Array.isArray(data) && "content" in data) {
        documents.push({ path, content: decodeFileContent(data.content) });
      }
    }

    return documents;
  }

  private async fetchRecentMergedPullRequests(
    owner: string,
    repo: string,
  ): Promise<RepositoryPullRequestSummary[]> {
    const response = await this.readonlyClient.pulls.list({
      owner,
      repo,
      state: "closed",
      per_page: 10,
    });

    return response.data
      .filter((pr) => Boolean(pr.merged_at))
      .slice(0, 5)
      .map((pr) => ({
        number: pr.number,
        title: pr.title,
        mergedAt: pr.merged_at ?? undefined,
        summary: summarizeText(pr.body),
      }));
  }

  async fetchRepositoryConfig(owner: string, repo: string): Promise<string | null> {
    const data = await this.tryGetContent(owner, repo, ".patchpact.yml");
    if (!data || Array.isArray(data) || !("content" in data)) {
      return null;
    }
    return decodeFileContent(data.content);
  }

  async fetchIssueContext(input: {
    owner: string;
    repo: string;
    issueNumber: number;
    installationId?: number;
  }): Promise<IssueContext> {
    if (input.installationId) {
      this.rememberInstallation(input.owner, input.repo, input.installationId);
    }

    const [issueResponse, documents, recentMergedPullRequests, recentClosedIssuesResponse] =
      await Promise.all([
        this.readonlyClient.issues.get({
          owner: input.owner,
          repo: input.repo,
          issue_number: input.issueNumber,
        }),
        this.fetchRepositoryDocuments({
          owner: input.owner,
          repo: input.repo,
          installationId: input.installationId,
        }),
        this.fetchRecentMergedPullRequests(input.owner, input.repo),
        this.readonlyClient.issues.listForRepo({
          owner: input.owner,
          repo: input.repo,
          state: "closed",
          per_page: 8,
        }),
      ]);

    return {
      owner: input.owner,
      repo: input.repo,
      installationId: input.installationId,
      issueNumber: input.issueNumber,
      title: issueResponse.data.title,
      body: issueResponse.data.body ?? "",
      author: issueResponse.data.user?.login ?? "unknown",
      labels: issueResponse.data.labels.map((label) =>
        typeof label === "string" ? label : label.name ?? "unknown",
      ),
      documents,
      recentMergedPullRequests,
      recentClosedIssues: recentClosedIssuesResponse.data
        .filter((issue) => !issue.pull_request && issue.number !== input.issueNumber)
        .slice(0, 5)
        .map((issue) => ({
          number: issue.number,
          title: issue.title,
          summary: summarizeText(issue.body),
        })),
    };
  }

  async fetchPullRequestContext(input: {
    owner: string;
    repo: string;
    pullRequestNumber: number;
    installationId?: number;
  }): Promise<PullRequestContext> {
    if (input.installationId) {
      this.rememberInstallation(input.owner, input.repo, input.installationId);
    }

    const [prResponse, filesResponse, documents, recentMergedPullRequests] =
      await Promise.all([
        this.readonlyClient.pulls.get({
          owner: input.owner,
          repo: input.repo,
          pull_number: input.pullRequestNumber,
        }),
        this.readonlyClient.pulls.listFiles({
          owner: input.owner,
          repo: input.repo,
          pull_number: input.pullRequestNumber,
          per_page: 100,
        }),
        this.fetchRepositoryDocuments({
          owner: input.owner,
          repo: input.repo,
          installationId: input.installationId,
        }),
        this.fetchRecentMergedPullRequests(input.owner, input.repo),
      ]);

    return {
      owner: input.owner,
      repo: input.repo,
      installationId: input.installationId,
      pullRequestNumber: input.pullRequestNumber,
      title: prResponse.data.title,
      body: prResponse.data.body ?? "",
      author: prResponse.data.user?.login ?? "unknown",
      headSha: prResponse.data.head.sha,
      baseRef: prResponse.data.base.ref,
      labels: prResponse.data.labels.map((label) => label.name),
      documents,
      referencedIssueNumbers: extractIssueReferences(
        prResponse.data.title,
        prResponse.data.body ?? "",
      ),
      linkedContractIssueNumber: extractManualContractLink(
        prResponse.data.title,
        prResponse.data.body ?? "",
      ),
      changedFiles: filesResponse.data.map(
        (file): ChangedFile => ({
          path: file.filename,
          status: file.status as ChangedFile["status"],
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
        }),
      ),
      recentMergedPullRequests,
    };
  }

  async addIssueComment(input: {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
  }): Promise<void> {
    const client = await this.getWriteClient(input.owner, input.repo);
    await client.issues.createComment({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.issueNumber,
      body: input.body.slice(0, 60_000),
    });
  }

  async upsertCheckRun(input: {
    owner: string;
    repo: string;
    pullRequestNumber: number;
    headSha: string;
    result: PatchPactCheckResult;
  }): Promise<void> {
    const client = await this.getWriteClient(input.owner, input.repo);
    await client.checks.create({
      owner: input.owner,
      repo: input.repo,
      name: "PatchPact",
      head_sha: input.headSha,
      status: "completed",
      conclusion: input.result.conclusion,
      output: {
        title: input.result.title,
        summary: input.result.summary,
      },
    });
  }
}

export interface SeedIssue {
  number: number;
  title: string;
  body: string;
  author: string;
  labels?: string[];
}

export interface SeedPullRequest {
  number: number;
  title: string;
  body: string;
  author: string;
  headSha: string;
  baseRef: string;
  labels?: string[];
  changedFiles: ChangedFile[];
}

export interface SeedRepository {
  owner: string;
  repo: string;
  configText?: string;
  documents?: RepositoryDocument[];
  issues?: SeedIssue[];
  pullRequests?: SeedPullRequest[];
  recentMergedPullRequests?: RepositoryPullRequestSummary[];
}

export class MemoryGitHubPlatform implements GitHubPlatform {
  readonly comments: Array<{ owner: string; repo: string; issueNumber: number; body: string }> =
    [];
  readonly checks: Array<{
    owner: string;
    repo: string;
    pullRequestNumber: number;
    headSha: string;
    result: PatchPactCheckResult;
  }> = [];
  private readonly repositories = new Map<string, SeedRepository>();

  seedRepository(seed: SeedRepository): void {
    this.repositories.set(`${seed.owner}/${seed.repo}`.toLowerCase(), seed);
  }

  private getRepo(owner: string, repo: string): SeedRepository {
    const record = this.repositories.get(`${owner}/${repo}`.toLowerCase());
    if (!record) {
      throw new Error(`Unknown test repository ${owner}/${repo}`);
    }
    return record;
  }

  async fetchRepositoryConfig(owner: string, repo: string): Promise<string | null> {
    return this.getRepo(owner, repo).configText ?? null;
  }

  async fetchRepositoryDocuments(input: {
    owner: string;
    repo: string;
    installationId?: number;
  }): Promise<RepositoryDocument[]> {
    return this.getRepo(input.owner, input.repo).documents ?? [];
  }

  async fetchIssueContext(input: {
    owner: string;
    repo: string;
    issueNumber: number;
    installationId?: number;
  }): Promise<IssueContext> {
    const repo = this.getRepo(input.owner, input.repo);
    const issue = repo.issues?.find((entry) => entry.number === input.issueNumber);
    if (!issue) {
      throw new Error(`Unknown seeded issue #${input.issueNumber}`);
    }
    return {
      owner: input.owner,
      repo: input.repo,
      installationId: input.installationId,
      issueNumber: issue.number,
      title: issue.title,
      body: issue.body,
      author: issue.author,
      labels: issue.labels ?? [],
      documents: repo.documents ?? [],
      recentMergedPullRequests: repo.recentMergedPullRequests ?? [],
      recentClosedIssues: (repo.issues ?? [])
        .filter((entry) => entry.number !== issue.number)
        .slice(0, 3)
        .map((entry) => ({
          number: entry.number,
          title: entry.title,
          summary: summarizeText(entry.body),
        })),
    };
  }

  async fetchPullRequestContext(input: {
    owner: string;
    repo: string;
    pullRequestNumber: number;
    installationId?: number;
  }): Promise<PullRequestContext> {
    const repo = this.getRepo(input.owner, input.repo);
    const pr = repo.pullRequests?.find((entry) => entry.number === input.pullRequestNumber);
    if (!pr) {
      throw new Error(`Unknown seeded pull request #${input.pullRequestNumber}`);
    }
    return {
      owner: input.owner,
      repo: input.repo,
      installationId: input.installationId,
      pullRequestNumber: pr.number,
      title: pr.title,
      body: pr.body,
      author: pr.author,
      headSha: pr.headSha,
      baseRef: pr.baseRef,
      labels: pr.labels ?? [],
      changedFiles: pr.changedFiles,
      documents: repo.documents ?? [],
      referencedIssueNumbers: extractIssueReferences(pr.title, pr.body),
      linkedContractIssueNumber: extractManualContractLink(pr.title, pr.body),
      recentMergedPullRequests: repo.recentMergedPullRequests ?? [],
    };
  }

  async addIssueComment(input: {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
  }): Promise<void> {
    this.comments.push(input);
  }

  async upsertCheckRun(input: {
    owner: string;
    repo: string;
    pullRequestNumber: number;
    headSha: string;
    result: PatchPactCheckResult;
  }): Promise<void> {
    this.checks.push(input);
  }
}
