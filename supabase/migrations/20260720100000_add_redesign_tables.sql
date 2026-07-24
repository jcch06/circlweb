-- Tables du redesign : contact_updates, contact_links, follow_ups.
--
-- DDL RÉEL repris verbatim des migrations d'origine du repo circl
-- (009_contact_updates, 011_contact_links, 014_follow_ups) — remplace la
-- version inférée. Ces tables préexistaient dans la base déployée mais
-- n'étaient versionnées que côté circl ; circlweb devient le foyer.
--
-- ⚠️ Dépendances non encore consolidées dans circlweb (elles vivent dans
-- circl/001_initial_schema.sql) : les tables spaces / contacts / notes et
-- les fonctions user_space_ids(uuid) / user_role_in_space(uuid, uuid) que
-- les policies RLS ci-dessous appellent. Sur la base de prod tout existe
-- déjà (ces `create ... if not exists` sont des no-op) ; un rebuild
-- from-scratch de circlweb exigera d'abord de porter le schéma de base de
-- circl. Dette suivie : consolidation complète du schéma dans circlweb.

-- ============================================================
-- contact_updates (circl/009)
-- ============================================================
-- Contact Updates — the shared "pending update -> confirm/dismiss -> apply" engine.
-- Fed by two sources:
--   1. Tracking (network profile changes, web/news, external enrichment providers)
--   2. Voice capture (a dictated note that implies a field change)
-- Confirming an update applies new_value onto the contact and writes a note.

-- ============================================================
-- 1. TABLE
-- ============================================================
create table if not exists public.contact_updates (
    id uuid primary key default gen_random_uuid(),
    contact_id uuid not null references public.contacts(id) on delete cascade,
    space_id uuid not null references public.spaces(id) on delete cascade,

    type text not null check (type in (
        'job_change', 'company_change', 'title_change', 'location_change',
        'profile_update', 'news', 'voice_capture', 'other'
    )),

    -- field = the contacts column this update targets (null for purely
    -- informational updates like 'news' or 'profile_update'). Whitelisted at
    -- apply-time in confirm_contact_update().
    field text check (field in (
        'company', 'job_title', 'industry', 'location', 'linkedin', 'bio'
    )),
    old_value text,
    new_value text,

    summary text not null,                 -- human string shown in the feed
    source text not null,                  -- 'network' | 'web' | 'tracking:pdl' | 'voice' | ...
    confidence numeric(3, 2),              -- 0.00..1.00, null if unknown

    status text not null default 'pending'
        check (status in ('pending', 'confirmed', 'dismissed')),

    metadata jsonb not null default '{}'::jsonb,

    detected_by uuid references auth.users(id) on delete set null,  -- null = system
    detected_at timestamptz not null default now(),
    resolved_by uuid references auth.users(id) on delete set null,
    resolved_at timestamptz
);

create index if not exists contact_updates_space_status_idx
    on public.contact_updates (space_id, status, detected_at desc);
create index if not exists contact_updates_contact_idx
    on public.contact_updates (contact_id);

-- Avoid stacking identical pending updates from repeated tracking runs.
create unique index if not exists contact_updates_dedupe_idx
    on public.contact_updates (contact_id, coalesce(field, ''), coalesce(new_value, ''))
    where status = 'pending';

-- ============================================================
-- 2. RLS
-- ============================================================
alter table public.contact_updates enable row level security;

-- Members of the space see updates for its contacts.
create policy "Members can view contact updates"
    on public.contact_updates for select
    using (space_id in (select public.user_space_ids(auth.uid())));

-- Members can insert (used by voice capture client-side; tracking edge
-- functions use the service role and bypass RLS).
create policy "Members can create contact updates"
    on public.contact_updates for insert
    with check (
        detected_by = auth.uid()
        and public.user_role_in_space(auth.uid(), space_id) in ('owner', 'admin', 'member')
        and contact_id in (
            select id from public.contacts
            where space_id in (select public.user_space_ids(auth.uid()))
        )
    );

-- Direct updates are restricted; resolution goes through the RPCs below.
create policy "Members can resolve contact updates"
    on public.contact_updates for update
    using (public.user_role_in_space(auth.uid(), space_id) in ('owner', 'admin', 'member'));

-- ============================================================
-- 3. CONFIRM — apply new_value to the contact + write a note
-- ============================================================
create or replace function public.confirm_contact_update(p_update_id uuid)
returns public.contact_updates as $$
declare
    upd public.contact_updates;
    uid uuid := auth.uid();
begin
    if uid is null then
        raise exception 'Not authenticated';
    end if;

    select * into upd from public.contact_updates where id = p_update_id;
    if upd.id is null then
        raise exception 'Update not found';
    end if;

    -- Caller must be a member of the update's space with edit rights.
    if public.user_role_in_space(uid, upd.space_id) not in ('owner', 'admin', 'member') then
        raise exception 'Not allowed';
    end if;

    if upd.status <> 'pending' then
        raise exception 'Update already resolved';
    end if;

    -- Apply the field change if there is one. field is already whitelisted by
    -- the table CHECK, so format(%I) is safe.
    if upd.field is not null and upd.new_value is not null then
        execute format(
            'update public.contacts set %I = $1, updated_at = now() where id = $2',
            upd.field
        ) using upd.new_value, upd.contact_id;
    end if;

    -- Leave a trace on the contact timeline.
    insert into public.notes (contact_id, author_id, content, context)
    values (upd.contact_id, uid, upd.summary, 'professional');

    update public.contact_updates
        set status = 'confirmed', resolved_by = uid, resolved_at = now()
        where id = p_update_id
        returning * into upd;

    return upd;
end;
$$ language plpgsql security definer;

grant execute on function public.confirm_contact_update(uuid) to authenticated;

-- ============================================================
-- 4. DISMISS
-- ============================================================
create or replace function public.dismiss_contact_update(p_update_id uuid)
returns public.contact_updates as $$
declare
    upd public.contact_updates;
    uid uuid := auth.uid();
begin
    if uid is null then
        raise exception 'Not authenticated';
    end if;

    select * into upd from public.contact_updates where id = p_update_id;
    if upd.id is null then
        raise exception 'Update not found';
    end if;

    if public.user_role_in_space(uid, upd.space_id) not in ('owner', 'admin', 'member') then
        raise exception 'Not allowed';
    end if;

    update public.contact_updates
        set status = 'dismissed', resolved_by = uid, resolved_at = now()
        where id = p_update_id and status = 'pending'
        returning * into upd;

    return upd;
end;
$$ language plpgsql security definer;

grant execute on function public.dismiss_contact_update(uuid) to authenticated;

-- ============================================================
-- contact_links (circl/011)
-- ============================================================
-- Links between two contacts, created when one contact's note mentions another
-- ("Paul Gérard" cited in Henri's note → Henri ↔ Paul). Powers the web galaxy
-- graph and lets the AI reason on who knows who.
create table if not exists public.contact_links (
    id uuid primary key default gen_random_uuid(),
    space_id uuid not null references public.spaces(id) on delete cascade,
    from_contact_id uuid not null references public.contacts(id) on delete cascade,
    to_contact_id uuid not null references public.contacts(id) on delete cascade,
    source_note_id uuid references public.notes(id) on delete set null,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    unique (from_contact_id, to_contact_id, source_note_id)
);

create index if not exists contact_links_space_idx on public.contact_links (space_id);
create index if not exists contact_links_from_idx on public.contact_links (from_contact_id);
create index if not exists contact_links_to_idx on public.contact_links (to_contact_id);
create index if not exists contact_links_note_idx on public.contact_links (source_note_id);

alter table public.contact_links enable row level security;

create policy "Members can view contact links"
    on public.contact_links for select
    using (space_id in (select public.user_space_ids(auth.uid())));

create policy "Members can create contact links"
    on public.contact_links for insert
    with check (space_id in (select public.user_space_ids(auth.uid())));

create policy "Creators and admins can delete contact links"
    on public.contact_links for delete
    using (
        created_by = auth.uid()
        or public.user_role_in_space(auth.uid(), space_id) in ('owner', 'admin')
    );

-- ============================================================
-- follow_ups (circl/014)
-- ============================================================
-- 014: follow_ups — relances planifiées, extraites des notes vocales
-- (structure-note) ou créées à la main plus tard. Jusqu'ici la relance
-- proposée par l'IA n'était affichée qu'une fois puis perdue.

create table if not exists public.follow_ups (
    id uuid primary key default gen_random_uuid(),
    space_id uuid not null references public.spaces(id) on delete cascade,
    contact_id uuid not null references public.contacts(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    note_id uuid references public.notes(id) on delete set null,
    due_date date not null,
    label text not null,
    status text not null default 'pending' check (status in ('pending', 'done', 'dismissed')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists follow_ups_user_pending_idx
    on public.follow_ups (user_id, status, due_date);
create index if not exists follow_ups_contact_idx
    on public.follow_ups (contact_id);

alter table public.follow_ups enable row level security;

-- Une relance est personnelle : seul son créateur la voit et la gère.
drop policy if exists "follow_ups_select_own" on public.follow_ups;
create policy "follow_ups_select_own" on public.follow_ups
    for select using (auth.uid() = user_id);

drop policy if exists "follow_ups_insert_own" on public.follow_ups;
create policy "follow_ups_insert_own" on public.follow_ups
    for insert with check (auth.uid() = user_id);

drop policy if exists "follow_ups_update_own" on public.follow_ups;
create policy "follow_ups_update_own" on public.follow_ups
    for update using (auth.uid() = user_id);

drop policy if exists "follow_ups_delete_own" on public.follow_ups;
create policy "follow_ups_delete_own" on public.follow_ups
    for delete using (auth.uid() = user_id);
