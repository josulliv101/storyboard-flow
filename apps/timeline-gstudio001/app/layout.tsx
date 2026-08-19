import type {Metadata} from 'next';
import { Caprasimo } from 'next/font/google';
import { Suspense } from 'react';
import { AuthGate } from '@/components/auth/auth-gate';
import { AuthProvider } from '@/components/auth/auth-provider';
import { getAuthUser } from '@/lib/firebase-auth-session';
import { TimelineSidebar } from '@/components/timeline/timeline-sidebar';
import { Toaster } from '@/components/core/sonner';
import './globals.css'; // Global styles

/**
 * The wordmark's face, and the only custom font in the app — everything else
 * rides Tailwind's `font-sans`.
 *
 * Exposed as a VARIABLE rather than applied to the body: it is a display face
 * for one lockup, not a UI font. It carries a single weight (400), which is why
 * the logo drops `font-bold` — asking for 700 would only get a synthesised
 * bold, and Caprasimo is already heavy.
 */
const caprasimo = Caprasimo({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-caprasimo',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Storyboard Flow',
  description: 'Build, nest, and preview storyboard timelines.',
};

// Reading the session here makes this layout dynamic, which every route that
// matters already was (the graph layout reads cookies to build its bootstrap
// payloads). What it buys: AuthProvider starts with the answer instead of
// blocking the whole tree on a client fetch for it — see `initialUser`.
export default async function RootLayout({children}: {children: React.ReactNode}) {
  const user = await getAuthUser();
  // `dark` is what switches on every `dark:` utility — the variant is rebound
  // to this class in globals.css, precisely so the app stops following the
  // reader's OS theme.
  return (
    <html lang="en" className={`dark ${caprasimo.variable}`}>
      <body suppressHydrationWarning>
        {/* App-wide: the sidebar renders on every route, so anything it
            toasts needs a surface here rather than inside one view. */}
        <Toaster />
        <AuthProvider initialUser={user}>
          <AuthGate>
            <div className="relative flex min-h-screen overflow-x-clip bg-zinc-950 font-sans text-white">
              <Suspense fallback={null}>
                <TimelineSidebar />
              </Suspense>
              {/* Scroll anchoring is disabled page-wide (see globals.css):
                  the preview pane mounting at main's top must not scroll
                  the page out from under its own sticky logic. */}
              <main
                className="min-w-0 flex-1 px-8 pt-[13px]"
                style={{
                  paddingBottom: "var(--asset-library-height, 0px)",
                }}
              >
                {children}
              </main>
            </div>
          </AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}
