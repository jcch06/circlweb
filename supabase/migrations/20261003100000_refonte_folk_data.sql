-- Refonte « Folk » : branchement des données (appliqué en base le 2026-10-03).

-- 1. contacts_visible : masquage évalué une fois par ligne (694 ms -> 101 ms
--    sur 2 545 contacts) + last_contacted_at (ignoré jusqu'ici par le statut
--    relationnel côté web) + photo_url (masquée).
create or replace view public.contacts_visible with (security_invoker = true) as
select
  c.id, c.space_id, c.owner_id, c.first_name, c.last_name,
  case when vis.full then c.company end as company,
  case when vis.full then c.job_title end as job_title,
  case when vis.full then c.industry end as industry,
  case when vis.full then c.location end as location,
  case when vis.full then c.bio end as bio,
  case when vis.full then c.email end as email,
  case when vis.full then c.phone end as phone,
  case when vis.full then c.linkedin end as linkedin,
  case when vis.full then c.ai_context end as ai_context,
  case when vis.full then c.skills else '{}'::text[] end as skills,
  case when vis.full then c.inferred_needs else '{}'::text[] end as inferred_needs,
  case when vis.full then c.company_size end as company_size,
  c.source, c.created_at, c.enriched_at, c.shared_contact_id,
  vis.full as is_unlocked,
  public.get_user_display_name(c.owner_id) as owner_display_name,
  case when vis.full then c.enrichment_sources else '[]'::jsonb end as enrichment_sources,
  c.last_contacted_at,
  case when vis.full then c.photo_url end as photo_url
from public.contacts c
cross join lateral (select public.can_view_contact_full(c.id) as full offset 0) vis;

create index if not exists notes_contact_created_idx on public.notes (contact_id, created_at desc);

-- 2. Pipelines (accès = membres du cercle).
create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null,
  position int not null default 0,
  tone text not null default 'neutral' check (tone in ('neutral', 'progress', 'won', 'lost'))
);
create table if not exists public.pipeline_items (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline_id, contact_id)
);
create index if not exists pipelines_space_idx on public.pipelines (space_id);
create index if not exists pipeline_stages_pipeline_idx on public.pipeline_stages (pipeline_id);
create index if not exists pipeline_items_pipeline_idx on public.pipeline_items (pipeline_id);
create index if not exists pipeline_items_contact_idx on public.pipeline_items (contact_id);
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.pipeline_items enable row level security;
drop policy if exists "pipelines members" on public.pipelines;
create policy "pipelines members" on public.pipelines for all
  using (space_id in (select public.user_space_ids(auth.uid())))
  with check (space_id in (select public.user_space_ids(auth.uid())));
drop policy if exists "pipeline_stages members" on public.pipeline_stages;
create policy "pipeline_stages members" on public.pipeline_stages for all
  using (exists (select 1 from public.pipelines p where p.id = pipeline_id and p.space_id in (select public.user_space_ids(auth.uid()))))
  with check (exists (select 1 from public.pipelines p where p.id = pipeline_id and p.space_id in (select public.user_space_ids(auth.uid()))));
drop policy if exists "pipeline_items members" on public.pipeline_items;
create policy "pipeline_items members" on public.pipeline_items for all
  using (exists (select 1 from public.pipelines p where p.id = pipeline_id and p.space_id in (select public.user_space_ids(auth.uid()))))
  with check (
    exists (select 1 from public.pipelines p where p.id = pipeline_id and p.space_id in (select public.user_space_ids(auth.uid())))
    and exists (select 1 from public.pipeline_stages s where s.id = stage_id and s.pipeline_id = pipeline_items.pipeline_id)
  );

-- 3. Crédits d'enrichissement (FullEnrich revendu). Lecture par l'utilisateur,
--    débit uniquement côté serveur.
create table if not exists public.enrichment_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance int not null default 25 check (balance >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta int not null,
  reason text not null,
  contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
alter table public.enrichment_credits enable row level security;
alter table public.credit_ledger enable row level security;
drop policy if exists "own credits read" on public.enrichment_credits;
create policy "own credits read" on public.enrichment_credits for select using (user_id = auth.uid());
drop policy if exists "own ledger read" on public.credit_ledger;
create policy "own ledger read" on public.credit_ledger for select using (user_id = auth.uid());

create or replace function public.debit_enrichment_credits(p_user uuid, p_cost int, p_reason text, p_contact uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_balance int;
begin
  insert into enrichment_credits (user_id) values (p_user) on conflict (user_id) do nothing;
  update enrichment_credits set balance = balance - p_cost, updated_at = now()
    where user_id = p_user and balance >= p_cost
    returning balance into v_balance;
  if v_balance is null then return -1; end if;
  insert into credit_ledger (user_id, delta, reason, contact_id) values (p_user, -p_cost, p_reason, p_contact);
  return v_balance;
end $$;
revoke all on function public.debit_enrichment_credits(uuid, int, text, uuid) from public, anon, authenticated;

-- 4. Recherche paginée côté serveur (page Contacts). SECURITY INVOKER : RLS et
--    masquage s'appliquent, la recherche porte sur les valeurs masquées.
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
touched as (
  select d.*, greatest(d.last_contacted_at, (select max(n.created_at) from notes_visible n where n.contact_id = d.id)) as touch
  from dedup d
),
st as (
  select t.*, case
      when t.touch is null then 'never'
      when t.touch > now() - interval '30 days' then 'fresh'
      when t.touch >= now() - interval '90 days' then 'due'
      else 'dormant' end as status
  from touched t
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
revoke all on function public.search_contacts(text, text, text, uuid, uuid, text, int, int) from public, anon;
grant execute on function public.search_contacts(text, text, text, uuid, uuid, text, int, int) to authenticated;
