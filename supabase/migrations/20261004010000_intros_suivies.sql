-- Introductions suivies de bout en bout : envoyée, réponse reçue, faite,
-- sans suite. Chaque étape est datée pour mesurer ce que les intros donnent.
alter table public.intro_suggestions drop constraint if exists intro_suggestions_status_check;
alter table public.intro_suggestions add constraint intro_suggestions_status_check
  check (status in ('pending', 'sent', 'replied', 'done', 'no_reply', 'snoozed', 'dismissed'));
alter table public.intro_suggestions add column if not exists sent_at timestamptz;
alter table public.intro_suggestions add column if not exists replied_at timestamptz;
alter table public.intro_suggestions add column if not exists done_at timestamptz;
alter table public.intro_suggestions add column if not exists outcome text check (outcome is null or length(outcome) <= 500);
