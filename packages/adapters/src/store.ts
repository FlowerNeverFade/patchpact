import { Pool } from "pg";
import type { ArtifactStore } from "@patchpact/core";
import { type PatchPactEnv } from "./env.js";
import { MemoryArtifactStore } from "./store-memory.js";
import { PostgresArtifactStore } from "./store-postgres.js";

export function createArtifactStore(env: PatchPactEnv): ArtifactStore {
  if (env.PATCHPACT_STORAGE === "postgres") {
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required when PATCHPACT_STORAGE=postgres");
    }
    return new PostgresArtifactStore(new Pool({ connectionString: env.DATABASE_URL }));
  }
  return new MemoryArtifactStore();
}

export { MemoryArtifactStore, PostgresArtifactStore };
