#!/bin/sh
set -eu

# Runs once per container start, before the Next.js server. Two DB
# connections are used on purpose and never mixed (see DEPLOY.md):
#   - MIGRATE_DATABASE_URL: privileged (postgres superuser) — schema
#     migrations, creating/password-ing the sqp_app role, initial seed.
#   - DATABASE_URL: the sqp_app role the *running app* connects as — cannot
#     UPDATE/DELETE AuditLog (FR-032), so it must never run the steps below
#     (seed.ts alone does a deleteMany() on AuditLog, which sqp_app cannot
#     execute at all, empty table or not — REVOKE blocks the statement
#     itself, not just matching rows).

for var in MIGRATE_DATABASE_URL SQP_APP_PASSWORD DATABASE_URL; do
  eval "value=\${$var:-}"
  if [ -z "$value" ]; then
    echo "[entrypoint] Missing required environment variable: $var" >&2
    exit 1
  fi
done

echo "[entrypoint] Applying Prisma migrations (privileged connection)..."
DATABASE_URL="$MIGRATE_DATABASE_URL" node_modules/.bin/prisma migrate deploy

echo "[entrypoint] Ensuring the sqp_app role has the configured password..."
# The role itself is created by the migration above (idempotent CREATE ROLE
# IF NOT EXISTS) with LOGIN but no password — see
# prisma/migrations/20260723095800_hardening_auditlog_immutable_role. This
# ALTER ROLE is safe to repeat on every boot: it only (re)sets the password
# to match SQP_APP_PASSWORD, it never touches grants. The password is
# escaped for a standard-conforming SQL string literal (single quotes
# doubled) rather than interpolated raw.
sql_escaped_password=$(node -e "process.stdout.write(process.env.SQP_APP_PASSWORD.replace(/'/g, \"''\"))")
printf "ALTER ROLE sqp_app WITH PASSWORD '%s';" "$sql_escaped_password" \
  | node_modules/.bin/prisma db execute --stdin --url="$MIGRATE_DATABASE_URL"

echo "[entrypoint] Seeding if the database is empty (no-op otherwise)..."
DATABASE_URL="$MIGRATE_DATABASE_URL" node_modules/.bin/tsx scripts/seed-if-empty.ts

echo "[entrypoint] Starting server..."
exec node server.js
