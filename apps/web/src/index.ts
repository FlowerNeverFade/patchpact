import { PatchPactEngine, type PatchPactJob } from "@patchpact/core";
import {
  BullMQJobBus,
  GitHubApiPlatform,
  InlineJobBus,
  createArtifactStore,
  createModelProvider,
  parseEnv,
} from "@patchpact/adapters";
import { createWebApp } from "./app.js";

async function main() {
  const env = parseEnv(process.env);
  const store = createArtifactStore(env);
  const github = new GitHubApiPlatform({
    appId: env.PATCHPACT_GITHUB_APP_ID,
    privateKey: env.PATCHPACT_GITHUB_PRIVATE_KEY,
  });
  const model = createModelProvider(env);
  const jobs = env.PATCHPACT_INLINE_JOBS
    ? new InlineJobBus()
    : new BullMQJobBus(
        env.REDIS_URL ??
          (() => {
            throw new Error("REDIS_URL is required when PATCHPACT_INLINE_JOBS=false");
          })(),
      );

  const engine = new PatchPactEngine({
    store,
    github,
    model,
    jobs,
  });

  if (jobs instanceof InlineJobBus) {
    jobs.setHandler((job: PatchPactJob, dedupeKey: string) =>
      engine.runJob(job, dedupeKey),
    );
  }

  const app = createWebApp({
    env,
    engine,
    store,
    github,
  });

  app.listen(env.PORT, () => {
    console.log(`PatchPact web listening on ${env.PATCHPACT_BASE_URL}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
