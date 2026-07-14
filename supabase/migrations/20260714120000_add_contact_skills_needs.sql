-- Sprint 1 — "Réparer le tuyau"
-- Adds structured columns so the AI enrichment (Perplexity) can persist the
-- skills (supply) and inferred needs (demand) it already extracts. These feed
-- the synergy engine (detectGroupSynergies) and the new Offre/Demande matrix
-- (buildSupplyDemandMatrix). Without these columns, the enrichment discards
-- skills/needs and the analysis works from notes only.
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS).

alter table public.contacts
  add column if not exists skills text[] default '{}'::text[];

alter table public.contacts
  add column if not exists inferred_needs text[] default '{}'::text[];

-- Optional but recommended: GIN indexes for fast filtering/search on these arrays.
create index if not exists contacts_skills_gin
  on public.contacts using gin (skills);

create index if not exists contacts_inferred_needs_gin
  on public.contacts using gin (inferred_needs);
