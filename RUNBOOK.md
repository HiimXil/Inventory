# SQP Inventaire — Runbook opérationnel

Ce document décrit uniquement ce qui existe réellement dans le dépôt de code à ce jour (US1 à US3 implémentées ; US4 sync, US5 export/clôture et US6 admin/audit ne sont pas encore construites). Toutes les affirmations ci-dessous sont vérifiées contre le code source, pas supposées.

## 1. Vue d'ensemble

SQP Inventaire est une application web de comptage d'inventaire par dépôt, pensée pour remplacer le comptage papier. Le principe est **offline-first** : la préparation d'une session (choix du dépôt, import du stock théorique depuis ARTIS) se fait en ligne, mais **le comptage lui-même se déroule entièrement hors connexion**, sur l'appareil, via un cache local IndexedDB alimenté une seule fois au démarrage. Le flux réel implémenté est : **Préparer** une session (`/prepare`, import ARTIS + création serveur) → **Compter** hors ligne (`/sessions/[id]/count`, scan QR ou saisie manuelle, mise à jour immédiate des quantités) → **Visualiser les écarts** (comparaison compté/théorique en temps réel, sans réseau, lignes en écart surlignées en rouge). La synchronisation vers le serveur, la clôture, l'export Excel et l'administration ne sont pas encore développés.

## 2. Prérequis & installation

### Versions

Aucune version de Node/npm n'est pinnée dans `package.json` (pas de champ `engines`), ni de `.nvmrc`/`Dockerfile` dans le dépôt. La seule référence documentée est `specs/001-module-inventaire-sqp-impression-uv/plan.md`, qui cite **Node.js 20+** et **TypeScript 5.x** comme cible — à traiter comme une intention de conception, pas comme une contrainte appliquée par l'outillage. Le projet utilise **Next.js 16.2.9** (voir `package.json`) avec Turbopack par défaut, PostgreSQL comme base de données (Prisma 6.11), et pnpm/npm indifféremment (les scripts sont lancés ici avec `npm`).

### Variables d'environnement (`.env.example`)

| Variable | Rôle réel dans le code |
|---|---|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL utilisée par `lib/db/client.ts` (Prisma). Exemple fourni : `postgresql://postgres:postgres@localhost:5432/sqp_inventaire`. |
| `NEXTAUTH_URL` | Base URL utilisée par Auth.js et par `lib/auth/session.ts` (fallback `http://localhost:3000`) pour reconstruire l'URL interne `/api/auth/session` lors de la résolution de session côté serveur. |
| `NEXTAUTH_SECRET` | Secret de signature/chiffrement des sessions Auth.js (`authOptions.secret` dans `lib/auth/options.ts`). La valeur d'exemple (`change-this-secret-to-a-secure-value`) doit être remplacée. |
| `ARTIS_MODE` | Lu par `lib/artis/factory.ts` (`resolveArtisMode()`). Trois valeurs : `file` (voie principale : import d'un export Excel ARTIS fourni par l'utilisateur à la préparation, `ArtisFileAdapter` — **défaut réel partout où un humain utilise l'app, dev local ET production**), `mock` (fixtures simulées, sans fichier — ne s'applique automatiquement que dans les suites de tests, forcé par Vitest/Playwright eux-mêmes, jamais comme effet de bord d'un `.env` local), `http` (non implémenté — lève `"ArtisHttpAdapter is not implemented in the foundation phase."`, le contrat réel est pourtant connu et documenté dans research.md R2, ce mode est un report délibéré, pas un manque d'information). Non défini dans `.env`/`.env.example` : la valeur par défaut du code (`file`) prévaut. |
| `ARTIS_FIXTURE` | Lu par `lib/artis/factory.ts`/`lib/artis/mock.ts`. Sélectionne le jeu de données simulé : `normal` (défaut si absent), `empty`, `malformed`, `paginated`. Voir section 7. |
| `NODE_ENV` | Standard Next.js. **Double rôle réel** : contrôle aussi l'activation de Serwist dans `next.config.ts` (`disable: process.env.NODE_ENV !== "production"`) — voir section 3. |
| `ARTIS_BASE_URL`, `ARTIS_USER`, `ARTIS_PASSWORD` | Réservées pour `ArtisHttpAdapter` (`ARTIS_MODE=http`), **non implémenté** — non lues par le code actuel. À renseigner uniquement si/quand ce mode est développé ; ne jamais y mettre de vraies valeurs dans un `.env` versionné. |
| `SEED_DEMO_PASSWORD` | Lu par `prisma/seed.ts`. Surcharge le mot de passe des comptes de démo (défaut : `Password123!`, une valeur publique documentée — voir section 4). |
| `RGPD_RETENTION_MONTHS` | Lu par `scripts/purge-rgpd.ts`. Fenêtre de rétention avant purge (défaut 24 mois si absent/invalide). |

### Installation

```bash
npm install
```

### Base de données

```bash
# applique les migrations Prisma existantes (prisma/migrations)
npx prisma migrate dev
# ou, script raccourci du projet :
npm run db:migrate

# peuple la base (dépôts + un utilisateur par rôle — voir section 4)
npm run db:seed
```

`npm run db:migrate` exécute `prisma migrate dev` ; la configuration Prisma (`prisma.config.ts`) charge `.env` via `dotenv/config` et définit `migrations.seed = "tsx prisma/seed.ts"`, donc `npx prisma db seed` fonctionne aussi directement.

## 3. Lancer le projet — dev vs build PWA/offline

**Ce qui distingue les deux modes n'est pas cosmétique** : le service worker Serwist est **désactivé en développement** (`next.config.ts` : `disable: process.env.NODE_ENV !== "production"`), parce que le plugin webpack de `@serwist/next` n'a pas de support Turbopack (or Next 16 utilise Turbopack par défaut pour `next dev` *et* `next build`). Conséquence directe : **le comptage hors ligne (`/sessions/[id]/count` sans réseau) ne fonctionne QUE contre un build `next build --webpack` servi par `next start`.** En développement, la route de comptage ne se charge que si le navigateur a effectivement du réseau pour l'appel `/bootstrap`.

```bash
# Développement (Turbopack, service worker INACTIF)
npm run dev
# -> http://localhost:3000
```

```bash
# Build + serveur "PWA" (webpack, service worker ACTIF) — seul mode où l'offline fonctionne
npm run build:pwa   # next build --webpack
npm run start       # next start, sert le build ci-dessus sur http://localhost:3000
```

### Tous les scripts (`package.json`)

| Script | Quand l'utiliser |
|---|---|
| `npm run dev` | Développement quotidien (Turbopack, rechargement rapide). Service worker inactif — ne pas tester l'offline ici. |
| `npm run build` | Build de production standard (Turbopack, défaut Next 16). **N'active pas** le service worker (voir ci-dessus) : à utiliser pour vérifier que le code compile/type-check, pas pour tester l'offline. |
| `npm run start` | Sert le build produit par `npm run build` ou `npm run build:pwa` (le dernier build présent dans `.next`). |
| `npm run build:pwa` | `next build --webpack` — seul build qui génère réellement `public/sw.js` avec le manifeste de précache. À utiliser avant `npm run start` pour tester le mode PWA/offline. |
| `npm run lint` | ESLint (flat config `eslint.config.mjs`). |
| `npm run db:migrate` | `prisma migrate dev` — applique/crée une migration. |
| `npm run db:seed` | `tsx prisma/seed.ts` — réinitialise et repeuple dépôts/utilisateurs (destructif, voir section 4). |
| `npm test` | Suite Vitest (unitaire). |
| `npm run test:e2e` | Playwright contre `npm run dev` (config par défaut `playwright.config.ts`, dossier `tests/e2e/`). |
| `npm run test:e2e:offline` | Playwright contre `npm run build:pwa && npm run start` (config `playwright.offline.config.ts`, dossier `tests/e2e-offline/`). |

## 4. Comptes de connexion

`prisma/seed.ts` supprime puis recrée systématiquement les dépôts et utilisateurs. Il crée **un utilisateur par rôle**, tous avec le même mot de passe :

| Email | Rôle | Mot de passe |
|---|---|---|
| `admin@example.com` | `ADMIN` | `Password123!` |
| `depot@example.com` | `DEPOT_MANAGER` | `Password123!` |
| `logistics@example.com` | `LOGISTICS` | `Password123!` |
| `direction@example.com` | `DIRECTION` | `Password123!` |

Ce mot de passe est une valeur de démo **délibérément publique et documentée** (des dizaines de tests s'appuient dessus) — ce n'est pas un secret, et ces comptes `@example.com` n'existent que dans une base locale/CI jetable. Le mot de passe réel est haché avec `argon2` avant stockage (`passwordHash`) ; la valeur en clair peut être remplacée en définissant `SEED_DEMO_PASSWORD` avant `npm run db:seed` (utile pour une base partagée où vous ne voulez pas de la valeur par défaut). **Ne jamais lancer ce script tel quel contre une base de production** (voir `quickstart.md` §5, checklist de déploiement).

Dépôts créés par le seed : `PAR01` (Paris - Atelier 1), `LYO01` (Lyon - Dépôt central), `GEN01` (Genève - Stock principal).

**Il n'existe actuellement aucune page `/login` dans le code** (`app/(auth)/login` est mentionné dans `specs/.../plan.md` comme cible d'architecture mais n'a pas été implémenté). L'authentification ne passe que par les endpoints Auth.js bruts :

```bash
# 1. récupérer un jeton CSRF
curl -s -c cookies.txt http://localhost:3000/api/auth/csrf
# 2. s'authentifier (le cookie de session est écrit dans cookies.txt)
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/auth/callback/credentials \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "email=admin@example.com&password=Password123!&csrfToken=<token ci-dessus>&json=true"
```

C'est exactement ce que font les tests E2E (`tests/e2e/prepare-session.spec.ts`, `tests/e2e-offline/*.spec.ts`) via `page.request`.

## 5. Carte des routes

Rôles déduits de `lib/auth/roles.ts` (`PERMISSION_MATRIX`) et des appels réels à `requirePermission()` dans le code — pas de supposition.

| Route | Type | À quoi elle sert | Rôles autorisés (réels) | Réseau requis ? |
|---|---|---|---|---|
| `/` | Page | Page d'accueil par défaut de `create-next-app`, non modifiée — sans lien avec le flux métier. | Aucune garde. | Non (statique). |
| `/prepare` | Page (Server Component, `force-dynamic`) | Liste les dépôts (`prisma.depot.findMany`) et affiche le formulaire de préparation de session. | **Aucune garde au niveau de la page** — visible par tout visiteur (authentifié ou non). C'est la *server action* `prepareSession` (`app/(app)/prepare/actions.ts` → `runPrepareSession`) qui applique la RBAC réelle : permission `PREPARE` = `ADMIN`, `DEPOT_MANAGER` uniquement. Tout autre rôle (ou non-connecté) reçoit une erreur et l'action journalise `SESSION_CREATE_DENIED` dans `AuditLog`. | Oui (import ARTIS + écriture DB). |
| `/sessions/[id]` | Page (Server Component, `force-dynamic`) | Redirige vers `/sessions/[id]/count` si le statut est `PREPARED` ; sinon affiche un stub texte (dépôt, statut) — la vraie vue de résultats n'est pas construite. | **Aucune garde RBAC dans le code actuel** (à la différence des deux routes ci-dessous). Accessible à quiconque connaît l'URL. | Oui (lecture DB). |
| `/sessions/[id]/count` | Page (Client Component, île offline, FR-026) | Écran de comptage : amorce le cache local une fois (`ensureSessionBootstrapped`), scan QR/saisie manuelle, table de comptage, écarts en temps réel. **Aucun garde d'auth de rendu/redirection n'est ajouté volontairement** sur cette route. | Aucune garde côté page. La RBAC réelle s'applique uniquement lors du premier appel réseau à `/bootstrap` (voir ci-dessous) : un rôle sans permission `COUNT` obtient une erreur affichée à la place de l'écran de comptage. | Non pour compter (une fois le snapshot en cache) ; oui uniquement pour le tout premier chargement (`/bootstrap`). |
| `/api/auth/[...nextauth]` | Route API (GET/POST) | Dispatcher Auth.js complet (`session`, `csrf`, `callback/credentials`, `providers`, etc. — `basePath: "/api/auth"`). | C'est le système d'authentification lui-même — pas de RBAC applicable. | Oui. |
| `/api/sessions/[id]/bootstrap` | Route API (GET) | Point de téléchargement **unique** du snapshot théorique d'une session (jamais re-fetché après, voir `plan.md` Décision #4). | Authentification requise (401 sinon) + permission `COUNT` = `ADMIN`, `DEPOT_MANAGER`, `LOGISTICS` (403 sinon, avec `AuditLog` action `BOOTSTRAP_DENIED`). 404 si la session n'existe pas. | Oui (c'est un appel serveur). |

Permissions définies dans `PERMISSION_MATRIX` mais **sans route qui les applique aujourd'hui** (US4/US5/US6 non construites) : `SYNC`, `CLOSE`, `EXPORT`, `CANCEL_SESSION`, `MANAGE_USERS`, `VIEW_AUDIT`, `VIEW_RESULTS`.

## 6. Comment tester

```bash
# Unitaire (Vitest, environnement happy-dom, base de test réelle pour les tests
# touchant Prisma — voir tests/unit/prepare-session.test.ts)
npm test

# E2E "en ligne" — contre npm run dev (Turbopack), dossier tests/e2e/
npm run test:e2e

# E2E "hors ligne" — contre npm run build:pwa && npm run start, dossier tests/e2e-offline/
# C'est le SEUL mode qui exerce réellement le service worker : ne testez jamais
# l'offline contre `npm run dev`, ça ne peut pas fonctionner (section 3).
npm run test:e2e:offline
```

Les tests Playwright hors ligne créent leurs propres dépôts/sessions via Prisma directement (pas d'UI), se connectent via le flux CSRF décrit en section 4, chargent la page une première fois en ligne (pour amorcer IndexedDB et laisser le service worker mettre la page en cache), puis appellent `context.setOffline(true)` avant de recharger.

## 7. Points d'attention connus

- **`ARTIS_MODE` a trois valeurs, deux fonctionnelles.** `file` (voie principale : `ArtisFileAdapter` parse un export Excel ARTIS fourni par l'utilisateur à la préparation — voir `app/(app)/prepare/`, `lib/artis/file.ts`) est le défaut réel partout où un humain utilise l'app, dev local et production. `mock` (fixtures simulées, sans fichier) est disponible mais ne s'applique automatiquement que pendant les tests. Les deux sont implémentées et testées. Seul `http` (appel direct à l'API ARTIS réelle, `ArtisHttpAdapter`) lève une exception — non implémenté par choix : le plafond `maxResults≈100` sans offset de l'API réelle (voir research.md R2) rend l'import par fichier préférable pour un import exhaustif, ce n'est pas un manque d'information sur le contrat.
- **Les suites de tests ne dépendent jamais du `.env` local pour `ARTIS_MODE`.** `resolveArtisMode()` (`lib/artis/factory.ts`) détecte un run de test (`NODE_ENV=test` ou `process.env.VITEST`, mis automatiquement par Vitest) et bascule le défaut sur `mock` dans ce cas précis — sans ça, le défaut réel (`file`) s'appliquerait aussi aux tests. En plus de cette détection, `vitest.config.ts`, `playwright.config.ts` et `playwright.offline.config.ts` fixent `ARTIS_MODE=mock` explicitement (à la fois pour le process de test lui-même via `globalSetup`/`test.env`, et pour le serveur `next dev`/`next start` qu'ils lancent via `webServer.env`) — ceinture et bretelles, pas l'un ou l'autre. Seul `playwright.file-import.config.ts` force `file` explicitement (son propre `webServer.env`), sur un port dédié (3100), pour tester le vrai chemin d'upload. Résultat : la valeur de `ARTIS_MODE` dans le `.env` local d'un développeur n'a plus aucune influence sur le résultat d'aucune suite.
- **Fixtures mock disponibles** (`lib/artis/mock.ts`, sélectionnées par `ARTIS_FIXTURE`) : `normal` (3 articles : ART-001/002/003), `empty` (liste vide), `malformed` (ligne invalide, rejetée par la validation Zod), `paginated` (1200 lignes sur 24 pages, pour tester l'agrégation complète).
- **Convention `E2E-*` sur le code dépôt** : `fixtureOverrideForDepot()` dans `lib/artis/mock.ts` fait correspondre un préfixe de *code dépôt* (`E2E-EMPTY...`, `E2E-MALFORMED...`, `E2E-PAGINATED...`, `E2E-NORMAL...`) à une fixture, indépendamment de la variable d'environnement globale `ARTIS_FIXTURE`. Nécessaire car les specs E2E hors ligne partagent un unique serveur `next build --webpack && next start` mais ont besoin de comportements différents en parallèle.
- `ArtisMockAdapter.listDepots()` renvoie une liste fixe (`PAR01`, `LYO01`) qui n'est appelée par aucune route actuellement — `/prepare` lit les dépôts directement dans PostgreSQL (`prisma.depot.findMany`), pas via l'adaptateur ARTIS.
- **Le décodage caméra réel n'est pas testé automatiquement.** `useBarcodeScanner.ts` sépare volontairement la logique pure de traitement d'une référence scannée (`lib/offline/scan-processing.ts`, testée en Vitest avec de simples chaînes) de la capture caméra (`BarcodeDetector` natif ou fallback `@zxing/browser`). Faire décoder un vrai QR code par un flux caméra factice Chromium (`--use-fake-device-for-media-stream`) demanderait une vidéo pré-encodée contenant un QR réel ; les tests E2E utilisent donc le champ de saisie manuelle de `QRScanner.tsx` (qui alimente le même pipeline `scanArticle`) pour exercer le comptage de bout en bout, tout en gardant les flags de flux média factice actifs pour vérifier que l'initialisation caméra ne plante pas.
- Aucune page `/login` : voir section 4 pour s'authentifier sans UI.
- `/sessions/[id]` n'a aucune garde RBAC dans le code actuel (section 5) — à garder en tête si une story ultérieure construit la vraie vue de résultats.
