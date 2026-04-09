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

  return {
    owner: repo.owner,
    repo: repo.repo,
    installationId: repo.installationId,
    status,
    knowledgeChunkCount,
    contractCount: contracts.length,
    packetCount: packets.length,
    waiverCount: waivers.length,
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
    repositories: statuses,
    recentFailedJobs,
  };
}
