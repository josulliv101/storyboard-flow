import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  reactStrictMode: true,
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  eslint: {
    ignoreDuringBuilds: true,
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
  transpilePackages: ['motion', '@storyboard/ui', '@storyboard/timeline-domain', '@storyboard/timeline-model', '@storyboard/collections-core'],
  webpack: (config, { dev }) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
