-- Tenue à grande échelle (10 000 à 50 000 contacts par utilisateur).
-- 1. Dernier échange matérialisé : contacts.touched_at = max(last_contacted_at,
--    dernière note non privée). Fini la sous-requête sur les notes par contact.
-- 2. contacts_visible calcule le droit de lecture complète par jointure
--    (ensembliste) au lieu d'un appel de fonction par ligne.

alter table public.contacts add column if not exists touched_at timestamptz;
update public.contacts c set touched_at = greatest(c.last_contacted_at,
  (select max(n.created_at) from public.notes n where n.contact_id = c.id and not n.is_private));
create index if not exists contacts_space_touched_idx on public.contacts (space_id, touched_at);

create or replace function public.contacts_keep_touched()
returns trigger language plpgsql set search_path = public as $$
begin
  new.touched_at := greatest(new.last_contacted_at, case when tg_op = 'UPDATE' then old.touched_at end, new.touched_at);
  return new;
end $$;
drop trigger if exists contacts_keep_touched on public.contacts;
create trigger contacts_keep_touched before insert or update of last_contacted_at on public.contacts
  for each row execute function public.contacts_keep_touched();

-- Une note (non privée) ajoutée, modifiée ou supprimée met à jour le dernier échange.
create or replace function public.notes_refresh_touched()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_contact uuid := coalesce(new.contact_id, old.contact_id);
begin
  update contacts c set touched_at = greatest(c.last_contacted_at,
    (select max(n.created_at) from notes n where n.contact_id = v_contact and not n.is_private))
  where c.id = v_contact;
  return null;
end $$;
revoke execute on function public.notes_refresh_touched() from public, anon, authenticated;
drop trigger if exists notes_refresh_touched on public.notes;
create trigger notes_refresh_touched after insert or update of is_private, contact_id or delete on public.notes
  for each row execute function public.notes_refresh_touched();

-- auth.uid() est évalué une seule fois (CTE matérialisée) et non par ligne.
create or replace view public.contacts_visible with (security_invoker = false) as
 with me as materialized (select auth.uid() as uid)
 select c.id, c.space_id, c.owner_id, c.first_name, c.last_name,
    case when vis.full then c.company else null end as company,
    case when vis.full then c.job_title else null end as job_title,
    case when vis.full then c.industry else null end as industry,
    case when vis.full then c.location else null end as location,
    case when vis.full then c.bio else null end as bio,
    case when vis.full then c.email else null end as email,
    case when vis.full then c.phone else null end as phone,
    case when vis.full then c.linkedin else null end as linkedin,
    case when vis.full then c.ai_context else null end as ai_context,
    case when vis.full then c.skills else '{}'::text[] end as skills,
    case when vis.full then c.inferred_needs else '{}'::text[] end as inferred_needs,
    case when vis.full then c.company_size else null end as company_size,
    c.source, c.created_at, c.enriched_at, c.shared_contact_id,
    vis.full as is_unlocked,
    coalesce(nullif(trim(ou.raw_user_meta_data->>'full_name'), ''), split_part(ou.email, '@', 1)) as owner_display_name,
    case when vis.full then c.enrichment_sources else '[]'::jsonb end as enrichment_sources,
    case when vis.full then c.last_contacted_at else null end as last_contacted_at,
    case when vis.full then c.photo_url else null end as photo_url,
    case when vis.full then c.touched_at else null end as touched_at
 from contacts c
 cross join me
 left join spaces s on s.id = c.space_id
 left join auth.users ou on ou.id = c.owner_id
 cross join lateral (select (
     c.owner_id = me.uid
     or s.contact_sharing_mode is distinct from 'request_only'
     or exists (select 1 from contact_access_requests r
                where r.contact_id = c.id and r.requester_id = me.uid and r.status = 'approved')
   ) as full) vis
 where c.space_id in (select user_space_ids(me.uid));
revoke all on public.contacts_visible from anon;

-- search_contacts : même contrat, le dernier échange vient de touched_at.
create or replace function public.search_contacts(
  p_q text default '', p_view text default 'all', p_status text default null, p_tag uuid default null,
  p_space uuid default null, p_sort text default 'name', p_offset int default 0, p_limit int default 100
) returns jsonb
language sql stable security invoker set search_path = public as $$
with base as (
  select v.* from contacts_visible v where p_space is null or v.space_id = p_space
),
dedup as (
  select distinct on (case when p_space is null then coalesce(b.shared_contact_id, b.id) else b.id end) b.*
  from base b
  order by case when p_space is null then coalesce(b.shared_contact_id, b.id) else b.id end, b.id
),
st as (
  select d.*, d.touched_at as touch, case
      when d.touched_at is null then 'never'
      when d.touched_at > now() - interval '30 days' then 'fresh'
      when d.touched_at >= now() - interval '90 days' then 'due'
      else 'dormant' end as status
  from dedup d
),
filtered as (
  select s.* from st s
  where (coalesce(p_q, '') = ''
      or (coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) ilike '%' || p_q || '%'
      or s.company ilike '%' || p_q || '%'
      or s.job_title ilike '%' || p_q || '%'
      or exists (select 1 from contact_tags ct join tags tg on tg.id = ct.tag_id
                 where ct.contact_id = s.id and tg.name ilike '%' || p_q || '%'))
    and (p_view <> 'due' or s.status in ('due', 'dormant'))
    and (p_view <> 'not_enriched' or s.enriched_at is null)
    and (p_tag is null or exists (select 1 from contact_tags ct where ct.contact_id = s.id and ct.tag_id = p_tag))
),
counts as (select status, count(*) as n from filtered group by status),
final as (select * from filtered where p_status is null or status = p_status),
ranked as (
  select f.*, row_number() over (order by
      case when p_sort = 'company' then lower(coalesce(f.company, '')) end nulls last,
      case when p_sort = 'last' or (p_view = 'due' and p_sort = 'name') then f.touch end asc nulls first,
      lower(coalesce(f.first_name, '') || ' ' || coalesce(f.last_name, '')),
      f.id) as rn
  from final f
)
select jsonb_build_object(
  'total', (select count(*) from final),
  'counts', coalesce((select jsonb_object_agg(status, n) from counts), '{}'::jsonb),
  'rows', coalesce((select jsonb_agg(to_jsonb(r) - 'rn' order by r.rn) from ranked r
                    where r.rn > p_offset and r.rn <= p_offset + p_limit), '[]'::jsonb)
);
$$;
