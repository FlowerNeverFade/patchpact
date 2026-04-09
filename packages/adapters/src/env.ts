import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      return ["1", "true", "yes", "on"].includes(value.toLowerCase());
    }
    return false;
  });

export const patchPactEnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3000),
  PATCHPACT_BASE_URL: z.string().url().default("http://localhost:3000"),
  PATCHPACT_GITHUB_APP_NAME: z.string().default("PatchPact"),
  PATCHPACT_GITHUB_APP_DESCRIPTION: z
    .string()
    .default("Contract-first GitHub App for open source maintainers."),
  PATCHPACT_GITHUB_APP_PUBLIC: booleanFromString.default(false),
  PATCHPACT_INLINE_JOBS: booleanFromString.default(true),
  PATCHPACT_STORAGE: z.enum(["memory", "postgres"]).default("memory"),
  PATCHPACT_GITHUB_APP_ID: z.string().optional(),
  PATCHPACT_GITHUB_WEBHOOK_SECRET: z.string().default("development-secret"),
  PATCHPACT_GITHUB_PRIVATE_KEY: z.string().optional(),
  PATCHPACT_GITHUB_CLIENT_ID: z.string().optional(),
  PATCHPACT_GITHUB_CLIENT_SECRET: z.string().optional(),
  PATCHPACT_DEFAULT_PROVIDER: z
    .enum(["openai-compatible", "anthropic", "ollama", "mock"])
    .default("mock"),
  PATCHPACT_OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  PATCHPACT_OPENAI_API_KEY: z.string().optional(),
  PATCHPACT_OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  PATCHPACT_ANTHROPIC_API_KEY: z.string().optional(),
  PATCHPACT_ANTHROPIC_MODEL: z.string().default("claude-3-5-sonnet-latest"),
  PATCHPACT_OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  PATCHPACT_OLLAMA_MODEL: z.string().default("qwen2.5-coder:7b"),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
});

export type PatchPactEnv = z.infer<typeof patchPactEnvSchema>;

export interface RuntimeReadinessCheck {
  label: string;
  ready: boolean;
  detail: string;
}

export interface RuntimeReadiness {
  ready: boolean;
  checks: RuntimeReadinessCheck[];
}

export interface GitHubAppManifest {
  name: string;
  url: string;
  description: string;
  public: boolean;
  setup_url: string;
  callback_urls: string[];
  hook_attributes: {
    url: string;
    active: boolean;
  };
  redirect_url?: string;
  request_oauth_on_install: boolean;
  setup_on_update: boolean;
  default_permissions: Record<string, "read" | "write">;
  default_events: string[];
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): PatchPactEnv {
  return patchPactEnvSchema.parse(source);
}

export function loadEnvFiles(baseDir = process.env.INIT_CWD || process.cwd()): void {
  for (const filename of [".env", ".env.local"]) {
    loadEnvFile(resolve(baseDir, filename));
  }
}

export function loadAndParseEnv(source: NodeJS.ProcessEnv = process.env): PatchPactEnv {
  loadEnvFiles();
  return parseEnv(source);
}

export function getRuntimeReadiness(env: PatchPactEnv): RuntimeReadiness {
  const checks: RuntimeReadinessCheck[] = [
    {
      label: "GitHub App credentials",
      ready: Boolean(env.PATCHPACT_GITHUB_APP_ID && env.PATCHPACT_GITHUB_PRIVATE_KEY),
      detail: "Required for posting issue comments and check runs as a GitHub App.",
    },
    {
      label: "Webhook secret",
      ready: Boolean(env.PATCHPACT_GITHUB_WEBHOOK_SECRET),
      detail: "Required for verifying incoming GitHub webhook signatures.",
    },
    {
      label: "Storage backend",
      ready: env.PATCHPACT_STORAGE === "memory" || Boolean(env.DATABASE_URL),
      detail:
        env.PATCHPACT_STORAGE === "memory"
          ? "Memory mode is enabled."
          : "Postgres mode requires DATABASE_URL.",
    },
    {
      label: "Queue backend",
      ready: env.PATCHPACT_INLINE_JOBS || Boolean(env.REDIS_URL),
      detail:
        env.PATCHPACT_INLINE_JOBS
          ? "Inline jobs are enabled."
          : "BullMQ mode requires REDIS_URL.",
    },
    {
      label: "Model provider",
      ready:
        env.PATCHPACT_DEFAULT_PROVIDER === "mock" ||
        env.PATCHPACT_DEFAULT_PROVIDER === "ollama" ||
        (env.PATCHPACT_DEFAULT_PROVIDER === "openai-compatible" &&
          Boolean(env.PATCHPACT_OPENAI_API_KEY)) ||
        (env.PATCHPACT_DEFAULT_PROVIDER === "anthropic" &&
          Boolean(env.PATCHPACT_ANTHROPIC_API_KEY)),
      detail: "Mock and Ollama can run without cloud keys. Cloud providers need their matching API key.",
    },
  ];

  return {
    ready: checks.every((check) => check.ready),
    checks,
  };
}

export function formatRuntimeReadinessSummary(readiness: RuntimeReadiness): string {
  const issues = readiness.checks
    .filter((check) => !check.ready)
    .map((check) => `${check.label}: ${check.detail}`);
  return issues.length
    ? `PatchPact runtime has missing prerequisites:\n- ${issues.join("\n- ")}`
    : "PatchPact runtime prerequisites are satisfied.";
}

export function buildGitHubAppManifest(env: PatchPactEnv): GitHubAppManifest {
  const baseUrl = env.PATCHPACT_BASE_URL.replace(/\/$/, "");
  const setupUrl = `${baseUrl}/setup`;
  const webhookUrl = `${baseUrl}/webhooks/github`;

  return {
    name: env.PATCHPACT_GITHUB_APP_NAME,
    url: baseUrl,
    description: env.PATCHPACT_GITHUB_APP_DESCRIPTION,
    public: env.PATCHPACT_GITHUB_APP_PUBLIC,
    setup_url: setupUrl,
    callback_urls: [setupUrl],
    hook_attributes: {
      url: webhookUrl,
      active: true,
    },
    request_oauth_on_install: false,
    setup_on_update: true,
    default_permissions: {
      issues: "write",
      pull_requests: "write",
      checks: "write",
      contents: "read",
      metadata: "read",
    },
    default_events: [
      "installation",
      "issues",
      "issue_comment",
      "pull_request",
      "pull_request_review",
      "push",
    ],
  };
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) {
    return;
  }

  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice("export ".length) : line;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, equalsIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = normalized.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      }
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }

    process.env[key] = value;
  }
}
