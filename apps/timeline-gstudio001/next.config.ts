import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * KEEP A VISITED BOARD IN THE CLIENT ROUTER CACHE FOR 30 SECONDS.
   *
   * Next 15 defaults `staleTimes.dynamic` to 0, so every navigation to a
   * project re-renders it on the server — including going back to one you just
   * left. Measured on the 143-document project: the render is 363ms warm and
   * ships ~475KB of RSC payload, all of it work the session already had, and
   * "it should be snappy the second time" is exactly the complaint that led
   * here.
   *
   * SAFE BECAUSE THE PRIME IS GUARDED, not because the payload is fresh. A
   * cached payload is by definition older than the server, and re-priming from
   * it is what would be dangerous — but `installPrime` already refuses a
   * payload for the wrong user, refuses one that regresses the revision ledger,
   * and refuses to overwrite a document with unsaved local edits. A stale
   * bootstrap is therefore ignored rather than believed.
   *
   * THE COST IS ELSEWHERE: a list page revisited inside the window can show
   * what it showed 30 seconds ago — a project created in another tab may not
   * appear until the window lapses or something calls `router.refresh()`.
   * Thirty seconds is chosen to be shorter than it takes to notice.
   */
  experimental: {
    staleTimes: { dynamic: 30 },
  },
  /**
   * NO GENERATED AGENT FILES. Next 16 writes `AGENTS.md` and `CLAUDE.md` into
   * this directory on every `next dev`, and the repo already has an instruction
   * hierarchy that takes precedence CLOSEST to the files being edited — so a
   * generated app-level file silently outranks the root `CLAUDE.md` and
   * `AGENTS.md` for everything in this app. Its content is Next's boilerplate,
   * not this team's, and its own text asks to be committed.
   *
   * The useful part of it — that Next 16 differs from an agent's training data
   * and ships its docs in `node_modules/next/dist/docs/` — belongs in the
   * repo's own instructions if it is wanted, written by us.
   */
  agentRules: false,
  devIndicators: false,
  reactStrictMode: true,
  // `NEXT_DIST_DIR` overrides it so a SECOND dev server can run beside the
  // usual one — two of them sharing a build directory corrupt each other, which
  // is why the dev/prod split exists at all. Needed to compare bundlers on the
  // same checkout without stopping the server you are working in.
  distDir:
    process.env.NEXT_DIST_DIR ??
    (process.env.NODE_ENV === 'development' ? '.next-dev' : '.next'),
  // THE `eslint` KEY IS GONE, removed from NextConfig in Next 16 along with the
  // built-in ESLint integration. It carried `ignoreDuringBuilds: false` for a
  // reason that has NOT gone away: the graph code treats react-hooks rules as
  // correctness constraints, not style — `react-hooks/set-state-in-effect` is
  // why several components adjust state during render instead of in an effect,
  // and auth-gate carries a deliberate disable with a written justification.
  //
  // Next 16 simply does not lint during a build, so deleting the key would
  // quietly retire that protection rather than move it. The `build` script runs
  // `npm run lint` first instead, which keeps the property the key was there
  // for: a local or alternate deploy path calling the build cannot skip it.
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  output: 'standalone',
  // firebase-admin must NOT be bundled into the serverless function. Its
  // transitive `jwks-rsa` does a CommonJS `require("jose")`, and when the
  // bundler resolves jose it picks the ESM build — Node then refuses the
  // require with ERR_REQUIRE_ESM and the whole function 500s at module load
  // (every route that touches auth/Firestore, not just login). Marking it
  // external defers resolution to Node at runtime, which picks jose's CJS
  // export condition and loads fine. Only shows up in a bundled deploy —
  // `next dev` doesn't bundle node_modules, so it passes locally.
  serverExternalPackages: ['firebase-admin'],
  transpilePackages: ['motion', '@storyboard/ui', '@storyboard/timeline-domain', '@storyboard/timeline-model', '@storyboard/collections-core', '@storyboard/timeline-widget'],
  /**
   * EXPLICITLY WEBPACK, via `--webpack` on both `dev` and `build`.
   *
   * Next 16 makes Turbopack the default and REFUSES to build when a `webpack`
   * config is present without a `turbopack` one — the upgrade failed on exactly
   * that. Passing the flag keeps the bundler constant so this upgrade changes
   * one thing (the framework) rather than two.
   *
   * The config below is why it matters. It is dev-only, and it stops the
   * watcher treating the app's own writes as source changes: without it, one
   * offline save produced a recompile, a full page reload and a closure walk —
   * ~16 reads of pure feedback for an edit that changed nothing in source.
   * Turbopack has no watchOptions equivalent, so switching the DEV bundler
   * would bring that back. The build never runs this (`if (dev)`), so moving
   * only the build to Turbopack is a separate, safe decision to make later.
   */
  webpack: (config, { dev }) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
      return config;
    }
    if (dev) {
      // DATA THE APP WRITES IS NOT SOURCE, and watching it costs reads.
      //
      // Offline mode persists every save to its fixture JSON, and offline media
      // uploads land under public/. Both live inside the app, so the watcher
      // treated each one as a source change: adding a collection produced
      // `POST /api/timelines/batch` -> `✓ Compiled` -> a full page reload -> the
      // board re-rendering, which walks the whole closure. One edit, ~16 reads
      // of pure feedback, none of it anything to do with the edit.
      //
      // Ignoring them loses nothing. The fixture store does NOT rely on webpack
      // to notice a changed fixture — it stats the file on every read and
      // rebuilds on a new mtime, which is how regenerating scale-probe.json is
      // picked up without a restart. Uploaded media is served statically by
      // path and never imported, so a recompile could not affect it either.
      config.watchOptions = {
        ...(config.watchOptions ?? {}),
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/fixtures/*.json',
          '**/public/offline-media/**',
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
