-- Contexte automatique : Gmail (métadonnées seulement) et Google Agenda.
-- Circl lit qui a écrit à qui et quand, et qui était à quel rendez-vous ;
-- jamais le contenu des emails. Le jeton Google est chiffré dans Vault,
-- lisible uniquement par les fonctions serveur (service role).

create table if not exists public.google_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text,
  token_secret_id uuid,
  scopes text,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text
);
alter table public.google_connections enable row level security;
drop policy if exists "own google read" on public.google_connections;
create policy "own google read" on public.google_connections for select using (user_id = auth.uid());
drop policy if exists "own google delete" on public.google_connections;
create policy "own google delete" on public.google_connections for delete using (user_id = auth.uid());
-- L'identifiant du secret ne sort pas vers le navigateur.
revoke select on public.google_connections from authenticated, anon;
grant select (user_id, google_email, scopes, connected_at, last_sync_at, last_error) on public.google_connections to authenticated;
grant delete on public.google_connections to authenticated;

-- Échanges détectés, propres à chaque utilisateur.
create table if not exists public.interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  kind text not null check (kind in ('email_in', 'email_out', 'meeting')),
  occurred_at timestamptz not null,
  title text check (title is null or length(title) <= 200),
  external_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, contact_id, external_id)
);
create index if not exists interactions_contact_idx on public.interactions (contact_id, occurred_at desc);
alter table public.interactions enable row level security;
drop policy if exists "own interactions" on public.interactions;
create policy "own interactions" on public.interactions for select using (user_id = auth.uid());

-- Jeton Google dans Vault : écriture et lecture réservées au service role.
create or replace function public.google_store_token(p_user uuid, p_token text, p_email text, p_scopes text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_old uuid; v_new uuid;
begin
  select token_secret_id into v_old from google_connections where user_id = p_user;
  if v_old is not null then
    perform vault.update_secret(v_old, p_token);
    v_new := v_old;
  else
    v_new := vault.create_secret(p_token, 'google_refresh_' || p_user::text);
  end if;
  insert into google_connections (user_id, google_email, token_secret_id, scopes, connected_at, last_error)
    values (p_user, p_email, v_new, p_scopes, now(), null)
    on conflict (user_id) do update set google_email = excluded.google_email, token_secret_id = excluded.token_secret_id,
      scopes = excluded.scopes, connected_at = now(), last_error = null;
end $$;
create or replace function public.google_get_token(p_user uuid)
returns text language sql security definer set search_path = public, vault as $$
  select s.decrypted_secret from google_connections g join vault.decrypted_secrets s on s.id = g.token_secret_id where g.user_id = p_user;
$$;
-- Déconnexion : le secret est supprimé avec la connexion.
create or replace function public.google_forget_secret()
returns trigger language plpgsql security definer set search_path = public, vault as $$
begin
  if old.token_secret_id is not null then delete from vault.secrets where id = old.token_secret_id; end if;
  return old;
end $$;
drop trigger if exists google_forget_secret on public.google_connections;
create trigger google_forget_secret after delete on public.google_connections
  for each row execute function public.google_forget_secret();
revoke execute on function public.google_store_token(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.google_get_token(uuid) from public, anon, authenticated;
revoke execute on function public.google_forget_secret() from public, anon, authenticated;
