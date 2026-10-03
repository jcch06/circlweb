# Circl — Design system

Monde visuel repris de **Hémicycle / Atlas** (thème app « Pay Smooth »), stack **Tailwind v3.4 + shadcn/ui**. Remplace l'ancien design (kit CRM périwinkle, tokens CSS maison dans index.css). Registre : monochrome neutre, épuré, calme, dense mais aéré — famille Linear / Notion / Folk. La marque vit dans la précision, pas dans la couleur.

## Thèmes

Clair par défaut, bascule sombre (`class="dark"` sur `<html>`). Tous les composants passent par les tokens shadcn (HSL), jamais de couleur en dur.

**Clair** : fond gris `0 0% 92%`, carte blanche `0 0% 100%`, encre `0 0% 9%`, primaire noir `0 0% 9%`, bordure hairline `0 0% 85.5%`, radius `0.875rem` (14px).
**Sombre** : fond `0 0% 7%`, carte `0 0% 11%`, encre `0 0% 96%`, primaire clair `0 0% 96%`, bordure `255 / 0.10`.

## Type

**Inter** (sans), poids 400-700, titres h1 22px/500 letter-spacing -0.03em. **Geist Mono** pour les chiffres alignés (`tabular-nums`). **Instrument Serif** disponible pour un accent éditorial rare (jamais en UI dense).

## Couleur de statut (sémantique, hors accent)

Statut relationnel et seulement là : Actif = `hgreen`, À relancer = `hamber`, En froid = `hred`. Cercles = jeu de teintes stable par hash (navy + neutres). Jamais de couleur décorative.

## Composants

shadcn/ui (button, card, input, badge, avatar, dropdown-menu, dialog, popover, tabs, separator, tooltip, scroll-area, table, command, sheet, sonner, skeleton). `cn()` de `@/lib/utils`. Pas de CSS maison hors tokens. Icônes lucide, trait fin.

## Principes

- Épuré d'abord : une action primaire par écran, le reste discret.
- Hairlines et espace pour séparer, pas des ombres lourdes.
- Chiffres en tabular-nums, pastilles de statut en capsule douce.
- Structure et copy repensées : libellés que l'utilisateur reconnaît, une idée par ligne.
