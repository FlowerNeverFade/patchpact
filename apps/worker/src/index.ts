import { PatchPactEngine, type PatchPactJob } from "@patchpact/core";
import {
  formatRuntimeReadinessSummary,
  GitHubApiPlatform,
  InlineJobBus,
  createArtifactStore,
  createModelProvider,
  getRuntimeReadiness,
  loadAndParseEnv,
  startBullWorker,
} from "@patchpact/adapters";

async function main() {
  const env = loadAndParseEnv(process.env);
  const readiness = getRuntimeReadiness(env);
  if (env.PATCHPACT_INLINE_JOBS) {
    console.log(
      "PatchPact worker is idle because PATCHPACT_INLINE_JOBS=true. Set it to false with REDIS_URL to use BullMQ.",
    );
    return;
  }
  if (!env.REDIS_URL) {
    throw new Error("REDIS_URL is required when running the worker.");
  }

  const store = createArtifactStore(env);
  const github = new GitHubApiPlatform({
    appId: env.PATCHPACT_GITHUB_APP_ID,
    privateKey: env.PATCHPACT_GITHUB_PRIVATE_KEY,
  });
  const model = createModelProvider(env);
  const engine = new PatchPactEngine({
    store,
    github,
    model,
    jobs: new InlineJobBus(),
  });

  const worker = startBullWorker(env.REDIS_URL, (job: PatchPactJob, dedupeKey: string) =>
    engine.runJob(job, dedupeKey),
  );

  worker.on("completed", (job: { name: string; id?: string }) => {
    console.log(`Completed ${job.name} (${job.id})`);
  });
  worker.on("failed", (job: { name?: string; id?: string } | undefined, error: Error) => {
    console.error(`Failed ${job?.name ?? "job"} (${job?.id ?? "unknown"}):`, error);
  });

  console.log("PatchPact worker is listening for jobs.");
  console.log(formatRuntimeReadinessSummary(readiness));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
