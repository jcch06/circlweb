-- La policy « Users can update own profile » laissait un utilisateur modifier
-- tout son profil, y compris subscription_status / subscription_tier : il
-- pouvait se déclarer abonné sans payer. Seuls le nom et l'avatar restent
-- modifiables par l'utilisateur (ce que font les apps web et iOS) ; les
-- colonnes de facturation ne sont écrites que par les fonctions serveur.
revoke update on public.profiles from authenticated, anon;
grant update (full_name, avatar_url, updated_at) on public.profiles to authenticated;
