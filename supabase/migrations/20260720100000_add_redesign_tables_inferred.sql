-- ⚠️ SCHÉMA INFÉRÉ — à réconcilier avec la vraie base.
--
-- Les tables contact_updates / follow_ups / contact_links sont utilisées par le
-- redesign (Accueil, Mises à jour, Réseau) mais n'avaient AUCUNE migration : elles
-- n'existaient que dans le Supabase déployé. Ce fichier reconstitue leur schéma
-- À PARTIR DE L'USAGE CÔTÉ CLIENT (colonnes lues/écrites) pour que le repo soit
-- reproductible sur un environnement neuf et documente le contrat attendu.
--
-- IL PEUT DIVERGER de la vraie base (colonnes/contraintes/RLS exactes). La source
-- de vérité reste la prod : faire un `supabase db pull` pour capturer le schéma
-- réel et remplacer ce fichier. Idéalement, l'auteur des tables committe la vraie
-- définition.
--
-- 100% NON DESTRUCTIF : chaque bloc est entièrement SKIPPÉ si la table existe déjà
-- (cas de la prod) — ni la table, ni le RLS, ni les policies existantes ne sont
-- touchés. Il ne crée quelque chose que sur une base où la table est absente.

-- ── follow_ups ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'follow_ups') then
    create table public.follow_ups (
      id uuid primary key default gen_random_uuid(),
      space_id uuid references public.spaces(id) on delete cascade,
      user_id uuid,
      contact_id uuid not null references public.contacts(id) on delete cascade,
      label text,
      due_date date,
      status text not null default 'pending',   -- 'pending' | 'done'
      created_at timestamptz not null default now()
    );
    create index follow_ups_status_due_idx on public.follow_ups (status, due_date);
    create index follow_ups_contact_idx on public.follow_ups (contact_id);
    alter table public.follow_ups enable row level security;
    create policy "follow_ups owner/space" on public.follow_ups
      for all using (user_id = auth.uid() or (space_id is not null and space_id in (select id from public.spaces)))
      with check (user_id = auth.uid() or (space_id is not null and space_id in (select id from public.spaces)));
  end if;
end $$;

-- ── contact_updates ─────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'contact_updates') then
    create table public.contact_updates (
      id uuid primary key default gen_random_uuid(),
      space_id uuid references public.spaces(id) on delete cascade,
      contact_id uuid not null references public.contacts(id) on delete cascade,
      field text,
      old_value text,
      new_value text,
      summary text,
      confidence numeric,
      source text,
      metadata jsonb,
      status text not null default 'pending',   -- 'pending' | traité/archivé
      created_at timestamptz not null default now()
    );
    create index contact_updates_status_idx on public.contact_updates (status, created_at desc);
    create index contact_updates_contact_idx on public.contact_updates (contact_id);
    alter table public.contact_updates enable row level security;
    create policy "contact_updates space" on public.contact_updates
      for all using (space_id is not null and space_id in (select id from public.spaces))
      with check (space_id is not null and space_id in (select id from public.spaces));
  end if;
end $$;

-- ── contact_links ───────────────────────────────────────────────────────────
-- Une arête = un lien entre deux contacts, dérivé d'une note (source_note_id).
-- NetworkPage agrège N lignes par paire → l'épaisseur de l'arête = nb de notes.
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'contact_links') then
    create table public.contact_links (
      id uuid primary key default gen_random_uuid(),
      space_id uuid references public.spaces(id) on delete cascade,
      from_contact_id uuid not null references public.contacts(id) on delete cascade,
      to_contact_id uuid not null references public.contacts(id) on delete cascade,
      source_note_id uuid,
      created_at timestamptz not null default now()
    );
    create index contact_links_from_idx on public.contact_links (from_contact_id);
    create index contact_links_to_idx on public.contact_links (to_contact_id);
    alter table public.contact_links enable row level security;
    create policy "contact_links space" on public.contact_links
      for all using (space_id is not null and space_id in (select id from public.spaces))
      with check (space_id is not null and space_id in (select id from public.spaces));
  end if;
end $$;
