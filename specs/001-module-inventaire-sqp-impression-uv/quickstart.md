# Quickstart — Module d'inventaire SQP

Ce document couvre deux choses distinctes : (1) mettre le projet en route en
local pour développer, et (2) la checklist à suivre avant/pendant un
déploiement en production. Pour le détail exhaustif du comportement actuel
du code (routes, RBAC, fixtures ARTIS...), voir `RUNBOOK.md` à la racine du
dépôt — ce document-ci est le point d'entrée rapide.

## 1. Prérequis

- Node.js 20+, npm
- PostgreSQL accessible (local via Docker, ou une instance existante)
- Aucune dépendance externe obligatoire au-delà de ça : pas de Redis, pas de
  service tiers pour tourner en local (`ARTIS_MODE=mock` fournit un stock
  théorique simulé).

## 2. Setup local

```bash
git clone <repo>
cd SqpInventaire
npm install
cp .env.example .env
```

Éditer `.env` : `DATABASE_URL` doit pointer vers un Postgres accessible.
Exemple avec Docker :

```bash
docker run -d --name sqp_inventaire_postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sqp_inventaire postgres:15
```

Puis :

```bash
npm run db:migrate   # applique toutes les migrations (schéma + rôle sqp_app, voir §5)
npm run db:seed      # dépôts + un utilisateur par rôle (destructif — voir RUNBOOK.md §4)
```

Comptes créés par le seed (mot de passe `Password123!` pour tous — valeur de
démo publique et documentée, pas un secret ; surchargeable via
`SEED_DEMO_PASSWORD` avant `npm run db:seed`) :
`admin@example.com` (ADMIN), `depot@example.com` (DEPOT_MANAGER),
`logistics@example.com` (LOGISTICS), `direction@example.com` (DIRECTION).

### Lancer l'application

```bash
npm run dev
# -> http://localhost:3000
```

**Le comptage hors ligne (`/sessions/[id]/count` sans réseau) ne fonctionne
PAS avec `npm run dev`** (Turbopack, service worker désactivé). Pour tester
le mode PWA/offline :

```bash
npm run build:pwa   # next build --webpack — seul build qui génère public/sw.js
npm run start        # sert ce build sur http://localhost:3000
```

### Tests

```bash
npm test                    # Vitest (unitaire + intégration Prisma sur la même base)
npm run test:e2e            # Playwright contre `npm run dev`
npm run test:e2e:offline    # Playwright contre `npm run build:pwa && npm run start`
```

## 3. Purge RGPD (FR-025)

```bash
npm run purge:rgpd
```

Supprime :
- les `InventorySession` en statut `CLOSED` ou `CANCELLED` dont `closedAt`
  (ou `updatedAt` si `closedAt` est absent) dépasse la fenêtre de rétention,
  avec leurs `InventoryLine` ;
- les `AuditLog` dont `createdAt` dépasse la même fenêtre, indépendamment de
  la session à laquelle ils sont rattachés.

Les sessions actives (`PREPARED`, `SYNCED`) ne sont **jamais** purgées, quel
que soit leur âge.

Fenêtre configurable via `RGPD_RETENTION_MONTHS` (24 mois par défaut si la
variable est absente ou invalide — voir `.env.example`).

Le script journalise sur stdout le nombre de sessions/lignes/entrées d'audit
purgées ainsi que la fenêtre et la date de coupure utilisées, et sort avec un
code non nul en cas d'échec (voir `scripts/purge-rgpd.ts`).

**Fréquence recommandée : une exécution quotidienne**, via le cron/scheduler
de l'hébergeur (voir checklist de déploiement ci-dessous).

## 4. Variables d'environnement

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | Oui | Connexion PostgreSQL |
| `NEXTAUTH_URL` | Oui | Base URL pour Auth.js |
| `NEXTAUTH_SECRET` | Oui | Secret de signature des sessions — à changer en production |
| `ARTIS_MODE` | Oui | `mock` (dev/test, fixtures simulées), `file` (voie principale — import d'un export Excel ARTIS fourni par l'utilisateur à la préparation, défaut en production), ou `http` (non implémenté — voir RUNBOOK.md §7) |
| `ARTIS_FIXTURE` | Non | Jeu de données simulé (`normal` par défaut) |
| `ARTIS_BASE_URL` / `ARTIS_USER` / `ARTIS_PASSWORD` | Non | Réservées pour le futur `ArtisHttpAdapter` (`ARTIS_MODE=http`) — non lues par le code actuel, ne rien y mettre de réel tant que ce mode n'existe pas |
| `SEED_DEMO_PASSWORD` | Non | Surcharge le mot de passe des comptes de démo créés par `npm run db:seed` (défaut `Password123!`, valeur publique documentée) |
| `RGPD_RETENTION_MONTHS` | Non | Fenêtre de rétention du script de purge (24 par défaut) |

## 5. Checklist de déploiement

**Ce sont des vérifications à effectuer manuellement au moment du
déploiement — pas des tests automatisés exécutés par la CI.** Rien ici ne
remplace `npm test`/`npm run test:e2e*` ; c'est une checklist opérationnelle
en plus.

- [ ] **Hébergement en UE** — vérifier manuellement que l'instance
  applicative et la base PostgreSQL sont hébergées dans l'Union européenne
  (contrainte RGPD, constitution du projet). Aucune vérification automatique
  n'existe dans le code : c'est un choix d'infrastructure à valider avec
  l'hébergeur.
- [ ] **HTTPS/TLS valide** — obligatoire, pas optionnel. Deux fonctionnalités
  du produit exigent un contexte sécurisé (`https://`) pour fonctionner dans
  le navigateur : `getUserMedia` (caméra pour le scan QR,
  `useBarcodeScanner.ts`) et l'enregistrement du service worker Serwist (le
  comptage hors ligne). Un déploiement en HTTP simple casse silencieusement
  ces deux fonctionnalités côté navigateur.
- [ ] **Build PWA, pas le build dev** — le serveur de production doit être
  démarré avec `npm run build:pwa && npm run start`, jamais `npm run dev`
  ni `npm run build` (Turbopack) seul : ce sont les seuls qui ne génèrent
  pas `public/sw.js`, donc le comptage hors ligne ne fonctionnerait pas en
  production (voir RUNBOOK.md §3).
- [ ] **Variables d'environnement de production** — `DATABASE_URL` (pointant
  vers la base de production), `NEXTAUTH_URL` (domaine public réel),
  `NEXTAUTH_SECRET` (valeur forte, générée pour l'environnement — jamais la
  valeur d'exemple), `ARTIS_MODE=file` (voie principale de production — un
  fichier d'export ARTIS est alors requis par l'utilisateur à chaque
  préparation de session ; `ARTIS_FIXTURE` ne s'applique qu'au mode `mock`
  et n'a pas d'effet en mode `file`. `ARTIS_MODE=http` reste non implémenté,
  voir RUNBOOK.md §7).
- [ ] **Migration + seed initial** — `npm run db:migrate` (ou
  `prisma migrate deploy` en CI/CD, qui n'exécute pas le seed) contre la base
  de production, puis un seed initial adapté (le script `prisma/seed.ts`
  fourni est **destructif** et pensé pour le dev — ne pas le lancer tel quel
  contre une base de production existante ; l'utiliser comme référence pour
  créer le·s premier·s compte·s admin).
- [ ] **Rôle `sqp_app` (FR-032, immuabilité de l'audit)** — la migration
  `20260723095800_hardening_auditlog_immutable_role` crée un rôle Postgres
  `sqp_app` sans mot de passe. Avant de pointer `DATABASE_URL` de production
  dessus : définir un mot de passe (`ALTER ROLE sqp_app WITH PASSWORD '...'`)
  et construire la chaîne de connexion avec ce rôle plutôt qu'avec le rôle
  superutilisateur utilisé en dev/test. Ce rôle a SELECT/INSERT/UPDATE/DELETE
  sur toutes les tables sauf `AuditLog`, où UPDATE/DELETE sont explicitement
  révoqués (voir le commentaire sur le modèle `AuditLog` dans
  `prisma/schema.prisma`).
- [ ] **Cron de purge RGPD** — brancher `npm run purge:rgpd` (§3) sur le
  cron/scheduler de l'hébergeur, fréquence quotidienne recommandée.
- [ ] **Compatibilité Chrome/Edge (FR-013)** — vérification manuelle sans
  artefact automatisé : parcourir le flux complet (préparation, scan QR,
  comptage, écarts, sync, clôture, export) sur la dernière version de Chrome
  et d'Edge, sur mobile/tablette en priorité. Non couvert par un test
  automatisé — c'est une contrainte non fonctionnelle de compatibilité
  navigateur, pas un comportement testable unitairement.
