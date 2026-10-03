-- Recherche par le sens : empreinte du texte embarqué, pour ne recalculer
-- l'embedding d'une fiche que si son contenu a changé (embed-contacts).
alter table public.contacts add column if not exists embedding_hash text;
