import type {
  ArtifactStore,
  ContractRecord,
  DecisionPacketRecord,
  JobRunRecord,
  RepositoryKnowledgeChunk,
  RepositoryRecord,
  WaiverRecord,
} from "@patchpact/core";

interface RepositorySnapshot {
  repo: RepositoryRecord;
  draftContracts: ContractRecord[];
  latestPackets: DecisionPacketRecord[];
  waivers: WaiverRecord[];
}

interface RepositoryConsoleData {
  repo: RepositoryRecord;
  contracts: ContractRecord[];
  packets: DecisionPacketRecord[];
  waivers: WaiverRecord[];
  knowledgeResults: RepositoryKnowledgeChunk[];
  knowledgeQuery: string;
}

export interface SetupConsoleData {
  baseUrl: string;
  webhookUrl: string;
  inlineJobs: boolean;
  storage: string;
  provider: string;
  manifest: {
    name: string;
    json: string;
  };
  checks: Array<{
    label: string;
    ready: boolean;
    detail: string;
  }>;
  requiredEvents: string[];
  requiredPermissions: Array<{
    scope: string;
    access: string;
  }>;
}

async function collectRepositorySnapshot(
  store: ArtifactStore,
  repo: RepositoryRecord,
): Promise<RepositorySnapshot> {
  const contracts = await store.listContracts(repo.owner, repo.repo);
  const packets = await store.listDecisionPackets(repo.owner, repo.repo);
  const waivers = await store.listWaivers(repo.owner, repo.repo);
  return {
    repo,
    draftContracts: contracts.filter((contract) => contract.status === "draft").slice(0, 5),
    latestPackets: packets.slice(0, 5),
    waivers: waivers.slice(0, 5),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function baseStyles(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f1e7;
        --card: rgba(255, 255, 255, 0.78);
        --ink: #1f1d1b;
        --muted: #6e6356;
        --line: rgba(31, 29, 27, 0.14);
        --accent: #0e7a66;
        --accent-2: #d97706;
        --danger: #b45309;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(14, 122, 102, 0.16), transparent 34%),
          radial-gradient(circle at top right, rgba(245, 158, 11, 0.16), transparent 28%),
          linear-gradient(180deg, #f8f5ee, #f1eadf 52%, #efe6d8);
      }
      a { color: var(--accent); text-decoration: none; }
      a:hover { text-decoration: underline; }
      main { max-width: 1200px; margin: 0 auto; padding: 40px 20px 80px; }
      h1, h2, h3 { margin-top: 0; }
      p, li, label, input, textarea, select, button { font-size: 0.98rem; }
      p, li { color: var(--muted); }
      code {
        background: rgba(31, 29, 27, 0.06);
        padding: 2px 6px;
        border-radius: 8px;
      }
      .hero {
        padding: 28px;
        border-radius: 28px;
        background: linear-gradient(135deg, rgba(255,255,255,.82), rgba(255,255,255,.58));
        border: 1px solid rgba(255,255,255,.75);
        backdrop-filter: blur(18px);
        box-shadow: 0 18px 55px rgba(46, 37, 25, 0.09);
      }
      .eyebrow {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(14, 122, 102, 0.1);
        color: var(--accent);
        font-size: 0.78rem;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 18px;
        margin-top: 24px;
      }
      .grid-wide {
        display: grid;
        grid-template-columns: minmax(280px, 1.1fr) minmax(320px, 0.9fr);
        gap: 18px;
        margin-top: 24px;
      }
      .card {
        border-radius: 22px;
        padding: 18px;
        background: var(--card);
        border: 1px solid var(--line);
        box-shadow: 0 12px 35px rgba(46, 37, 25, 0.08);
      }
      .card-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .card-list li {
        padding: 12px 0;
        border-top: 1px solid rgba(31, 29, 27, 0.08);
      }
      .card-list li:first-child { border-top: 0; padding-top: 0; }
      .statline {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 12px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(31, 29, 27, 0.06);
        color: var(--ink);
      }
      .muted { color: var(--muted); }
      .pill {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(14, 122, 102, 0.1);
        color: var(--accent);
        font-size: 0.82rem;
      }
      .pill-warn {
        background: rgba(217, 119, 6, 0.12);
        color: var(--danger);
      }
      form {
        display: grid;
        gap: 12px;
      }
      label {
        display: grid;
        gap: 6px;
        color: var(--ink);
        font-weight: 600;
      }
      input, textarea, select {
        width: 100%;
        border: 1px solid rgba(31, 29, 27, 0.14);
        border-radius: 14px;
        padding: 10px 12px;
        background: rgba(255, 255, 255, 0.9);
        color: var(--ink);
        font: inherit;
      }
      textarea {
        min-height: 100px;
        resize: vertical;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 10px 16px;
        font-weight: 700;
        background: linear-gradient(135deg, var(--accent), #0f766e);
        color: white;
        cursor: pointer;
      }
      .secondary {
        background: rgba(31, 29, 27, 0.08);
        color: var(--ink);
      }
      .actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .split {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }
      .mono {
        font-family: "IBM Plex Mono", "Consolas", monospace;
      }
      .small { font-size: 0.88rem; }
      @media (max-width: 920px) {
        .grid-wide {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;
}

function renderRepositoryCard(snapshot: RepositorySnapshot): string {
  const href = `/dashboard/${encodeURIComponent(snapshot.repo.owner)}/${encodeURIComponent(snapshot.repo.repo)}`;
  return `<li>
    <a href="${href}"><strong>${escapeHtml(snapshot.repo.owner)}/${escapeHtml(snapshot.repo.repo)}</strong></a><br />
    Mode: <code>${escapeHtml(snapshot.repo.config.mode)}</code> |
    Provider: <code>${escapeHtml(snapshot.repo.config.provider)}</code><br />
    <span class="small">Drafts ${snapshot.draftContracts.length} | Packets ${snapshot.latestPackets.length} | Waivers ${snapshot.waivers.length}</span>
  </li>`;
}

function renderContractList(contracts: ContractRecord[], repo?: RepositoryRecord): string {
  if (!contracts.length) {
    return "<li>No contracts yet.</li>";
  }
  return contracts
    .map(
      (contract) => `<li>
        ${
          repo
            ? `<a href="/dashboard/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contracts/${contract.issueNumber}"><strong>Issue #${contract.issueNumber}</strong></a>`
            : `<strong>Issue #${contract.issueNumber}</strong>`
        } v${contract.version}
        <span class="pill${contract.status === "approved" ? "" : " pill-warn"}">${escapeHtml(contract.status)}</span><br />
        <span class="small">${escapeHtml(contract.content.problemStatement)}</span>
      </li>`,
    )
    .join("");
}

function renderPacketList(packets: DecisionPacketRecord[], repo?: RepositoryRecord): string {
  if (!packets.length) {
    return "<li>No decision packets yet.</li>";
  }
  return packets
    .map(
      (packet) => `<li>
        ${
          repo
            ? `<a href="/dashboard/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/packets/${packet.pullRequestNumber}"><strong>PR #${packet.pullRequestNumber}</strong></a>`
            : `<strong>PR #${packet.pullRequestNumber}</strong>`
        }
        <span class="pill${packet.content.verdict === "aligned" ? "" : " pill-warn"}">${escapeHtml(packet.content.verdict)}</span><br />
        <span class="small">Action ${escapeHtml(packet.content.suggestedAction)} | Score ${packet.content.contractMatchScore}</span><br />
        <span class="small">${escapeHtml(packet.content.summary)}</span>
      </li>`,
    )
    .join("");
}

function renderWaiverList(waivers: WaiverRecord[]): string {
  if (!waivers.length) {
    return "<li>No waivers recorded.</li>";
  }
  return waivers
    .map(
      (waiver) => `<li>
        <strong>${waiver.targetType === "issue" ? "Issue" : "PR"} #${waiver.targetNumber}</strong><br />
        <span class="small">By ${escapeHtml(waiver.requestedBy)}${waiver.reason ? `: ${escapeHtml(waiver.reason)}` : ""}</span>
      </li>`,
    )
    .join("");
}

function renderKnowledgeResults(results: RepositoryKnowledgeChunk[]): string {
  if (!results.length) {
    return "<li>No knowledge matches yet.</li>";
  }
  return results
    .map(
      (chunk) => `<li>
        <strong>${escapeHtml(chunk.path)}</strong> <span class="small">chunk ${chunk.chunkIndex}</span><br />
        <span class="small">${escapeHtml(chunk.content.slice(0, 220))}${chunk.content.length > 220 ? "..." : ""}</span>
      </li>`,
    )
    .join("");
}

function configTextareaValue(values: string[]): string {
  return escapeHtml(values.join("\n"));
}

function renderStringItems(items: string[]): string {
  if (!items.length) {
    return '<p class="small muted">None recorded.</p>';
  }
  return `<ul class="card-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

export function renderJobDetailPage(job: JobRunRecord): string {
  const retryAction = `/dashboard/jobs/${encodeURIComponent(job.dedupeKey)}/retry`;
  const payloadJson = escapeHtml(JSON.stringify(job.payload, null, 2));
  const errorJson = job.error ? escapeHtml(job.error) : "";
  return baseStyles(
    `PatchPact Job ${job.type}`,
    `
      <section class="hero">
        <span class="eyebrow">Job Detail</span>
        <h1>${escapeHtml(job.type)}</h1>
        <p>Inspect the stored payload, failure reason, and re-run this job if you want to retry it with a fresh dedupe key.</p>
        <div class="actions">
          <a class="badge" href="/dashboard">Back to Dashboard</a>
          <a class="badge" href="/api/jobs/${encodeURIComponent(job.dedupeKey)}">Open JSON</a>
        </div>
        <div class="statline">
          <span class="badge">Status ${escapeHtml(job.status)}</span>
          <span class="badge">Key ${escapeHtml(job.dedupeKey)}</span>
        </div>
      </section>

      <section class="grid-wide">
        <article class="card">
          <h2>Payload</h2>
          <pre class="mono">${payloadJson}</pre>
        </article>
        <article class="card">
          <h2>Runtime Detail</h2>
          <p><strong>Created:</strong> ${escapeHtml(job.createdAt)}</p>
          <p><strong>Updated:</strong> ${escapeHtml(job.updatedAt)}</p>
          ${
            job.error
              ? `<h3>Last Error</h3><pre class="mono">${errorJson}</pre>`
              : `<p class="small muted">No error recorded for this job.</p>`
          }
          <form method="post" action="${retryAction}">
            <button type="submit">Retry Job</button>
          </form>
        </article>
      </section>
    `,
  );
}

export async function renderDashboard(store: ArtifactStore): Promise<string> {
  const repositories = await store.listRepositories();
  const jobs = await store.listJobRuns(20);
  const snapshots = await Promise.all(
    repositories.slice(0, 12).map((repo: RepositoryRecord) =>
      collectRepositorySnapshot(store, repo),
    ),
  );

  return baseStyles(
    "PatchPact Dashboard",
    `
      <section class="hero">
        <span class="eyebrow">Contract-first maintenance</span>
        <h1>PatchPact</h1>
        <p>
          Turn noisy GitHub issues and pull requests into reviewable contribution contracts,
          then compare each PR against the agreed scope before maintainers spend review time.
        </p>
        <div class="actions">
          <a class="badge" href="/setup">Open Setup Guide</a>
          <a class="badge" href="/api/repositories">Open JSON API</a>
        </div>
        <div class="statline">
          <span class="badge">Repositories ${repositories.length}</span>
          <span class="badge">Recent jobs ${jobs.length}</span>
        </div>
      </section>

      <section class="grid">
        <article class="card">
          <h2>Connected Repositories</h2>
          <ul class="card-list">
            ${snapshots.length ? snapshots.map(renderRepositoryCard).join("") : "<li>No repositories connected yet.</li>"}
          </ul>
        </article>

        <article class="card">
          <h2>Pending Contract Approvals</h2>
          <ul class="card-list">
            ${
              snapshots.some((snapshot) => snapshot.draftContracts.length)
                ? snapshots
                    .flatMap((snapshot) =>
                      snapshot.draftContracts.map(
                        (contract) =>
                          `<li><a href="/dashboard/${encodeURIComponent(snapshot.repo.owner)}/${encodeURIComponent(snapshot.repo.repo)}">${escapeHtml(snapshot.repo.owner)}/${escapeHtml(snapshot.repo.repo)}</a><br />Issue #${contract.issueNumber} v${contract.version}</li>`,
                      ),
                    )
                    .join("")
                : "<li>No pending draft contracts.</li>"
            }
          </ul>
        </article>

        <article class="card">
          <h2>Recent Decision Packets</h2>
          <ul class="card-list">
            ${
              snapshots.some((snapshot) => snapshot.latestPackets.length)
                ? snapshots
                    .flatMap((snapshot) =>
                      snapshot.latestPackets.map(
                        (packet) =>
                          `<li><a href="/dashboard/${encodeURIComponent(snapshot.repo.owner)}/${encodeURIComponent(snapshot.repo.repo)}">${escapeHtml(snapshot.repo.owner)}/${escapeHtml(snapshot.repo.repo)}</a><br />PR #${packet.pullRequestNumber} ${escapeHtml(packet.content.verdict)} (${packet.content.contractMatchScore})</li>`,
                      ),
                    )
                    .join("")
                : "<li>No decision packets yet.</li>"
            }
          </ul>
        </article>

        <article class="card">
          <h2>Job Queue</h2>
          <ul class="card-list">
            ${
              jobs.length
                ? jobs
                    .map(
                      (job) =>
                        `<li><a href="/dashboard/jobs/${encodeURIComponent(job.dedupeKey)}"><code>${escapeHtml(job.type)}</code></a> ${escapeHtml(job.status)}<br /><span class="small mono">${escapeHtml(job.dedupeKey)}</span></li>`,
                    )
                    .join("")
                : "<li>No jobs recorded.</li>"
            }
          </ul>
        </article>
      </section>
    `,
  );
}

export function renderRepositoryConsole(data: RepositoryConsoleData): string {
  const { repo, contracts, packets, waivers, knowledgeQuery, knowledgeResults } = data;
  return baseStyles(
    `${repo.owner}/${repo.repo} - PatchPact`,
    `
      <section class="hero">
        <span class="eyebrow">Repository Console</span>
        <h1>${escapeHtml(repo.owner)}/${escapeHtml(repo.repo)}</h1>
        <p>
          Tune repository policy, inspect generated artifacts, and trigger lightweight maintenance actions without leaving PatchPact.
        </p>
        <div class="actions">
          <a class="badge" href="/dashboard">Back to Dashboard</a>
          <a class="badge" href="/api/repositories/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}">JSON API</a>
        </div>
        <div class="statline">
          <span class="badge">Mode ${escapeHtml(repo.config.mode)}</span>
          <span class="badge">Provider ${escapeHtml(repo.config.provider)}</span>
          <span class="badge">Contracts ${contracts.length}</span>
          <span class="badge">Packets ${packets.length}</span>
          <span class="badge">Waivers ${waivers.length}</span>
        </div>
      </section>

      <section class="grid-wide">
        <article class="card">
          <h2>Repository Policy</h2>
          <form method="post" action="/dashboard/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/config">
            <div class="split">
              <label>Mode
                <select name="mode">
                  <option value="advisory"${repo.config.mode === "advisory" ? " selected" : ""}>advisory</option>
                  <option value="soft-gate"${repo.config.mode === "soft-gate" ? " selected" : ""}>soft-gate</option>
                </select>
              </label>
              <label>Provider
                <select name="provider">
                  ${["mock", "openai-compatible", "anthropic", "ollama"]
                    .map(
                      (provider) =>
                        `<option value="${provider}"${repo.config.provider === provider ? " selected" : ""}>${provider}</option>`,
                    )
                    .join("")}
                </select>
              </label>
            </div>
            <label>Model
              <input name="model" value="${escapeHtml(repo.config.model)}" />
            </label>
            <label>Repository Rules
              <textarea name="repoRules">${configTextareaValue(repo.config.repoRules)}</textarea>
            </label>
            <div class="split">
              <label>Docs Globs
                <textarea name="docsGlobs">${configTextareaValue(repo.config.docsGlobs)}</textarea>
              </label>
              <label>Test Globs
                <textarea name="testGlobs">${configTextareaValue(repo.config.testGlobs)}</textarea>
              </label>
            </div>
            <button type="submit">Save Repository Policy</button>
          </form>
        </article>

        <article class="card">
          <h2>Repository Actions</h2>
          <p>Use these controls when you want to refresh PatchPact's understanding of the repository without waiting for the next webhook.</p>
          <form method="post" action="/dashboard/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/actions/sync-knowledge">
            <button type="submit">Sync Knowledge Now</button>
          </form>
          <p class="small">This rebuilds the lightweight document index from README, contributing guides, templates, and docs matched by the current repository config.</p>
          <form method="get" action="/dashboard/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}">
            <label>Search Knowledge
              <input name="q" value="${escapeHtml(knowledgeQuery)}" placeholder="tests auth workflows" />
            </label>
            <button type="submit" class="secondary">Search Knowledge</button>
          </form>
          <ul class="card-list">
            ${renderKnowledgeResults(knowledgeResults)}
          </ul>
        </article>
      </section>

      <section class="grid">
        <article class="card">
          <h2>Contracts</h2>
          <ul class="card-list">${renderContractList(contracts.slice(0, 12), repo)}</ul>
        </article>

        <article class="card">
          <h2>Decision Packets</h2>
          <ul class="card-list">${renderPacketList(packets.slice(0, 12), repo)}</ul>
        </article>

        <article class="card">
          <h2>Waivers</h2>
          <ul class="card-list">${renderWaiverList(waivers.slice(0, 12))}</ul>
        </article>
      </section>
    `,
  );
}

export function renderContractDetailPage(
  repo: RepositoryRecord,
  contracts: ContractRecord[],
): string {
  const latest = contracts[0];
  const repoHref = `/dashboard/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
  if (!latest) {
    return baseStyles(
      `${repo.owner}/${repo.repo} contract`,
      `<section class="hero"><h1>Contract Not Found</h1><p><a href="${repoHref}">Back to repository console</a></p></section>`,
    );
  }

  return baseStyles(
    `${repo.owner}/${repo.repo} issue #${latest.issueNumber} contract`,
    `
      <section class="hero">
        <span class="eyebrow">Contract Detail</span>
        <h1>${escapeHtml(repo.owner)}/${escapeHtml(repo.repo)} issue #${latest.issueNumber}</h1>
        <p>${escapeHtml(latest.content.problemStatement)}</p>
        <div class="actions">
          <a class="badge" href="${repoHref}">Back to Repository Console</a>
          <a class="badge" href="/api/repositories/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contracts/${latest.issueNumber}">Open JSON</a>
        </div>
      </section>

      <section class="grid-wide">
        <article class="card">
          <div class="actions" style="justify-content:space-between;align-items:center;">
            <h2 style="margin:0;">Latest Contract</h2>
            <form class="inline-form" method="post" action="${repoHref}/actions/refresh-contract">
              <input type="hidden" name="issueNumber" value="${latest.issueNumber}" />
              <input type="hidden" name="redirectTo" value="/dashboard/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contracts/${latest.issueNumber}" />
              <button type="submit">Refresh Contract</button>
            </form>
          </div>
          <div class="card-list">
            <div class="small">Status <span class="pill${latest.status === "approved" ? "" : " pill-warn"}">${escapeHtml(latest.status)}</span> | Version <code>${latest.version}</code> | Confidence <code>${escapeHtml(latest.content.confidence)}</code></div>
          </div>
          <h3>Problem Statement</h3>
          <p>${escapeHtml(latest.content.problemStatement)}</p>
          <h3>Scope Boundaries</h3>
          ${renderStringItems(latest.content.scopeBoundaries)}
          <h3>Impacted Areas</h3>
          ${renderStringItems(latest.content.impactedAreas)}
          <h3>Acceptance Criteria</h3>
          ${renderStringItems(latest.content.acceptanceCriteria)}
          <h3>Test Expectations</h3>
          ${renderStringItems(latest.content.testExpectations)}
          <h3>Non Goals</h3>
          ${renderStringItems(latest.content.nonGoals)}
          <h3>Repository Signals</h3>
          ${renderStringItems(latest.content.repoSignals)}
        </article>

        <article class="card">
          <h2>Version History</h2>
          <ul class="card-list">
            ${contracts
              .map(
                (contract) => `<li>
                  <strong>v${contract.version}</strong>
                  <span class="pill${contract.status === "approved" ? "" : " pill-warn"}">${escapeHtml(contract.status)}</span><br />
                  <span class="small">Generated by ${escapeHtml(contract.generatedBy)}${contract.approvedBy ? ` | approved by ${escapeHtml(contract.approvedBy)}` : ""}</span><br />
                  <span class="small">${escapeHtml(contract.createdAt)}</span>
                </li>`,
              )
              .join("")}
          </ul>
        </article>
      </section>
    `,
  );
}

export function renderDecisionPacketDetailPage(
  repo: RepositoryRecord,
  packets: DecisionPacketRecord[],
): string {
  const latest = packets[0];
  const repoHref = `/dashboard/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
  if (!latest) {
    return baseStyles(
      `${repo.owner}/${repo.repo} decision packet`,
      `<section class="hero"><h1>Decision Packet Not Found</h1><p><a href="${repoHref}">Back to repository console</a></p></section>`,
    );
  }

  return baseStyles(
    `${repo.owner}/${repo.repo} PR #${latest.pullRequestNumber} decision packet`,
    `
      <section class="hero">
        <span class="eyebrow">Decision Packet Detail</span>
        <h1>${escapeHtml(repo.owner)}/${escapeHtml(repo.repo)} PR #${latest.pullRequestNumber}</h1>
        <p>${escapeHtml(latest.content.summary)}</p>
        <div class="actions">
          <a class="badge" href="${repoHref}">Back to Repository Console</a>
          <a class="badge" href="/api/repositories/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/packets/${latest.pullRequestNumber}">Open JSON</a>
        </div>
      </section>

      <section class="grid-wide">
        <article class="card">
          <div class="actions" style="justify-content:space-between;align-items:center;">
            <h2 style="margin:0;">Latest Packet</h2>
            <form class="inline-form" method="post" action="${repoHref}/actions/regenerate-packet">
              <input type="hidden" name="pullRequestNumber" value="${latest.pullRequestNumber}" />
              <input type="hidden" name="redirectTo" value="/dashboard/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/packets/${latest.pullRequestNumber}" />
              <button type="submit">Regenerate Packet</button>
            </form>
          </div>
          <p>Verdict <span class="pill${latest.content.verdict === "aligned" ? "" : " pill-warn"}">${escapeHtml(latest.content.verdict)}</span> | Score <code>${latest.content.contractMatchScore}</code> | Action <code>${escapeHtml(latest.content.suggestedAction)}</code></p>
          ${
            latest.content.waiverApplied
              ? `<p class="small">Waiver applied${latest.content.waiverReason ? `: ${escapeHtml(latest.content.waiverReason)}` : ""}</p>`
              : ""
          }
          <h3>Risks</h3>
          ${renderStringItems(latest.content.risks)}
          <h3>Missing Tests</h3>
          ${renderStringItems(latest.content.missingTests)}
          <h3>Blocking Reasons</h3>
          ${renderStringItems(latest.content.blockingReasons)}
          <h3>Related Artifacts</h3>
          ${renderStringItems(
            latest.content.relatedArtifacts.map(
              (artifact) => `${artifact.type} ${artifact.identifier}: ${artifact.reason}`,
            ),
          )}
        </article>

        <article class="card">
          <h2>Packet History</h2>
          <ul class="card-list">
            ${packets
              .map(
                (packet) => `<li>
                  <strong>${escapeHtml(packet.createdAt)}</strong><br />
                  <span class="small">${escapeHtml(packet.content.verdict)} | ${escapeHtml(packet.content.suggestedAction)} | score ${packet.content.contractMatchScore}</span>
                </li>`,
              )
              .join("")}
          </ul>
        </article>
      </section>
    `,
  );
}

export function buildSetupConsoleData(input: {
  baseUrl: string;
  inlineJobs: boolean;
  storage: string;
  provider: string;
  manifest: {
    name: string;
    json: string;
  };
  envStatus: {
    githubAppId: boolean;
    githubPrivateKey: boolean;
    githubClientId: boolean;
    githubClientSecret: boolean;
    webhookSecret: boolean;
    databaseUrl: boolean;
    redisUrl: boolean;
    openAiKey: boolean;
    anthropicKey: boolean;
  };
}): SetupConsoleData {
  return {
    baseUrl: input.baseUrl,
    webhookUrl: `${input.baseUrl.replace(/\/$/, "")}/webhooks/github`,
    inlineJobs: input.inlineJobs,
    storage: input.storage,
    provider: input.provider,
    manifest: input.manifest,
    checks: [
      {
        label: "GitHub App ID",
        ready: input.envStatus.githubAppId,
        detail: "Required to mint installation tokens and identify the GitHub App.",
      },
      {
        label: "GitHub private key",
        ready: input.envStatus.githubPrivateKey,
        detail: "Required for GitHub App JWT signing.",
      },
      {
        label: "GitHub client ID",
        ready: input.envStatus.githubClientId,
        detail: "Needed for future install and connect flows.",
      },
      {
        label: "GitHub client secret",
        ready: input.envStatus.githubClientSecret,
        detail: "Needed for future install and connect flows.",
      },
      {
        label: "Webhook secret",
        ready: input.envStatus.webhookSecret,
        detail: "GitHub signs webhook payloads with this secret.",
      },
      {
        label: "Database connection",
        ready: input.storage === "memory" ? true : input.envStatus.databaseUrl,
        detail:
          input.storage === "memory"
            ? "Memory mode is active, so Postgres is optional."
            : "Required because persistent storage is enabled.",
      },
      {
        label: "Redis connection",
        ready: input.inlineJobs ? true : input.envStatus.redisUrl,
        detail:
          input.inlineJobs
            ? "Inline job mode is active, so Redis is optional."
            : "Required because BullMQ worker mode is enabled.",
      },
      {
        label: "Live model credentials",
        ready:
          input.provider === "mock" ||
          input.provider === "ollama" ||
          (input.provider === "openai-compatible" && input.envStatus.openAiKey) ||
          (input.provider === "anthropic" && input.envStatus.anthropicKey),
        detail: "Mock mode works for demos, but production is stronger with a live provider.",
      },
    ],
    requiredEvents: [
      "installation",
      "issues",
      "issue_comment",
      "pull_request",
      "pull_request_review",
      "push",
    ],
    requiredPermissions: [
      { scope: "Issues", access: "Read and write" },
      { scope: "Pull requests", access: "Read and write" },
      { scope: "Checks", access: "Read and write" },
      { scope: "Contents", access: "Read-only" },
      { scope: "Metadata", access: "Read-only" },
    ],
  };
}

export function renderSetupConsole(data: SetupConsoleData): string {
  return baseStyles(
    "PatchPact Setup",
    `
      <section class="hero">
        <span class="eyebrow">Setup Guide</span>
        <h1>PatchPact Instance Readiness</h1>
        <p>
          Confirm whether this PatchPact instance is ready for real GitHub App traffic, which URLs to plug into GitHub, and which credentials still need attention.
        </p>
        <div class="actions">
          <a class="badge" href="/dashboard">Back to Dashboard</a>
          <a class="badge" href="/api/setup">Open JSON Setup Data</a>
        </div>
      </section>

      <section class="grid-wide">
        <article class="card">
          <h2>Readiness Checks</h2>
          <ul class="card-list">
            ${data.checks
              .map(
                (check) => `<li>
                  <strong>${escapeHtml(check.label)}</strong>
                  <span class="pill${check.ready ? "" : " pill-warn"}">${check.ready ? "ready" : "missing"}</span><br />
                  <span class="small">${escapeHtml(check.detail)}</span>
                </li>`,
              )
              .join("")}
          </ul>
        </article>

        <article class="card">
          <h2>Wiring Details</h2>
          <p>Base URL</p>
          <pre>${escapeHtml(data.baseUrl)}</pre>
          <p>Webhook URL</p>
          <pre>${escapeHtml(data.webhookUrl)}</pre>
          <p class="small">Storage <code>${escapeHtml(data.storage)}</code> | Inline jobs <code>${String(data.inlineJobs)}</code> | Default provider <code>${escapeHtml(data.provider)}</code></p>
        </article>
      </section>

      <section class="grid">
        <article class="card">
          <h2>GitHub App Manifest</h2>
          <p class="small">
            Use this manifest as a copyable starting point when creating the GitHub App manually or when scripting setup.
          </p>
          <p><strong>Suggested name:</strong> <code>${escapeHtml(data.manifest.name)}</code></p>
          <pre class="mono">${escapeHtml(data.manifest.json)}</pre>
          <div class="actions">
            <a class="badge" href="/api/setup/github-app-manifest">Open Manifest JSON</a>
          </div>
        </article>
      </section>

      <section class="grid">
        <article class="card">
          <h2>Required Events</h2>
          <ul class="card-list">
            ${data.requiredEvents.map((event) => `<li><code>${escapeHtml(event)}</code></li>`).join("")}
          </ul>
        </article>
        <article class="card">
          <h2>Required Permissions</h2>
          <ul class="card-list">
            ${data.requiredPermissions
              .map(
                (permission) => `<li><strong>${escapeHtml(permission.scope)}</strong><br /><span class="small">${escapeHtml(permission.access)}</span></li>`,
              )
              .join("")}
          </ul>
        </article>
        <article class="card">
          <h2>Suggested Next Steps</h2>
          <ul class="card-list">
            <li>Configure the webhook URL in GitHub to point at the value above.</li>
            <li>Grant the listed permissions and subscribe to the required events.</li>
            <li>Install the GitHub App on a test repository and watch for the installation event in the dashboard.</li>
            <li>Open the repository console and run a manual knowledge sync after setup.</li>
          </ul>
        </article>
      </section>
    `,
  );
}
