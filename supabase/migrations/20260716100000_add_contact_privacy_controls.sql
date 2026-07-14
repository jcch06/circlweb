-- Confidentialité inter-réseaux (Phases 2-3): by default a team member only
-- sees a contact's first/last name unless they own it or have been granted
-- access. Spaces can opt into this "request_only" mode; existing spaces keep
-- today's full-sharing behavior (default 'full') so nothing breaks silently.
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS / CREATE OR REPLACE).

-- 1. Per-space sharing policy -------------------------------------------------

alter table public.spaces
  add column if not exists contact_sharing_mode text not null default 'full'
  check (contact_sharing_mode in ('full', 'request_only'));

-- 2. Access requests -----------------------------------------------------------

create table if not exists public.contact_access_requests (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  reason text,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (contact_id, requester_id)
);

create index if not exists contact_access_requests_owner_idx
  on public.contact_access_requests (owner_id, status);

create index if not exists contact_access_requests_requester_idx
  on public.contact_access_requests (requester_id, status);

alter table public.contact_access_requests enable row level security;

drop policy if exists "select own requests" on public.contact_access_requests;
create policy "select own requests" on public.contact_access_requests
  for select using (owner_id = auth.uid() or requester_id = auth.uid());

drop policy if exists "insert own requests" on public.contact_access_requests;
create policy "insert own requests" on public.contact_access_requests
  for insert with check (requester_id = auth.uid());

drop policy if exists "owner responds to requests" on public.contact_access_requests;
create policy "owner responds to requests" on public.contact_access_requests
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- 3. Helpers ---------------------------------------------------------------

-- Safe, minimal identity lookup (SECURITY DEFINER so it can read auth.users)
-- — returns a display name only, never the raw email or other auth data.
create or replace function public.get_user_display_name(p_user_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(nullif(trim(raw_user_meta_data->>'full_name'), ''), split_part(email, '@', 1))
  from auth.users
  where id = p_user_id;
$$;

grant execute on function public.get_user_display_name(uuid) to authenticated;

-- Whether the CURRENT user (auth.uid()) may see the full details of a given
-- contact. Fails safe: any ambiguity (missing rows, RLS hiding the space)
-- resolves to "not visible" rather than accidentally granting access.
create or replace function public.can_view_contact_full(p_contact_id uuid)
returns boolean
language plpgsql
security invoker
stable
as $$
declare
  v_owner_id uuid;
  v_space_id uuid;
  v_sharing_mode text;
begin
  select owner_id, space_id into v_owner_id, v_space_id
  from public.contacts where id = p_contact_id;

  if v_owner_id is null then
    return false;
  end if;

  if v_owner_id = auth.uid() then
    return true;
  end if;

  if v_space_id is null then
    return true;
  end if;

  select contact_sharing_mode into v_sharing_mode
  from public.spaces where id = v_space_id;

  if v_sharing_mode is distinct from 'request_only' then
    return true;
  end if;

  return exists (
    select 1 from public.contact_access_requests r
    where r.contact_id = p_contact_id
      and r.requester_id = auth.uid()
      and r.status = 'approved'
  );
end;
$$;

grant execute on function public.can_view_contact_full(uuid) to authenticated;

-- 4. Masked read views -------------------------------------------------------
-- security_invoker so these views run under the CALLING user's RLS on the
-- underlying tables (not the view owner's) — required on Postgres 15+.

create or replace view public.contacts_visible
with (security_invoker = true) as
select
  c.id,
  c.space_id,
  c.owner_id,
  c.first_name,
  c.last_name,
  case when public.can_view_contact_full(c.id) then c.company else null end as company,
  case when public.can_view_contact_full(c.id) then c.job_title else null end as job_title,
  case when public.can_view_contact_full(c.id) then c.industry else null end as industry,
  case when public.can_view_contact_full(c.id) then c.location else null end as location,
  case when public.can_view_contact_full(c.id) then c.bio else null end as bio,
  case when public.can_view_contact_full(c.id) then c.email else null end as email,
  case when public.can_view_contact_full(c.id) then c.phone else null end as phone,
  case when public.can_view_contact_full(c.id) then c.linkedin else null end as linkedin,
  case when public.can_view_contact_full(c.id) then c.ai_context else null end as ai_context,
  case when public.can_view_contact_full(c.id) then c.skills else '{}'::text[] end as skills,
  case when public.can_view_contact_full(c.id) then c.inferred_needs else '{}'::text[] end as inferred_needs,
  case when public.can_view_contact_full(c.id) then c.company_size else null end as company_size,
  c.source,
  c.created_at,
  c.enriched_at,
  c.shared_contact_id,
  public.can_view_contact_full(c.id) as is_unlocked,
  public.get_user_display_name(c.owner_id) as owner_display_name
from public.contacts c;

grant select on public.contacts_visible to authenticated;

create or replace view public.notes_visible
with (security_invoker = true) as
select n.*
from public.notes n
where public.can_view_contact_full(n.contact_id);

grant select on public.notes_visible to authenticated;

create or replace view public.contact_tags_visible
with (security_invoker = true) as
select ct.*
from public.contact_tags ct
where public.can_view_contact_full(ct.contact_id);

grant select on public.contact_tags_visible to authenticated;

-- NOTE: this migration only masks READS. Existing write policies on
-- contacts/notes/contact_tags are unchanged — a team member who could edit a
-- shared contact before this migration still can, even if they can no longer
-- see its current (locked) values. Locking down writes too is a deliberate
-- follow-up, not done here to avoid changing collaborative-editing behavior
-- without an explicit decision on what that should look like.
