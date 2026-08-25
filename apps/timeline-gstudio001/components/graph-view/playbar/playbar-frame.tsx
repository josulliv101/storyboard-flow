"use client";

import type { ReactNode } from "react";

/**
 * THE PAGE AROUND A PLAYBAR COMPONENT, or nothing at all (PL15-030).
 *
 * The reference design's stage and content area exist because it IS a page:
 * `.stage` carries 44px of top padding and `.area` the surface beneath it.
 * Embedded in the app they are a second page inside one — padding the view has
 * already applied, above a ground it has already painted. Measured, that frame
 * put 103px between the bar and the deck when the two are meant to read as one
 * instrument and its contents.
 *
 * A fragment is the honest answer there, which is what `standalone={false}`
 * gets. Shared by both components so "does this bring its own page?" has one
 * answer rather than two that can drift.
 */
export function PlaybarFrame({
  standalone,
  children,
}: Readonly<{ standalone: boolean; children: ReactNode }>) {
  if (!standalone) return <>{children}</>;
  return (
    <main className="stage">
      <section className="area">{children}</section>
    </main>
  );
}
