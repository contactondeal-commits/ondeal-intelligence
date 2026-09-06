# 12 — Dette technique et manques (recherche active, pas un rapport vert)

Ce document liste ce qui a été activement recherché et trouvé — pas ce qui a été supposé absent.

## TODO / FIXME / XXX / HACK

```
grep -rn "TODO\|FIXME\|XXX\|HACK" src/ scripts/
```
**Zéro marqueur réel trouvé.** Les 2 seuls résultats (`owner-auth/page.tsx:199`, `recovery.ts:20`) sont des occurrences littérales du motif `XXXX-XXXX-XXXX` (format d'un code de récupération), pas des marqueurs de dette — faux positifs confirmés par lecture.

## mock / stub / simulate / fake / placeholder

Recherche sur 39 fichiers correspondant au motif hors `tests/`. Chaque occurrence a été vérifiée individuellement :
- Majorité : attributs HTML `placeholder` sur des champs de formulaire — non-problème.
- `simulatePriceChange`/`simulateRestock` (`src/lib/intelligence/simulate.ts`) — fonctionnalité produit réelle de simulation de décision, consommée par plusieurs composants UI, pas un raccourci.
- Nombreuses occurrences de "NO FAKE CONNECTOR"/"NO FAKE CONTROL"/"No Fake Metrics" — invariants anti-fabrication documentés dans le code lui-même, pas des raccourcis.
- `fakeReq` (`src/app/api/actions/bulk/route.ts`, `src/app/api/stock/bulk-update/route.ts`) — pattern réel qui construit une `NextRequest` en mémoire pour réutiliser le handler mono-item dans une boucle bulk. Nom trompeur mais comportement réel, pas un mock.

**Constat : aucun raccourci runtime ("renvoie une donnée fictive au lieu de calculer") trouvé dans `src/` hors tests.**

## Routes API renvoyant une réponse statique/en dur

Les 30 routes sous `src/app/api/ai-lab/` ont été inspectées : aucune ne renvoie de payload statique — chacune délègue systématiquement à une fonction de calcul réelle après vérification de capacité.

## Composants morts (définis, jamais référencés)

Confirmé par recoupement exhaustif — **5 composants existent sans être importés nulle part ailleurs dans le dépôt** :
- `src/components/ui/Skeleton.tsx`
- `src/components/ui/StatusIndicator.tsx`
- `src/components/ui/EmptyState.tsx`
- `src/components/ui/IconButton.tsx`
- `src/components/StoreChip.tsx`

Classification : **dette technique mineure** — code construit mais jamais câblé à une page. Ne présente aucun risque de sécurité (composants d'affichage passifs), mais doit être soit câblé, soit supprimé.

## Dépendances mortes

Aucune trouvée. Les candidats les plus susceptibles d'être morts (`@simplewebauthn/*`, `bcryptjs`, `mammoth`, `pdf-parse`, `xlsx`, `lucide-react`) sont tous réellement utilisés — `mammoth`/`pdf-parse`/`xlsx` via `import()` dynamique dans `src/lib/ai/attachments/parse.ts` (un grep naïf d'imports statiques les aurait faussement signalés comme morts).

## Élément notable trouvé pendant la recherche (isolé, pas classé "défaut")

`src/components/TestModeGenerator.tsx` génère de faux avis clients fictifs (noms/textes inventés) pour tester l'import CSV. Isolation vérifiée : écrit exclusivement dans le modèle `TestReview`, jamais dans `Review` — séparation imposée par le schéma lui-même, pas seulement par convention. UI porte un avertissement explicite "MODE TEST — AVIS FICTIFS". Ce n'est pas classé comme un défaut, mais **signalé pour un examen de conformité explicite** étant donné la sensibilité réglementaire des avis fabriqués, même en mode test isolé.

## Incohérence documentaire trouvée

`prisma/seed.ts` contient un commentaire "Le paiement n'est pas implémenté dans cette V1" — **factuellement obsolète** : le billing Stripe et Shopify AppSubscription sont réellement câblés (voir 10-MERCHANT-SAAS.md). À corriger dans une prochaine itération.

## Sécurité incomplète / tests manquants identifiés

- Aucun test automatisé dédié pour : rejeu de challenge WebAuthn, compteur FIDO2 non-croissant, timeout réel de mission de bout en bout, kill switch en conditions de production réelles (voir 08-RED-TEAM-FAILURE-MATRIX.md pour le détail).
- Aucun test automatisé dédié pour les routes `/api/ai-lab/agents`, `/memory`, `/audit`, `/tools`, `/connectors`, `/policy`, `/owner/sessions*` (la logique métier sous-jacente est testée, pas la route HTTP elle-même).
- Aucune politique de rétention/suppression pour les données AI Lab (voir 09-DATA-MEMORY-PRIVACY.md).
- Aucun rollback/undo pour les mutations marchandes réelles une fois exécutées côté Shopify.

## Classification récapitulative

| Catégorie | Trouvé | Sévérité |
|---|---|---|
| TODO/FIXME réels | 0 | — |
| Mocks/stubs runtime en dehors des tests | 0 | — |
| Routes statiques/en dur | 0 | — |
| Composants morts | 5 | Mineure |
| Dépendances mortes | 0 | — |
| Rétention données AI Lab absente | 1 (structurel) | **Élevée — point RGPD** |
| Tests manquants sur routes AI Lab secondaires | ~10 routes | Moyenne |
| Rollback marchand absent | 1 (structurel) | Moyenne |
| Incohérence documentaire (seed.ts) | 1 | Mineure |
| Générateur d'avis fictifs (isolé mais présent) | 1 | À examiner en conformité |
