-- Audit Astra lot 2 : état intermédiaire « finalizing » entre la fin du
-- waterfall FullEnrich et l'écriture de la fiche (un seul appel débite).
alter table public.enrichment_jobs drop constraint if exists enrichment_jobs_status_check;
alter table public.enrichment_jobs add constraint enrichment_jobs_status_check
  check (status in ('pending', 'finalizing', 'found', 'not_found', 'error'));
create index if not exists enrichment_jobs_active_idx on public.enrichment_jobs (user_id, contact_id, kind)
  where status in ('pending', 'finalizing');
