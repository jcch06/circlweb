-- Carte réseau repensée : milieux et liens expliqués.
-- Les milieux et les liens « devinés » sont calculés à la volée par des
-- règles (src/lib/networkRules.ts). La base ne garde que les décisions :
-- classement explicite (utilisateur ou IA), renommages, liens confirmés ou
-- rejetés. Tout est propre à chaque utilisateur.

-- 1. Classement explicite d'un contact dans un ou plusieurs milieux.
--    Dès qu'un contact a une ligne ici, elle remplace les règles.
create table if not exists public.contact_milieux (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  milieu text not null check (length(trim(milieu)) between 1 and 80),
  source text not null default 'user' check (source in ('user', 'ai')),
  created_at timestamptz not null default now(),
  primary key (user_id, contact_id, milieu)
);
alter table public.contact_milieux enable row level security;
drop policy if exists "own milieux" on public.contact_milieux;
create policy "own milieux" on public.contact_milieux for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from contacts c where c.id = contact_id));

-- 2. Renommage ou fusion d'un milieu (« scout » devient « Scouts »).
create table if not exists public.milieu_aliases (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_name text not null,
  to_name text not null check (length(trim(to_name)) between 1 and 80),
  primary key (user_id, from_name)
);
alter table public.milieu_aliases enable row level security;
drop policy if exists "own aliases" on public.milieu_aliases;
create policy "own aliases" on public.milieu_aliases for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3. Liens devinés que l'utilisateur a rejetés : ils ne reviennent plus.
create table if not exists public.link_rejections (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  a uuid not null references public.contacts(id) on delete cascade,
  b uuid not null references public.contacts(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, a, b, kind)
);
alter table public.link_rejections enable row level security;
drop policy if exists "own rejections" on public.link_rejections;
create policy "own rejections" on public.link_rejections for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 4. Chaque lien dit ce qu'il est et pourquoi il existe.
alter table public.contact_links add column if not exists kind text not null default 'note'
  check (kind in ('note', 'works_for', 'co_mention', 'knows', 'colleague'));
alter table public.contact_links add column if not exists reason text;
create unique index if not exists contact_links_pair_kind_uniq
  on public.contact_links (least(from_contact_id, to_contact_id), greatest(from_contact_id, to_contact_id), kind)
  where source_note_id is null;
