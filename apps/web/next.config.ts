import type {NextConfig} from 'next';
import v8 from 'v8';
import { PerformanceObserver } from 'perf_hooks';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  serverExternalPackages: ['@remotion/bundler', '@remotion/renderer'],
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
  transpilePackages: ['motion', '@storyboard/ui', '@storyboard/db', '@storyboard/timeline-model', '@storyboard/collections-core'],
  experimental: {
    webpackMemoryOptimizations: true,
  },
  webpack: (config, {dev}) => {
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

if (process.env.NODE_ENV === 'development') {
  const pid = process.pid;
  const argvStr = process.argv.slice(1, 4).join(' ');
  const processRole = argvStr.includes('jest')
    ? 'Jest'
    : argvStr.includes('next-dev') || argvStr.includes('next dev')
    ? 'Next Dev Server'
    : argvStr.includes('webpack')
    ? 'Webpack Compiler Worker'
    : 'Node Process';

  const toMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

  const logMemory = () => {
    const memory = process.memoryUsage();
    let spacesStr = '';
    try {
      const spaces = v8.getHeapSpaceStatistics();
      spacesStr = spaces
        .filter((s: any) => s.space_used_size > 0)
        .map((s: any) => `${s.space_name.replace('_space', '')}: ${(s.space_used_size / 1024 / 1024).toFixed(1)}MB`)
        .join(', ');
    } catch (e) {}

    console.log(
      `[Memory Monitor] PID: ${pid} (${processRole}) | RSS: ${toMB(memory.rss)} | Heap: ${toMB(memory.heapUsed)} / ${toMB(memory.heapTotal)} | External: ${toMB(
        memory.external
      )}${spacesStr ? ` | Spaces: [${spacesStr}]` : ''}`
    );
  };

  logMemory();
  const interval = setInterval(logMemory, 30000);
  interval.unref();

  try {
    const gcTypes: Record<number, string> = {
      1: 'Minor GC (Scavenge)',
      2: 'Major GC (Mark-Sweep)',
      4: 'Incremental Marking',
      8: 'Weak Processing',
      15: 'All'
    };

    const obs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const entry of entries) {
        const detail = (entry as any).detail;
        const kind = detail ? detail.kind : 15;
        const kindStr = gcTypes[kind] || `GC Kind ${kind}`;
        console.log(
          `[GC Monitor] PID: ${pid} (${processRole}) | ${kindStr} | Duration: ${entry.duration.toFixed(1)}ms`
        );
      }
    });
    obs.observe({ entryTypes: ['gc'] });
  } catch (e) {
    console.error('[GC Monitor] Failed to initialize PerformanceObserver:', e);
  }
}
