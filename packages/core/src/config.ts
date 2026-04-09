import { load } from "js-yaml";
import { patchPactConfigSchema, type PatchPactConfig } from "./types.js";

export const defaultPatchPactConfig: PatchPactConfig = patchPactConfigSchema.parse(
  {},
);

export function parsePatchPactConfig(text: string): PatchPactConfig {
  const loaded = load(text);
  if (!loaded || typeof loaded !== "object") {
    return defaultPatchPactConfig;
  }

  const raw = loaded as Record<string, unknown>;
  return patchPactConfigSchema.parse({
    mode: raw.mode,
    requiredContractSections: raw.required_contract_sections,
    docsGlobs: raw.docs_globs,
    testGlobs: raw.test_globs,
    provider: raw.provider,
    model: raw.model,
    repoRules: raw.repo_rules,
  });
}

export function mergePatchPactConfig(
  base: PatchPactConfig,
  override?: Partial<PatchPactConfig>,
): PatchPactConfig {
  return patchPactConfigSchema.parse({
    ...base,
    ...override,
  });
}
