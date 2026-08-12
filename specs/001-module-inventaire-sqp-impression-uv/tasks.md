# Implementation Tasks: Module web d'inventaire de stock par dépôt

**Status**: Livré — MVP P1-P3 (US1-US6) et durcissement implémentés et testés (Vitest + Playwright), y compris la voie d'import par fichier (ArtisFileAdapter). `ArtisHttpAdapter` reste délibérément différé (voir plan.md Décision #9, research.md R2).
**Source**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md)

## Phase 0 — Foundations (blocks everything)

- [x] [P] Initialize the Next.js 15 App Router project with TypeScript strict, Tailwind CSS, Vitest, Playwright, and a root-level .env.example.
- [x] [P] Configure Prisma, PostgreSQL connection settings, and the initial Prisma client singleton for the app.
- [x] [P] Define the initial Prisma schema for User, Depot, InventorySession, InventoryLine, and AuditLog, then generate the first migration.
- [x] [P] Seed development fixtures for depots, the four roles, and mock ARTIS data.
- [x] [P] Set up Auth.js v5 with credentials, argon2 password hashing, and role injection into the session.
- [x] [P] Add the root middleware with a matcher that excludes /sessions/[id]/count and the PWA/service-worker assets (FR-026). Delivered as `proxy.ts` at the repo root (Next.js 16 renamed `middleware.ts` → `proxy.ts`; same root-level requirement, same matcher role).
- [x] [P][FR-015] Implement the shared server-side RBAC permission matrix and reusable guard helpers for server actions and route handlers (FR-027, FR-028). The same adapter-boundary architecture (`lib/artis/*`, never called from the browser) is also what satisfies FR-015.
- [x] [P] Define the Dexie offline schema for the theoretical snapshot, counting lines, dirty state, and last local update (FR-020, FR-018).
- [x] [P] Set up Serwist for the PWA shell, manifest, icons, and precache of the counting-route shell (FR-026).
- [x] [P] Define the ARTIS adapter interface, Zod validation schemas, mock adapter fixtures, and adapter factory keyed by ARTIS_MODE (FR-021, FR-029).

## Phase 1 — MVP P1: US1 prepare session

- [x] [US1][FR-001][FR-016][FR-021][FR-023][FR-024][FR-029][FR-028] Implement prepareSession server flow that aggregates all ARTIS pages, validates the full payload with Zod, refuses empty/incomplete data, refuses a second active session per depot (FR-016), and only persists a session after successful validation. Requires network end-to-end (server action) with no external ARTIS service dependency in file mode (FR-024).
- [x] [US1][FR-028][FR-020] Implement GET /api/sessions/[id]/bootstrap with authentication, RBAC, and the response payload needed to seed the offline snapshot.
- [x] [US1][FR-022][FR-029] Add Vitest tests for ARTIS import failure modes: network error, timeout, 5xx, malformed response, and incomplete pagination.
- [x] [US1][FR-021][FR-022] Add Playwright coverage for the prepare/import flow, including no partial session persistence on failure.
- [x] [FR-002] Session mono-appareil de facto : le snapshot théorique et la file de comptages résident dans l'IndexedDB d'un seul navigateur (Phase 2, `lib/offline/db.ts`), sans copie serveur équivalente — aucune vérification serveur d'identité d'appareil requise ni implémentée. La colonne `InventorySession.deviceId`, jamais lue ni écrite, a été retirée du schéma (migration `remove_unused_device_id`) après confirmation qu'aucun code ni test n'y faisait référence.

## Phase 2 — MVP P1: US2 count offline + US3 show gaps

- [x] [US2][FR-003][FR-005][FR-020] Implement the client-side counting island under /sessions/[id]/count as a dedicated offline-first route, including the live per-line and running-total counted-quantity display (FR-005).
- [x] [US2][FR-003] Implement the QR scanner hook with native BarcodeDetector and a @zxing/browser fallback.
- [x] [US2][FR-004][FR-019] Implement manual quantity entry and correction with integer validation (>= 0) and local audit tracing.
- [x] [US2][FR-014][FR-003] Implement off-referential lines (theoreticalQty = 0, isOffReferential = true, designation nullable) and mark them distinctly in the UI.
- [x] [US2][FR-026] Add a Playwright E2E regression test for a previously bootstrapped session: with the network disabled, /sessions/[id]/count loads without redirection, and no server-side auth render/redirect guard is present on this route.
- [x] [US2][FR-026] Add a guard comment in the counting-route code explicitly forbidding the introduction of an auth render/redirect guard on this offline island.
- [x] [US3][FR-006] Implement discrepancy calculation (counted − theoretical) and expose it in the session view.
- [x] [US3][FR-006] Highlight discrepancies in red and surface the conform vs gap state in the UI.
- [x] [US3][FR-006] Add Vitest coverage for discrepancy calculation and offline rendering logic.

## Phase 3 — MVP P2: US4 sync

- [x] [US4][FR-007][FR-008][FR-030][FR-028] Implement POST /api/sessions/[id]/sync with authentication, RBAC, idempotency, last-write-wins using clientUpdatedAt vs syncedAt, and server-side audit logging.
- [x] [US4][FR-030] Implement the client-side sync trigger that detects connectivity, retries on failure, and preserves dirty state on 401 before reauth/retry.
- [x] [US4][FR-030] Add Vitest coverage for LWW reconciliation, idempotent replay, and 401 handling without data loss.
- [x] [US4][FR-030] Add E2E coverage for sync recovery after network return.

## Phase 4 — MVP P2/P3: US5 close/export and US6 admin/audit

- [x] [US5][FR-009][FR-031] Implement closureSession so it rejects any session that is not already SYNCED and transitions the session to CLOSED only after successful sync.
- [x] [US5][FR-009] Implement the Excel export generator with two sheets (Inventaire complet and Écarts), red highlighting for discrepancies, and the filename format inventaire_{depot}_{AAAAMMJJ-HHmm}.xlsx.
- [x] [US5][FR-031] Add a regression test that closureSession is rejected for non-SYNCED sessions and that export is not possible until the session is SYNCED/CLOSED.
- [x] [US6][FR-010][FR-017] Build the admin dashboard and user CRUD flow for administrators.
- [x] [US6][FR-011][FR-032] Implement the audit viewer and enforce append-only audit storage with no mutation or deletion of existing events.
- [x] [US6][FR-027] Implement the server-side guard for prepare/import: allow ADMIN and DEPOT_MANAGER, deny everyone else, on both the server action and the relevant route handler(s).
- [x] [US6][FR-027] Implement the server-side guard for counting: allow ADMIN, DEPOT_MANAGER, and LOGISTICS, deny everyone else, on both the server action and the relevant route handler(s).
- [x] [US6][FR-027] Implement the server-side guard for sync: allow ADMIN, DEPOT_MANAGER, and LOGISTICS, deny everyone else, on both the server action and the relevant route handler(s).
- [x] [US6][FR-027] Implement the server-side guard for close: allow ADMIN and DEPOT_MANAGER, deny everyone else, on both the server action and the relevant route handler(s).
- [x] [US6][FR-027] Implement the server-side guard for export/download: allow ADMIN, DEPOT_MANAGER, and DIRECTION, deny everyone else, on both the server action and the relevant route handler(s).
- [x] [US6][FR-027] Implement the server-side guard for cancelling a session: allow ADMIN only, deny everyone else, on both the server action and the relevant route handler(s).
- [x] [US6][FR-027] Implement the server-side guard for user management: allow ADMIN only, deny everyone else, on both the server action and the relevant route handler(s).
- [x] [US6][FR-027] Implement the server-side guard for reading the audit log: allow ADMIN only, deny everyone else, on both the server action and the relevant route handler(s).
- [x] [US6][FR-016][FR-027] Implement the server-side guard for reading results: allow ADMIN, DEPOT_MANAGER, and DIRECTION globally; allow LOGISTICS only for their own session, on both the server action and the relevant route handler(s).
- [x] [US6][FR-027][FR-032] Add regression tests proving that DIRECTION read-only users cannot perform any mutation (prepare, count, sync, close, cancel) and that every denied mutation is logged.
- [x] [US6][FR-010][FR-017][FR-027] Add RBAC matrix tests covering the full action × role matrix from the specification. Delivered as per-action test suites (`prepare-session.test.ts`, `bootstrap-rbac.test.ts`, `sync-session.test.ts`, `close-session.test.ts`, `export-session.test.ts`, `cancel-session.test.ts`, `admin-users.test.ts`, `admin-audit.test.ts`, `view-session.test.ts`) each exercising all four roles for their action, rather than one consolidated matrix file.

## Phase 5 — Hardening and deployment readiness

- [x] [FR-025] Implement the 24-month RGPD purge job for CLOSED/CANCELLED sessions and audit logs.
- [x] [FR-026] Implement the Serwist update strategy with skipWaiting + clients.claim and a version check surfaced by /sync.
- [x] [FR-012] Write quickstart.md with local setup instructions and a deployment checklist for EU hosting, TLS, and operational verification.
- [ ] [FR-029][Optionnel — non retenu pour la voie principale] ArtisHttpAdapter (real ARTIS API calls): kept as an optional, unimplemented mode behind ARTIS_MODE=http; not required by the current file-import primary path (see plan.md Decision #9) — revisit only if a future need for live API import is confirmed.
- [x] [US1][FR-024][FR-029][FR-033][FR-034] ArtisFileAdapter delivered as the primary import path: server-side .xlsx parsing via ExcelJS with column matching by header name, Zod validation (required columns, ≥1 row, unique non-empty codes, integer qty ≥ 0), theoreticalQty ← "Stock physique" (not "Qté théorique"), wired into prepareSession via ARTIS_MODE=file, explicit depot selection in the prepare UI (file carries no depot info), and Depot table seeded manually with real ARTIS codes. Full Vitest (adapter + prepare-session integration) and Playwright (dedicated file-import config) coverage.
