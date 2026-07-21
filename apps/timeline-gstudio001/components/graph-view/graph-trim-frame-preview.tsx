"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  useLiveTrim,
  type LiveTrim,
  type MediaNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

// Floating frame preview during a trim drag (R5 #3, overlay mode): while a
// VIDEO clip's handle is being dragged, a small panel floats above the card
// showing the actual frame at the moving edge — front handle: the clip's new
// FIRST frame; back handle: its new LAST frame — so the user sees where they
// are trimming to, not just a duration number.
//
// Wiring: rides the package's per-node live-trim channel (useLiveTrim), the
// same one the duration pill uses — re-renders only this leaf, only during
// the gesture, per the package's efficiency model. PORTALED to document.body
// because every in-strip ancestor clips (the scroll container) or is
// transformed (virtual items), which would either cut the panel off or turn
// position:fixed into position:absolute.
//
// Video-only by design: an image's frame never changes under trim (only its
// duration, which the pill already tracks live).

const PANEL_WIDTH = 168;
const PANEL_MARGIN = 8;

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
 * and it only runs while the panel is mounted, i.e. during the gesture.
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

function FloatingFramePanel({
  node,
  live,
  anchor,
}: Readonly<{ node: MediaNode; live: LiveTrim; anchor: HTMLElement }>) {
  // Quantize to ~25fps so a slow pixel-level drag doesn't issue a seek per
  // pointer event for sub-frame deltas.
  const rawTime = edgeSourceTime(node, live);
  const time = Math.round(rawTime * 25) / 25;
  const videoRef = useSeekedVideo(time);

  // Position above the card, hugging the dragged edge — written straight to
  // the panel's style (no state round-trip): re-measured on every live change
  // (this component re-renders per pointer move), so the panel follows the
  // card's live resize; clamped into the viewport. The panel mounts offscreen
  // and the layout effect places it before paint.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = anchor.getBoundingClientRect();
    const panelHeight = (PANEL_WIDTH * 9) / 16 + 22; // media + label row
    const left = Math.min(
      Math.max(PANEL_MARGIN, live.side === "right" ? rect.right - PANEL_WIDTH : rect.left),
      window.innerWidth - PANEL_WIDTH - PANEL_MARGIN,
    );
    const top = Math.max(PANEL_MARGIN, rect.top - panelHeight - PANEL_MARGIN);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }, [anchor, live]);

  if (node.mediaKind !== "video" || !node.src) return null;

  // Which panel edge mirrors the handle being dragged: the front/in handle
  // ("left", and "move", which slides the in-point) marks the LEFT edge, the
  // back/out handle the RIGHT — never both. Purely cosmetic: the bar echoes
  // the amber trim-handle pixels so the panel reads as "this edge, up close".
  const activeEdge = live.side === "right" ? "right" : "left";

  return createPortal(
    <div
      ref={panelRef}
      data-trim-frame-preview={live.side}
      aria-hidden="true"
      className="pointer-events-none fixed z-[60] overflow-hidden rounded-md border border-zinc-700 bg-zinc-950 shadow-xl shadow-black/50"
      style={{ left: -9999, top: -9999, width: PANEL_WIDTH }}
    >
      <video
        ref={videoRef}
        src={node.src}
        poster={node.posterSrcs?.[0]}
        muted
        playsInline
        preload="auto"
        className="aspect-video w-full bg-black object-contain"
      />
      <div className="flex items-center justify-between bg-zinc-950/95 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-amber-200">
        <span>{live.side === "right" ? "out" : "in"}</span>
        <span>{time.toFixed(2)}s</span>
      </div>
      {/* The trim-handle look — amber bar with the dark center notch — laid
          over the ACTIVE edge only (the container's overflow-hidden clips it
          to the rounded corners). */}
      <span
        data-trim-frame-preview-edge={activeEdge}
        className={[
          "absolute inset-y-0 flex w-2 items-center justify-center bg-amber-400 opacity-95",
          activeEdge === "right" ? "right-0" : "left-0",
        ].join(" ")}
      >
        <span className="h-4 w-0.5 rounded bg-black/60" />
      </span>
    </div>,
    document.body,
  );
}

/**
 * Mount inside a video card's content (beside the duration pill). Renders
 * nothing at rest; during a trim gesture on THIS node it floats the frame
 * panel above the card. The wrapper span is the position anchor — it spans
 * the card (absolute inset-0), so measuring it measures the card. Tracked as
 * STATE (callback ref), not a ref read in render: the panel must render on
 * the same pass the anchor appears, and render-time ref reads are illegal.
 */
export function TrimFramePreview({ id, node }: Readonly<{ id: NodeId; node: MediaNode }>) {
  const live = useLiveTrim(id);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);

  if (node.mediaKind !== "video" || !node.src) return null;
  return (
    <span ref={setAnchor} aria-hidden="true" className="pointer-events-none absolute inset-0">
      {live !== null && anchor !== null ? (
        <FloatingFramePanel node={node} live={live} anchor={anchor} />
      ) : null}
    </span>
  );
}
