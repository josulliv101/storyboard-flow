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

// The trim panel (PL10-004): ONE floating surface above a selected video —
// the frame at the edge you are working on, over a fitted map of the whole
// source with the showing window and its grips.
//
// It replaces two surfaces that had to agree with each other. The frame panel
// (R5 #3) anchored to the CARD's edge; the source overview (R7 #2) drew the
// whole source at TIMELINE scale, which made its amber window exactly the
// card's width and put its grips over the card's edges. The frame panel
// looked like it pointed at a grip, but only because both were drawn in the
// same scale — nothing linked them. And timeline scale meant the overview's
// width grew with source duration: an 80s source at 50px/s is 4042px, three
// screens wide, so the one thing it exists to show could not be seen. Fitting
// it breaks the coincidence, so the two are composed here instead: the grip
// and the frame live in one box and cannot drift apart at any scale.
//
// The trade is deliberate and named on TrimOverviewStrip's `width` prop: a
// fitted map is coarser per pixel (80s across ~304px is ~0.26s/px against the
// timeline's ~0.02), so the panel is the COARSE instrument — where am I in
// the source, put the window there — and the card's own trim handles stay the
// fine one. Both drive the same `update-media` command through the same
// gesture.
//
// Video-only by design: an image has no source to map and no frame that
// changes under trim (only its duration, which the pill already tracks).

const PANEL_WIDTH = 320;
const PANEL_MARGIN = 8;
/** Panel border + the map's own padding — what the map can't have. */
const MAP_INSET = 16;
/** The frame zone's height (16:9), which the active-edge bar spans. */
const FRAME_HEIGHT = (PANEL_WIDTH * 9) / 16;

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
 * and it only runs while the panel is mounted.
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

function FloatingTrimPanel({
  node,
  live,
  anchor,
}: Readonly<{ node: MediaNode; live: LiveTrim | null; anchor: HTMLElement }>) {
  // At rest the frame shows the clip's IN point — "this is where you start" —
  // and during a drag it follows the edge being moved. Quantized to ~25fps so
  // a slow pixel-level drag doesn't issue a seek per pointer event.
  // Narrowed inline because the video guard below runs after the hooks (a
  // non-video never renders, but its props still have to typecheck here).
  const rawTime = live
    ? edgeSourceTime(node, live)
    : node.mediaKind === "video"
      ? node.trimInSeconds
      : 0;
  const time = Math.round(rawTime * 25) / 25;
  const videoRef = useSeekedVideo(time);

  // Centred over the card and written straight to the panel's style (no state
  // round-trip): re-measured on every live change, so it follows the card's
  // live resize, and clamped into the viewport — which is the whole point of
  // a bounded panel. It mounts offscreen and the layout effect places it
  // before paint.
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
    // Above the card by preference, BELOW it when there isn't room — the strip
    // is the first row on this page, so for the focused surface there usually
    // isn't. Flipping keeps the panel off the clip it describes; clamping
    // alone would park it on top of the strip.
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

  // Which panel edge mirrors the handle being dragged: the front/in handle
  // ("left", and "move", which slides the in-point) marks the LEFT edge, the
  // back/out handle the RIGHT — never both, and neither at rest. Cosmetic:
  // the bar echoes the amber trim-handle pixels so the frame reads as "this
  // edge, up close".
  const activeEdge = live === null ? null : live.side === "right" ? "right" : "left";

  return createPortal(
    <div
      ref={panelRef}
      data-trim-panel={node.id}
      data-trim-panel-mode={live === null ? "resting" : "trimming"}
      // A React portal bubbles through the REACT tree, not the DOM one, and
      // this panel is rendered inside the card's content — so every press and
      // click inside it arrived at the card's own handlers, which toggled the
      // selection off and unmounted the panel mid-gesture. (The frame-only
      // preview this replaces never hit it: pointer-events-none, so nothing
      // to bubble.) Stopping here is after the panel's own children have had
      // the event — the map's grips and slide gesture still work.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className="fixed z-[60] overflow-hidden rounded-md border border-zinc-700 bg-zinc-950 shadow-xl shadow-black/50"
      style={{ left: -9999, top: -9999, width: PANEL_WIDTH }}
    >
      <video
        ref={videoRef}
        src={node.src}
        poster={node.posterSrcs?.[0]}
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        className="pointer-events-none aspect-video w-full bg-black object-contain"
      />
      <div className="pointer-events-none flex items-center justify-between bg-zinc-950/95 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-amber-200">
        <span>{live === null ? "in" : live.side === "right" ? "out" : "in"}</span>
        <span>{time.toFixed(2)}s</span>
      </div>

      {/* The source map. Interactive: its grips trim and its body slides the
          source window — the reason the panel as a whole is NOT
          pointer-events-none the way the old frame-only preview was. */}
      <div className="px-2 pt-1.5 pb-2">
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
      </div>

      {activeEdge !== null && (
        <span
          data-trim-panel-edge={activeEdge}
          aria-hidden="true"
          className={[
            "pointer-events-none absolute top-0 flex w-2 items-center justify-center bg-amber-400 opacity-95",
            // The frame zone only — the map below has its own grips, and a bar
            // running the panel's full height would read as a third one.
            activeEdge === "right" ? "right-0" : "left-0",
          ].join(" ")}
          style={{ height: FRAME_HEIGHT }}
        >
          <span className="h-4 w-0.5 rounded bg-black/60" />
        </span>
      )}
    </div>,
    document.body,
  );
}

/**
 * Mount inside a video card's content. Renders nothing unless the panel is
 * pinned for THIS (selected) card or a trim gesture on this node is live — so
 * the instrument shows up on trim intent rather than on selection, which is
 * the cheap action people do all day.
 *
 * The wrapper span is the position anchor — it spans the card (absolute
 * inset-0), so measuring it measures the card. Tracked as STATE (callback
 * ref), not a ref read in render: the panel must render on the same pass the
 * anchor appears, and render-time ref reads are illegal.
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
  const visible = live !== null || (pinned && selected);
  return (
    <span ref={setAnchor} aria-hidden="true" className="pointer-events-none absolute inset-0">
      {visible && anchor !== null ? (
        <FloatingTrimPanel node={node} live={live} anchor={anchor} />
      ) : null}
    </span>
  );
}
