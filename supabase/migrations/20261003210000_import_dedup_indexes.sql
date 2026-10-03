-- Import de gros fichiers : la détection de doublons du trigger d'import
-- s'appuie sur des index d'expression (email, 9 derniers chiffres du
-- téléphone, prénom + nom) au lieu de balayer tout le carnet à chaque ligne.
create index if not exists contacts_email_norm_idx on public.contacts (lower(trim(email))) where email is not null and email <> '';
create index if not exists contacts_phone_tail_idx on public.contacts (right(regexp_replace(phone, '\D', '', 'g'), 9)) where phone is not null and phone <> '';
create index if not exists contacts_name_norm_idx on public.contacts (lower(trim(first_name)), lower(trim(last_name)));

create or replace function public.skip_duplicate_import()
returns trigger language plpgsql set search_path = public as $$
declare
  v_phone text := right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 9);
  v_spaces uuid[];
begin
  if coalesce(new.source, '') not in ('iphone_import', 'import') then return new; end if;
  v_spaces := array(select user_space_ids(new.owner_id));
  if (coalesce(trim(new.email), '') <> '' and exists (
        select 1 from contacts c where lower(trim(c.email)) = lower(trim(new.email))
          and c.email is not null and c.email <> '' and c.space_id = any(v_spaces)))
     or (length(v_phone) = 9 and exists (
        select 1 from contacts c where right(regexp_replace(c.phone, '\D', '', 'g'), 9) = v_phone
          and c.phone is not null and c.phone <> '' and c.space_id = any(v_spaces)))
     or (coalesce(trim(new.last_name), '') <> '' and exists (
        select 1 from contacts c where lower(trim(c.first_name)) = lower(trim(new.first_name))
          and lower(trim(c.last_name)) = lower(trim(new.last_name)) and c.space_id = any(v_spaces)
          and (c.company is null or new.company is null or lower(trim(c.company)) = lower(trim(new.company)))))
  then
    return null;
  end if;
  return new;
end $$;
