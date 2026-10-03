-- Recherches FullEnrich asynchrones : le waterfall peut prendre plusieurs
-- minutes, au-delà de ce qu'un appel HTTP synchrone tient. La fonction
-- find-contact-info crée un job, le client l'interroge jusqu'au résultat.
create table if not exists public.enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  kind text not null check (kind in ('email', 'phone')),
  enrichment_id text not null,
  status text not null default 'pending' check (status in ('pending', 'found', 'not_found', 'error')),
  value text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists enrichment_jobs_user_idx on public.enrichment_jobs (user_id, created_at desc);

alter table public.enrichment_jobs enable row level security;
drop policy if exists "own jobs read" on public.enrichment_jobs;
create policy "own jobs read" on public.enrichment_jobs for select using (user_id = auth.uid());
-- Écritures réservées à la fonction (service role) : aucune policy d'écriture.
