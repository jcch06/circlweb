-- Partage par référence : une personne = une fiche, visible dans plusieurs
-- cercles. Partager une fiche avec un cercle ajoute une ligne contact_shares,
-- au lieu de copier la fiche (cause des doublons). La fiche garde son cercle
-- d'origine (space_id) : c'est lui qui fixe le mode de partage (verrouillage)
-- et qui donne les droits d'écriture (propriétaire, admins).
-- Les copies déjà existantes ne sont pas converties : elles appartiennent
-- souvent à d'autres utilisateurs, et l'affichage les regroupe déjà.

create table if not exists public.contact_shares (
  contact_id uuid not null references public.contacts(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  shared_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, space_id)
);
create index if not exists contact_shares_space_idx on public.contact_shares (space_id, contact_id);
alter table public.contact_shares enable row level security;

-- Lecture : les membres du cercle destinataire, et l'auteur du partage.
drop policy if exists "shares read" on public.contact_shares;
create policy "shares read" on public.contact_shares for select
  using (space_id in (select user_space_ids(auth.uid())) or shared_by = auth.uid());
-- Partager : être membre du cercle destinataire et pouvoir modifier la fiche
-- (propriétaire, ou admin de son cercle d'origine).
create or replace function public.can_share_contact(p_contact uuid, p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from contacts c
    where c.id = p_contact and c.space_id <> p_space
      and (c.owner_id = auth.uid() or user_role_in_space(auth.uid(), c.space_id) in ('owner', 'admin'))
  ) and user_role_in_space(auth.uid(), p_space) in ('owner', 'admin', 'member');
$$;
revoke execute on function public.can_share_contact(uuid, uuid) from public, anon;
grant execute on function public.can_share_contact(uuid, uuid) to authenticated;
drop policy if exists "shares insert" on public.contact_shares;
create policy "shares insert" on public.contact_shares for insert
  with check (shared_by = auth.uid() and can_share_contact(contact_id, space_id));
-- Retirer un partage : son auteur, le propriétaire de la fiche, ou un admin du cercle destinataire.
drop policy if exists "shares delete" on public.contact_shares;
create policy "shares delete" on public.contact_shares for delete
  using (shared_by = auth.uid()
         or user_role_in_space(auth.uid(), space_id) in ('owner', 'admin')
         or exists (select 1 from contacts c where c.id = contact_id and c.owner_id = auth.uid()));

-- Cercles où une fiche est visible pour l'appelant (origine et partages).
create or replace function public.contact_in_my_spaces(p_contact uuid, p_home uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_home in (select user_space_ids(auth.uid()))
      or exists (select 1 from contact_shares sh
                 where sh.contact_id = p_contact and sh.space_id in (select user_space_ids(auth.uid())));
$$;
revoke execute on function public.contact_in_my_spaces(uuid, uuid) from public, anon;
grant execute on function public.contact_in_my_spaces(uuid, uuid) to authenticated, service_role;

-- La fiche brute : propriétaire, ou visible par un cercle ET déverrouillée.
drop policy if exists "Members can view contacts in their spaces" on public.contacts;
create policy "Members can view contacts in their spaces" on public.contacts for select
  using (owner_id = auth.uid() or (contact_in_my_spaces(id, space_id) and can_view_contact_full(id)));

-- Les objets attachés à une fiche suivent la visibilité de la fiche brute
-- (cercles, partages et verrouillage compris) : « contact_id in (select id from contacts) ».
drop policy if exists "Members can view non-private notes" on public.notes;
create policy "Members can view non-private notes" on public.notes for select
  using (((not is_private) or author_id = auth.uid()) and contact_id in (select id from contacts));
drop policy if exists "Members can create notes" on public.notes;
create policy "Members can create notes" on public.notes for insert
  with check (author_id = auth.uid() and contact_id in (select id from contacts));

drop policy if exists "Members can view contact tags" on public.contact_tags;
create policy "Members can view contact tags" on public.contact_tags for select
  using (contact_id in (select id from contacts));
drop policy if exists "Members can tag contacts" on public.contact_tags;
create policy "Members can tag contacts" on public.contact_tags for insert
  with check (tagged_by = auth.uid() and contact_id in (select id from contacts));

drop policy if exists "Members can view contact permissions" on public.contact_permissions;
create policy "Members can view contact permissions" on public.contact_permissions for select
  using (contact_id in (select id from contacts));

drop policy if exists "Members can view contact updates" on public.contact_updates;
create policy "Members can view contact updates" on public.contact_updates for select
  using (contact_id in (select id from contacts));
drop policy if exists "Members can create contact updates" on public.contact_updates;
create policy "Members can create contact updates" on public.contact_updates for insert
  with check (detected_by = auth.uid() and contact_id in (select id from contacts));

drop policy if exists "Members can view contact links" on public.contact_links;
create policy "Members can view contact links" on public.contact_links for select
  using (from_contact_id in (select id from contacts) and to_contact_id in (select id from contacts));
drop policy if exists "Members can create contact links" on public.contact_links;
create policy "Members can create contact links" on public.contact_links for insert
  with check (space_id in (select user_space_ids(auth.uid())) and from_contact_id in (select id from contacts));

-- Demande d'accès : possible sur une fiche partagée dans un de mes cercles.
create or replace function public.guard_contact_access_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_space uuid;
begin
  if tg_op = 'INSERT' then
    select owner_id, space_id into v_owner, v_space from contacts where id = new.contact_id;
    if v_owner is null or not contact_in_my_spaces(new.contact_id, v_space) then
      raise exception 'Contact introuvable' using errcode = '42501';
    end if;
    new.requester_id := auth.uid();
    new.owner_id := v_owner;
    new.space_id := v_space;
    new.status := 'pending';
    new.responded_at := null;
  else
    new.contact_id := old.contact_id;
    new.requester_id := old.requester_id;
    new.owner_id := old.owner_id;
    new.space_id := old.space_id;
  end if;
  return new;
end $$;

-- Vue masquée : fiches de mes cercles et fiches partagées avec eux.
-- space_ids = cercles (parmi les miens) où la fiche est visible.
create or replace view public.contacts_visible with (security_invoker = false) as
 with me as materialized (select auth.uid() as uid),
 mine as materialized (select user_space_ids(auth.uid()) as sid)
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
    case when vis.full then c.touched_at else null end as touched_at,
    array(select x from (select c.space_id as x where c.space_id in (select sid from mine)
                         union select sh.space_id from contact_shares sh
                         where sh.contact_id = c.id and sh.space_id in (select sid from mine)) u) as space_ids
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
 where c.space_id in (select sid from mine)
    or exists (select 1 from contact_shares sh where sh.contact_id = c.id and sh.space_id in (select sid from mine));
revoke all on public.contacts_visible from anon;

-- search_contacts : filtrer un cercle inclut les fiches partagées avec lui.
create or replace function public.search_contacts(
  p_q text default '', p_view text default 'all', p_status text default null, p_tag uuid default null,
  p_space uuid default null, p_sort text default 'name', p_offset int default 0, p_limit int default 100
) returns jsonb
language sql stable security invoker set search_path = public as $$
with base as (
  select v.* from contacts_visible v where p_space is null or p_space = any(v.space_ids)
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
