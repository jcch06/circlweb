-- intro_suggestions : décisions prises sur les mises en relation proposées.
-- Calquée sur contact_updates. Sans elle, chaque régénération d'analyse
-- ressuscite les intros déjà envoyées ou écartées (brief 4.0.9).

create table if not exists public.intro_suggestions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  from_contact_id uuid not null references public.contacts(id) on delete cascade,
  to_contact_id uuid not null references public.contacts(id) on delete cascade,
  rationale text,
  confidence numeric,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'snoozed', 'dismissed')),
  snoozed_until date,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  -- Une seule décision vivante par paire et par utilisateur : la régénération
  -- de l'analyse ne recrée pas une ligne déjà tranchée.
  unique (user_id, from_contact_id, to_contact_id)
);

create index if not exists intro_suggestions_user_status_idx
  on public.intro_suggestions (user_id, status, created_at desc);

alter table public.intro_suggestions enable row level security;

drop policy if exists "intro_suggestions_select_own" on public.intro_suggestions;
create policy "intro_suggestions_select_own" on public.intro_suggestions
  for select using (auth.uid() = user_id);

drop policy if exists "intro_suggestions_insert_own" on public.intro_suggestions;
create policy "intro_suggestions_insert_own" on public.intro_suggestions
  for insert with check (auth.uid() = user_id);

drop policy if exists "intro_suggestions_update_own" on public.intro_suggestions;
create policy "intro_suggestions_update_own" on public.intro_suggestions
  for update using (auth.uid() = user_id);

drop policy if exists "intro_suggestions_delete_own" on public.intro_suggestions;
create policy "intro_suggestions_delete_own" on public.intro_suggestions
  for delete using (auth.uid() = user_id);
