import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // @serwist/next's webpack plugin has no Turbopack support (Next 16 defaults
  // both `next dev` and `next build` to Turbopack, which crashes the dev
  // server outright when this plugin is active). Disabling outside
  // production means the service worker only exists in a `next build
  // --webpack` artifact served by `next start` — see README/quickstart notes
  // for how the offline E2E test targets that build instead of `next dev`.
  disable: process.env.NODE_ENV !== "production",
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Self-contained server bundle (.next/standalone/server.js) for the
  // Docker runner stage — traces only the deps actually used at runtime.
  // Scoped to the Docker build only (DOCKER_BUILD set in the Dockerfile's
  // build stage): `output: "standalone"` makes `next start` print "does
  // not work with output: standalone, use node .next/standalone/server.js
  // instead" — confirmed by actually running it, tests still passed, but
  // it's a real warning on a real incompatibility, not cosmetic, and
  // `npm run start` (playwright.offline.config.ts's webServer) relies on
  // `next start` for local/e2e use. Keeping it off there avoids that
  // warning and any future breakage, since Docker is the only place this
  // needs to be a self-contained bundle in the first place. public/ and
  // .next/static still need to be copied in manually alongside it either
  // way — Next doesn't do that itself, standalone or not — see Dockerfile.
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,
  // Acknowledges the webpack config @serwist/next injects (see below) so
  // Turbopack doesn't hard-error on "webpack config with no turbopack
  // config" during `next dev`/`next build`. It stays empty because we don't
  // want Turbopack itself reconfigured — only the (disabled outside
  // production) Serwist webpack hook needs to coexist with it.
  turbopack: {},
};

export default withSerwist(nextConfig);
