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

export function parseEnv(source: NodeJS.ProcessEnv = process.env): PatchPactEnv {
  return patchPactEnvSchema.parse(source);
}
