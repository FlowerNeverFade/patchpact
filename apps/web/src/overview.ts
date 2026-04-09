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
  const recommendedAction =
    status === "needs-installation"
      ? {
          label: "Open setup guide",
          href: "/setup",
          summary: "PatchPact knows about this repository but has not recorded a GitHub App installation yet.",
        }
      : status === "needs-knowledge-sync"
        ? {
            label: "Sync knowledge",
            href: `${repositoryConsoleHref}?q=`,
            summary: "The repository is installed but PatchPact has not built its first document knowledge index yet.",
          }
        : status === "active"
          ? {
              label: "Open repository console",
              href: repositoryConsoleHref,
              summary: `PatchPact has generated ${contracts.length} contracts and ${packets.length} decision packets for this repository.`,
            }
          : {
              label: "Review repository console",
              href: repositoryConsoleHref,
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
