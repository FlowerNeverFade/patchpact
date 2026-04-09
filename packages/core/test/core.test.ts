import { describe, expect, it } from "vitest";
import {
  buildDecisionPacketPrompt,
  defaultPatchPactConfig,
  generateContractHeuristically,
  generateDecisionPacketHeuristically,
  parsePatchPactConfig,
  parseSlashCommand,
  type IssueContext,
  type PullRequestContext,
} from "../src/index.js";

const issueContext: IssueContext = {
  owner: "acme",
  repo: "patchpact-demo",
  issueNumber: 42,
  title: "Add audit trail to moderation workflow",
  body: `We need a maintainable audit trail for moderation actions.

- Log moderator actions with actor and timestamp
- Keep implementation centered in src/moderation
- Keep the scope to the moderation workflow
- Do not refactor unrelated dashboards`,
  author: "maintainer",
  labels: ["backend", "moderation"],
  documents: [
    {
      path: "README.md",
      content: "PatchPact demo repo",
    },
    {
      path: "CONTRIBUTING.md",
      content: "Tests are expected for behavior changes.",
    },
  ],
  recentMergedPullRequests: [
    {
      number: 30,
      title: "Improve moderation queue ordering",
      summary: "Adjusted ranking logic and tests.",
    },
  ],
  recentClosedIssues: [
    {
      number: 31,
      title: "Clarify moderator logs",
      summary: "Previous docs cleanup.",
    },
  ],
};

describe("core behavior", () => {
  it("parses slash commands and config", () => {
    expect(parseSlashCommand("/contract create")).toEqual({
      kind: "contract",
      action: "create",
    });
    expect(parseSlashCommand("/contract waive maintainer override")).toEqual({
      kind: "contract",
      action: "waive",
      argumentText: "maintainer override",
    });
    expect(
      parsePatchPactConfig(`
mode: soft-gate
provider: ollama
model: qwen2.5-coder:7b
repo_rules:
  - Require tests for user-visible changes
      `),
    ).toMatchObject({
      mode: "soft-gate",
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      repoRules: ["Require tests for user-visible changes"],
    });
  });

  it("creates heuristic contracts and packets", () => {
    const contract = generateContractHeuristically({
      config: defaultPatchPactConfig,
      issue: issueContext,
    });

    const pullRequest: PullRequestContext = {
      owner: "acme",
      repo: "patchpact-demo",
      pullRequestNumber: 77,
      title: "Fixes #42 add moderation audit trail",
      body: "Closes #42\n\nAdds audit logging and tests for moderation actions.",
      author: "contributor",
      headSha: "abc123",
      baseRef: "main",
      labels: ["backend"],
      documents: issueContext.documents,
      referencedIssueNumbers: [42],
      recentMergedPullRequests: issueContext.recentMergedPullRequests,
      changedFiles: [
        {
          path: "src/moderation/audit.ts",
          status: "added",
          additions: 80,
          deletions: 0,
        },
        {
          path: "src/moderation/audit.test.ts",
          status: "added",
          additions: 55,
          deletions: 0,
        },
      ],
    };

    const packet = generateDecisionPacketHeuristically({
      config: defaultPatchPactConfig,
      pullRequest,
      contract,
    });

    expect(contract.problemStatement).toContain("maintainable audit trail");
    expect(contract.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(buildDecisionPacketPrompt(defaultPatchPactConfig, pullRequest, contract)).toContain(
      "Approved Contract",
    );
    expect(packet.verdict).toBe("aligned");
    expect(packet.suggestedAction).toBe("merge-ready");
    expect(packet.missingTests).toHaveLength(0);
  });
});
