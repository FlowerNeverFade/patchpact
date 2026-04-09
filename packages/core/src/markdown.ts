import type {
  ContractRecord,
  DecisionPacketRecord,
  PatchPactConfig,
} from "./types.js";

function section(title: string, items: string[]): string {
  if (!items.length) {
    return `### ${title}\n- None recorded\n`;
  }
  return `### ${title}\n${items.map((item) => `- ${item}`).join("\n")}\n`;
}

export function renderContractComment(
  contract: ContractRecord,
  config: PatchPactConfig,
): string {
  const c = contract.content;
  return [
    `## PatchPact Contribution Contract v${contract.version}`,
    "",
    `Status: **${contract.status}**`,
    `Mode: **${config.mode}**`,
    `Confidence: **${c.confidence}**`,
    "",
    "### Problem Statement",
    c.problemStatement,
    "",
    section("Scope Boundaries", c.scopeBoundaries),
    section("Impacted Areas", c.impactedAreas),
    section("Acceptance Criteria", c.acceptanceCriteria),
    section("Test Expectations", c.testExpectations),
    section("Non Goals", c.nonGoals),
    section("Repository Signals", c.repoSignals),
    "",
    `Suggested next step: ${c.suggestedNextStep}`,
    "",
    "Use `/contract approve` to lock this version, `/contract refresh` after issue changes, or `/contract waive` if the repository needs to proceed without a formal contract.",
  ].join("\n");
}

export function renderDecisionPacketComment(
  packet: DecisionPacketRecord,
  config: PatchPactConfig,
): string {
  const p = packet.content;
  return [
    `## PatchPact Decision Packet for PR #${p.pullRequestNumber}`,
    "",
    `Mode: **${config.mode}**`,
    `Verdict: **${p.verdict}**`,
    `Match score: **${p.contractMatchScore}/100**`,
    `Suggested action: **${p.suggestedAction}**`,
    `Confidence: **${p.confidence}**`,
    ...(p.waiverApplied
      ? [`Waiver: **applied**${p.waiverReason ? ` (${p.waiverReason})` : ""}`]
      : []),
    "",
    "### Summary",
    p.summary,
    "",
    section("Risks", p.risks),
    section("Missing Tests", p.missingTests),
    section(
      "Related Artifacts",
      p.relatedArtifacts.map(
        (artifact) => `${artifact.type} ${artifact.identifier}: ${artifact.reason}`,
      ),
    ),
    section("Blocking Reasons", p.blockingReasons),
    "",
    "Use `/packet explain` on the pull request thread to repost the latest packet on demand.",
  ].join("\n");
}

export function renderContractApprovalComment(contract: ContractRecord): string {
  return [
    `PatchPact locked contract v${contract.version} for issue #${contract.issueNumber}.`,
    "Future PRs can now be checked against this approved contract.",
  ].join("\n");
}

export function renderWaiverComment(
  targetNumber: number,
  requestedBy: string,
  reason?: string,
  targetType: "issue" | "pull_request" = "issue",
): string {
  return [
    `PatchPact recorded a waiver for ${targetType === "issue" ? "issue" : "pull request"} #${targetNumber}.`,
    `Requested by: ${requestedBy}`,
    `Reason: ${reason ?? "No reason provided."}`,
  ].join("\n");
}
