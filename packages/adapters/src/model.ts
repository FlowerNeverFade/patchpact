import { z } from "zod";
import {
  generateContractHeuristically,
  generateDecisionPacketHeuristically,
  type ContributionContract,
  type DecisionPacket,
  type ModelProvider,
} from "@patchpact/core";
import type { PatchPactEnv } from "./env.js";

const contractSchema = z.object({
  issueNumber: z.number(),
  title: z.string(),
  problemStatement: z.string(),
  scopeBoundaries: z.array(z.string()),
  impactedAreas: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  testExpectations: z.array(z.string()),
  nonGoals: z.array(z.string()),
  repoSignals: z.array(z.string()),
  relatedIssueNumbers: z.array(z.number()),
  rationale: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  suggestedNextStep: z.string(),
});

const decisionPacketSchema = z.object({
  pullRequestNumber: z.number(),
  summary: z.string(),
  contractMatchScore: z.number().min(0).max(100),
  verdict: z.enum(["aligned", "partial", "missing-contract", "misaligned"]),
  risks: z.array(z.string()),
  missingTests: z.array(z.string()),
  relatedArtifacts: z.array(
    z.object({
      type: z.enum(["issue", "pull_request", "document"]),
      identifier: z.string(),
      reason: z.string(),
    }),
  ),
  suggestedAction: z.enum([
    "merge-ready",
    "needs-follow-up",
    "needs-contract",
    "needs-waiver",
  ]),
  confidence: z.enum(["low", "medium", "high"]),
  blockingReasons: z.array(z.string()),
});

async function postJson(url: string, init: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Model provider returned ${response.status} for ${url}`);
  }
  return response.json();
}

function extractJsonCandidate(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]+?)```/i);
  return fenced?.[1]?.trim() ?? text.trim();
}

abstract class BaseRemoteProvider implements ModelProvider {
  abstract readonly name: string;

  protected abstract run(prompt: string): Promise<string>;

  async generateContract(input: {
    config: any;
    issue: any;
    prompt: string;
  }): Promise<ContributionContract> {
    const response = await this.run(
      `${input.prompt}\n\nReturn JSON only for a ContributionContract object.`,
    );
    return contractSchema.parse(JSON.parse(extractJsonCandidate(response)));
  }

  async generateDecisionPacket(input: {
    config: any;
    pullRequest: any;
    contract: any;
    prompt: string;
  }): Promise<DecisionPacket> {
    const response = await this.run(
      `${input.prompt}\n\nReturn JSON only for a DecisionPacket object.`,
    );
    return decisionPacketSchema.parse(JSON.parse(extractJsonCandidate(response)));
  }
}

class OpenAICompatibleProvider extends BaseRemoteProvider {
  readonly name = "openai-compatible";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {
    super();
  }

  protected async run(prompt: string): Promise<string> {
    const json = await postJson(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are PatchPact. Return strict JSON only, with no markdown explanation.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });
    return json.choices?.[0]?.message?.content ?? "{}";
  }
}

class AnthropicProvider extends BaseRemoteProvider {
  readonly name = "anthropic";

  constructor(private readonly apiKey: string, private readonly model: string) {
    super();
  }

  protected async run(prompt: string): Promise<string> {
    const json = await postJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2_000,
        temperature: 0.1,
        system: "You are PatchPact. Return strict JSON only.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const textPart = json.content?.find((item: any) => item.type === "text");
    return textPart?.text ?? "{}";
  }
}

class OllamaProvider extends BaseRemoteProvider {
  readonly name = "ollama";

  constructor(private readonly baseUrl: string, private readonly model: string) {
    super();
  }

  protected async run(prompt: string): Promise<string> {
    const json = await postJson(`${this.baseUrl}/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model: this.model,
        format: "json",
        stream: false,
        messages: [
          {
            role: "system",
            content: "You are PatchPact. Return strict JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    return json.message?.content ?? "{}";
  }
}

export class MockModelProvider implements ModelProvider {
  readonly name = "mock";

  async generateContract(input: {
    config: any;
    issue: any;
    prompt: string;
  }): Promise<ContributionContract> {
    return generateContractHeuristically({
      config: input.config,
      issue: input.issue,
    });
  }

  async generateDecisionPacket(input: {
    config: any;
    pullRequest: any;
    contract: any;
    prompt: string;
  }): Promise<DecisionPacket> {
    return generateDecisionPacketHeuristically({
      config: input.config,
      pullRequest: input.pullRequest,
      contract: input.contract,
    });
  }
}

class FallbackModelProvider implements ModelProvider {
  readonly name: string;

  constructor(
    private readonly primary: ModelProvider,
    private readonly fallback = new MockModelProvider(),
  ) {
    this.name = primary.name;
  }

  async generateContract(input: {
    config: any;
    issue: any;
    prompt: string;
  }): Promise<ContributionContract> {
    try {
      return await this.primary.generateContract(input);
    } catch {
      return this.fallback.generateContract(input);
    }
  }

  async generateDecisionPacket(input: {
    config: any;
    pullRequest: any;
    contract: any;
    prompt: string;
  }): Promise<DecisionPacket> {
    try {
      return await this.primary.generateDecisionPacket(input);
    } catch {
      return this.fallback.generateDecisionPacket(input);
    }
  }
}

export function createModelProvider(env: PatchPactEnv): ModelProvider {
  switch (env.PATCHPACT_DEFAULT_PROVIDER) {
    case "openai-compatible":
      if (!env.PATCHPACT_OPENAI_API_KEY) {
        return new MockModelProvider();
      }
      return new FallbackModelProvider(
        new OpenAICompatibleProvider(
          env.PATCHPACT_OPENAI_BASE_URL,
          env.PATCHPACT_OPENAI_API_KEY,
          env.PATCHPACT_OPENAI_MODEL,
        ),
      );
    case "anthropic":
      if (!env.PATCHPACT_ANTHROPIC_API_KEY) {
        return new MockModelProvider();
      }
      return new FallbackModelProvider(
        new AnthropicProvider(
          env.PATCHPACT_ANTHROPIC_API_KEY,
          env.PATCHPACT_ANTHROPIC_MODEL,
        ),
      );
    case "ollama":
      return new FallbackModelProvider(
        new OllamaProvider(env.PATCHPACT_OLLAMA_BASE_URL, env.PATCHPACT_OLLAMA_MODEL),
      );
    default:
      return new MockModelProvider();
  }
}
