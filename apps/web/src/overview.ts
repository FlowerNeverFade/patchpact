import type { ArtifactStore, JobRunRecord, RepositoryRecord } from "@patchpact/core";

export interface RepositoryOnboardingStatus {
  owner: string;
  repo: string;
  installationId?: number;
  status: "needs-installation" | "needs-knowledge-sync" | "active" | "configured";
  knowledgeChunkCount: number;
  contractCount: number;
  packetCount: number;
  waiverCount: number;
  summary: string;
  recommendedActionLabel: string;
  recommendedActionHref: string;
}

export interface RepositoryOnboardingChecklistItem {
  label: string;
  state: "complete" | "attention" | "optional";
  detail: string;
  actionLabel?: string;
  actionHref?: string;
}

export interface RepositoryOnboardingChecklist {
  repository: RepositoryOnboardingStatus;
  latestContractIssueNumber?: number;
  latestPullRequestNumber?: number;
  checklistItems: RepositoryOnboardingChecklistItem[];
  recentFailedJobs: JobRunRecord[];
}

export interface InstanceOverview {
  repositoryCount: number;
  installedRepositoryCount: number;
  activeRepositoryCount: number;
  repositoriesNeedingInstallation: RepositoryOnboardingStatus[];
  repositoriesNeedingKnowledgeSync: RepositoryOnboardingStatus[];
  repositories: RepositoryOnboardingStatus[];
  recentFailedJobs: JobRunRecord[];
}

export async function buildRepositoryOnboardingStatus(
  store: ArtifactStore,
  repo: RepositoryRecord,
): Promise<RepositoryOnboardingStatus> {
  const [contracts, packets, waivers, knowledgeChunkCount] = await Promise.all([
    store.listContracts(repo.owner, repo.repo),
    store.listDecisionPackets(repo.owner, repo.repo),
    store.listWaivers(repo.owner, repo.repo),
    store.countKnowledgeChunks(repo.owner, repo.repo),
  ]);

  const status: RepositoryOnboardingStatus["status"] = !repo.installationId
    ? "needs-installation"
    : knowledgeChunkCount === 0
      ? "needs-knowledge-sync"
      : contracts.length > 0 || packets.length > 0
        ? "active"
        : "configured";

  const repositoryConsoleHref = `/dashboard/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
  const setupChecklistHref = `/setup/repositories/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
  const recommendedAction =
    status === "needs-installation"
      ? {
          label: "Open onboarding checklist",
          href: setupChecklistHref,
          summary: "PatchPact knows about this repository but has not recorded a GitHub App installation yet.",
        }
      : status === "needs-knowledge-sync"
        ? {
            label: "Open onboarding checklist",
            href: setupChecklistHref,
            summary: "The repository is installed but PatchPact has not built its first document knowledge index yet.",
          }
        : status === "active"
          ? {
              label: "Open onboarding checklist",
              href: setupChecklistHref,
              summary: `PatchPact has generated ${contracts.length} contracts and ${packets.length} decision packets for this repository.`,
            }
          : {
              label: "Open onboarding checklist",
              href: setupChecklistHref,
              summary: "The repository is installed and indexed, but PatchPact has not generated maintainer artifacts yet.",
            };

  return {
    owner: repo.owner,
    repo: repo.repo,
    installationId: repo.installationId,
    status,
    knowledgeChunkCount,
    contractCount: contracts.length,
    packetCount: packets.length,
    waiverCount: waivers.length,
    summary: recommendedAction.summary,
    recommendedActionLabel: recommendedAction.label,
    recommendedActionHref: recommendedAction.href,
  };
}

export async function buildInstanceOverview(
  store: ArtifactStore,
): Promise<InstanceOverview> {
  const repositories = await store.listRepositories();
  const statuses = await Promise.all(
    repositories.map((repo) => buildRepositoryOnboardingStatus(store, repo)),
  );
  const recentFailedJobs = (await store.listJobRuns(50)).filter(
    (job) => job.status === "failed",
  );

  const orderedStatuses = [...statuses].sort((left, right) => {
    const order = {
      "needs-installation": 0,
      "needs-knowledge-sync": 1,
      configured: 2,
      active: 3,
    } as const;
    return order[left.status] - order[right.status] || `${left.owner}/${left.repo}`.localeCompare(`${right.owner}/${right.repo}`);
  });

  return {
    repositoryCount: statuses.length,
    installedRepositoryCount: statuses.filter((repo) => Boolean(repo.installationId)).length,
    activeRepositoryCount: statuses.filter((repo) => repo.status === "active").length,
    repositoriesNeedingInstallation: statuses.filter(
      (repo) => repo.status === "needs-installation",
    ),
    repositoriesNeedingKnowledgeSync: statuses.filter(
      (repo) => repo.status === "needs-knowledge-sync",
    ),
    repositories: orderedStatuses,
    recentFailedJobs,
  };
}

export async function buildRepositoryOnboardingChecklist(
  store: ArtifactStore,
  owner: string,
  repo: string,
): Promise<RepositoryOnboardingChecklist | null> {
  const repository = await store.getRepository(owner, repo);
  if (!repository) {
    return null;
  }

  const [status, contracts, packets] = await Promise.all([
    buildRepositoryOnboardingStatus(store, repository),
    store.listContracts(owner, repo),
    store.listDecisionPackets(owner, repo),
  ]);
  const repositoryConsoleHref = `/dashboard/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const recentFailedJobs = (await store.listJobRuns(50)).filter((job) => {
    const payload = job.payload as Partial<{ owner: string; repo: string }>;
    return job.status === "failed" && payload.owner === owner && payload.repo === repo;
  });

  const checklistItems: RepositoryOnboardingChecklistItem[] = [
    {
      label: "GitHub App installation",
      state: status.installationId ? "complete" : "attention",
      detail: status.installationId
        ? `Installation recorded with id ${status.installationId}.`
        : "PatchPact has not recorded a GitHub App installation for this repository yet.",
      actionLabel: status.installationId ? "Open repository console" : "Open setup guide",
      actionHref: status.installationId ? repositoryConsoleHref : "/setup",
    },
    {
      label: "Initial knowledge sync",
      state: status.knowledgeChunkCount > 0 ? "complete" : "attention",
      detail:
        status.knowledgeChunkCount > 0
          ? `PatchPact indexed ${status.knowledgeChunkCount} knowledge chunks for this repository.`
          : "Run an initial knowledge sync so PatchPact can ground contracts and decision packets in repository docs.",
      actionLabel: "Open repository console",
      actionHref: repositoryConsoleHref,
    },
    {
      label: "Repository policy review",
      state:
        repository.config.repoRules.length > 0 || repository.config.mode === "soft-gate"
          ? "complete"
          : "optional",
      detail:
        repository.config.repoRules.length > 0
          ? `Repository policy contains ${repository.config.repoRules.length} custom rule(s).`
          : "No custom repository rules are configured yet. PatchPact will rely on defaults until you add them.",
      actionLabel: "Review repository policy",
      actionHref: repositoryConsoleHref,
    },
    {
      label: "Contract generation",
      state: status.contractCount > 0 ? "complete" : "optional",
      detail:
        status.contractCount > 0
          ? `PatchPact has already generated ${status.contractCount} contract artifact(s).`
          : "No contracts have been generated for this repository yet.",
      actionLabel: "Open repository console",
      actionHref: repositoryConsoleHref,
    },
    {
      label: "Decision packet generation",
      state: status.packetCount > 0 ? "complete" : "optional",
      detail:
        status.packetCount > 0
          ? `PatchPact has generated ${status.packetCount} decision packet artifact(s).`
          : "No decision packets have been generated yet.",
      actionLabel: "Open repository console",
      actionHref: repositoryConsoleHref,
    },
    {
      label: "Recent failed jobs",
      state: recentFailedJobs.length ? "attention" : "complete",
      detail: recentFailedJobs.length
        ? `PatchPact recorded ${recentFailedJobs.length} failed job(s) for this repository recently.`
        : "No failed jobs are currently associated with this repository.",
      actionLabel: recentFailedJobs.length ? "Review failed jobs" : "Open repository console",
      actionHref: recentFailedJobs.length
        ? `/dashboard/jobs/${encodeURIComponent(recentFailedJobs[0]!.dedupeKey)}`
        : repositoryConsoleHref,
    },
  ];

  return {
    repository: status,
    latestContractIssueNumber: contracts[0]?.issueNumber,
    latestPullRequestNumber: packets[0]?.pullRequestNumber,
    checklistItems,
    recentFailedJobs,
  };
}
