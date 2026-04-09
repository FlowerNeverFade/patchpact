import crypto from "node:crypto";
import { Pool } from "pg";
import type {
  ArtifactStore,
  ContractRecord,
  ContractStatus,
  DecisionPacketRecord,
  JobRunRecord,
  PatchPactConfig,
  RepositoryKnowledgeChunk,
  RepositoryRecord,
  WaiverRecord,
} from "@patchpact/core";

function rowToRepository(row: any): RepositoryRecord {
  return {
    owner: row.owner,
    repo: row.repo,
    installationId: row.installation_id ?? undefined,
    config: row.config,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function rowToContract(row: any): ContractRecord {
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    issueNumber: row.issue_number,
    version: row.version,
    status: row.status,
    generatedBy: row.generated_by,
    approvedBy: row.approved_by ?? undefined,
    content: row.content,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function rowToDecisionPacket(row: any): DecisionPacketRecord {
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    pullRequestNumber: row.pull_request_number,
    linkedContractId: row.linked_contract_id ?? undefined,
    generatedBy: row.generated_by,
    content: row.content,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function rowToJobRun(row: any): JobRunRecord {
  return {
    id: row.id,
    type: row.type,
    dedupeKey: row.dedupe_key,
    status: row.status,
    payload: row.payload,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    error: row.error ?? undefined,
  };
}

function rowToKnowledgeChunk(row: any): RepositoryKnowledgeChunk {
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    path: row.path,
    chunkIndex: row.chunk_index,
    content: row.content,
    contentHash: row.content_hash,
    score: row.score !== undefined && row.score !== null ? Number(row.score) : undefined,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function rowToWaiver(row: any): WaiverRecord {
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    targetType: row.target_type,
    targetNumber: row.target_number,
    requestedBy: row.requested_by,
    reason: row.reason ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class PostgresArtifactStore implements ArtifactStore {
  constructor(private readonly pool: Pool) {}

  async upsertRepository(
    input: Pick<RepositoryRecord, "owner" | "repo" | "installationId" | "config">,
  ): Promise<RepositoryRecord> {
    const { rows } = await this.pool.query(
      `
        insert into repositories (owner, repo, installation_id, config)
        values ($1, $2, $3, $4::jsonb)
        on conflict (owner, repo) do update
        set installation_id = excluded.installation_id,
            config = excluded.config,
            updated_at = now()
        returning *
      `,
      [input.owner, input.repo, input.installationId ?? null, JSON.stringify(input.config)],
    );
    return rowToRepository(rows[0]);
  }

  async getRepository(owner: string, repo: string): Promise<RepositoryRecord | null> {
    const { rows } = await this.pool.query(
      `select * from repositories where owner = $1 and repo = $2 limit 1`,
      [owner, repo],
    );
    return rows[0] ? rowToRepository(rows[0]) : null;
  }

  async listRepositories(): Promise<RepositoryRecord[]> {
    const { rows } = await this.pool.query(`select * from repositories order by updated_at desc`);
    return rows.map(rowToRepository);
  }

  async saveRepositoryConfig(
    owner: string,
    repo: string,
    config: PatchPactConfig,
  ): Promise<RepositoryRecord> {
    const current = await this.getRepository(owner, repo);
    return this.upsertRepository({
      owner,
      repo,
      installationId: current?.installationId,
      config,
    });
  }

  async saveContract(
    input: Omit<ContractRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<ContractRecord> {
    const { rows } = await this.pool.query(
      `
        insert into contracts
          (id, owner, repo, issue_number, version, status, generated_by, approved_by, content)
        values
          ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        returning *
      `,
      [
        crypto.randomUUID(),
        input.owner,
        input.repo,
        input.issueNumber,
        input.version,
        input.status,
        input.generatedBy,
        input.approvedBy ?? null,
        JSON.stringify(input.content),
      ],
    );
    return rowToContract(rows[0]);
  }

  async getLatestContract(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<ContractRecord | null> {
    const { rows } = await this.pool.query(
      `
        select * from contracts
        where owner = $1 and repo = $2 and issue_number = $3
        order by version desc
        limit 1
      `,
      [owner, repo, issueNumber],
    );
    return rows[0] ? rowToContract(rows[0]) : null;
  }

  async getApprovedContract(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<ContractRecord | null> {
    const { rows } = await this.pool.query(
      `
        select * from contracts
        where owner = $1 and repo = $2 and issue_number = $3 and status = 'approved'
        order by version desc
        limit 1
      `,
      [owner, repo, issueNumber],
    );
    return rows[0] ? rowToContract(rows[0]) : null;
  }

  async listContracts(
    owner: string,
    repo: string,
    issueNumber?: number,
  ): Promise<ContractRecord[]> {
    const { rows } = await this.pool.query(
      `
        select * from contracts
        where owner = $1 and repo = $2 and ($3::int is null or issue_number = $3)
        order by version desc
      `,
      [owner, repo, issueNumber ?? null],
    );
    return rows.map(rowToContract);
  }

  async updateContractStatus(
    id: string,
    status: ContractStatus,
    actor?: string,
  ): Promise<ContractRecord | null> {
    const { rows } = await this.pool.query(
      `
        update contracts
        set status = $2,
            approved_by = coalesce($3, approved_by),
            updated_at = now()
        where id = $1
        returning *
      `,
      [id, status, actor ?? null],
    );
    return rows[0] ? rowToContract(rows[0]) : null;
  }

  async saveDecisionPacket(
    input: Omit<DecisionPacketRecord, "id" | "createdAt">,
  ): Promise<DecisionPacketRecord> {
    const { rows } = await this.pool.query(
      `
        insert into decision_packets
          (id, owner, repo, pull_request_number, linked_contract_id, generated_by, content)
        values
          ($1, $2, $3, $4, $5, $6, $7::jsonb)
        returning *
      `,
      [
        crypto.randomUUID(),
        input.owner,
        input.repo,
        input.pullRequestNumber,
        input.linkedContractId ?? null,
        input.generatedBy,
        JSON.stringify(input.content),
      ],
    );
    return rowToDecisionPacket(rows[0]);
  }

  async getLatestDecisionPacket(
    owner: string,
    repo: string,
    pullRequestNumber: number,
  ): Promise<DecisionPacketRecord | null> {
    const { rows } = await this.pool.query(
      `
        select * from decision_packets
        where owner = $1 and repo = $2 and pull_request_number = $3
        order by created_at desc
        limit 1
      `,
      [owner, repo, pullRequestNumber],
    );
    return rows[0] ? rowToDecisionPacket(rows[0]) : null;
  }

  async listDecisionPackets(
    owner: string,
    repo: string,
    pullRequestNumber?: number,
  ): Promise<DecisionPacketRecord[]> {
    const { rows } = await this.pool.query(
      `
        select * from decision_packets
        where owner = $1 and repo = $2 and ($3::int is null or pull_request_number = $3)
        order by created_at desc
      `,
      [owner, repo, pullRequestNumber ?? null],
    );
    return rows.map(rowToDecisionPacket);
  }

  async saveJobRun(input: Omit<JobRunRecord, "createdAt" | "updatedAt">): Promise<void> {
    await this.pool.query(
      `
        insert into job_runs (id, type, dedupe_key, status, payload, error)
        values ($1, $2, $3, $4, $5::jsonb, $6)
        on conflict (dedupe_key) do update
        set status = excluded.status,
            payload = excluded.payload,
            error = excluded.error,
            updated_at = now()
      `,
      [
        input.id,
        input.type,
        input.dedupeKey,
        input.status,
        JSON.stringify(input.payload),
        input.error ?? null,
      ],
    );
  }

  async updateJobRun(
    dedupeKey: string,
    status: JobRunRecord["status"],
    error?: string,
  ): Promise<void> {
    await this.pool.query(
      `update job_runs set status = $2, error = $3, updated_at = now() where dedupe_key = $1`,
      [dedupeKey, status, error ?? null],
    );
  }

  async listJobRuns(limit = 20): Promise<JobRunRecord[]> {
    const { rows } = await this.pool.query(
      `select * from job_runs order by updated_at desc limit $1`,
      [limit],
    );
    return rows.map(rowToJobRun);
  }

  async getJobRun(dedupeKey: string): Promise<JobRunRecord | null> {
    const { rows } = await this.pool.query(
      `select * from job_runs where dedupe_key = $1 limit 1`,
      [dedupeKey],
    );
    return rows[0] ? rowToJobRun(rows[0]) : null;
  }

  async countKnowledgeChunks(owner: string, repo: string): Promise<number> {
    const { rows } = await this.pool.query(
      `select count(*)::int as count from doc_chunks where owner = $1 and repo = $2`,
      [owner, repo],
    );
    return rows[0]?.count ?? 0;
  }

  async saveWaiver(input: {
    owner: string;
    repo: string;
    targetType: "issue" | "pull_request";
    targetNumber: number;
    requestedBy: string;
    reason?: string;
  }): Promise<WaiverRecord> {
    const { rows } = await this.pool.query(
      `
        insert into waivers
          (id, owner, repo, target_type, target_number, requested_by, reason)
        values
          ($1, $2, $3, $4, $5, $6, $7)
        returning *
      `,
      [
        crypto.randomUUID(),
        input.owner,
        input.repo,
        input.targetType,
        input.targetNumber,
        input.requestedBy,
        input.reason ?? null,
      ],
    );
    return rowToWaiver(rows[0]);
  }

  async getLatestWaiver(
    owner: string,
    repo: string,
    targetType: "issue" | "pull_request",
    targetNumber: number,
  ): Promise<WaiverRecord | null> {
    const { rows } = await this.pool.query(
      `
        select * from waivers
        where owner = $1 and repo = $2 and target_type = $3 and target_number = $4
        order by created_at desc
        limit 1
      `,
      [owner, repo, targetType, targetNumber],
    );
    return rows[0] ? rowToWaiver(rows[0]) : null;
  }

  async listWaivers(
    owner: string,
    repo: string,
    targetType?: "issue" | "pull_request",
    targetNumber?: number,
  ): Promise<WaiverRecord[]> {
    const { rows } = await this.pool.query(
      `
        select * from waivers
        where owner = $1
          and repo = $2
          and ($3::text is null or target_type = $3)
          and ($4::int is null or target_number = $4)
        order by created_at desc
      `,
      [owner, repo, targetType ?? null, targetNumber ?? null],
    );
    return rows.map(rowToWaiver);
  }

  async replaceKnowledgeChunks(
    owner: string,
    repo: string,
    chunks: Array<{
      path: string;
      chunkIndex: number;
      content: string;
      contentHash: string;
    }>,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`delete from doc_chunks where owner = $1 and repo = $2`, [owner, repo]);
      for (const chunk of chunks) {
        await client.query(
          `
            insert into doc_chunks
              (id, owner, repo, path, chunk_index, content, content_hash)
            values
              ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            crypto.randomUUID(),
            owner,
            repo,
            chunk.path,
            chunk.chunkIndex,
            chunk.content,
            chunk.contentHash,
          ],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async searchKnowledgeChunks(
    owner: string,
    repo: string,
    query: string,
    limit = 6,
  ): Promise<RepositoryKnowledgeChunk[]> {
    if (!query.trim()) {
      const { rows } = await this.pool.query(
        `
          select *, 0 as score
          from doc_chunks
          where owner = $1 and repo = $2
          order by created_at desc
          limit $3
        `,
        [owner, repo, limit],
      );
      return rows.map(rowToKnowledgeChunk);
    }

    const { rows } = await this.pool.query(
      `
        select *,
               ts_rank_cd(
                 to_tsvector('simple', path || ' ' || content),
                 websearch_to_tsquery('simple', $3)
               ) as score
        from doc_chunks
        where owner = $1
          and repo = $2
          and to_tsvector('simple', path || ' ' || content) @@ websearch_to_tsquery('simple', $3)
        order by score desc, created_at desc
        limit $4
      `,
      [owner, repo, query, limit],
    );
    return rows.map(rowToKnowledgeChunk);
  }
}
