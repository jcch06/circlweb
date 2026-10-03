-- Contrôle de sécurité Supabase (04/10/2026) : fonctions security definer
-- appelables par n'importe qui via /rest/v1/rpc.
-- - increment_ai_usage(uid) : n'importe qui pouvait gonfler le quota IA d'un
--   autre utilisateur ; get_ai_usage / can_use_feature lisaient les siens.
-- - seed_default_tags(space) : n'importe qui pouvait créer des tags dans
--   n'importe quel cercle.
-- Aucun client ne les appelle : réservées aux fonctions serveur et triggers.
revoke execute on function public.increment_ai_usage(uuid) from public, anon, authenticated;
revoke execute on function public.get_ai_usage(uuid) from public, anon, authenticated;
revoke execute on function public.can_use_feature(uuid, text) from public, anon, authenticated;
revoke execute on function public.seed_default_tags(uuid) from public, anon, authenticated;
-- Utilisées par les policies RLS des utilisateurs connectés : retirées au seul rôle anon.
revoke execute on function public.user_space_ids(uuid) from public, anon;
revoke execute on function public.user_role_in_space(uuid, uuid) from public, anon;
revoke execute on function public.get_user_display_name(uuid) from public, anon;
revoke execute on function public.has_access_to_field(uuid, text) from public, anon;
revoke execute on function public.accept_invitation(uuid) from public, anon;
revoke execute on function public.create_team_space(text) from public, anon;
revoke execute on function public.batch_insert_contacts_idempotent(jsonb) from public, anon;
revoke execute on function public.confirm_contact_update(uuid) from public, anon;
revoke execute on function public.dismiss_contact_update(uuid) from public, anon;
grant execute on function public.user_space_ids(uuid) to authenticated, service_role;
grant execute on function public.user_role_in_space(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_user_display_name(uuid) to authenticated, service_role;
grant execute on function public.has_access_to_field(uuid, text) to authenticated, service_role;
grant execute on function public.accept_invitation(uuid) to authenticated, service_role;
grant execute on function public.create_team_space(text) to authenticated, service_role;
grant execute on function public.batch_insert_contacts_idempotent(jsonb) to authenticated, service_role;
grant execute on function public.confirm_contact_update(uuid) to authenticated, service_role;
grant execute on function public.dismiss_contact_update(uuid) to authenticated, service_role;
grant execute on function public.increment_ai_usage(uuid) to service_role;
grant execute on function public.get_ai_usage(uuid) to service_role;
grant execute on function public.can_use_feature(uuid, text) to service_role;
grant execute on function public.seed_default_tags(uuid) to service_role;
