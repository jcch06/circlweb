-- Incremental Oracle analysis: persists per-contact embeddings, cluster
-- centroids, and per-cluster MAP results across runs so a re-analysis only
-- recomputes what actually changed (new/edited contacts) instead of the
-- entire network every time. This is what makes repeat analyses cheap and
-- fast — the previous design recomputed every embedding and re-ran every
-- MAP prompt on every single run, even if nothing changed.
--
-- Scoping: most Oracle runs are scoped to a single space (spaceId is not
-- null) — those rows are shared across every member of that space, since
-- they all see the same underlying contact set and can equally benefit from
-- each other's prior runs (guarded by the space's own RLS below). The
-- "spaceId is null" case ("tous mes contacts", merged across every space the
-- caller belongs to) is inherently per-caller — two different users see
-- different merged sets — so those rows are scoped to owner_id instead.
--
-- Cached results are stored RAW/unredacted (e.g. oracle_batch_cache.result
-- can name a currently-locked contact). Every read path MUST re-apply the
-- caller's current lock-based redaction (same as a freshly computed result)
-- before anything reaches a client — caching here must never bypass that.
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS).

-- 1. Per-contact embedding cache -------------------------------------------

create table if not exists public.contact_embeddings (
  contact_id uuid primary key references public.contacts(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  content_hash text not null,
  embedding jsonb not null,
  cluster_id uuid,
  updated_at timestamptz not null default now()
);

create index if not exists contact_embeddings_space_idx
  on public.contact_embeddings (space_id);
create index if not exists contact_embeddings_cluster_idx
  on public.contact_embeddings (cluster_id);

alter table public.contact_embeddings enable row level security;

drop policy if exists "space members manage embeddings" on public.contact_embeddings;
create policy "space members manage embeddings" on public.contact_embeddings
  for all using (
    space_id in (select id from public.spaces)
  ) with check (
    space_id in (select id from public.spaces)
  );

-- 2. Persisted cluster centroids --------------------------------------------

create table if not exists public.oracle_clusters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  space_id uuid references public.spaces(id) on delete cascade,
  scope_key text not null,
  centroid jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists oracle_clusters_scope_idx
  on public.oracle_clusters (scope_key);

alter table public.oracle_clusters enable row level security;

drop policy if exists "space members manage clusters" on public.oracle_clusters;
create policy "space members manage clusters" on public.oracle_clusters
  for all using (
    (space_id is not null and space_id in (select id from public.spaces))
    or (space_id is null and owner_id = auth.uid())
  ) with check (
    (space_id is not null and space_id in (select id from public.spaces))
    or (space_id is null and owner_id = auth.uid())
  );

alter table public.contact_embeddings drop constraint if exists contact_embeddings_cluster_fkey;
alter table public.contact_embeddings
  add constraint contact_embeddings_cluster_fkey
  foreign key (cluster_id) references public.oracle_clusters(id) on delete set null;

-- 3. Cached per-cluster MAP result -------------------------------------------

create table if not exists public.oracle_batch_cache (
  cluster_id uuid primary key references public.oracle_clusters(id) on delete cascade,
  scope_key text not null,
  space_id uuid references public.spaces(id) on delete cascade,
  owner_id uuid not null,
  contact_ids_hash text not null,
  result jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists oracle_batch_cache_scope_idx
  on public.oracle_batch_cache (scope_key);

alter table public.oracle_batch_cache enable row level security;

drop policy if exists "space members manage batch cache" on public.oracle_batch_cache;
create policy "space members manage batch cache" on public.oracle_batch_cache
  for all using (
    (space_id is not null and space_id in (select id from public.spaces))
    or (space_id is null and owner_id = auth.uid())
  ) with check (
    (space_id is not null and space_id in (select id from public.spaces))
    or (space_id is null and owner_id = auth.uid())
  );

-- 4. Cached SUPPLY/DEMAND result ---------------------------------------------

create table if not exists public.oracle_supply_demand_cache (
  scope_key text primary key,
  space_id uuid references public.spaces(id) on delete cascade,
  owner_id uuid not null,
  contacts_hash text not null,
  result jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.oracle_supply_demand_cache enable row level security;

drop policy if exists "space members manage supply demand cache" on public.oracle_supply_demand_cache;
create policy "space members manage supply demand cache" on public.oracle_supply_demand_cache
  for all using (
    (space_id is not null and space_id in (select id from public.spaces))
    or (space_id is null and owner_id = auth.uid())
  ) with check (
    (space_id is not null and space_id in (select id from public.spaces))
    or (space_id is null and owner_id = auth.uid())
  );
