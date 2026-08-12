# SQP Inventaire

Application web de comptage d'inventaire par dépôt, pensée pour remplacer le comptage papier. Principe **offline-first** : la préparation d'une session (choix du dépôt, import du stock théorique depuis ARTIS) se fait en ligne, mais **le comptage lui-même se déroule entièrement hors connexion**, sur l'appareil, via un cache local IndexedDB.

Flux : **Préparer** une session (`/prepare`, import ARTIS + création serveur) → **Compter** hors ligne (`/sessions/[id]/count`, scan QR ou saisie manuelle) → **Synchroniser** puis **Clôturer** (`/sessions/[id]`, écarts compté/théorique) → **Administrer** (`/admin`, dépôts/utilisateurs/audit, réservé aux administrateurs).

Pour le détail exhaustif du comportement du code (routes, RBAC, fixtures ARTIS...), voir [`RUNBOOK.md`](./RUNBOOK.md). Pour la checklist de déploiement, voir [`specs/001-module-inventaire-sqp-impression-uv/quickstart.md`](./specs/001-module-inventaire-sqp-impression-uv/quickstart.md).

## Stack

- [Next.js](https://nextjs.org) (App Router, Turbopack) + TypeScript
- PostgreSQL + [Prisma](https://www.prisma.io)
- [Auth.js](https://authjs.dev) (credentials, sessions JWT)
- [Serwist](https://serwist.pages.dev) (service worker — PWA/offline)
- IndexedDB (via [Dexie](https://dexie.org)) pour le cache local de comptage
- [Vitest](https://vitest.dev) (unitaire) + [Playwright](https://playwright.dev) (e2e)

## Prérequis

- Node.js 20+, npm
- PostgreSQL accessible (local via Docker, ou une instance existante)
- Aucune dépendance externe obligatoire au-delà de ça — `ARTIS_MODE=mock` fournit un stock théorique simulé pour développer sans accès au système ARTIS réel.

## Installation

```bash
git clone <url-du-repo>
cd SqpInventaire
npm install
cp .env.example .env
```

Éditer `.env` : `DATABASE_URL` doit pointer vers un Postgres accessible. Toutes les variables sont documentées dans [`.env.example`](./.env.example). Exemple de Postgres local via Docker :

```bash
docker run -d --name sqp_inventaire_postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sqp_inventaire postgres:15
```

Puis :

```bash
npm run db:migrate   # applique les migrations (schéma + rôle sqp_app)
npm run db:seed      # dépôts + un utilisateur par rôle — destructif, voir RUNBOOK.md §4
```

## Lancer le projet

```bash
npm run dev
# -> http://localhost:3000
```

**Le comptage hors ligne ne fonctionne pas avec `npm run dev`** (Turbopack, service worker désactivé). Pour tester le mode PWA/offline :

```bash
npm run build:pwa   # next build --webpack — seul build qui génère public/sw.js
npm run start        # sert ce build sur http://localhost:3000
```

Détail des deux modes et pourquoi ils diffèrent : [`RUNBOOK.md` §3](./RUNBOOK.md).

## Tests

```bash
npm test                    # Vitest — unitaire + intégration Prisma
npm run test:e2e            # Playwright contre `npm run dev`
npm run test:e2e:offline    # Playwright contre `npm run build:pwa && npm run start`
npm run test:e2e:file-import # Playwright, import ARTIS réel (ARTIS_MODE=file)
npm run lint
```

## RGPD

Un script de purge (`npm run purge:rgpd`) supprime les sessions/lignes/entrées d'audit au-delà d'une fenêtre de rétention configurable (`RGPD_RETENTION_MONTHS`, 24 mois par défaut). Détails et fréquence recommandée : [`quickstart.md` §3](./specs/001-module-inventaire-sqp-impression-uv/quickstart.md).

## Déploiement

Image Docker multi-stage (`Dockerfile`) + `docker-compose.yml` pour une stack Portainer (app + PostgreSQL) derrière Nginx Proxy Manager. Étapes Portainer/NPM, variables de stack, et checklist post-déploiement (dont la vérification du rôle `sqp_app`, FR-032) : voir [`DEPLOY.md`](./DEPLOY.md).

## Licence

Non définie.
