# Phase 0 Research: Module web d'inventaire de stock par dépôt

**Branch**: `001-module-inventaire-sqp-impression-uv` | **Date**: 2026-07-01

This document resolves the open technical questions before Phase 1 design and task generation. R1 is the most consequential: it prevents the offline-first counting flow from being broken by server-side authentication.

---

## R1 — Authentication vs the offline counting island (DECIDED)

### Problem

`/sessions/[id]/count` is an offline island. When the device is offline, the browser request never reaches the server: neither the root `middleware.ts` nor server-side rendering executes. A conventional server auth guard on this route (redirect to `/login` when unauthenticated, or a server component that reads the session) would make the counting screen **unreachable offline** — breaking the primary operational flow (counting stock from a vehicle with no network, per the spec).

### Decision

Authentication is enforced **online, at the server data boundaries only** — never as a render/redirect guard on the offline island.

1. **Precache the counting shell.** Serwist precaches the app shell (HTML/JS/CSS) of `/sessions/[id]/count`. Offline, the service worker serves the cached shell; the client-side island then hydrates from the IndexedDB snapshot. No navigation request is proxied to the server, so no redirect can occur.

2. **Enforce auth at the two server boundaries.**
   - `GET /api/sessions/[id]/bootstrap` — requires a valid authenticated session and RBAC authorization **before** any theoretical data reaches the device. This is where trust is established: the user must be authenticated and authorized to receive the snapshot.
   - `POST /api/sessions/[id]/sync` — requires a valid authenticated session and RBAC authorization **before** any counted data is accepted back. This is where trust is re-established on return to network.

3. **Offline = trust the resident data.** Between bootstrap and sync, the device holds data the user was already authorized to access. Offline, the island does not attempt to re-authenticate; it operates on the local cache. Sensitivity is acceptable because (a) the snapshot is scoped to one session/one depot, and (b) it is purged after successful sync + confirmed closure (FR-018).

4. **Middleware matcher excludes the island.** The root `middleware.ts` matcher must exclude `/sessions/[id]/count`, the service-worker file, and PWA/static assets, so the middleware produces no redirect that would be cached in place of the real shell.

### Consequences & guardrails

- If the auth token/cookie has expired by the time the device is back online, `bootstrap` was already consumed; only `sync` is affected. On a 401 at sync, the client keeps local data (`dirty = true`) and prompts re-login, then retries. **No counted data is lost on an expired session.**
- **E2E test (mandatory):** with the network emulated offline in Playwright, navigating directly to `/sessions/[id]/count` for a previously-bootstrapped session MUST load the counting UI (asserting no redirect to `/login`). This test is the regression guard for this decision.
- Do not read `auth()` in the server component of the counting route in a way that forces dynamic server rendering; keep the route statically shippable so Serwist can precache it.

---

## R2 — ARTIS integration contract (RÉSOLU)

**Source**: `https://artis-swissqprint.artis.fr/ArtisWebSwissQprint/services/api-docs/v2/`, exploré en lecture seule stricte avec des identifiants réels (aucune écriture, voir garde-fous des missions d'exploration).

Toutes les questions ouvertes ci-dessous ont été résolues par exploration authentifiée directe de l'API réelle (et non plus depuis la seule documentation OpenAPI) :

- **Auth scheme** : `POST /user/auth` en corps `application/x-www-form-urlencoded` (`userName`/`password`) — un corps `application/json` est rejeté avec `415`. Le token est renvoyé et transite ensuite en **query string** (`?token=...`) sur chaque appel. Durée de vie ~2h, **aucun refresh** : au-delà, il faut se ré-authentifier. Identifiants stockés côté serveur via env uniquement (FR-015).
- **Depot listing endpoint** : **aucun endpoint de listing des dépôts n'existe** dans l'API réelle — il n'y a pas d'équivalent à `listDepots()`. Les codes dépôts réels ont dû être reconstitués manuellement en examinant les champs `CodeLib` de commandes/livraisons existantes, puis confirmés par recoupement sur plusieurs articles témoins. La table `Depot` est en conséquence **alimentée à la main** (`prisma/seed.ts`) avec les codes confirmés (`0101`, `0120`, `0130`, `01TR`, `01V1`, `01V3`–`01V10`) et n'a pas vocation à être synchronisée automatiquement depuis ARTIS.
- **Theoretical stock endpoint** : deux endpoints exposent du stock, ni l'un ni l'autre adapté à un import complet et paginé par dépôt :
  - `GET /articles/{codeArticleVendu}/calculStock/{codeDepot}` — unitaire (un article à la fois), et son `404` est **ambigu** (dépôt invalide vs. simplement aucune ligne de stock pour cet article dans ce dépôt — impossible à distinguer depuis la réponse).
  - `GET /articles/recherche?codeDepot=...` — retourne un lot d'articles pour un dépôt, mais **plafonné à `maxResults` ≈ 100 résultats, sans paramètre d'offset** : au-delà de ce plafond, il n'existe aucun moyen de récupérer la suite. Un dépôt réel dépasse largement ce volume (l'export de référence compte 98 lignes à lui seul pour un seul véhicule ; un dépôt central en contiendrait bien davantage).
  - Seul `GET /articles/consultation` offre une vraie pagination par offset, mais il ne renvoie pas le stock par dépôt.
  - **Conclusion** : c'est précisément ce plafond de 100 résultats sans offset, combiné à l'absence de tout signal de fin de pagination exploitable, qui a motivé le choix de l'**import par fichier Excel comme voie principale** (`ArtisFileAdapter`, FR-029/033/034) plutôt qu'un appel direct à l'API — un fichier exporté depuis ARTIS ne souffre d'aucune limite de ce type. `ArtisHttpAdapter` reste de ce fait une option **délibérément différée**, non un travail bloqué par un manque d'information : le contrat est connu, il est simplement inadapté en l'état à un import exhaustif automatisé.
- **Rate limits / timeouts** : aucune limite de débit documentée ou observée distincte du plafond `maxResults` ci-dessus ; le timeout de préparation (10s) reste une contrainte côté application, pas une exigence d'ARTIS.
- **Field mapping** : confirmé sur articles témoins réels — `articleRef` (encodé dans les QR codes imprimés) ← colonne **`Code`** (toujours unique et non vide ; jamais `Référence`, la référence constructeur, parfois vide) ; `designation` ← **`Libellé`** ; `theoreticalQty` ← **`Stock physique`**, jamais `Qté théorique` (qui est nette de `Résa stock` et produirait un faux écart sur tout article réservé mais physiquement présent).

**Deliverable de R2** : l'interface `ArtisAdapter` (`lib/artis/interface.ts`) et les schémas Zod (`lib/artis/validation.ts`) sont figés et communs aux deux adaptateurs implémentés (`ArtisMockAdapter`, `ArtisFileAdapter`). Le contrat HTTP réel ci-dessus est documenté pour le jour où `ArtisHttpAdapter` serait effectivement construit, mais n'est plus un prérequis bloquant pour quoi que ce soit sur la voie principale actuelle.

## R3 — Mock ARTIS fixtures (design)

- `ArtisMockAdapter` returns deterministic fixtures selected by `ARTIS_MODE=mock` (default in dev/test).
- Fixtures cover: a normal depot (~a few hundred lines), an **empty** stock (to exercise FR-023 refusal), and a **large** depot (~10k lines) for performance/quota tests.
- Fixtures conform to the same Zod schemas as the real adapter, so validation logic is exercised identically in both modes.
- A deliberate "malformed response" fixture verifies that Zod rejection blocks session creation with an explicit error (FR-022).

## R4 — Serwist precache & update strategy

- Precache: app shell for `/sessions/[id]/count` and its client chunks, PWA manifest, icons.
- Runtime strategy: the theoretical snapshot is **not** an HTTP cache concern — it is fetched once via `bootstrap` and stored in IndexedDB (Dexie), not the Cache API.
- Updates: `skipWaiting` + `clients.claim` for immediate activation. A build/version identifier is returned by `/sync`; the client compares it to its own and warns the user if the offline shell is stale (prompt to refresh when online).
- Camera access (`getUserMedia`) and service workers both require HTTPS — the EU host must serve valid TLS.

## R5 — Offline store schema (Dexie) — to detail in data-model.md

- One record per session keyed by `sessionId`: `{ meta, theoreticalLines[], countLines: Record<articleRef, { countedQty, isOffReferential }>, dirty, lastLocalUpdate }`.
- Scan and manual edits mutate `countLines` locally and set `dirty = true`.
- Sync: when `navigator.onLine && dirty`, `POST /sync`; on success set `dirty = false`; purge the cache after confirmed closure (FR-018).
- `designation` for off-referential lines is null locally and rendered as "hors référentiel" at export (see plan.md Decision #8).

---

**Exit criteria for Phase 0**: R1, R2, R3, R4, R5 all decided (done above). R2's real-API contract is now fully confirmed (see above) — the file-import path (`ArtisFileAdapter`) was built as the primary implementation on the strength of those findings, and `ArtisHttpAdapter` is a **deliberate deferral**, not something still blocked on missing information.
