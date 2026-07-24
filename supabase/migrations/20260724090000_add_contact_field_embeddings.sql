-- Separate needs/skills embeddings for supply-demand candidate pre-filtering.
--
-- contact_embeddings (see 20260718090000) holds ONE whole-profile embedding
-- per contact, used only for topic clustering (who's broadly similar to
-- whom). It's the wrong shape for need↔skill matching: a demander and a
-- supplier are complementary, not similar, and mixing skills+needs+notes
-- into a single vector blurs exactly the signal supply-demand.ts needs.
--
-- This table embeds a contact's "besoins" text and "compétences" text
-- SEPARATELY, keyed by (contact_id, field). supply-demand.ts then runs a
-- cheap cosine-similarity search across need-vectors × skill-vectors to
-- pre-select promising candidate pairs before spending an LLM call on
-- validating/articulating them — see buildCandidateMatches there.
--
-- Same caching shape and RLS pattern as contact_embeddings: content_hash
-- lets an unchanged field skip re-embedding; rows are shared across a
-- space's members since they all see the same underlying contact data.
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS).

create table if not exists public.contact_field_embeddings (
  contact_id uuid not null references public.contacts(id) on delete cascade,
  field text not null check (field in ('skill', 'need')),
  space_id uuid not null references public.spaces(id) on delete cascade,
  content_hash text not null,
  embedding jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (contact_id, field)
);

create index if not exists contact_field_embeddings_space_idx
  on public.contact_field_embeddings (space_id);

alter table public.contact_field_embeddings enable row level security;

drop policy if exists "space members manage field embeddings" on public.contact_field_embeddings;
create policy "space members manage field embeddings" on public.contact_field_embeddings
  for all using (
    space_id in (select id from public.spaces)
  ) with check (
    space_id in (select id from public.spaces)
  );
