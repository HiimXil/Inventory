# syntax=docker/dockerfile:1

# ---- deps: full install (incl. devDependencies), used only to build -------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
# argon2 (native module) needs a toolchain to compile if no prebuilt binary
# matches this exact platform/libc.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: BUILD:PWA (webpack + Serwist service worker), not `next build` #
FROM deps AS build
WORKDIR /app
COPY . .
RUN npx prisma generate
# Non-negotiable: build:pwa (`next build --webpack`) is the only build that
# emits public/sw.js — a plain `next build` (Turbopack) produces no service
# worker at all, silently breaking the offline counting screen. See
# next.config.ts and RUNBOOK.md §3.
# DOCKER_BUILD=1 is what turns on `output: standalone` in next.config.ts —
# scoped to this build only, so local `npm run build:pwa`/`next start`
# (playwright.offline.config.ts) are unaffected.
ENV NODE_ENV=production
ENV DOCKER_BUILD=1
RUN npm run build:pwa

# ---- prod-deps: runtime-only deps (prisma CLI + tsx are "dependencies") ---
FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
# Same toolchain as `deps` (argon2 native module) — this stage only ever
# contributes its node_modules to the final image (see the `runner` COPY
# --from=prod-deps below), never the apt packages themselves, so this
# doesn't bloat the shipped image.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npx prisma generate

# ---- runner: minimal image, non-root, standalone Next server + CLI tools --
FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Prisma's query/schema engine binaries need libssl at runtime — confirmed
# by actually running this image: without it, `prisma migrate deploy` fails
# ("Prisma failed to detect the libssl/openssl version"), it's not merely a
# warning. node:20-bookworm-slim doesn't include it by default.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# Full prod node_modules (prisma CLI, @prisma/client, tsx, argon2, ...) —
# deliberately NOT the trimmed node_modules bundled inside
# .next/standalone/ (that trace only covers what the Next.js server itself
# imports; it omits the prisma/tsx CLIs the entrypoint needs for migrate
# deploy / seed). Same package-lock.json as the build stage, so versions
# can't drift between the two. --chown matters: the container runs as a
# non-root user below, and Prisma needs to write into
# node_modules/@prisma/engines on first run (confirmed by actually running
# this image as non-root without it: "Can't write to
# /app/node_modules/@prisma/engines").
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# The standalone server bundle itself — public/ and .next/static are NOT
# included by `output: standalone` and must be copied in separately (this
# is standard Next.js behaviour, unrelated to Serwist): confirmed by
# actually building this image — public/sw.js only exists in the plain
# public/ output, never inside .next/standalone/.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone/server.js ./server.js
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone/.next ./.next
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Needed at runtime by the entrypoint, not by the Next server itself.
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nextjs:nodejs /app/scripts/seed-if-empty.ts ./scripts/seed-if-empty.ts
COPY --from=build --chown=nextjs:nodejs /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
