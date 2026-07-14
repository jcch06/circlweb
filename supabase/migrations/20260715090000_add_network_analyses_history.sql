-- Persists every full Oracle Map-Reduce run (not just the latest one in
-- localStorage) so past analyses stay readable even after running new ones,
-- and so two runs can be diffed to show network evolution over time.
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS).

create table if not exists public.network_analyses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete cascade,
  label text,
  contact_count integer not null default 0,
  contact_ids text[] not null default '{}'::text[],
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists network_analyses_owner_created_idx
  on public.network_analyses (owner_id, created_at desc);

create index if not exists network_analyses_space_created_idx
  on public.network_analyses (space_id, created_at desc);

alter table public.network_analyses enable row level security;

-- Visible to the person who ran it, and to anyone who can see the space it
-- was run against (team spaces): the subquery is itself subject to the
-- `spaces` table's own RLS, so this naturally follows whatever visibility
-- rules already exist there.
drop policy if exists "select own or space analyses" on public.network_analyses;
create policy "select own or space analyses" on public.network_analyses
  for select using (
    owner_id = auth.uid()
    or (space_id is not null and space_id in (select id from public.spaces))
  );

drop policy if exists "insert own analyses" on public.network_analyses;
create policy "insert own analyses" on public.network_analyses
  for insert with check (
    owner_id = auth.uid()
    and (space_id is null or space_id in (select id from public.spaces))
  );

drop policy if exists "delete own analyses" on public.network_analyses;
create policy "delete own analyses" on public.network_analyses
  for delete using (owner_id = auth.uid());

-- NOTE: these policies assume `spaces` already has RLS that scopes rows to
-- users who own or belong to them (team membership). If your actual spaces
-- RLS differs, adjust the `space_id in (select id from public.spaces)`
-- subquery accordingly.
