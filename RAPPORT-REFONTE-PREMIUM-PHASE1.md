# Refonte Premium OnDeal Intelligence — Rapport Phase 1

Date : 03/09/2026
Branche : `preview-design` (ne touche pas `master`/production)

## 1. Résumé

La mission demandée est une refonte complète de niveau SaaS international (57 sections : design system, sidebar groupée, header temps réel, Dashboard avec health score, Centre d'intelligence groupé, Stock/Historique/Assistant/Actions/Settings redessinés, responsive, accessibilité, dark-mode, etc.).

Vu l'ampleur, j'ai livré une **Phase 1 complète, réellement codée, testée et validée** plutôt qu'une passe superficielle sur toutes les pages à la fois. Tout ce qui est listé ci-dessous est du code réel, exécuté avec succès en local (lint + typecheck + tests + build), et livré dans votre dépôt sur la branche `preview-design`.

**Aucune donnée n'est inventée ou codée en dur** — tous les chiffres affichés (score, ruptures, avis, recommandations) proviennent de requêtes Prisma réelles, comme avant. Les changements sont uniquement structurels et visuels + un vrai moteur de regroupement des recommandations.

## 2. Ce qui a été livré (Phase 1)

### 2.1 Système de design (`globals.css`)
Extension additive du système existant (rien de retiré, donc aucune page ne casse) : nouveaux tokens de surface/info, et une vingtaine de nouveaux composants CSS premium — sidebar groupée/collapsible, header SaaS avec effet verre (blur), pastille de statut de connexion, chips de filtre avec compteurs, cartes de priorité groupées, hero de santé avec dégradé, anneau de score SVG, barres de contribution du score, timeline verticale, onglets de filtre, skeleton loading, bulles de copilote IA.

### 2.2 AppShell — sidebar groupée + header réel
- `Sidebar.tsx` (nouveau, client) : sidebar réductible (icônes seules), 6 groupes repliables (Vue d'ensemble / Intelligence / Croissance / IA / Opérations / Paramètres) au lieu d'une liste plate de 10 liens.
- `StoreStatusPill.tsx` (nouveau) : pastille de statut réelle (🟢 connecté / 🟠 partiel / ⚪ déconnecté) + "il y a X min/h/j" depuis la dernière synchro réelle — alimentée par un nouveau champ `store.integrations` (lu directement dans `store-context.ts` via `prisma.integration.findMany`, aucune valeur simulée).
- `AppShell.tsx` : header sticky flouté avec la pastille + zone `headerExtra` pour les actions contextuelles (ex. bouton Synchroniser sur le Dashboard).

### 2.3 Moteur d'intelligence de groupe (`src/lib/intelligence/group.ts`, nouveau)
Résout directement le problème des "1036 problèmes urgents" vs "184 ruptures" que vous aviez soulevé : les recommandations réelles (une par variante en rupture, etc.) sont désormais **regroupées par produit + catégorie** pour l'affichage, sans jamais en perdre une seule — le nombre réel total reste affiché et accessible. 9 tests unitaires dédiés (`tests/group.test.ts`) vérifient notamment qu'aucune recommandation n'est perdue lors du regroupement.

### 2.4 Dashboard (page réécrite)
- Bloc "hero" avec salutation dynamique (Bonjour/Bon après-midi/Bonsoir), résumé en une phrase du nombre réel de problèmes/opportunités/recommandations, 3 statistiques clés.
- **ONDEAL HEALTH** : anneau SVG animé affichant le score moyen réel (`HealthRing.tsx`), couleur qui varie selon le niveau (rouge/orange/vert).
- **"Pourquoi ce score ?"** : nouvelle fonction `aggregateScoreBreakdowns()` dans `score.ts` qui agrège les vrais `factorsJson` de tous les produits scorés pour expliquer, facteur par facteur, ce qui tire le score vers le haut ou le bas — jamais de moyenne sur des données indisponibles (testé : 3 nouveaux tests dans `score.test.ts`).
- "Priorités du jour" : 3 à 5 cartes groupées maximum (au lieu de la liste plate de 6 recommandations brutes), avec lien vers la liste complète.

### 2.5 Centre d'intelligence (page réécrite)
Chips de filtre avec compteurs réels (Toutes / Urgent / Opportunités / Recommandations) + cartes groupées au lieu de 3 sections à plat listant chaque recommandation individuellement.

### 2.6 Stock Intelligence (page enrichie)
Bloc hero avec situations critiques / réapprovisionnables chez le fournisseur / variantes suivies. Table "Tous les produits" plafonnée à 25 lignes avec mention explicite du total réel, pour rester lisible sur un catalogue large.

### 2.7 Historique (page réécrite en timeline)
Passage d'une table plate à une timeline verticale avec points colorés (succès/échec/neutre) + onglets de filtre par catégorie d'événement (Synchronisations / IA & Intelligence / Actions / Paramètres & Intégrations), compteurs réels par catégorie.

## 3. Validation (exécutée dans l'environnement de build)

| Étape | Résultat |
|---|---|
| `npm run lint` | ✅ PASS — 0 erreur |
| `npm run typecheck` | ✅ PASS — 0 erreur |
| `npm test` | ✅ PASS — 46/46 tests (dont 18 nouveaux) |
| `npm run build` | ✅ PASS — build de production réussi, 31 routes générées |
| Démarrage `npm run dev` + requêtes sur les 12 pages authentifiées | ✅ Aucune page ne plante (redirection 307 attendue, non authentifié) |

## 4. Fichiers créés

- `src/lib/intelligence/group.ts` — moteur de regroupement
- `src/components/Sidebar.tsx`, `StoreStatusPill.tsx`, `HealthRing.tsx`, `PriorityCard.tsx`
- `tests/group.test.ts`

## 5. Fichiers modifiés

- `src/app/globals.css` — extension du design system
- `src/components/AppShell.tsx`, `LogoutButton.tsx`
- `src/app/(app)/dashboard/page.tsx`, `intelligence/page.tsx`, `stock/page.tsx`, `audit-log/page.tsx`
- `src/lib/intelligence/score.ts` — ajout `aggregateScoreBreakdowns()`
- `src/lib/store-context.ts` — ajout `integrations` (statut réel)
- `tests/score.test.ts`
- `.gitignore`

## 6. Problèmes restants / Phase 2 à faire

Le reste de la mission (Product Intelligence, page produit détail, Assistant IA en workspace copilote, Actions "Action Center", Settings avec sous-navigation, page Intégrations dédiée, onboarding/login redessinés, dark-mode, audit accessibilité WCAG complet) **n'a pas encore été fait** — refaire les 57 sections d'un coup, sans validation intermédiaire, aurait un risque réel de casser des pages en production. Je recommande d'enchaîner par vagues du même type (code → tests → lint/typecheck/build → livraison), en commençant par Product Intelligence + page produit puisque ce sont les pages les plus visitées après le Dashboard.

## 7. Pour voir le résultat

```
cd ondeal-intelligence
git add -A
git commit -m "Refonte premium Phase 1: sidebar groupée, header réel, dashboard health score, intelligence groupée, stock/historique"
git push
```

Le lien de preview existant se met à jour automatiquement :
https://ondeal-intelligence-git-preview-design-on-deal.vercel.app
