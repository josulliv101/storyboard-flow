import type { Metadata } from "next";
import { Grandstander } from "next/font/google";
import { Toaster } from "@/components/core/sonner";
import { RAIL_WIDTH_VAR, RAIL_WIDTH_PX } from "@/components/shell/rail-width";
import "./globals.css";

/**
 * The wordmark's face, and the only custom font here — everything else rides
 * Tailwind's `font-sans`.
 *
 * Exposed as a VARIABLE rather than applied to the body: it is a display face
 * for one lockup, not a UI font.
 *
 * LOADING A WEIGHT IS NOT ASKING FOR IT. `next/font` emits one `@font-face` at
 * the weight named here; the ELEMENT still renders at whatever `font-weight`
 * cascades to it, which is 400 by default. With a single face available the
 * browser will use it either way, but it is then drawing a 700 face for a 400
 * request and free to synthesise — so the lockup carries `font-bold` to ask for
 * the weight that was loaded. Both numbers move together or neither does.
 */
const grandstander = Grandstander({
  weight: "700",
  subsets: ["latin"],
  variable: "--font-grandstander",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Media Monster",
  description: "Nested collections, built on the graph engine.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  /**
   * `dark` is what switches on every `dark:` utility. The variant is rebound to
   * this class in globals.css precisely so the app stops following the reader's
   * OS theme — see the note there for what that cost the source app when a
   * light-mode machine rendered white-on-near-black buttons nobody else could
   * see.
   *
   * NOT A SERVER COMPONENT READING COOKIES, unlike the app this came from. That
   * one is `async` because it awaits a session and the rail's width preference,
   * and both of those are decisions this app has not made yet. It stays sync
   * until it has something to await — an `async` layout with nothing in it is a
   * dynamic render bought for nothing.
   */
  return (
    <html
      lang="en"
      className={`dark ${grandstander.variable}`}
      /**
       * THE RAIL'S WIDTH, PUBLISHED BEFORE ANYTHING PAINTS.
       *
       * A fixed value for now, because there is no rail and therefore no
       * preference to read. It is a variable rather than a literal so that the
       * surfaces beside the rail are already offset by the right mechanism when
       * the real one lands: in the source app this is written from a COOKIE, so
       * the server's own markup is correct on the first paint. The preference
       * used to live only in `localStorage`, which the server cannot read, so
       * the rail rendered collapsed and widened on hydration — shoving `main`
       * 188px sideways for 0.135 of a 0.16 CLS.
       *
       * Keeping the variable now means that fix is a change of VALUE later, not
       * a change of shape.
       */
      style={
        { [RAIL_WIDTH_VAR]: `${RAIL_WIDTH_PX}px` } as React.CSSProperties
      }
    >
      <body suppressHydrationWarning>
        {/* App-wide, because anything that toasts will live outside a single
            view — the same reason it sits here in the source app. */}
        <Toaster />
        <div className="relative flex min-h-screen overflow-x-clip bg-zinc-950 font-sans text-white">
          {/* THE PLACEHOLDER RESERVES THE RAIL'S WIDTH, and that is its whole
              job — it is not a stub waiting to be filled with markup.

              `main` is its `flex-1` sibling, so with nothing here at all `main`
              lays out across the whole row and will be shoved sideways the
              moment a rail appears beside it. In the source app that exact
              shift — `main` x:0 w:1385 -> x:260 w:1125 — measured 0.1837 and
              was the entire CLS of the page. Reserving the width now means the
              rail arrives into a slot rather than into the layout. */}
          <div
            aria-hidden
            className="shrink-0"
            style={{ width: `var(${RAIL_WIDTH_VAR})` }}
          />
          <main className="min-w-0 flex-1 px-8 pt-[13px]">{children}</main>
        </div>
      </body>
    </html>
  );
}
