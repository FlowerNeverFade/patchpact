create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists repositories (
  owner text not null,
  repo text not null,
  installation_id bigint,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner, repo)
);

create table if not exists contracts (
  id uuid primary key,
  owner text not null,
  repo text not null,
  issue_number integer not null,
  version integer not null,
  status text not null,
  generated_by text not null,
  approved_by text,
  content jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contracts_repo_issue_idx
  on contracts (owner, repo, issue_number, version desc);

create table if not exists decision_packets (
  id uuid primary key,
  owner text not null,
  repo text not null,
  pull_request_number integer not null,
  linked_contract_id uuid,
  generated_by text not null,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists decision_packets_repo_pr_idx
  on decision_packets (owner, repo, pull_request_number, created_at desc);

create table if not exists job_runs (
  id text primary key,
  type text not null,
  dedupe_key text not null unique,
  status text not null,
  payload jsonb not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists waivers (
  id uuid primary key,
  owner text not null,
  repo text not null,
  target_type text not null,
  target_number integer not null,
  requested_by text not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists waivers_repo_target_idx
  on waivers (owner, repo, target_type, target_number, created_at desc);

create table if not exists doc_chunks (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  repo text not null,
  path text not null,
  chunk_index integer not null,
  content text not null,
  content_hash text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists doc_chunks_repo_idx
  on doc_chunks (owner, repo, path);
