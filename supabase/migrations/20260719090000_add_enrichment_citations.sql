-- Perplexity web enrichment already searches the live web to fill in a
-- contact's bio/context, but discarded the sources it found — the user had
-- no way to verify an AI-generated claim without re-searching manually.
-- Persists those sources (title + url) alongside the enrichment itself.
--
-- Safe to run multiple times (idempotent).

alter table public.contacts
  add column if not exists enrichment_sources jsonb not null default '[]'::jsonb;

-- Re-expose through the masked view (Phase 2/3 privacy) the same way as
-- every other AI-enrichment field: only visible when the caller can see the
-- contact's full details, never leaked alongside just the name.
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
  public.get_user_display_name(c.owner_id) as owner_display_name,
  case when public.can_view_contact_full(c.id) then c.enrichment_sources else '[]'::jsonb end as enrichment_sources
from public.contacts c;

grant select on public.contacts_visible to authenticated;
