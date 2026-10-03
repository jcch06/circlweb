-- Audit Astra du 03/10/2026, lot 1 (frontière de données) + import web.
-- Vérifié en base avant correction : aucun cercle n'est en request_only et
-- aucune demande d'accès n'est approuvée, donc aucune fuite n'a eu lieu.

-- 1. can_view_contact_full devient security definer : elle est désormais
--    appelée par la policy SELECT de contacts et relit contacts (sinon
--    récursion RLS). Elle ne renvoie qu'un booléen.
alter function public.can_view_contact_full(uuid) security definer set search_path = public;

-- 2. La table brute ne livre plus une fiche verrouillée : seuls le
--    propriétaire et les membres autorisés la lisent. Les autres passent par
--    contacts_visible, qui masque les champs.
drop policy if exists "Members can view contacts in their spaces" on public.contacts;
create policy "Members can view contacts in their spaces" on public.contacts for select
  using (owner_id = auth.uid()
         or (space_id in (select user_space_ids(auth.uid())) and can_view_contact_full(id)));

-- 3. contacts_visible lit la table avec les droits de son propriétaire, filtre
--    elle-même sur les cercles de l'appelant et masque aussi last_contacted_at.
create or replace view public.contacts_visible with (security_invoker = false) as
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
    get_user_display_name(c.owner_id) as owner_display_name,
    case when vis.full then c.enrichment_sources else '[]'::jsonb end as enrichment_sources,
    case when vis.full then c.last_contacted_at else null end as last_contacted_at,
    case when vis.full then c.photo_url else null end as photo_url
 from contacts c
 cross join lateral (select can_view_contact_full(c.id) as full offset 0) vis
 where c.space_id in (select user_space_ids(auth.uid()));
revoke all on public.contacts_visible from anon;

-- 4. Demandes d'accès : la base impose demandeur, propriétaire réel et statut
--    « pending » à la création ; une réponse ne peut changer que le statut.
drop policy if exists "insert own requests" on public.contact_access_requests;
drop policy if exists "Members can request access" on public.contact_access_requests;
drop policy if exists "Owner can respond to requests" on public.contact_access_requests;
drop policy if exists "owner responds to requests" on public.contact_access_requests;
create policy "Members can request access" on public.contact_access_requests for insert
  with check (requester_id = auth.uid());
create policy "Owner can respond to requests" on public.contact_access_requests for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.guard_contact_access_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_space uuid;
begin
  if tg_op = 'INSERT' then
    select owner_id, space_id into v_owner, v_space from contacts where id = new.contact_id;
    if v_owner is null or v_space not in (select user_space_ids(auth.uid())) then
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
drop trigger if exists guard_contact_access_request on public.contact_access_requests;
create trigger guard_contact_access_request before insert or update on public.contact_access_requests
  for each row execute function public.guard_contact_access_request();

-- 5. Mises à jour détectées et liens suivent le verrouillage de la fiche.
drop policy if exists "Members can view contact updates" on public.contact_updates;
create policy "Members can view contact updates" on public.contact_updates for select
  using (space_id in (select user_space_ids(auth.uid())) and can_view_contact_full(contact_id));
drop policy if exists "Members can view contact links" on public.contact_links;
create policy "Members can view contact links" on public.contact_links for select
  using (space_id in (select user_space_ids(auth.uid()))
         and can_view_contact_full(from_contact_id) and can_view_contact_full(to_contact_id));

-- 6. La recherche sémantique (security definer) ne renvoie plus de fiche verrouillée.
create or replace function public.search_contacts(query_embedding vector, match_threshold double precision default 0.7, match_count integer default 20, target_space_id uuid default null)
returns table(id uuid, first_name text, last_name text, job_title text, company text, industry text, location text, ai_context text, similarity double precision)
language plpgsql security definer set search_path = public as $$
begin
    return query
    select c.id, c.first_name, c.last_name, c.job_title, c.company, c.industry, c.location, c.ai_context,
        1 - (c.embedding <=> query_embedding) as similarity
    from public.contacts c
    where c.embedding is not null
        and 1 - (c.embedding <=> query_embedding) > match_threshold
        and c.space_id in (select public.user_space_ids(auth.uid()))
        and (target_space_id is null or c.space_id = target_space_id)
        and public.can_view_contact_full(c.id)
    order by c.embedding <=> query_embedding
    limit match_count;
end $$;
revoke execute on function public.search_contacts(vector, double precision, integer, uuid) from public, anon;

-- 7. L'import web écrit source = 'import' : la contrainte d'origine le refusait.
alter table public.contacts drop constraint if exists contacts_source_check;
alter table public.contacts add constraint contacts_source_check
  check (source = any (array['iphone_import', 'manual', 'enrichment', 'import']));

-- 8. Devenue security definer, can_view_contact_full n'est plus exposée à anon.
revoke execute on function public.can_view_contact_full(uuid) from public, anon;
grant execute on function public.can_view_contact_full(uuid) to authenticated, service_role;
