-- FR-032: AuditLog append-only, enforced at the database level for whatever
-- role the deployed application actually connects as.
--
-- Approach: a dedicated, unprivileged "sqp_app" role gets SELECT/INSERT on
-- every table but explicitly NOT UPDATE/DELETE on "AuditLog". This (over a
-- BEFORE UPDATE/DELETE trigger with a bypass GUC) was chosen because:
--   - It requires zero changes to any existing test's cleanup code: local
--     dev, CI, and every Vitest file keep connecting as the current
--     superuser role (via DATABASE_URL) and keep using deleteMany/etc.
--     exactly as before — nothing here is "environment-conditional" at
--     runtime, so there is no bypass flag that could accidentally leak into
--     production and no per-connection state that Prisma's connection
--     pooling could reshuffle mid-test.
--   - It only actually bites once a deployment's DATABASE_URL is configured
--     to authenticate as sqp_app instead of the superuser — see the
--     deployment checklist in
--     specs/001-module-inventaire-sqp-impression-uv/quickstart.md.
--
-- The role is created with LOGIN but NO PASSWORD here: never commit a real
-- production credential into a migration file. Ops sets one out-of-band
-- with `ALTER ROLE sqp_app WITH PASSWORD '...'` before pointing production's
-- DATABASE_URL at it (documented in quickstart.md).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'sqp_app') THEN
    CREATE ROLE sqp_app WITH LOGIN;
  END IF;
END
$$;

-- GRANT CONNECT ON DATABASE takes an identifier, not an expression, so the
-- database name (which varies between environments) has to go through
-- dynamic SQL rather than a literal statement.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO sqp_app', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO sqp_app;

-- Full CRUD on every table the app needs to mutate...
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sqp_app;

-- ...except AuditLog can only ever be appended to, never changed or removed.
REVOKE UPDATE, DELETE ON "AuditLog" FROM sqp_app;
