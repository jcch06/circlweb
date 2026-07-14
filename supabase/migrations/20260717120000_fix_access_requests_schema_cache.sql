-- Defensive fix: guarantees contact_access_requests.space_id exists
-- regardless of what happened with the previous migration (a stale
-- PostgREST schema cache after a manual SQL Editor run is the most likely
-- explanation for "column ... does not exist" errors from the REST API
-- even when the column is actually present in Postgres), and forces
-- PostgREST to reload its schema cache so the REST API picks it up.
--
-- Safe to run multiple times.

alter table public.contact_access_requests
  add column if not exists space_id uuid references public.spaces(id) on delete cascade;

-- Force PostgREST (Supabase's REST API layer) to reload its cached schema.
notify pgrst, 'reload schema';
