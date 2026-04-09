import { describe, expect, it } from "vitest";
import { buildGitHubAppManifest, getRuntimeReadiness, parseEnv } from "../src/env.js";

describe("runtime readiness", () => {
  it("reports missing production prerequisites", () => {
    const env = parseEnv({
      PATCHPACT_BASE_URL: "http://localhost:3000",
      PATCHPACT_STORAGE: "postgres",
      PATCHPACT_INLINE_JOBS: "false",
      PATCHPACT_DEFAULT_PROVIDER: "openai-compatible",
      PATCHPACT_GITHUB_WEBHOOK_SECRET: "secret",
    });

    const readiness = getRuntimeReadiness(env);

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.some((check) => check.label === "GitHub App credentials" && !check.ready)).toBe(true);
    expect(readiness.checks.some((check) => check.label === "Queue backend" && !check.ready)).toBe(true);
  });

  it("treats mock mode and memory mode as ready for local development", () => {
    const env = parseEnv({
      PATCHPACT_BASE_URL: "http://localhost:3000",
      PATCHPACT_STORAGE: "memory",
      PATCHPACT_INLINE_JOBS: "true",
      PATCHPACT_DEFAULT_PROVIDER: "mock",
      PATCHPACT_GITHUB_WEBHOOK_SECRET: "secret",
      PATCHPACT_GITHUB_APP_ID: "123",
      PATCHPACT_GITHUB_PRIVATE_KEY: "private-key",
    });

    const readiness = getRuntimeReadiness(env);

    expect(readiness.ready).toBe(true);
  });

  it("builds a GitHub App manifest from env defaults", () => {
    const env = parseEnv({
      PATCHPACT_BASE_URL: "https://patchpact.example.com",
      PATCHPACT_GITHUB_APP_NAME: "PatchPact Production",
      PATCHPACT_GITHUB_APP_DESCRIPTION: "Contract-first GitHub App",
      PATCHPACT_GITHUB_APP_PUBLIC: "true",
      PATCHPACT_GITHUB_WEBHOOK_SECRET: "secret",
    });

    const manifest = buildGitHubAppManifest(env);

    expect(manifest.name).toBe("PatchPact Production");
    expect(manifest.public).toBe(true);
    expect(manifest.hook_attributes.url).toBe(
      "https://patchpact.example.com/webhooks/github",
    );
    expect(manifest.default_events).toContain("pull_request_review");
  });
});
