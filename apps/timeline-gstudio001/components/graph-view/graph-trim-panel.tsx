"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  TrimOverviewStrip,
  useLiveTrim,
  type LiveTrim,
  type MediaNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { useTrimPanel } from "./graph-trim-panel-context";

// The trim surfaces (PL10-004, revised by PL10-005). TWO things, each doing
// one job, instead of the timeline-scale overview band and the frame panel
// that only coincidentally lined up with it:
//
// 1. The live FRAME, during a drag only: a small still of the source at the
//    edge you are moving, laid in the breadcrumb row's band above the strip
//    and hugging the edge being dragged — in-edge drags align its LEFT to the
//    clip's left, out-edge drags align its RIGHT to the clip's right. It is
//    the height of that row and no taller, so it borrows space that is
//    already chrome rather than taking a band of its own.
//
// 2. The source MAP, while pinned: the whole clip fitted into a bounded
//    panel, with the showing window and its grips. No frame in it — the frame
//    is (1), and a still inside the map panel was 65% of its area for a job
//    the map is doing.
//
// Video-only by design: an image has no source to map and no frame that
// changes under trim (only its duration, which the pill already tracks).

const PANEL_WIDTH = 320;
const PANEL_MARGIN = 8;
/** Panel border + the map's own padding — what the map can't have. */
const MAP_INSET = 16;
/** Fallback band height if the board header can't be measured. */
const FALLBACK_BAND_PX = 44;

/** The moving edge's time in SOURCE seconds — what the video should show. */
function edgeSourceTime(node: MediaNode, live: LiveTrim): number {
  const full =
    node.mediaKind === "video" ? node.fullDurationSeconds : live.trimInSeconds + live.effectiveSeconds + live.trimOutSeconds;
  // "left"/"move" both move the IN edge; "right" moves the OUT edge. The out
  // edge's source time is the full duration minus what's trimmed off the end.
  return live.side === "right"
    ? Math.max(0, full - live.trimOutSeconds)
    : Math.max(0, live.trimInSeconds);
}

/**
 * Keeps the preview element seeked to `time`, one in-flight seek at a time: a
 * per-frame settle loop issues a seek only while none is in flight and the
 * element isn't already on target, so a fast drag lands on the newest frame
 * without queueing dozens of decodes. A rAF loop rather than `seeked`
 * bookkeeping on purpose — it is self-healing (a missed event or a seek the
 * browser coalesced can't strand a stale frame; the next frame catches up),
 * and it only runs while the preview is mounted, i.e. during the gesture.
 * (`currentTime` reads back as the seek TARGET mid-seek, so the on-target
 * check doesn't re-issue while decoding either.)
 */
function useSeekedVideo(time: number) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const targetRef = useRef(time);

  useEffect(() => {
    targetRef.current = time;
  }, [time]);

  const attachVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (
        video &&
        video.readyState >= 1 &&
        !video.seeking &&
        Math.abs(video.currentTime - targetRef.current) > 0.03
      ) {
        try {
          video.currentTime = targetRef.current;
        } catch {
          // metadata raced away; next frame retries
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return attachVideo;
}

/**
 * The live frame, during a trim drag. Sized to the board header's band and
 * anchored to the moving edge — so it reads as "this edge, up close" without
 * a caption saying so, and without displacing anything: the band is the
 * breadcrumb row, which is already there.
 */
function LiveEdgeFrame({
  node,
  live,
  anchor,
}: Readonly<{ node: MediaNode; live: LiveTrim; anchor: HTMLElement }>) {
  // Quantized to ~25fps so a slow pixel-level drag doesn't issue a seek per
  // pointer event for sub-frame deltas.
  const time = Math.round(edgeSourceTime(node, live) * 25) / 25;
  const videoRef = useSeekedVideo(time);

  const frameRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const card = anchor.getBoundingClientRect();
    // The band is MEASURED off the header rather than hardcoded: it is a
    // sticky row whose offset moves with the preview pane, and a constant
    // would drift the moment either changes.
    const band = document
      .querySelector("[data-graph-board-header]")
      ?.getBoundingClientRect();
    const height = band?.height ?? FALLBACK_BAND_PX;
    const width = Math.round((height * 16) / 9);
    // The dragged edge decides which of the frame's edges is pinned to it:
    // the out-edge drag hangs the frame's RIGHT on the clip's right, the
    // in-edge drag its LEFT on the clip's left. Either way the frame grows
    // INWARD, over the clip, never off past the timeline's ends.
    const pinned = live.side === "right" ? card.right - width : card.left;
    const left = Math.min(
      Math.max(PANEL_MARGIN, pinned),
      window.innerWidth - width - PANEL_MARGIN,
    );
    frame.style.left = `${left}px`;
    frame.style.top = `${band?.top ?? PANEL_MARGIN}px`;
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
  }, [anchor, live]);

  if (node.mediaKind !== "video" || !node.src) return null;

  const activeEdge = live.side === "right" ? "right" : "left";

  return createPortal(
    <div
      ref={frameRef}
      data-trim-edge-frame={activeEdge}
      aria-hidden="true"
      className="pointer-events-none fixed z-[60] overflow-hidden rounded-sm border border-zinc-700 bg-zinc-950 shadow-lg shadow-black/50"
      style={{ left: -9999, top: -9999 }}
    >
      <video
        ref={videoRef}
        src={node.src}
        poster={node.posterSrcs?.[0]}
        muted
        playsInline
        preload="auto"
        className="h-full w-full bg-black object-cover"
      />
      {/* The trim-handle look — amber bar — on the pinned edge, so the frame
          reads as an extension of the handle under the pointer. */}
      <span
        className={[
          "absolute inset-y-0 w-1 bg-amber-400",
          activeEdge === "right" ? "right-0" : "left-0",
        ].join(" ")}
      />
      <span className="absolute right-0 bottom-0 bg-zinc-950/85 px-1 font-mono text-[9px] leading-tight tabular-nums text-amber-200">
        {time.toFixed(2)}s
      </span>
    </div>,
    document.body,
  );
}

/**
 * The pinned source map: the whole clip fitted into a bounded panel with the
 * showing window and its grips. Placed above the card when there is room and
 * below when there isn't, so it never sits on the clip it describes.
 */
function PinnedSourceMap({
  node,
  live,
  anchor,
}: Readonly<{ node: MediaNode; live: LiveTrim | null; anchor: HTMLElement }>) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(
      Math.max(PANEL_MARGIN, rect.left + rect.width / 2 - PANEL_WIDTH / 2),
      window.innerWidth - PANEL_WIDTH - PANEL_MARGIN,
    );
    // Measured, not assumed: the panel is already laid out offscreen, and a
    // constant would drift from the real height every time the contents
    // change by a few pixels — which is exactly what puts a "floating above"
    // panel over the thing it floats above.
    const height = panel.offsetHeight;
    const above = rect.top - height - PANEL_MARGIN;
    const below = rect.bottom + PANEL_MARGIN;
    const top =
      above >= PANEL_MARGIN
        ? above
        : Math.min(below, Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.dataset.trimPanelPlacement = above >= PANEL_MARGIN ? "above" : "below";
  }, [anchor, live]);

  if (node.mediaKind !== "video" || !node.src) return null;

  // Live values (mid-drag) win over the committed trim so the window tracks
  // the drag frame-for-frame — the same rule VirtualStrip used for the old
  // overview.
  const trimIn = live ? live.trimInSeconds : node.trimInSeconds;
  const trimOut = live ? live.trimOutSeconds : node.trimOutSeconds;

  return createPortal(
    <div
      ref={panelRef}
      data-trim-panel={node.id}
      data-trim-panel-mode={live === null ? "resting" : "trimming"}
      // A React portal bubbles through the REACT tree, not the DOM one, and
      // this panel is rendered inside the card's content — so every press and
      // click inside it arrived at the card's own handlers, which toggled the
      // selection off and unmounted the panel mid-gesture. Stopping here is
      // after the panel's own children have had the event, so the map's grips
      // and slide gesture still work.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className="fixed z-[55] overflow-hidden rounded-md border border-zinc-700 bg-zinc-950 px-2 pt-2 pb-1.5 shadow-xl shadow-black/50"
      style={{ left: -9999, top: -9999, width: PANEL_WIDTH }}
    >
      <TrimOverviewStrip
        node={node}
        width={PANEL_WIDTH - MAP_INSET}
        trimInSeconds={trimIn}
        trimOutSeconds={trimOut}
      />
      <div className="mt-1 flex items-center justify-between font-mono text-[9px] text-zinc-500">
        <span>whole source {node.fullDurationSeconds.toFixed(1)}s</span>
        <span>drag to move the window</span>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Mount inside a video card's content. Renders nothing at rest unless the map
 * is pinned for THIS (selected) card; during a trim gesture on this node it
 * also floats the live edge frame. Trim INTENT is what shows either — not
 * selection, which is the cheap action people do all day.
 *
 * The wrapper span is the position anchor — it spans the card (absolute
 * inset-0), so measuring it measures the card. Tracked as STATE (callback
 * ref), not a ref read in render: the surfaces must render on the same pass
 * the anchor appears, and render-time ref reads are illegal.
 */
export function TrimPanel({
  id,
  node,
  selected,
}: Readonly<{ id: NodeId; node: MediaNode; selected: boolean }>) {
  const live = useLiveTrim(id);
  const { pinned } = useTrimPanel();
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);

  if (node.mediaKind !== "video" || !node.src) return null;
  return (
    <span ref={setAnchor} aria-hidden="true" className="pointer-events-none absolute inset-0">
      {anchor !== null && live !== null ? (
        <LiveEdgeFrame node={node} live={live} anchor={anchor} />
      ) : null}
      {anchor !== null && pinned && selected ? (
        <PinnedSourceMap node={node} live={live} anchor={anchor} />
      ) : null}
    </span>
  );
}
