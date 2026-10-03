-- Un import (carnet iPhone, import web) ne recrée pas une personne déjà
-- présente dans l'un des cercles de l'utilisateur : même email, même
-- téléphone (9 derniers chiffres), ou même prénom + nom sans entreprise
-- contradictoire. La ligne est ignorée en silence (comme « on conflict do
-- nothing » de batch_insert_contacts_idempotent).
-- Les copies volontaires vers un cercle (source 'manual') ne sont pas filtrées.
-- ponytail: balayage des contacts de l'utilisateur à chaque ligne importée,
-- index sur expression si les imports dépassent quelques milliers de lignes.
create or replace function public.skip_duplicate_import()
returns trigger language plpgsql set search_path = public as $$
declare
  v_phone text := right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 9);
begin
  if coalesce(new.source, '') not in ('iphone_import', 'import') then return new; end if;
  if exists (
    select 1 from contacts c
    where c.space_id in (select user_space_ids(new.owner_id))
      and (
        (coalesce(trim(new.email), '') <> '' and lower(trim(c.email)) = lower(trim(new.email)))
        or (length(v_phone) = 9 and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9) = v_phone)
        or (coalesce(trim(new.last_name), '') <> ''
            and lower(trim(c.first_name)) = lower(trim(new.first_name))
            and lower(trim(c.last_name)) = lower(trim(new.last_name))
            and (c.company is null or new.company is null or lower(trim(c.company)) = lower(trim(new.company))))
      )
  ) then
    return null;
  end if;
  return new;
end $$;

-- Préfixe zz_ : les triggers s'exécutent par ordre alphabétique, celui-ci
-- doit passer après trigger_clean_contact_names (qui sépare prénom et nom).
drop trigger if exists zz_skip_duplicate_import on public.contacts;
create trigger zz_skip_duplicate_import before insert on public.contacts
  for each row execute function public.skip_duplicate_import();
