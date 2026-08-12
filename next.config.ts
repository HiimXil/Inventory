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
  // Acknowledges the webpack config @serwist/next injects (see below) so
  // Turbopack doesn't hard-error on "webpack config with no turbopack
  // config" during `next dev`/`next build`. It stays empty because we don't
  // want Turbopack itself reconfigured — only the (disabled outside
  // production) Serwist webpack hook needs to coexist with it.
  turbopack: {},
};

export default withSerwist(nextConfig);
