# 15 — Protocole d'acceptation Owner

Deux volets distincts et complémentaires : (A) la checklist Owner E2E des 10 flux de sécurité, dont l'exécution a déjà commencé en conditions réelles ; (B) le protocole de validation de la première mission Owner réelle en SANDBOX + ASSIST + budget limité, demandé par le mandat §10.

## A. Checklist Owner E2E — 10 flux (structurellement non-scriptable par un agent)

Ces flux exigent l'authenticateur physique de l'Owner — aucun agent ne peut les simuler sans compromettre la garantie de sécurité même que le mandat demande de vérifier.

| # | Flux | Statut au 06/09/2026 | Preuve |
|---|---|---|---|
| 1 | Connexion Platform Owner (`/login`, email/mot de passe) | 🟢 OWNER VERIFIED | session applicative confirmée, accès à `/owner-auth` obtenu |
| 2 | Enregistrement passkey (`/owner-auth` → cérémonie WebAuthn) | 🟢 OWNER VERIFIED | notification native Chrome "Clé d'accès enregistrée" confirmée en conversation, `PLATFORM_OWNER_USER_IDS` corrigé en direct pour débloquer le flux |
| 3 | Reconnexion par passkey | ⚪ à exécuter | non encore testé par l'Owner à ce jour |
| 4 | Accès à AI Lab (`/ai-lab`, inclut Outcomes/Observability) | 🟢 OWNER VERIFIED | capture d'écran fournie : header "contact@ondeal.fr — Platform Owner", "SYSTEM LIVE", 14 onglets visibles |
| 5 | Refus d'un compte non-Owner | ✅ VERIFIED (par équivalence automatisée) | red-team réel : `Role.OWNER` métier légitime refusé sur `SYSTEM_CODER` (403) — couvre le même mécanisme (`isPlatformOwner`), reste néanmoins recommandé à l'Owner de le constater lui-même une fois avec un second compte marchand |
| 6 | Action sensible sans step-up récent → refus explicite | ⚪ à exécuter | ex. `PATCH /api/ai-lab/policy` sans step-up préalable |
| 7 | Validation step-up réussie puis action sensible acceptée | ⚪ à exécuter | `POST /api/owner/step-up/options` puis `/verify`, puis retenter l'action |
| 8 | Révocation d'une session (`GET /api/owner/sessions`, `POST .../revoke`) | ⚪ à exécuter | |
| 9 | Kill Switch Owner (`PATCH /api/ai-lab/policy`, `killSwitchEngaged:true`) | ⚪ à exécuter — **à faire en connaissance de cause** : pause toutes les missions AI Lab en cours, aucun effet sur le Merchant Plane |
| 10 | Audit des opérations précédentes (`GET /api/ai-lab/audit`) | ⚪ à exécuter | vérifier que les étapes 1-9 apparaissent bien horodatées |

**3 des 10 flux sont déjà `OWNER VERIFIED` ou équivalent-vérifiés. 7 restent à exécuter par l'Owner lui-même.**

## B. Protocole de la première mission Owner réelle (SANDBOX + ASSIST + budget limité)

À exécuter une fois les flux 3, 6, 7, 8 ci-dessus complétés (pour disposer d'une session Owner step-up fraîche si nécessaire).

### Préconditions obligatoires
- Onglet Composer, `Environment = SANDBOX` (jamais PRODUCTION pour ce premier test).
- `Autonomy Level = ASSIST`.
- `Hard Budget (USD)` fixé bas (ex. 5$, valeur déjà pré-remplie dans l'UI observée).
- Aucun `Store ID` renseigné (aucune cible marchande réelle).

### Objectif de test suggéré
Un objectif de pure cognition/analyse, sans effet de bord possible, par exemple : *"Analyse le pipeline de synchronisation Shopify et propose 3 axes d'amélioration, avec preuve chiffrée à partir du code existant."* — délibérément un objectif qui ne peut produire qu'une analyse, jamais une écriture.

### Ce qui doit être observé et vérifié à chaque étape

| Étape | Ce qui doit se produire | Où vérifier |
|---|---|---|
| Lancement | Mission créée, statut `PLANNING` puis `RUNNING` | Onglet Missions |
| Planification | Un graphe de nœuds réel apparaît (pas un texte statique) | Détail de la mission |
| Exécution | Les nœuds passent `RUNNING`→`SUCCEEDED` un par un, SSE en temps réel | Flux SSE visible dans l'UI |
| Budget | Le coût cumulé réel s'affiche et reste sous le budget fixé | Détail de la mission |
| Résultat | Un résultat concret est produit, avec preuve (pas une simple affirmation) | Résultat final de la mission |
| Audit | La mission entière apparaît dans l'onglet Audit avec les coûts/décisions réels | Onglet Audit |
| Observabilité | Aucune mission bloquée signalée pendant/après le test | Onglet Observability |
| Outcomes | Le compteur de missions total et le taux de succès reflètent ce test | Onglet Outcomes |

### Garantie de non-écriture production

Aucune écriture production ne doit se produire pendant ce test — garanti structurellement par `evaluatePolicy()` : `PRODUCTION_EFFECT` est `DENY` par défaut (`SystemPolicy.productionEffectsAllowed=false`), et la route de création de mission refuse même de créer une mission `environment:"PRODUCTION"` tant que ce flag est faux. En `SANDBOX`, `SANDBOX_EFFECT` est `ALLOW_AUTO` mais n'a par construction aucun effet en dehors de l'espace de travail jetable du Coder Agent.

### Critère de déclaration `OWNER VERIFIED`

Ce parcours ne peut être marqué `OWNER VERIFIED` que lorsque l'Owner l'aura réellement exécuté et confirmé chacune des observations du tableau ci-dessus — jamais par anticipation. Au moment de la rédaction de ce dossier, **ce protocole n'a pas encore été exécuté** ; il est ⚪ NOT IMPLEMENTED du point de vue de la preuve d'exécution (le code sous-jacent est ✅ VERIFIED par `tests/supervisorGraphRunner.test.ts`, voir 05-CAPABILITY-MATRIX.md).
