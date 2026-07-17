-- Async Oracle pipeline (option B): a resumable, background-friendly analysis
-- job so a large network (up to ~10k contacts) can be analyzed in bounded
-- chunks across many short serverless invocations instead of one synchronous
-- browser-driven run that blows past every 60s function limit.
--
-- A job walks through phases (embed → plan → map → reduce → supply → done),
-- doing a BOUNDED slice of work per "advance" call and persisting progress
-- after each slice. If the tab closes mid-run the job survives here and a cron
-- (or the client on return) resumes it exactly where it stopped.
--
-- Per-batch MAP results live in their own table so each completed batch is a
-- small independent write — we never rewrite one giant jsonb blob per batch.
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS).

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  space_id uuid references public.spaces(id) on delete cascade,
  -- pending (created, not started) | running | done | error
  status text not null default 'pending',
  -- init | embed | plan | map | reduce | supply | done
  phase text not null default 'init',
  progress int not null default 0,             -- 0..100 for the UI
  -- embedding progress
  total_to_embed int not null default 0,
  embedded int not null default 0,
  -- map progress
  total_batches int not null default 0,
  completed_batches int not null default 0,
  -- carried context / partial + final results
  user_profile jsonb,
  bridge_contacts jsonb,
  locked_names jsonb,
  synthesis jsonb,
  supply_demand jsonb,
  analyzed_count int not null default 0,
  excluded_count int not null default 0,
  capped_count int not null default 0,
  error text,
  -- lets a stalled/cron pickup detect abandoned in-flight work
  heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists analysis_jobs_owner_status_idx
  on public.analysis_jobs (owner_id, status);
create index if not exists analysis_jobs_status_heartbeat_idx
  on public.analysis_jobs (status, heartbeat_at);

alter table public.analysis_jobs enable row level security;

drop policy if exists "owner manages own analysis jobs" on public.analysis_jobs;
create policy "owner manages own analysis jobs" on public.analysis_jobs
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Per-batch MAP work + result. One row per (job, batch); written once when
-- that batch's MAP completes.
create table if not exists public.analysis_job_batches (
  job_id uuid not null references public.analysis_jobs(id) on delete cascade,
  batch_index int not null,
  contact_ids jsonb not null,
  cluster_id text,
  contact_ids_hash text,
  -- pending | done
  status text not null default 'pending',
  result jsonb,
  updated_at timestamptz not null default now(),
  primary key (job_id, batch_index)
);

create index if not exists analysis_job_batches_job_status_idx
  on public.analysis_job_batches (job_id, status);

alter table public.analysis_job_batches enable row level security;

-- A batch row is reachable only through a job the caller owns.
drop policy if exists "owner manages own job batches" on public.analysis_job_batches;
create policy "owner manages own job batches" on public.analysis_job_batches
  for all using (
    job_id in (select id from public.analysis_jobs where owner_id = auth.uid())
  ) with check (
    job_id in (select id from public.analysis_jobs where owner_id = auth.uid())
  );
