-- Contre-audit Astra (L5-01) : l'import ne fusionne plus des personnes distinctes.
-- Doublon certain = même email ; même téléphone ET même nom ; même nom sans
-- entreprise, email ni téléphone contradictoires. Deux homonymes aux emails
-- différents, ou deux personnes derrière un même standard, restent distinctes.
create or replace function public.skip_duplicate_import()
returns trigger language plpgsql set search_path = public as $$
declare
  v_phone text := right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 9);
  v_email text := lower(trim(coalesce(new.email, '')));
  v_spaces uuid[];
begin
  if coalesce(new.source, '') not in ('iphone_import', 'import') then return new; end if;
  v_spaces := array(select user_space_ids(new.owner_id));
  if (v_email <> '' and exists (
        select 1 from contacts c where lower(trim(c.email)) = v_email
          and c.email is not null and c.email <> '' and c.space_id = any(v_spaces)))
     or (length(v_phone) = 9 and exists (
        select 1 from contacts c where right(regexp_replace(c.phone, '\D', '', 'g'), 9) = v_phone
          and c.phone is not null and c.phone <> '' and c.space_id = any(v_spaces)
          and lower(trim(c.first_name)) = lower(trim(new.first_name))
          and lower(trim(coalesce(c.last_name, ''))) = lower(trim(coalesce(new.last_name, '')))))
     or (coalesce(trim(new.last_name), '') <> '' and exists (
        select 1 from contacts c where lower(trim(c.first_name)) = lower(trim(new.first_name))
          and lower(trim(c.last_name)) = lower(trim(new.last_name)) and c.space_id = any(v_spaces)
          and (c.company is null or new.company is null or lower(trim(c.company)) = lower(trim(new.company)))
          and (coalesce(c.email, '') = '' or v_email = '' or lower(trim(c.email)) = v_email)
          and (coalesce(c.phone, '') = '' or length(v_phone) <> 9 or right(regexp_replace(c.phone, '\D', '', 'g'), 9) = v_phone)))
  then
    return null;
  end if;
  return new;
end $$;
