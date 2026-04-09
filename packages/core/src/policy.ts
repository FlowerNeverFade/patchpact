import type { DecisionPacket, PatchPactCheckResult, PatchPactConfig } from "./types.js";

export function deriveCheckResult(
  config: PatchPactConfig,
  packet: DecisionPacket,
): PatchPactCheckResult {
  const shouldGate =
    config.mode === "soft-gate" &&
    ((packet.verdict === "missing-contract" && !packet.waiverApplied) ||
      packet.verdict === "misaligned" ||
      packet.missingTests.length > 0);

  return {
    title: "PatchPact Decision Packet",
    summary: [
      packet.summary,
      `Contract match score: ${packet.contractMatchScore}/100`,
      `Suggested action: ${packet.suggestedAction}`,
      ...(packet.blockingReasons.length
        ? [`Blocking reasons: ${packet.blockingReasons.join(" | ")}`]
        : []),
      ...(packet.missingTests.length
        ? [`Missing tests: ${packet.missingTests.join(" | ")}`]
        : []),
      ...(packet.waiverApplied
        ? [`Waiver applied: ${packet.waiverReason ?? "Maintainer override recorded."}`]
        : []),
    ].join("\n"),
    conclusion: shouldGate
      ? "action_required"
      : packet.suggestedAction === "merge-ready"
        ? "success"
        : "neutral",
  };
}
