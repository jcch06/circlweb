-- Closes the gap left by the previous migration: masking only protected
-- READS. A team member who could already edit a shared contact could still
-- blindly overwrite fields they could no longer even see the current value
-- of. This adds the same can_view_contact_full() check as a write guard.
--
-- Safe to run multiple times (idempotent).

create or replace function public.enforce_contact_write_lock()
returns trigger
language plpgsql
security invoker
as $$
begin
  if not public.can_view_contact_full(old.id) then
    raise exception 'Accès complet requis pour modifier ce contact. Demandez l''accès au propriétaire.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_write_lock on public.contacts;
create trigger contacts_write_lock
  before update or delete on public.contacts
  for each row
  execute function public.enforce_contact_write_lock();

-- NOTE: this only guards contacts.* fields. Notes/tags on a locked contact
-- were already write-permitted the same way they were before (this
-- migration doesn't touch those tables) — a deliberate, smaller first step.
-- Owners are always allowed through (can_view_contact_full returns true for
-- them unconditionally), so this never blocks normal single-owner editing.
