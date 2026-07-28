"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  useLiveTrim,
  type LiveTrim,
  type MediaNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

// The live trim FRAME (PL10-005, placed by PL10-007): during a drag, a small
// still of the source at the edge you are moving, hovering directly above the
// clip and hugging the edge being dragged — in-edge drags align its LEFT to
// the clip's left, out-edge drags align its RIGHT to the clip's right.
//
// It is sized to the breadcrumb row's height and no taller. That row is the
// app's "one row of chrome" measure, so a frame that size reads as chrome
// instead of as a panel — but it is a SIZE reference only. The frame follows
// the clip, which in a nested strip is nowhere near the header.
//
// Its other half, the source MAP, is docked under the strip in
// `graph-trim-dock` — not floated here. A floating panel anchored to a card
// in a nested, scrolling board always ends up on top of something (PL10-006).
//
// Video-only by design: an image has no source to map and no frame that
// changes under trim (only its duration, which the pill already tracks).

const PANEL_MARGIN = 8;
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
    // The breadcrumb row sets the SIZE, not the place: it is the app's
    // established "one row of chrome" height, so a frame that tall reads as
    // chrome rather than as a panel. Measured off the header rather than
    // hardcoded because that row is sticky and its height travels with the
    // toolbar's contents.
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
    // Directly above the CLIP being trimmed, not parked in the header band —
    // the frame belongs to the card under the pointer, and in a nested strip
    // the header is nowhere near it. It may end up over the header when the
    // focused strip is the top row; that's incidental, not the anchor.
    const top = Math.max(PANEL_MARGIN, card.top - height - PANEL_MARGIN);
    frame.style.left = `${left}px`;
    frame.style.top = `${top}px`;
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
 * Mount inside a video card's content. Renders nothing at rest; during a trim
 * gesture on this node it floats the live edge frame. Trim INTENT is what
 * shows it — not selection, which is the cheap action people do all day.
 *
 * The wrapper span is the position anchor — it spans the card (absolute
 * inset-0), so measuring it measures the card. Tracked as STATE (callback
 * ref), not a ref read in render: the surfaces must render on the same pass
 * the anchor appears, and render-time ref reads are illegal.
 */
export function TrimPanel({ id, node }: Readonly<{ id: NodeId; node: MediaNode }>) {
  const live = useLiveTrim(id);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);

  if (node.mediaKind !== "video" || !node.src) return null;
  return (
    <span ref={setAnchor} aria-hidden="true" className="pointer-events-none absolute inset-0">
      {anchor !== null && live !== null ? (
        <LiveEdgeFrame node={node} live={live} anchor={anchor} />
      ) : null}
    </span>
  );
}
