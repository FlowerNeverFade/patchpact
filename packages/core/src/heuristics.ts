import type {
  ChangedFile,
  ContributionContract,
  DecisionPacket,
  IssueContext,
  PatchPactConfig,
  PullRequestContext,
  RelatedArtifact,
} from "./types.js";
import { matchesAnyGlob } from "./knowledge.js";
import { sanitizeUntrustedText } from "./security.js";

function tokenize(text: string): string[] {
  return sanitizeUntrustedText(text)
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .filter((token) => token.length >= 3);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function pickBullets(source: string, fallback: string[]): string[] {
  const bullets = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ""))
    .slice(0, 6);
  return bullets.length ? bullets : fallback;
}

function inferImpactedAreas(issue: IssueContext): string[] {
  const fileHints = issue.documents
    .filter((doc) => /(readme|contributing|codeowners|package\.json|pyproject)/i.test(doc.path))
    .map((doc) => doc.path);
  const bodyHints = tokenize(`${issue.title} ${issue.body}`)
    .filter((token) => token.includes("/") || token.includes("."))
    .slice(0, 6);
  const labelHints = issue.labels.map((label) => `label:${label}`);
  return unique([...bodyHints, ...fileHints, ...labelHints]).slice(0, 6);
}

function inferRepoSignals(issue: IssueContext): string[] {
  const signals = issue.documents.map((doc) => `Repository doc considered: ${doc.path}`);
  if (issue.recentMergedPullRequests.length) {
    signals.push(
      `Looked at ${Math.min(issue.recentMergedPullRequests.length, 3)} recent merged pull requests for precedent.`,
    );
  }
  if (issue.recentClosedIssues.length) {
    signals.push(
      `Looked at ${Math.min(issue.recentClosedIssues.length, 3)} recently closed issues for scope alignment.`,
    );
  }
  return signals.slice(0, 5);
}

function inferConfidence(score: number): "low" | "medium" | "high" {
  if (score >= 80) {
    return "high";
  }
  if (score >= 55) {
    return "medium";
  }
  return "low";
}

export function generateContractHeuristically(input: {
  config: PatchPactConfig;
  issue: IssueContext;
}): ContributionContract {
  const { issue } = input;
  const body = sanitizeUntrustedText(issue.body);
  const title = sanitizeUntrustedText(issue.title);
  const acceptanceCriteria = pickBullets(body, [
    "Contributor describes the intended user-visible behavior change.",
    "Pull request stays within the agreed scope and references this issue.",
    "Reviewers can verify the change from changed files and tests.",
  ]);
  const scopeBoundaries = pickBullets(body, [
    "Do not expand beyond the issue's described user problem.",
    "Avoid unrelated refactors or dependency churn.",
    "Escalate if implementation needs repository-wide architecture changes.",
  ]);
  const impactedAreas = inferImpactedAreas(issue);
  const scoreSeed = Math.min(100, 40 + impactedAreas.length * 7 + acceptanceCriteria.length * 6);

  return {
    issueNumber: issue.issueNumber,
    title,
    problemStatement:
      body.split(/\r?\n/).find((line) => line.trim().length > 20)?.trim() ??
      `Resolve the maintainer need described in "${title}".`,
    scopeBoundaries,
    impactedAreas,
    acceptanceCriteria,
    testExpectations: [
      "Add or update tests near the changed TypeScript or Python surface when behavior changes.",
      "If tests are skipped, explain why in the pull request body.",
    ],
    nonGoals: [
      "Do not merge speculative improvements unrelated to the issue.",
      "Do not introduce new secrets handling or background automation without maintainer review.",
    ],
    repoSignals: inferRepoSignals(issue),
    relatedIssueNumbers: issue.recentClosedIssues.slice(0, 3).map((entry) => entry.number),
    rationale:
      "This contract was produced from the issue description, repository guidance, and recent repository activity. It is intended as a reviewable draft rather than a final truth.",
    confidence: inferConfidence(scoreSeed),
    suggestedNextStep:
      "A maintainer should confirm the contract or refresh it after clarifying scope in the issue.",
  };
}

function inferRiskFromFile(file: ChangedFile): string[] {
  const risks: string[] = [];
  if (/auth|permission|acl|policy/i.test(file.path)) {
    risks.push(`Access-control sensitive file changed: ${file.path}`);
  }
  if (/migration|schema|sql|prisma/i.test(file.path)) {
    risks.push(`Data-shape sensitive file changed: ${file.path}`);
  }
  if (/package-lock|pnpm-lock|poetry.lock|requirements/i.test(file.path)) {
    risks.push(`Dependency surface changed: ${file.path}`);
  }
  if (/workflow|github\/workflows|docker|infra/i.test(file.path)) {
    risks.push(`Operational or CI surface changed: ${file.path}`);
  }
  return risks;
}

function inferMissingTests(
  pullRequest: PullRequestContext,
  config: PatchPactConfig,
): string[] {
  const productionFiles = pullRequest.changedFiles.filter(
    (file) =>
      !matchesAnyGlob(file.path, config.testGlobs) &&
      /\.(ts|tsx|js|jsx|py)$/.test(file.path) &&
      !/\.d\.ts$/.test(file.path),
  );
  const hasTests = pullRequest.changedFiles.some((file) =>
    matchesAnyGlob(file.path, config.testGlobs),
  );
  if (!productionFiles.length || hasTests) {
    return [];
  }
  return productionFiles
    .slice(0, 5)
    .map((file) => `No matching test change was detected for ${file.path}.`);
}

function scoreContractAlignment(
  pullRequest: PullRequestContext,
  contract: ContributionContract | null,
): {
  score: number;
  verdict: DecisionPacket["verdict"];
  relatedArtifacts: RelatedArtifact[];
  blockingReasons: string[];
} {
  if (!contract) {
    return {
      score: 20,
      verdict: "missing-contract",
      relatedArtifacts: [],
      blockingReasons: ["No approved contribution contract is linked to this pull request."],
    };
  }

  const fileText = pullRequest.changedFiles.map((file) => file.path.toLowerCase()).join(" ");
  const areaHits = contract.impactedAreas.filter((area) =>
    fileText.includes(area.toLowerCase().replace(/^label:/, "")),
  ).length;
  const issueLinked =
    pullRequest.referencedIssueNumbers.includes(contract.issueNumber) ||
    pullRequest.linkedContractIssueNumber === contract.issueNumber;
  const score = Math.max(
    0,
    Math.min(100, 35 + areaHits * 15 + (issueLinked ? 20 : -10) + pullRequest.changedFiles.length),
  );
  const verdict: DecisionPacket["verdict"] =
    score >= 75 ? "aligned" : score >= 55 ? "partial" : "misaligned";
  const blockingReasons =
    verdict === "misaligned"
      ? [
          "Changed files do not line up well with the approved contract's impacted areas.",
          ...(issueLinked
            ? []
            : ["The pull request body does not clearly reference the contracted issue."]),
        ]
      : issueLinked
        ? []
        : ["The pull request should explicitly reference the contracted issue."];

  return {
    score,
    verdict,
    relatedArtifacts: [
      {
        type: "issue",
        identifier: `#${contract.issueNumber}`,
        reason: "Approved contract source issue",
      },
    ],
    blockingReasons,
  };
}

export function generateDecisionPacketHeuristically(input: {
  config: PatchPactConfig;
  pullRequest: PullRequestContext;
  contract: ContributionContract | null;
}): DecisionPacket {
  const { config, pullRequest, contract } = input;
  const alignment = scoreContractAlignment(pullRequest, contract);
  const risks = unique(
    pullRequest.changedFiles.flatMap((file) => inferRiskFromFile(file)),
  ).slice(0, 6);
  const missingTests = inferMissingTests(pullRequest, config);
  const suggestedAction: DecisionPacket["suggestedAction"] =
    alignment.verdict === "aligned" && !missingTests.length && !alignment.blockingReasons.length
      ? "merge-ready"
      : alignment.verdict === "missing-contract"
        ? "needs-contract"
        : alignment.verdict === "misaligned"
          ? "needs-waiver"
          : "needs-follow-up";
  const confidenceSeed =
    alignment.score - missingTests.length * 8 - Math.min(20, pullRequest.changedFiles.length);

  return {
    pullRequestNumber: pullRequest.pullRequestNumber,
    summary:
      contract && alignment.verdict !== "missing-contract"
        ? `PR #${pullRequest.pullRequestNumber} appears ${alignment.verdict} with contract issue #${contract.issueNumber}.`
        : `PR #${pullRequest.pullRequestNumber} does not have a trustworthy approved contract link yet.`,
    contractMatchScore: alignment.score,
    verdict: alignment.verdict,
    risks:
      risks.length > 0
        ? risks
        : ["No high-risk file patterns were detected from changed-files analysis."],
    missingTests,
    relatedArtifacts: [
      ...alignment.relatedArtifacts,
      ...pullRequest.recentMergedPullRequests.slice(0, 2).map((pr) => ({
        type: "pull_request" as const,
        identifier: `#${pr.number}`,
        reason: "Recent merged pull request used as repository precedent.",
      })),
    ],
    suggestedAction,
    confidence: inferConfidence(Math.max(0, confidenceSeed)),
    blockingReasons: alignment.blockingReasons,
  };
}
