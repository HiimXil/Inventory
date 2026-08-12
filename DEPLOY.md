# Déploiement — Portainer + Nginx Proxy Manager

Cible : une stack Portainer (`docker-compose.yml` collé dans l'UI) contenant l'app et PostgreSQL, derrière Nginx Proxy Manager (NPM) qui gère le HTTPS. L'app ne sert que du HTTP en interne — NPM termine le TLS.

Tout le contenu de ce document a été validé en construisant et lançant réellement l'image (`docker build` + `docker compose up` contre un vrai Postgres), pas seulement rédigé sur le papier — voir §5 pour ce qui a été concrètement vérifié.

## 1. Réseau partagé avec NPM

NPM route vers le conteneur de l'app par son nom de service Docker (`app`), pas par une IP ni un port publié sur l'hôte — les deux doivent donc être sur le **même réseau Docker externe**.

Si ce réseau n'existe pas encore (NPM tourne peut-être déjà sur son propre réseau créé par sa propre stack — vérifiez avec `docker network ls` avant de recréer) :

```bash
docker network create npm_proxy
```

Si le réseau de NPM porte déjà un autre nom, ne le recréez pas : renseignez `NPM_NETWORK_NAME` (variable de stack, §2) avec le nom existant plutôt que de dupliquer un réseau.

## 2. Créer la stack dans Portainer

1. **Stacks → Add stack**, nommez-la (ex. `sqp-inventaire`).
2. Collez le contenu de [`docker-compose.yml`](./docker-compose.yml).
3. Section **Environment variables** de la stack — renseignez (aucune valeur par défaut n'est un vrai secret) :

   | Variable | Exemple / génération | Notes |
   |---|---|---|
   | `POSTGRES_PASSWORD` | `openssl rand -hex 24` | Mot de passe superuser Postgres — sert uniquement aux migrations, jamais à l'app en fonctionnement. |
   | `SQP_APP_PASSWORD` | `openssl rand -hex 24` | Mot de passe du rôle applicatif `sqp_app` (FR-032). Évitez un guillemet simple `'` dans la valeur — voir §4. |
   | `NEXTAUTH_SECRET` | `openssl rand -base64 32` | Signature des sessions Auth.js. |
   | `NEXTAUTH_URL` | `https://inventaire.votredomaine.com` | **L'URL PUBLIQUE HTTPS servie par NPM — jamais une URL interne (`http://app:3000`).** Auth.js signe ses cookies contre cette origine ; une mauvaise valeur casse silencieusement le login et l'enregistrement du service worker. |
   | `ARTIS_MODE` | `file` | Voie principale en production (voir RUNBOOK.md §7). |
   | `RGPD_RETENTION_MONTHS` | `24` | Optionnel, défaut 24. |
   | `SEED_DEMO_PASSWORD` | (laisser vide ou définir) | Si vide, le seed initial utilise `Password123!` (valeur publique documentée — voir RUNBOOK.md §4). Recommandé de définir une valeur si vous ne comptez pas remplacer/désactiver ces comptes de démo immédiatement après le premier démarrage. |
   | `NPM_NETWORK_NAME` | `npm_proxy` | Nom du réseau externe créé au §1, si différent du défaut. |
   | `POSTGRES_DB` | `sqp_inventaire` | Optionnel, défaut déjà correct. |

4. **Deploy the stack**.

Au premier démarrage, le conteneur `app` : applique les migrations Prisma, positionne le mot de passe du rôle `sqp_app`, puis peuple la base (dépôts + un utilisateur par rôle) puisqu'elle est vide — voir `scripts/docker-entrypoint.sh`. Aux démarrages suivants, ces trois étapes sont ré-exécutées mais sans effet destructif : migrations déjà appliquées → no-op, mot de passe réappliqué à l'identique, seed sauté dès qu'un utilisateur existe (`scripts/seed-if-empty.ts`).

## 3. Configuration Nginx Proxy Manager

1. **Proxy Hosts → Add Proxy Host**.
2. **Domain Names** : votre domaine public (ex. `inventaire.votredomaine.com`) — doit correspondre exactement à `NEXTAUTH_URL`.
3. **Scheme** : `http` (l'app ne sert que du HTTP en interne).
4. **Forward Hostname / IP** : `app` (le nom du service Docker — résoluble uniquement parce que NPM et `app` partagent le réseau `proxy` du §1).
5. **Forward Port** : `3000`.
6. Onglet **SSL** : demandez/attachez un certificat Let's Encrypt, activez **Force SSL** et **HTTP/2**.
7. Onglet **Advanced** : rien de spécifique n'est requis par l'app (pas de WebSocket à proxifier — le service worker et IndexedDB sont purement côté navigateur).

## 4. Notes opérationnelles

- **Deux connexions DB distinctes, jamais mélangées** (voir `scripts/docker-entrypoint.sh`) : `MIGRATE_DATABASE_URL` (rôle superuser `postgres`, construit automatiquement dans `docker-compose.yml` à partir de `POSTGRES_PASSWORD`) pour les migrations/seed/`ALTER ROLE`, et `DATABASE_URL` (rôle `sqp_app`) pour l'app en fonctionnement. Ne changez pas l'app pour qu'elle utilise `MIGRATE_DATABASE_URL` — ça annulerait la garantie FR-032.
- **`SQP_APP_PASSWORD` ne doit pas contenir de guillemet simple (`'`)** — le mot de passe est correctement échappé pour SQL par l'entrypoint (guillemets doublés), mais un mot de passe généré via `openssl rand -hex ...` n'en contient de toute façon jamais (alphanumérique uniquement).
- **Rotation d'un mot de passe** : changez la variable de stack (`POSTGRES_PASSWORD` ou `SQP_APP_PASSWORD`) puis **redéployez la stack** (pas juste un redémarrage du conteneur `db`, qui ne relit pas `POSTGRES_PASSWORD` une fois le volume déjà initialisé) — pour `SQP_APP_PASSWORD`, un simple redémarrage du conteneur `app` suffit : l'entrypoint réapplique l'`ALTER ROLE` à chaque boot.
- **Sauvegardes** : le volume nommé `db_data` contient toute la base. Sauvegardez-le (ou faites un `pg_dump` régulier depuis le conteneur `db`) — hors du périmètre de cette stack elle-même.

## 5. Checklist post-déploiement

- [ ] **L'app répond** : `https://votredomaine/login` charge sans erreur TLS ni erreur 502.
- [ ] **Login fonctionne** avec un des comptes de démo (ou vos propres comptes admin créés ensuite) — confirme NEXTAUTH_URL/NEXTAUTH_SECRET corrects.
- [ ] **`sqp_app` est bien restreint (FR-032)** — depuis le conteneur `db` :
  ```bash
  docker exec -it <container_db> psql -U sqp_app -d sqp_inventaire -c 'DELETE FROM "AuditLog";'
  # Attendu : ERROR: permission denied for table AuditLog
  ```
  Si cette commande réussit au lieu d'échouer, `DATABASE_URL` de l'app pointe encore sur le rôle superuser — vérifiez la variable de stack.
- [ ] **Le comptage hors ligne fonctionne réellement sur l'URL HTTPS publique** (pas juste en local) : ouvrez `/sessions/[id]/count` sur une session préparée, laissez la page charger une fois en ligne, puis coupez le réseau du poste (ou mode avion) et confirmez que la page reste utilisable (scan/saisie, écarts calculés) sans réseau. Ce test doit se faire sur le domaine HTTPS réel : le service worker ne s'enregistre que dans un contexte sécurisé (`https://`), donc ce point ne peut PAS être validé en HTTP simple.
- [ ] **Remplacez ou désactivez les comptes de démo** (`admin@example.com` etc., mot de passe public documenté) avant d'ouvrir l'accès à de vrais utilisateurs, sauf si `SEED_DEMO_PASSWORD` a déjà été défini à une valeur privée avant le tout premier démarrage.
- [ ] **Cron RGPD** : planifiez `npm run purge:rgpd`. **Confirmé en lisant `lib/rgpd/purge.ts`** : la purge fait un `DELETE` direct sur `AuditLog` (des entrées au-delà de la fenêtre de rétention, indépendamment de leur session) — ce `DELETE` est physiquement refusé au rôle `sqp_app` (FR-032). Ce script doit donc tourner avec une connexion privilégiée (l'équivalent de `MIGRATE_DATABASE_URL`), jamais avec le `DATABASE_URL` applicatif :
  ```bash
  docker exec -e DATABASE_URL="$MIGRATE_DATABASE_URL" <container_app> node_modules/.bin/tsx scripts/purge-rgpd.ts
  ```
  À planifier depuis le cron/scheduler de l'hébergeur (hors de cette stack), fréquence quotidienne recommandée.

## Ce qui a été concrètement vérifié (pas seulement écrit)

- `docker build` complet de l'image (multi-stage) — réussi.
- `docker compose up` contre un vrai `postgres:16-alpine` — migrations appliquées (6/6), mot de passe `sqp_app` positionné, seed initial exécuté sur base vide.
- Redémarrage du conteneur `app` — migrations en no-op, seed correctement sauté (`4 user(s) already present`), aucune perte de données.
- `public/sw.js` bien présent dans l'image finale (le build `build:pwa` + la copie manuelle de `public/` dans le Dockerfile fonctionnent ensemble).
- `sqp_app` confirmé incapable de `DELETE`/`UPDATE` sur `AuditLog` (`permission denied for table AuditLog`), capable de lire/écrire ailleurs.
- Flux de login complet testé (CSRF → credentials → cookie de session) à travers la stack conteneurisée.
- Le healthcheck `db` et le `depends_on: condition: service_healthy` de `app` fonctionnent comme attendu.

Non vérifiable dans cet environnement (pas de vrai NPM/domaine/certificat disponible ici) : la configuration NPM elle-même (§3) et le test offline sur une vraie URL HTTPS publique (dernier point de la checklist) — à valider par vous après déploiement réel.
