-- Contre-audit Astra du 04/10/2026 : droits de modification, partages,
-- crédits, Google. Vérifié en base avant correction : confirm/dismiss
--_contact_update laissaient passer un non-membre (NULL NOT IN (...) ne lève rien).

-- 1. Droit de modifier une fiche : propriétaire, ou owner/admin de son cercle d'origine.
create or replace function public.can_edit_contact(p_contact uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from contacts c
    where c.id = p_contact
      and (c.owner_id = auth.uid() or coalesce(user_role_in_space(auth.uid(), c.space_id), '') in ('owner', 'admin'))
  );
$$;
-- Fiche visible et déverrouillée pour l'appelant (origine ou partage).
create or replace function public.can_see_contact(p_contact uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from contacts c where c.id = p_contact
                 and (c.owner_id = auth.uid() or (contact_in_my_spaces(c.id, c.space_id) and can_view_contact_full(c.id))));
$$;
revoke execute on function public.can_edit_contact(uuid) from public, anon;
revoke execute on function public.can_see_contact(uuid) from public, anon;
grant execute on function public.can_edit_contact(uuid) to authenticated, service_role;
grant execute on function public.can_see_contact(uuid) to authenticated, service_role;

-- 2. Résolution des mises à jour détectées : appliquer exige le droit de
--    modifier la fiche ; écarter exige de la voir.
create or replace function public.confirm_contact_update(p_update_id uuid)
returns contact_updates language plpgsql security definer set search_path = public as $$
declare upd public.contact_updates; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into upd from contact_updates where id = p_update_id;
  if upd.id is null or not can_see_contact(upd.contact_id) then raise exception 'Update not found'; end if;
  if not can_edit_contact(upd.contact_id) then raise exception 'Seul le propriétaire de la fiche peut appliquer cette mise à jour.'; end if;
  if upd.status <> 'pending' then raise exception 'Update already resolved'; end if;
  if upd.field is not null and upd.new_value is not null then
    execute format('update public.contacts set %I = $1, updated_at = now() where id = $2', upd.field)
      using upd.new_value, upd.contact_id;
  end if;
  insert into notes (contact_id, author_id, content, context) values (upd.contact_id, uid, upd.summary, 'professional');
  update contact_updates set status = 'confirmed', resolved_by = uid, resolved_at = now()
    where id = p_update_id returning * into upd;
  return upd;
end $$;
create or replace function public.dismiss_contact_update(p_update_id uuid)
returns contact_updates language plpgsql security definer set search_path = public as $$
declare upd public.contact_updates; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into upd from contact_updates where id = p_update_id;
  if upd.id is null or not can_see_contact(upd.contact_id) then raise exception 'Update not found'; end if;
  update contact_updates set status = 'dismissed', resolved_by = uid, resolved_at = now()
    where id = p_update_id and status = 'pending' returning * into upd;
  return upd;
end $$;
revoke execute on function public.confirm_contact_update(uuid) from public, anon;
revoke execute on function public.dismiss_contact_update(uuid) from public, anon;
grant execute on function public.confirm_contact_update(uuid) to authenticated;
grant execute on function public.dismiss_contact_update(uuid) to authenticated;

-- Une mise à jour porte toujours le cercle d'origine réel de sa fiche.
create or replace function public.contact_updates_space()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select space_id into new.space_id from contacts where id = new.contact_id;
  return new;
end $$;
drop trigger if exists contact_updates_space on public.contact_updates;
create trigger contact_updates_space before insert on public.contact_updates
  for each row execute function public.contact_updates_space();

-- 3. Partages : le propriétaire voit tous les partages de sa fiche.
create or replace function public.is_contact_owner(p_contact uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from contacts where id = p_contact and owner_id = auth.uid());
$$;
revoke execute on function public.is_contact_owner(uuid) from public, anon;
grant execute on function public.is_contact_owner(uuid) to authenticated;
drop policy if exists "shares read" on public.contact_shares;
create policy "shares read" on public.contact_shares for select
  using (space_id in (select user_space_ids(auth.uid())) or shared_by = auth.uid() or is_contact_owner(contact_id));
drop policy if exists "shares delete" on public.contact_shares;
create policy "shares delete" on public.contact_shares for delete
  using (shared_by = auth.uid()
         or coalesce(user_role_in_space(auth.uid(), space_id), '') in ('owner', 'admin')
         or is_contact_owner(contact_id));

-- 4. Libellés des tags d'une fiche partagée : lisibles par ceux qui voient la fiche.
drop policy if exists "Members can view tags in their spaces" on public.tags;
create policy "Members can view tags in their spaces" on public.tags for select
  using (space_id in (select user_space_ids(auth.uid()))
         or id in (select ct.tag_id from contact_tags ct));

-- 5. Recherche vectorielle : mêmes fiches que la lecture (origine ou partage).
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
        and public.contact_in_my_spaces(c.id, c.space_id)
        and public.can_view_contact_full(c.id)
        and (target_space_id is null or c.space_id = target_space_id
             or exists (select 1 from contact_shares sh where sh.contact_id = c.id and sh.space_id = target_space_id))
    order by c.embedding <=> query_embedding
    limit match_count;
end $$;
revoke execute on function public.search_contacts(vector, double precision, integer, uuid) from public, anon;

-- 6. Google : interactions lisibles seulement si la fiche l'est encore ; le
--    rapprochement n'utilise que les fiches visibles et déverrouillées.
drop policy if exists "own interactions" on public.interactions;
create policy "own interactions" on public.interactions for select
  using (user_id = auth.uid() and contact_id in (select id from contacts));
create or replace function public.google_match_contacts(p_user uuid)
returns table(id uuid, email text, owner_id uuid)
language sql stable security definer set search_path = public as $$
  select c.id, lower(trim(c.email)), c.owner_id
  from contacts c
  left join spaces s on s.id = c.space_id
  where c.email is not null and c.email <> ''
    and (c.space_id in (select user_space_ids(p_user))
         or exists (select 1 from contact_shares sh where sh.contact_id = c.id and sh.space_id in (select user_space_ids(p_user))))
    and (c.owner_id = p_user or s.contact_sharing_mode is distinct from 'request_only'
         or exists (select 1 from contact_access_requests r where r.contact_id = c.id and r.requester_id = p_user and r.status = 'approved'));
$$;
revoke execute on function public.google_match_contacts(uuid) from public, anon, authenticated;
grant execute on function public.google_match_contacts(uuid) to service_role;

-- Tentatives OAuth à usage unique, liées à l'utilisateur qui les a lancées.
create table if not exists public.oauth_attempts (
  nonce uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.oauth_attempts enable row level security;
-- Aucune policy : accès réservé au service role.

-- 7. Crédits : réservation transactionnelle avant tout appel au fournisseur,
--    une seule recherche active par fiche et par champ, clôture atomique.
alter table public.enrichment_jobs alter column enrichment_id drop not null;
alter table public.enrichment_jobs add column if not exists cost int;
drop index if exists public.enrichment_jobs_active_idx;
create unique index if not exists enrichment_jobs_active_uniq on public.enrichment_jobs (user_id, contact_id, kind)
  where status in ('pending', 'finalizing');

create or replace function public.reserve_enrichment_job(p_user uuid, p_contact uuid, p_kind text, p_cost int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_balance int; v_reserved int; v_id uuid;
begin
  insert into enrichment_credits (user_id) values (p_user) on conflict (user_id) do nothing;
  select balance into v_balance from enrichment_credits where user_id = p_user for update;
  select coalesce(sum(cost), 0) into v_reserved from enrichment_jobs
    where user_id = p_user and status in ('pending', 'finalizing') and created_at > now() - interval '30 minutes';
  if v_balance - v_reserved < p_cost then raise exception 'Crédits insuffisants' using errcode = 'P0402'; end if;
  insert into enrichment_jobs (user_id, contact_id, kind, cost, status)
    values (p_user, p_contact, p_kind, p_cost, 'pending') returning id into v_id;
  return v_id;
end $$;

-- Clôture : débit, écriture de la fiche et état final dans une seule transaction.
create or replace function public.finalize_enrichment_job(p_job uuid, p_value text)
returns text language plpgsql security definer set search_path = public as $$
declare j enrichment_jobs; v_balance int;
begin
  select * into j from enrichment_jobs where id = p_job for update;
  if j.id is null or j.status not in ('pending', 'finalizing') then return coalesce(j.status, 'missing'); end if;
  if p_value is null or p_value = '' then
    update enrichment_jobs set status = 'not_found', finished_at = now() where id = p_job;
    return 'not_found';
  end if;
  update enrichment_credits set balance = balance - j.cost, updated_at = now()
    where user_id = j.user_id and balance >= j.cost returning balance into v_balance;
  if v_balance is null then
    update enrichment_jobs set status = 'error', error = 'Crédits insuffisants', finished_at = now() where id = p_job;
    return 'error';
  end if;
  insert into credit_ledger (user_id, delta, reason, contact_id, ref) values (j.user_id, -j.cost, 'fullenrich_' || j.kind, j.contact_id, 'job:' || j.id);
  execute format('update contacts set %I = $1 where id = $2', case j.kind when 'email' then 'email' else 'phone' end)
    using p_value, j.contact_id;
  update enrichment_jobs set status = 'found', value = p_value, finished_at = now() where id = p_job;
  return 'found';
end $$;
revoke execute on function public.reserve_enrichment_job(uuid, uuid, text, int) from public, anon, authenticated;
revoke execute on function public.finalize_enrichment_job(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_enrichment_job(uuid, uuid, text, int) to service_role;
grant execute on function public.finalize_enrichment_job(uuid, text) to service_role;

-- 8. Intros : la relance J+7 est liée à l'intro et se ferme avec elle.
alter table public.intro_suggestions add column if not exists follow_up_id uuid references public.follow_ups(id) on delete set null;

-- 9. Suivi LinkedIn : null = selon les tags, true = suivi, false = arrêt explicite.
alter table public.contacts alter column follow_linkedin drop not null;
alter table public.contacts alter column follow_linkedin drop default;
update public.contacts set follow_linkedin = null where follow_linkedin = false;
create or replace function public.get_trackable_contacts(p_limit int)
returns table(id uuid, first_name text, last_name text, company text, job_title text, industry text, location text, linkedin text, space_id uuid)
language sql stable set search_path = public as $$
    select c.id, c.first_name, c.last_name, c.company, c.job_title, c.industry, c.location, c.linkedin, c.space_id
    from public.contacts c
    where c.linkedin is not null
      and coalesce(c.follow_linkedin, exists (
        select 1 from public.contact_tags ct join public.tags t on t.id = ct.tag_id
        where ct.contact_id = c.id and lower(t.name) in ('vip', 'à suivre', 'a suivre')))
      and (c.tracked_at is null or c.tracked_at < now() - interval '6 days')
    order by c.tracked_at asc nulls first
    limit greatest(1, least(p_limit, 50));
$$;
revoke execute on function public.get_trackable_contacts(int) from public, anon, authenticated;
