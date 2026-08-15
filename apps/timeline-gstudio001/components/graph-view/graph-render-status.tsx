"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { nextPollDelayMs, renderToShow } from "@/lib/render/render-poll";
import type { RenderProgress } from "@/lib/render/types";

// The render indicator, beside the save status it is modelled on.
//
// A render is started from somewhere ELSE — the `render_timeline` MCP tool, an
// agent — and takes minutes. Without this the board said nothing at all while
// one ran, and the only sign it had finished was a card appearing in Renders,
// which is a poor way to learn that a thing you asked for worked.
//
// SAME SHAPE AS `GraphSaveStatus`: text only, trailing the breadcrumb, absent
// when there is nothing to say. A render is rarer than a save but longer, so
// the one thing it adds is a NUMBER — a percentage is the difference between
// "still going" and "stuck", and that is the question anyone watching actually
// has.

/** One row of `GET /api/renders?timelineId=`. `updatedAt` is what the "ready"
 *  flash times against — when the render SETTLED, not when it was asked for. */
type RenderRow = RenderProgress &
  Readonly<{ id: string; createdAt: string; updatedAt: string }>;

/** How long "Render ready" stays up before the chip goes quiet. Longer than
 *  the save flash: a render is a rarer, bigger event, and the file it made is
 *  something you may want to go and open. */
const READY_FLASH_MS = 20_000;

const STATUS_CLASS = "shrink-0 whitespace-nowrap font-mono text-xs";

/**
 * Poll this timeline's renders, at a rate that follows what is happening — and
 * not at all while the tab is hidden. The rule is in `lib/render/render-poll`,
 * where it is unit-tested; this owns the fetching and the timer.
 */
function useTimelineRenders(timelineId: string | null): RenderRow[] {
  const [renders, setRenders] = useState<RenderRow[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Fetch, and RETURN what was fetched.
   *
   * Returning the rows is what lets the scheduler below rate itself off them.
   * The first version kept the latest rows in a ref and read that instead,
   * which was wrong in a way only the browser showed: the continuation runs in
   * the microtask after this resolves — BEFORE React has re-rendered and
   * refreshed the ref — so the poll that discovered a running render still saw
   * the previous, empty list and scheduled the 30s idle delay. The chip then
   * sat a full idle cycle behind the render it had just found.
   */
  const poll = useCallback(async (): Promise<RenderRow[]> => {
    if (timelineId === null) return [];
    try {
      const response = await fetch(
        `/api/renders?timelineId=${encodeURIComponent(timelineId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return [];
      const body = (await response.json()) as { renders?: RenderRow[] };
      const rows = body.renders ?? [];
      setRenders(rows);
      return rows;
    } catch {
      // A failed poll is ordinary — a deploy, a network blip. The next one
      // covers it, and a chip that shouted about its own polling would be
      // worse than one that is briefly stale. Reported as "nothing running",
      // which backs the rate off rather than hammering a server that is down.
      return [];
    }
  }, [timelineId]);

  useEffect(() => {
    if (timelineId === null) return;
    let cancelled = false;

    const scheduleFrom = (rows: readonly RenderRow[]) => {
      if (cancelled) return;
      const delay = nextPollDelayMs({
        states: rows.map((render) => render.state),
        visible: document.visibilityState === "visible",
      });
      // Null means the tab is hidden: schedule NOTHING, and wait for the
      // visibility change below to start it again.
      if (delay === null) return;
      timerRef.current = setTimeout(() => {
        void poll().then(scheduleFrom);
      }, delay);
    };

    const restart = () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      // Coming back to the tab: read once immediately, because whatever was
      // happening has moved on while nobody was polling.
      if (document.visibilityState === "visible") void poll().then(scheduleFrom);
    };

    // Kicked off on a zero timer rather than called straight from the effect
    // body. `poll` sets state, and the cascading-render lint cannot see that
    // the fetch in between makes that asynchronous — the repo's usual answer.
    // Zero is immediate in practice, and it means the first read takes exactly
    // the same path every later one does.
    timerRef.current = setTimeout(() => {
      void poll().then(scheduleFrom);
    }, 0);
    document.addEventListener("visibilitychange", restart);
    return () => {
      cancelled = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", restart);
    };
  }, [timelineId, poll]);

  return renders;
}

export function GraphRenderStatus({ timelineId }: Readonly<{ timelineId: string | null }>) {
  const renders = useTimelineRenders(timelineId);
  const showing = renderToShow(
    renders.map((render) => ({ ...render, progress: { state: render.state } })),
  );

  // "Ready" is time-based, so it needs a tick of its own — the same problem
  // the save status has, and the same answer.
  const [now, setNow] = useState(() => Date.now());
  const settledAt = showing?.updatedAt;
  useEffect(() => {
    if (showing === null || showing.state !== "succeeded") return;
    const timer = setTimeout(() => setNow(Date.now()), READY_FLASH_MS);
    return () => clearTimeout(timer);
  }, [showing, settledAt]);

  if (showing === null) return null;

  if (showing.state === "failed") {
    // Failures do NOT time out. A render that failed is work you asked for and
    // did not get, and it leaves nothing behind to notice later — unlike a
    // success, which leaves a card in Renders.
    return (
      <span
        data-render-status="failed"
        title={showing.message ?? "The render failed."}
        className={cn(STATUS_CLASS, "text-amber-300")}
      >
        Render failed
      </span>
    );
  }

  if (showing.state === "succeeded") {
    const fresh =
      showing.updatedAt === undefined ||
      now - new Date(showing.updatedAt).getTime() < READY_FLASH_MS;
    if (!fresh) return null;
    return (
      <a
        data-render-status="succeeded"
        href={showing.outputUrl}
        target="_blank"
        rel="noreferrer"
        title="Open the finished render. It is also filed in Renders."
        className={cn(STATUS_CLASS, "text-sky-300 underline decoration-dotted underline-offset-2")}
      >
        Render ready
      </a>
    );
  }

  if (showing.state === "queued") {
    return (
      <span
        data-render-status="queued"
        // Says WHY nothing is happening. A queued render with no worker
        // running sits here indefinitely, and "queued" alone reads as broken.
        title="Waiting for a render worker to pick it up."
        className={cn(STATUS_CLASS, "text-zinc-500")}
      >
        Render queued
      </span>
    );
  }

  // Claimed or rendering. The PERCENTAGE is the point — it separates "still
  // going" from "stuck", which is the question anyone watching has.
  const percent = showing.fraction === undefined ? null : Math.round(showing.fraction * 100);
  return (
    <span
      data-render-status="rendering"
      data-render-fraction={showing.fraction ?? undefined}
      title={showing.message ?? "Assembling the render"}
      className={cn(STATUS_CLASS, "text-zinc-400")}
    >
      {percent === null ? "Rendering…" : `Rendering ${percent}%`}
    </span>
  );
}
