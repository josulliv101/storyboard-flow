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
  devIndicators: false,
  reactStrictMode: true,
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  eslint: {
    // NOT ignored. The graph code treats react-hooks rules as correctness
    // constraints, not style — `react-hooks/set-state-in-effect` is why several
    // components adjust state during render instead of in an effect, and
    // auth-gate carries a deliberate disable with a written justification. CI
    // runs `npm run lint`, but a local or alternate deploy path that calls
    // `next build` directly would have skipped all of it.
    ignoreDuringBuilds: false,
  },
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
  webpack: (config, { dev }) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
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
