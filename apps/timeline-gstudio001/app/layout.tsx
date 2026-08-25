import type {Metadata} from 'next';
import { Grandstander } from 'next/font/google';
import { Suspense } from 'react';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { AuthGate } from '@/components/auth/auth-gate';
import { AuthProvider } from '@/components/auth/auth-provider';
import { getAuthUser } from '@/lib/firebase-auth-session';
import { cookies } from 'next/headers';
import { TimelineSidebar } from '@/components/timeline/timeline-sidebar';
// From the framework-neutral module, NOT from `timeline-sidebar` — that one is
// a client component, and the server calling into it fails at request time
// while typechecking perfectly.
import {
  RAIL_WIDTH_VAR,
  railExpandedFromCookies,
} from '@/components/timeline/sidebar-rail-preference';
import {
  RAIL_OPEN_WIDTH_PX,
  RAIL_WIDTH_PX,
} from '@/components/timeline/sidebar-icon-styles';
import { Toaster } from '@/components/core/sonner';
import './globals.css'; // Global styles

/**
 * The wordmark's face, and the only custom font in the app — everything else
 * rides Tailwind's `font-sans`.
 *
 * Exposed as a VARIABLE rather than applied to the body: it is a display face
 * for one lockup, not a UI font.
 *
 * REAL WEIGHTS, unlike the Caprasimo this replaces. That face shipped a single
 * 400 and was already heavy, which is why the lockup deliberately carried no
 * weight class of its own — 600 there bought nothing but a synthesised bold
 * smeared over it. Grandstander is a variable family, so the weight is a
 * choice again, and 700 is the one that gives a 19px wordmark presence without
 * the letterforms closing up at that size.
 *
 * LOADING A WEIGHT IS NOT ASKING FOR IT. `next/font` emits one `@font-face` at
 * the weight named here; the ELEMENT still renders at whatever `font-weight`
 * cascades to it, which is 400 by default. With a single face available the
 * browser will use it either way, but it is then drawing a 700 face for a 400
 * request and free to synthesise — so the lockup carries `font-bold` to ask
 * for the weight that was loaded. Both numbers move together or neither does.
 */
const grandstander = Grandstander({
  weight: '700',
  subsets: ['latin'],
  variable: '--font-grandstander',
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
  // THE RAIL'S WIDTH, BEFORE ANYTHING PAINTS.
  //
  // The preference used to live only in `localStorage`, which the server
  // cannot read — so the rail rendered collapsed on every load and widened on
  // hydration, shoving `main` 188px sideways. That one shift was 0.135 of a
  // 0.16 CLS (#471). A cookie is the only copy of the preference that travels
  // with the REQUEST, which is what makes a correct first paint possible at
  // all; this layout was already dynamic for the session, so reading it costs
  // nothing extra.
  const railExpanded = railExpandedFromCookies((await cookies()).toString());
  // `dark` is what switches on every `dark:` utility — the variant is rebound
  // to this class in globals.css, precisely so the app stops following the
  // reader's OS theme.
  return (
    <html
      lang="en"
      className={`dark ${grandstander.variable}`}
      // PUBLISHED HERE so the surfaces BESIDE the rail are offset correctly in
      // the server's own markup. The sidebar keeps writing this on every
      // toggle — the server will not hear about one until the next request —
      // but it can no longer be the FIRST writer, because an effect runs after
      // paint and anything reading the variable would have spent that paint at
      // the wrong offset.
      style={{ [RAIL_WIDTH_VAR]: `${railExpanded ? RAIL_OPEN_WIDTH_PX : RAIL_WIDTH_PX}px` } as React.CSSProperties}
    >
      <body suppressHydrationWarning>
        {/* App-wide: the sidebar renders on every route, so anything it
            toasts needs a surface here rather than inside one view. */}
        <Toaster />
        <AuthProvider initialUser={user}>
          <AuthGate>
            <div className="relative flex min-h-screen overflow-x-clip bg-zinc-950 font-sans text-white">
              {/* THE FALLBACK RESERVES THE RAIL'S WIDTH, and that is the whole
                  point of it not being `null`.

                  The rail is server-rendered, but inside a Suspense boundary,
                  so the shell flushes with the boundary still pending and the
                  rail's markup arrives later in the same response. With a
                  `null` fallback it occupied NO width in that window, so
                  `main` — its `flex-1` sibling — laid out across the whole row
                  and was shoved 260px sideways when the boundary resolved.
                  Measured: `main` x:0 w:1385 -> x:260 w:1125, a single layout
                  shift of 0.1837, which was the entire CLS of this page.

                  It only shows when a paint lands between those two moments,
                  which is why it read as intermittent — and why making the
                  page paint SOONER (PL15-027) is what surfaced it.

                  `--sw-rail-width` is the right number to reserve because the
                  server already publishes it on `<html>` from the cookie, so
                  it is correct for both rail states before anything paints —
                  the same reason that variable exists at all (#471). */}
              <Suspense
                fallback={
                  <div
                    aria-hidden
                    className="shrink-0"
                    style={{ width: `var(${RAIL_WIDTH_VAR})` }}
                  />
                }
              >
                <TimelineSidebar initialRailExpanded={railExpanded} />
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
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
