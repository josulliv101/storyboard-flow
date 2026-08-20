"use client";

import {
  ChevronFirst,
  ChevronLast,
  GripHorizontal,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "../../lib/utils";
import type { CollectionFramePreview } from "../timeline-documents";
import { useTimelineDocuments } from "../timeline-document-store";

import { createAudioMixer, type AudioMixer } from "./audio-graph";

import {
  layerFrameOf,
  layerFrameRect,
  outputFrameRect,
  type LayerFrame,
} from "@storyboard/timeline-model/layer-frame";
import type { CollectionTimelineClip, TimelineClip } from "../types";
import { formatSeconds } from "../utils";
import {
  clipContainsPlaybackTime,
  getClipPlaybackDuration,
  getClipPlaybackStart,
  getLiveLayerClips,
  getPictureClip,
  getTimelineDuration,
  nextPlayableTime,
} from "./playback-skip";

/** "Stop everything." One shared instance — the override effect asks for it on
 *  every change, and a fresh Set per call would be litter. */
const NO_LIVE_KEYS: ReadonlySet<string> = new Set<string>();

type DisplayMedia = {
  key: string;
  kind: "image" | "video" | "audio";
  src: string;
  /** Never set for audio — it has no frame to poster. */
  poster?: string;
  alt: string;
  sourceTime: number;
  timelineTime: number;
  clipTitle: string;
  playbackRate: number;
};

/**
 * A cached entry that OWNS AN HTMLMediaElement — video or audio.
 *
 * Every playback site below used to test `kind !== "video"` and bail. That was
 * correct when video was the only thing that could play; with audio it meant
 * the element was created, cached and mixer-attached, and then never told to
 * play. The clip looked loaded and stayed silent.
 */
type PlayableCachedMedia = Extract<CachedMedia, { kind: "video" | "audio" }>;

function isPlayable(cached: CachedMedia | undefined): cached is PlayableCachedMedia {
  return cached !== undefined && (cached.kind === "video" || cached.kind === "audio");
}

type CachedMedia =
  | { kind: "image"; element: HTMLImageElement }
  | { kind: "video"; element: HTMLVideoElement }
  | { kind: "audio"; element: HTMLAudioElement };

type PlaybackSurfaceRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type CanvasPointEvent = {
  clientX: number;
  clientY: number;
  currentTarget: HTMLCanvasElement;
};

type WorkbenchDisplaySurfaceProps = {
  clips: TimelineClip[];
  currentTime: number;
  onCurrentTimeChange: (time: number) => void;
  className?: string;
  preferredClipId?: string | null;
  /** Controlled playback. When supplied, the surface plays iff this is true and
   *  reports intent through `onPlayingChange` (the play button and the
   *  end-of-timeline auto-stop call it) instead of holding play state itself.
   *  Omit for the default uncontrolled behavior (internal play state). */
  playing?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  /** Controlled audio, same contract as `playing` above: supply both to own the
   *  state, omit for internal defaults. Volume is 0..1 and is a MASTER level —
   *  per-clip levels are the mixer's business, not a consumer's. */
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
  /** When supplied, the surface renders a close affordance in its top-right
   *  corner. Omit and no button is drawn — a consumer that has no way to hide
   *  the preview must not show one. */
  onClose?: () => void;
  /**
   * Draw THIS frame instead of the one the clock is on, for as long as it is
   * set. Null (the default) means the clock decides, which is every existing
   * consumer.
   *
   * Exists for gestures that are about a frame rather than a moment — trimming
   * being the one that asked for it: the user is choosing an in/out point, and
   * the answer to "what does that point look like" belongs on the biggest
   * picture available rather than in a thumbnail floated next to the handle.
   *
   * `sourceTime` is in SOURCE seconds, not timeline seconds, and that is the
   * point: mid-drag the clip's own trim values are still the committed ones, so
   * a timeline time would map through stale trims. The caller knows the source
   * frame it wants; this draws it.
   *
   * Addressed by `src` rather than by clip id, which is the correction that
   * made this work at all. The pane plays one of TWO models — the focused
   * level's projection, whose clip ids are graph node ids, or the compiled
   * manifest, whose ids are path-qualified (`path/to:leafId`) precisely
   * because leaf ids repeat across documents. A clip id is therefore not a
   * stable handle across the boundary; the source URL is, and it is what the
   * media cache is really about.
   *
   * The CLOCK IS NOT TOUCHED. `currentTime` keeps its value, `onCurrentTimeChange`
   * is not called, and clearing this redraws whatever the clock was always on.
   * A consumer cannot move the playhead through this prop, by construction.
   */
  frameOverride?: Readonly<{ src: string; poster?: string; sourceTime: number }> | null;
  /**
   * The RENDER's frame shape (width / height), for placing under-layer insets.
   *
   * A layer's rectangle is normalized to the OUTPUT frame, not to the picture,
   * and the two differ whenever the source's shape differs from the render's —
   * the export fits the source in and pads the rest. Without this the preview
   * composes against the picture box and puts the inset somewhere the finished
   * file will not: for the default bottom-right inset, 22px and 68px of margin
   * against a 16:9 picture where the render gives 40px and 40px.
   *
   * Optional because the surface is generic and a consumer with no render
   * target has no answer; absent means compose against the picture, which is
   * the best available guess and what this did before.
   */
  outputAspect?: number;
};

const BUFFER_WINDOW_SIZE = 4;
const DEFAULT_SURFACE_HEIGHT = 380;
const MIN_SURFACE_HEIGHT = 120;
const MIN_TIMELINE_SPACE = 260;
/** The divider button's full height — the DRAG HIT TARGET, and what
 *  `--workbench-preview-offset` is built from. Constant at every breakpoint
 *  (Tailwind h-7), so the band inside it can change height without moving the
 *  preview, the transport, or anything sticking below.
 *
 *  44 rather than 16: the band needs clear space on BOTH sides of it, and at
 *  16 with the mid-line at 10 it had 10 above and 6 below — the surface and
 *  the timeline crowded it from either side.
 *
 *  It is also the drag hit target, and a taller one is strictly easier to
 *  grab — there is no cost here to spend against. */
const DIVIDER_HEIGHT_PX = 44;


/** Where the visible band's mid-line falls inside that box. The band is
 *  CENTERED on this line at every breakpoint rather than sized from the top,
 *  which is what lets it be 8px on desktop and 12px on coarse-pointer widths
 *  (where it hosts the grip) without the transport shifting. The transport is
 *  centered on the same line and may overhang the band freely.
 *
 *  DELIBERATELY BELOW CENTRE — 24 in a 44 box, so the band gets 20 clear above
 *  and 16 below. Optical, not arithmetic: the transport (h-11) is centred on
 *  this same line and overhangs the band by more than the clearance either
 *  side, so it crowds the preview above more than it crowds the timeline
 *  below, and a mathematically even 22/22 still read bottom-heavy. It is a
 *  constant rather than a fraction of the height for exactly that reason —
 *  the right value is judged, not derived. */
const DIVIDER_BAND_CENTER_PX = 24;

type WorkbenchDividerTransportProps = {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  canPlay: boolean;
  canSeekPrevious: boolean;
  canSeekNext: boolean;
  /** Whether the playhead has anywhere to go at each END of the timeline —
   *  distinct from the clip-to-clip pair above, which step between clips. */
  canSeekStart: boolean;
  canSeekEnd: boolean;
  previewHovered: boolean;
  onTogglePlaying: () => void;
  onSeekPrevious: () => void;
  onSeekNext: () => void;
  onSeekStart: () => void;
  onSeekEnd: () => void;
};

type WorkbenchAudioControlsProps = {
  volume: number;
  muted: boolean;
  onToggleMuted: () => void;
  onVolumeChange: (volume: number) => void;
  /** True once an unmuted play() was refused for want of a user gesture. The
   *  control says so rather than leaving the user to wonder why it is silent. */
  audioBlocked: boolean;
};

/**
 * Volume lives INSIDE the preview, not on the divider beside play/pause.
 *
 * The divider is a resize handle first: its whole band is the drag target, and
 * parking a button at its left end quietly shrank that target — the e2e that
 * hovers the divider at x=20 caught it immediately. Overlaying the picture is
 * also simply where every video player puts this control.
 */
function WorkbenchAudioControls({
  volume,
  muted,
  onToggleMuted,
  onVolumeChange,
  audioBlocked,
}: WorkbenchAudioControlsProps) {
  const silent = muted || volume <= 0;

  return (
    <div
      className="absolute bottom-2 left-2 z-20 flex items-center gap-1.5 rounded-full bg-zinc-950/70 px-1.5 py-1 backdrop-blur-sm"
      data-testid="workbench-preview-audio"
      onPointerDown={(event) => {
        // The canvas below toggles play on click. These controls are their own
        // island — pressing one must not also start the preview.
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        onClick={onToggleMuted}
        className="grid size-6 shrink-0 place-items-center rounded-full text-zinc-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        aria-label={silent ? "Unmute workbench preview" : "Mute workbench preview"}
        aria-pressed={silent}
        title={audioBlocked ? "Click to enable sound" : silent ? "Unmute" : "Mute"}
        data-testid="workbench-preview-mute"
        data-audio-blocked={audioBlocked || undefined}
      >
        {silent ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
      </button>

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={(event) => onVolumeChange(Number(event.target.value))}
        className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        aria-label="Workbench preview volume"
        data-testid="workbench-preview-volume"
      />
    </div>
  );
}

function WorkbenchDividerTransport({
  currentTime,
  duration,
  isPlaying,
  canPlay,
  canSeekPrevious,
  canSeekNext,
  canSeekStart,
  canSeekEnd,
  previewHovered,
  onTogglePlaying,
  onSeekPrevious,
  onSeekNext,
  onSeekStart,
  onSeekEnd,
}: WorkbenchDividerTransportProps) {
  return (
    <div
      role="group"
      aria-label="Preview transport"
      className="pointer-events-none absolute inset-x-0 top-full z-50 h-0 transition-opacity duration-300 ease-out [[data-preview-chrome='out']_&]:opacity-0 motion-reduce:transition-none"
      data-testid="workbench-preview-controls"
      data-transport-layout="static"
    >
      {/* FIVE controls now, so 13.75rem — the width is 5 × the 44px button
          well (size-11) and has to be kept in step with the count, since the
          time readout to the right budgets its own width against half of it. */}
      <div
        className="pointer-events-auto absolute left-1/2 flex h-11 w-[13.75rem] items-center justify-center"
        data-transport-button-group
        style={{ top: DIVIDER_BAND_CENTER_PX, transform: "translate(-50%, -50%)" }}
        onPointerDown={(event) => {
          // The transport visually occupies the divider, but remains its own
          // interaction island. A transport press must never begin a resize.
          event.stopPropagation();
        }}
      >
        {/* THE ENDS, outside the clip-steppers. The pairing is deliberate:
            reading outwards from the play button you get "one clip back" then
            "all the way back", which is the order every transport in every
            editor uses. Putting them inside would have made the two arrow
            pairs read as one four-way stepper.

            `translate-x-4` against the steppers' `2` is what makes the row
            EVENLY spaced, and the number is not free. Each button is a 44px
            well, so a glyph's position is its well's centre plus its nudge:
            22+16, 66+8, 110, 154−8, 198−16 → 38, 74, 110, 146, 182. Four gaps
            of 36px.

            It was `3`, which put the outer glyphs at 34 and 186 — gaps of
            40, 36, 36, 40. Only 4px, and it read exactly as what it was: the
            new pair pushed out too far, the cluster reading as a control with
            two satellites rather than one row. */}
        <button
          type="button"
          onClick={onSeekStart}
          disabled={!canSeekStart}
          className="group/start relative z-10 grid size-11 shrink-0 place-items-center text-zinc-400 transition-colors hover:text-white focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Jump to start of workbench preview"
          title="Jump to start"
        >
          <span className="grid size-5 translate-x-4 place-items-center rounded-full transition-colors group-focus-visible/start:ring-2 group-focus-visible/start:ring-sky-400 group-focus-visible/start:ring-offset-2 group-focus-visible/start:ring-offset-zinc-950">
            <ChevronFirst className="size-3.5" />
          </span>
        </button>

        <button
          type="button"
          onClick={onSeekPrevious}
          disabled={!canSeekPrevious}
          className="group/previous relative z-10 grid size-11 shrink-0 place-items-center text-zinc-400 transition-colors hover:text-white focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Previous workbench clip"
          title="Previous clip"
        >
          <span className="grid size-5 translate-x-2 place-items-center rounded-full transition-colors group-focus-visible/previous:ring-2 group-focus-visible/previous:ring-sky-400 group-focus-visible/previous:ring-offset-2 group-focus-visible/previous:ring-offset-zinc-950">
            <SkipBack className="size-3.5 fill-current" />
          </span>
        </button>

        <button
          type="button"
          onClick={onTogglePlaying}
          disabled={!canPlay}
          className="group/play relative z-10 grid size-11 shrink-0 place-items-center text-zinc-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={isPlaying ? "Pause workbench preview" : "Play workbench preview"}
          title={isPlaying ? "Pause" : "Play"}
        >
          {/* ACTIVE = the highlighted state (the preview is hovered, or this
              button is), the same condition that used to only whiten the
              glyph. It now INVERTS: a solid white disc with the mark punched
              black out of it. Resting stays background-free, and the disc is
              the well's own size, so nothing shifts as it lights up. */}
          <span
            className={cn(
              "grid size-5 place-items-center rounded-full transition-colors group-hover/play:bg-white group-hover/play:text-zinc-950 group-focus-visible/play:ring-2 group-focus-visible/play:ring-sky-400 group-focus-visible/play:ring-offset-2 group-focus-visible/play:ring-offset-zinc-950",
              previewHovered && "bg-white text-zinc-950",
            )}
            data-transport-primary-control
          >
            {isPlaying ? (
              <Pause className="size-3 fill-current" />
            ) : (
              <Play className="ml-0.5 size-3 fill-current" />
            )}
          </span>
        </button>

        <button
          type="button"
          onClick={onSeekNext}
          disabled={!canSeekNext}
          className="group/next relative z-10 grid size-11 shrink-0 place-items-center text-zinc-400 transition-colors hover:text-white focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Next workbench clip"
          title="Next clip"
        >
          <span className="grid size-5 -translate-x-2 place-items-center rounded-full transition-colors group-focus-visible/next:ring-2 group-focus-visible/next:ring-sky-400 group-focus-visible/next:ring-offset-2 group-focus-visible/next:ring-offset-zinc-950">
            <SkipForward className="size-3.5 fill-current" />
          </span>
        </button>

        <button
          type="button"
          onClick={onSeekEnd}
          disabled={!canSeekEnd}
          className="group/end relative z-10 grid size-11 shrink-0 place-items-center text-zinc-400 transition-colors hover:text-white focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Jump to end of workbench preview"
          title="Jump to end"
        >
          <span className="grid size-5 -translate-x-4 place-items-center rounded-full transition-colors group-focus-visible/end:ring-2 group-focus-visible/end:ring-sky-400 group-focus-visible/end:ring-offset-2 group-focus-visible/end:ring-offset-zinc-950">
            <ChevronLast className="size-3.5" />
          </span>
        </button>
      </div>

      <span
        // Budgeted against HALF the button group (now 13.75rem ⇒ 6.875rem)
        // plus a gap, so the readout cannot slide under the outermost button.
        // This number is not free-standing — it moves whenever the group's
        // width does.
        className="absolute right-3 max-w-[calc(50%_-_7.75rem)] overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-zinc-900/90 px-2 py-0.5 font-mono text-[10px] text-zinc-400 shadow-sm"
        aria-label={`Preview time ${formatSeconds(currentTime)} of ${formatSeconds(duration)}`}
        data-testid="workbench-preview-time"
        style={{ top: DIVIDER_BAND_CENTER_PX, transform: "translateY(-50%)" }}
      >
        <span className="sm:hidden">{formatSeconds(currentTime)}</span>
        <span className="hidden sm:inline">
          {formatSeconds(currentTime)} / {formatSeconds(duration)}
        </span>
      </span>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clipLabel(clip: TimelineClip) {
  return clip.kind === "collection" ? clip.title : clip.alt || "Clip";
}

function getClipPlaybackRate(clip: TimelineClip) {
  const sourceRange = Math.max(0.001, clip.sourceDuration - clip.trimIn - clip.trimOut);
  return clamp(sourceRange / getClipPlaybackDuration(clip), 0.0625, 16);
}

// getClipPlaybackStart / getClipPlaybackDuration / clipContainsPlaybackTime /
// getContainingClip / getTimelineDuration now live in ./playback-skip, beside
// the skip rule that reads them — pure, and unit-tested without React.

function getClipPlaybackProgress(clip: TimelineClip, timelineTime: number) {
  const playbackStart = getClipPlaybackStart(clip);
  return clamp(
    (timelineTime - playbackStart) / getClipPlaybackDuration(clip),
    0,
    1,
  );
}

function getCollectionPreviewClip(clip: CollectionTimelineClip): CollectionTimelineClip {
  const playbackDuration = getClipPlaybackDuration(clip);
  return {
    ...clip,
    duration: playbackDuration,
    sourceDuration: Math.max(clip.sourceDuration, playbackDuration),
  };
}

type GetCollectionClipFramePreview = (
  clip: CollectionTimelineClip,
  clipTime: number,
  visited?: Set<string>,
  parentPlaybackRate?: number,
) => CollectionFramePreview | null;

/**
 * The media for an explicit SOURCE frame, bypassing the clock (`frameOverride`).
 *
 * Matched on `src`, NOT on clip id, and that is the whole correctness of it.
 * The pane plays one of two models: the focused level's projection, whose clip
 * ids are graph node ids, or the compiled manifest, whose ids are
 * `collectionPath:leafId` because leaf ids repeat across documents. An id from
 * outside therefore matches in one model and silently misses in the other —
 * which is exactly how this shipped: it worked against the projection the
 * e2e fixture uses and did nothing in a real project, where the manifest wins.
 *
 * Finding the clip is only for the CACHE KEY: matching one makes the key
 * byte-identical to `resolveClipMedia`'s, so the override seeks the element
 * the pane is already holding rather than loading a second copy. Nothing else
 * is taken from it — notably not `sourceDuration`, which the manifest
 * synthesizes per leaf and would clamp against the wrong range. The element's
 * own duration is the real bound and `syncActiveVideo` already clamps to it.
 */
export function resolveOverrideMedia(
  clips: readonly TimelineClip[],
  override: Readonly<{ src: string; poster?: string; sourceTime: number }>,
): DisplayMedia {
  const match = clips.find(
    (clip): clip is Extract<TimelineClip, { kind: "video" }> =>
      clip.kind === "video" && clip.src === override.src,
  );
  return {
    // Same key as normal playback when the source is on screen; a stable
    // private one when it is not, so an off-screen source still draws.
    key: match ? `${match.id}:video:${match.src}` : `frame-override:video:${override.src}`,
    kind: "video",
    src: override.src,
    poster: override.poster ?? match?.poster,
    alt: match?.alt ?? "",
    sourceTime: Math.max(0, override.sourceTime),
    // Unused for drawing; the clock is not involved in an override.
    timelineTime: 0,
    clipTitle: match ? clipLabel(match) : "",
    playbackRate: 1,
  };
}

function resolveClipMedia(
  clip: TimelineClip,
  timelineTime: number,
  getCollectionClipFramePreview: GetCollectionClipFramePreview,
): DisplayMedia | null {
  const progress = getClipPlaybackProgress(clip, timelineTime);
  const playbackLocalTime = progress * getClipPlaybackDuration(clip);

  if (clip.kind === "video") {
    const sourceRange = Math.max(0, clip.sourceDuration - clip.trimIn - clip.trimOut);
    const sourceTime = clamp(
      clip.trimIn + progress * sourceRange,
      0,
      Math.max(0, clip.sourceDuration - 0.001),
    );

    return {
      key: `${clip.id}:video:${clip.src}`,
      kind: "video",
      src: clip.src,
      poster: clip.poster,
      alt: clip.alt,
      sourceTime,
      timelineTime,
      clipTitle: clipLabel(clip),
      playbackRate: getClipPlaybackRate(clip),
    };
  }

  if (clip.kind === "image") {
    return {
      key: `${clip.id}:image:${clip.src}`,
      kind: "image",
      src: clip.src,
      poster: clip.poster,
      alt: clip.alt,
      sourceTime: 0,
      timelineTime,
      clipTitle: clipLabel(clip),
      playbackRate: 1,
    };
  }

  if (clip.kind === "audio") {
    // Windowed like video, so the source position is computed the same way —
    // the element seeks, there is simply no picture to draw from it. The
    // surface renders a waveform for this kind instead of a frame.
    const sourceRange = Math.max(0, clip.sourceDuration - clip.trimIn - clip.trimOut);
    const sourceTime = clamp(
      clip.trimIn + progress * sourceRange,
      0,
      Math.max(0, clip.sourceDuration - 0.001),
    );

    return {
      key: `${clip.id}:audio:${clip.src}`,
      kind: "audio",
      src: clip.src,
      alt: clip.alt,
      sourceTime,
      timelineTime,
      clipTitle: clipLabel(clip),
      playbackRate: getClipPlaybackRate(clip),
    };
  }

  // Everything above returns, so `clip` is a collection here. Before audio
  // existed this was an unguarded fallthrough: a new media kind landed in the
  // collection branch and called getCollectionPreviewClip on a non-collection.
  // The type below is what catches that — keep it exhaustive.
  const collectionPreview = getCollectionClipFramePreview(
    getCollectionPreviewClip(clip),
    playbackLocalTime,
  );
  if (collectionPreview) {
    return {
      key: `${clip.id}:${collectionPreview.kind}:${collectionPreview.src}`,
      kind: collectionPreview.kind,
      src: collectionPreview.src,
      poster: collectionPreview.poster,
      alt: collectionPreview.alt,
      sourceTime: collectionPreview.kind === "video" ? collectionPreview.previewTime : 0,
      timelineTime,
      clipTitle: clip.title,
      playbackRate: clamp(collectionPreview.playbackRate, 0.0625, 16),
    };
  }

  const fallbackPreview = clip.previewItems?.[0];
  if (!fallbackPreview) return null;

  return {
    key: `${clip.id}:${fallbackPreview.kind}:${fallbackPreview.src}`,
    kind: fallbackPreview.kind,
    src: fallbackPreview.src,
    poster: fallbackPreview.poster,
    alt: fallbackPreview.alt,
    sourceTime: 0,
    timelineTime,
    clipTitle: clip.title,
    playbackRate: 1,
  };
}

function getActiveClip(
  clips: TimelineClip[],
  currentTime: number,
  preferredClipId?: string | null,
) {
  if (clips.length === 0) return null;
  const preferredClip = preferredClipId
    ? clips.find((clip) => clip.id === preferredClipId)
    : null;
  if (preferredClip && clipContainsPlaybackTime(preferredClip, currentTime)) {
    return preferredClip;
  }

  // The PICTURE, which also holds the last shot across a gap — see
  // `getPictureClip`. It used to be `getContainingClip` plus a hold loop right
  // here, and the difference is the whole reason that function was split:
  // packing leaves a gap at every cut, and a lane clip covering that gap made
  // the surface try to draw an under-layer.
  return getPictureClip(clips, currentTime);
}

/** One under-layer running at this instant: what to play, and — when it has
 *  been given a frame — where to draw it inside the picture. */
type LiveLayer = Readonly<{
  media: DisplayMedia;
  /** Absent means SOUND ONLY, which is what every layer did before
   *  compositing. It is not a default waiting to be filled in here. */
  frame?: LayerFrame;
  /** The clip's own shape, so the inset is never stretched. */
  aspect: number;
  /** Which lane, for draw order. */
  lane: number;
}>;

/**
 * Every under-layer live at this instant. The picture is excluded — it arrives
 * separately as the thing that decides the frame.
 *
 * Sorted so the LOWEST lane is drawn last and therefore ends up on top,
 * matching "lowest lane wins" everywhere else here. Sorting at resolve time
 * rather than per draw: the live set changes far less often than the canvas
 * repaints, and there are only ever a handful of them.
 */
function getLiveLayers(
  clips: TimelineClip[],
  currentTime: number,
  getCollectionClipFramePreview: GetCollectionClipFramePreview,
): LiveLayer[] {
  const live = getLiveLayerClips(clips, currentTime);
  if (live.length === 0) return [];
  const layers: LiveLayer[] = [];
  for (const clip of live) {
    const media = resolveClipMedia(clip, currentTime, getCollectionClipFramePreview);
    if (media === null) continue;
    const frame = layerFrameOf(clip.layerFrame);
    layers.push({
      media,
      ...(frame === undefined ? {} : { frame }),
      aspect: clip.aspect > 0 ? clip.aspect : 16 / 9,
      lane: clip.trackIndex,
    });
  }
  return layers.sort((a, b) => b.lane - a.lane);
}

// normalizePlaybackTime is `nextPlayableTime` (./playback-skip): it decides
// whether the clock needs snapping forward to material that will actually be
// drawn — over a gap, or over a DISABLED clip's whole span. Deliberately not
// getActiveClip, which answers "what should the surface draw" and holds a
// frame across gaps, making every gap look like a legitimate resting place.

export function WorkbenchDisplaySurface({
  clips,
  currentTime,
  onCurrentTimeChange,
  className,
  preferredClipId,
  playing,
  onPlayingChange,
  volume,
  onVolumeChange,
  muted,
  onMutedChange,
  onClose,
  frameOverride = null,
  outputAspect,
}: WorkbenchDisplaySurfaceProps) {
  const { getCollectionClipFramePreview } = useTimelineDocuments();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playbackSurfaceRectRef = useRef<PlaybackSurfaceRect | null>(null);
  const cacheRef = useRef(new Map<string, CachedMedia>());
  const activeMediaRef = useRef<DisplayMedia | null>(null);
  const activeClipDisabledRef = useRef(false);
  // The under-layers audible right now. The picture is `activeMediaRef`; these
  // play alongside it and, in this phase, are heard and not seen.
  const liveLayerMediaRef = useRef<LiveLayer[]>([]);
  // A ref, so `drawDrawable` keeps its stable identity — it is reached from a
  // dozen async media listeners that would be orphaned if it were rebuilt.
  const outputAspectRef = useRef(outputAspect);
  outputAspectRef.current = outputAspect;
  const animationFrameRef = useRef<number | null>(null);
  const timeoutFrameRef = useRef<number | null>(null);
  // PER ELEMENT, keyed by media key. This was a single slot, which was correct
  // while exactly one element could ever be seeking: a second element seeking
  // concurrently would run the first's cleanup as if it were its own, leaving
  // the first's listeners attached and its own removed.
  const pendingSeekDrawCleanupRef = useRef(new Map<string, () => void>());
  const playbackAnchorRef = useRef<{ timelineTime: number; startedAtMs: number } | null>(null);
  const lastPublishedAtRef = useRef(0);
  const lastRenderedMediaKeyRef = useRef<string | null>(null);
  const currentTimeRef = useRef(currentTime);
  const sortedClipsRef = useRef<TimelineClip[]>([]);
  const durationRef = useRef(0);
  const isPlayingRef = useRef(false);
  // Controlled when `playing` is supplied; otherwise the surface owns the state
  // (the default, preserving every existing consumer's behavior).
  const isControlledPlayback = playing !== undefined;
  const [uncontrolledPlaying, setUncontrolledPlaying] = useState(false);
  const [previewHovered, setPreviewHovered] = useState(false);
  const isPlaying = playing ?? uncontrolledPlaying;
  const setPlaying = useCallback(
    (next: boolean) => {
      if (isControlledPlayback) onPlayingChange?.(next);
      else setUncontrolledPlaying(next);
    },
    [isControlledPlayback, onPlayingChange],
  );

  // Audio follows the same controlled-or-uncontrolled contract as playback.
  const isControlledVolume = volume !== undefined;
  const isControlledMuted = muted !== undefined;
  const [uncontrolledVolume, setUncontrolledVolume] = useState(1);
  const [uncontrolledMuted, setUncontrolledMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const activeVolume = volume ?? uncontrolledVolume;
  const activeMuted = muted ?? uncontrolledMuted;
  const setVolume = useCallback(
    (next: number) => {
      if (isControlledVolume) onVolumeChange?.(next);
      else setUncontrolledVolume(next);
    },
    [isControlledVolume, onVolumeChange],
  );
  const setMuted = useCallback(
    (next: boolean) => {
      if (isControlledMuted) onMutedChange?.(next);
      else setUncontrolledMuted(next);
    },
    [isControlledMuted, onMutedChange],
  );
  // One mixer for the surface's lifetime. Created lazily on first use so a
  // never-played preview never constructs an AudioContext.
  const mixerRef = useRef<AudioMixer | null>(null);
  const getMixer = useCallback(() => {
    mixerRef.current ??= createAudioMixer();
    return mixerRef.current;
  }, []);
  // Read inside callbacks that must not re-create when the level changes.
  const audioLevelRef = useRef({ volume: activeVolume, muted: activeMuted });
  audioLevelRef.current = { volume: activeVolume, muted: activeMuted };

  const sortedClips = useMemo(
    () => [...clips].sort((a, b) => getClipPlaybackStart(a) - getClipPlaybackStart(b) || a.index - b.index),
    [clips],
  );
  const duration = useMemo(() => getTimelineDuration(sortedClips), [sortedClips]);
  useEffect(() => {
    sortedClipsRef.current = sortedClips;
    durationRef.current = duration;
  }, [duration, sortedClips]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  const activeClip = useMemo(
    () => getActiveClip(sortedClips, currentTime, preferredClipId),
    [currentTime, preferredClipId, sortedClips],
  );
  const activeClipIndex = useMemo(
    () => (activeClip ? sortedClips.findIndex((clip) => clip.id === activeClip.id) : -1),
    [activeClip, sortedClips],
  );
  // Derived in render from the same pure function the clock path uses, so the
  // published count and the elements actually playing cannot disagree.
  const liveLayers = useMemo(
    () => getLiveLayerClips(sortedClips, currentTime),
    [currentTime, sortedClips],
  );
  const activeMedia = useMemo(
    () =>
      activeClip
        ? resolveClipMedia(
            activeClip,
            currentTime,
            getCollectionClipFramePreview,
          )
        : null,
    [activeClip, currentTime, getCollectionClipFramePreview],
  );
  const bufferedMedia = useMemo(() => {
    if (!activeClip) return [];
    const activeIndex = sortedClips.findIndex((clip) => clip.id === activeClip.id);
    if (activeIndex === -1) return activeMedia ? [activeMedia] : [];

    return sortedClips
      .slice(activeIndex, activeIndex + BUFFER_WINDOW_SIZE)
      .map((clip) =>
        resolveClipMedia(
          clip,
          Math.max(currentTime, getClipPlaybackStart(clip)),
          getCollectionClipFramePreview,
        ),
      )
      .filter((media): media is DisplayMedia => media !== null);
  }, [
    activeClip,
    activeMedia,
    currentTime,
    getCollectionClipFramePreview,
    sortedClips,
  ]);

  const ensureCachedMedia = useCallback((media: DisplayMedia) => {
    const cached = cacheRef.current.get(media.key);
    if (cached) return cached;

    if (media.kind === "video") {
      const video = document.createElement("video");
      video.preload = "auto";
      video.playsInline = true;
      // CORS-clean or Web Audio hands back SILENCE for cross-origin media —
      // `createMediaElementSource` on a tainted element produces zeros rather
      // than failing loudly. Must be set BEFORE `src`; setting it after would
      // need a reload. Only for absolute http(s) sources: a host that does not
      // send CORS headers would refuse the request outright, and blob:/data:
      // sources are same-origin already. (Cloudinary, which serves every clip
      // here, sends `Access-Control-Allow-Origin: *`.)
      if (/^https?:\/\//i.test(media.src)) video.crossOrigin = "anonymous";
      if (media.poster) video.poster = media.poster;
      video.src = media.src;
      video.load();
      // Attach BEFORE any play(): the mixer starts every source at zero gain,
      // so a prefetched clip is inaudible until it becomes the active one.
      getMixer().attach(video);
      const nextCached: CachedMedia = { kind: "video", element: video };
      cacheRef.current.set(media.key, nextCached);
      return nextCached;
    }

    if (media.kind === "audio") {
      const audio = document.createElement("audio");
      // `metadata`, NOT `auto` — unlike video, this buffers BUFFER_WINDOW_SIZE
      // clips ahead, and a lossless voice take is large. `auto` would speculatively
      // fetch several whole files to play one. Duration is all the clock needs
      // up front; the rest streams on demand.
      audio.preload = "metadata";
      // Same CORS rule as video, and for the same reason: Web Audio returns
      // silence rather than an error for a tainted element. Must precede `src`.
      if (/^https?:\/\//i.test(media.src)) audio.crossOrigin = "anonymous";
      audio.src = media.src;
      audio.load();
      // The mixer takes any HTMLMediaElement and starts it at zero gain, so a
      // prefetched take is silent until it becomes active — no changes needed
      // there for a second element kind.
      getMixer().attach(audio);
      const nextCached: CachedMedia = { kind: "audio", element: audio };
      cacheRef.current.set(media.key, nextCached);
      return nextCached;
    }

    const image = new window.Image();
    image.decoding = "async";
    image.src = media.src;
    const nextCached: CachedMedia = { kind: "image", element: image };
    cacheRef.current.set(media.key, nextCached);
    return nextCached;
  }, [getMixer]);

  const drawDrawable = useCallback((drawable: HTMLImageElement | HTMLVideoElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cssWidth = Math.max(1, canvas.clientWidth);
    const cssHeight = Math.max(1, canvas.clientHeight);
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const renderWidth = Math.round(cssWidth * pixelRatio);
    const renderHeight = Math.round(cssHeight * pixelRatio);
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
    }

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    const sourceWidth = drawable instanceof HTMLVideoElement ? drawable.videoWidth : drawable.naturalWidth;
    const sourceHeight = drawable instanceof HTMLVideoElement ? drawable.videoHeight : drawable.naturalHeight;
    if (sourceWidth <= 0 || sourceHeight <= 0) return;

    const scale = Math.min(cssWidth / sourceWidth, cssHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    const left = (cssWidth - width) / 2;
    const top = (cssHeight - height) / 2;
    playbackSurfaceRectRef.current = { left, top, width, height };
    canvas.dataset.previewPlaybackSurfaceReady = "true";

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = "#050505";
    context.fillRect(0, 0, cssWidth, cssHeight);
    // A disabled clip is reachable only by scrubbing, and it draws GRAYED so
    // the frame reads as "here, but not in the cut" — the same grayscale the
    // card wears on the board, on the same content. Filter is set around the
    // one drawImage and reset immediately: the backdrop fill above must stay
    // its true black, and a leaked filter would tint the next frame drawn.
    if (activeClipDisabledRef.current) context.filter = "grayscale(1) opacity(0.45)";
    context.drawImage(drawable, left, top, width, height);
    // Reset BEFORE compositing, not just after: an inset is its own clip and
    // must not inherit the picture's grayed-out treatment.
    context.filter = "none";

    // THE UNDER-LAYERS, OVER THE PICTURE.
    //
    // Inside `drawDrawable` deliberately. Nine call sites repaint this canvas
    // — the clock, six async media listeners, a ResizeObserver, and the frame
    // override's settle loop — and every one of them that draws a picture
    // arrives here. Compositing at the call sites instead would mean finding
    // all nine, and missing one shows up as an inset that vanishes whenever
    // some unrelated image finishes loading.
    //
    // Positioned against the PICTURE box, not the canvas: the black bars are
    // letterboxing, not part of the frame. Note this is the one place preview
    // and render can disagree — the stored rectangle is normalized to the
    // OUTPUT frame (2.4:1 today) while the preview box takes the source's
    // aspect, so when those differ an inset's vertical margin here is not
    // exactly the margin in the file. The render is authoritative; this is
    // close enough to position by eye and exact in x and in size.
    const picture = playbackSurfaceRectRef.current;
    if (picture === null) return;
    // THE OUTPUT FRAME, not the picture. See `outputAspect` — an inset near an
    // edge can legitimately land over where the render's padding will be, and
    // showing that is the point rather than a glitch.
    const aspect = outputAspectRef.current;
    const frame =
      aspect === undefined || !(aspect > 0)
        ? { left: picture.left, top: picture.top, width: picture.width, height: picture.height }
        : outputFrameRect(picture, aspect);
    const frameAspect = frame.height > 0 ? frame.width / frame.height : 1;
    for (const layer of liveLayerMediaRef.current) {
      if (layer.frame === undefined) continue;
      const cached = cacheRef.current.get(layer.media.key);
      // An <audio> has no frames, so a rectangle on one draws nothing. It
      // should never have got a frame at all — see `hasPicture` on the write
      // path — but a stored document can carry anything.
      if (!cached || cached.kind === "audio") continue;
      // Not decoded yet. Skipped rather than drawn as a blank: the next
      // repaint picks it up, and the picture underneath stays intact.
      const element =
        cached.kind === "image"
          ? cached.element.complete && cached.element.naturalWidth > 0
            ? cached.element
            : null
          : cached.element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
            ? cached.element
            : null;
      if (element === null) continue;
      const rect = layerFrameRect(layer.frame, layer.aspect, frameAspect);
      context.drawImage(
        element,
        frame.left + rect.x * frame.width,
        frame.top + rect.y * frame.height,
        rect.width * frame.width,
        rect.height * frame.height,
      );
    }
  }, []);

  const drawEmptyFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cssWidth = Math.max(1, canvas.clientWidth);
    const cssHeight = Math.max(1, canvas.clientHeight);
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const renderWidth = Math.round(cssWidth * pixelRatio);
    const renderHeight = Math.round(cssHeight * pixelRatio);
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
    }

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    playbackSurfaceRectRef.current = null;
    canvas.dataset.previewPlaybackSurfaceReady = "false";
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = "#050505";
    context.fillRect(0, 0, cssWidth, cssHeight);
  }, []);

  /**
   * An audio clip's stand-in. It has no frame, but it is PLAYING, and a
   * playing clip must never look like one that failed to load.
   *
   * Draws a centred baseline with a moving position marker plus the clip
   * title. Deliberately synthetic rather than decoded peaks: real peaks need
   * the whole file fetched and decoded, which belongs to the waveform lane
   * (cached, concurrency-capped, visible cards only) — not to a per-frame
   * paint on the playback clock.
   *
   * Sets `playbackSurfaceRectRef` and the ready flag exactly as `drawDrawable`
   * does. Skipping that was a real trap: click-to-seek geometry keys off the
   * rect, so an audio clip would silently swallow seeks.
   */
  const drawAudioFrame = useCallback((media: DisplayMedia) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cssWidth = Math.max(1, canvas.clientWidth);
    const cssHeight = Math.max(1, canvas.clientHeight);
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const renderWidth = Math.round(cssWidth * pixelRatio);
    const renderHeight = Math.round(cssHeight * pixelRatio);
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
    }

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    playbackSurfaceRectRef.current = {
      left: 0,
      top: 0,
      width: cssWidth,
      height: cssHeight,
    };
    canvas.dataset.previewPlaybackSurfaceReady = "true";

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = "#050505";
    context.fillRect(0, 0, cssWidth, cssHeight);

    const midY = cssHeight / 2;
    const inset = Math.min(48, cssWidth * 0.08);
    const trackLeft = inset;
    const trackRight = Math.max(trackLeft + 1, cssWidth - inset);

    context.strokeStyle = "#3f3f46";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(trackLeft, midY);
    context.lineTo(trackRight, midY);
    context.stroke();

    context.fillStyle = "#a1a1aa";
    context.font = "500 12px ui-sans-serif, system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(media.clipTitle, cssWidth / 2, midY - 28);
  }, []);

  const drawActiveFrame = useCallback(() => {
    const media = activeMediaRef.current;
    if (!media) {
      drawEmptyFrame();
      return;
    }
    const cached = cacheRef.current.get(media.key);
    if (!cached) return;

    if (cached.kind === "image") {
      if (cached.element.complete && cached.element.naturalWidth > 0) {
        drawDrawable(cached.element);
      }
      return;
    }

    if (cached.kind === "audio") {
      // An <audio> element has no intrinsic dimensions, so `drawDrawable`
      // would bail at its zero-size guard and leave the canvas blank. Audio
      // gets its own drawn stand-in instead — a clip that is playing must
      // never look like a clip that failed to load.
      drawAudioFrame(media);
      return;
    }

    if (cached.element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      drawDrawable(cached.element);
    }
  }, [drawAudioFrame, drawDrawable, drawEmptyFrame]);

  const frameOverrideRef = useRef(frameOverride);

  /**
   * Everything that is NOT live right now goes quiet and stops.
   *
   * Live is a SET, not one key. It used to be one: the picture. But a bed on a
   * lane is playing at the same instant as the shot it runs under, and the
   * export has always mixed it — silencing it here is what made the preview
   * disagree with the finished file.
   */
  const pauseClipsNotLive = useCallback((liveKeys: ReadonlySet<string>) => {
    const mixer = getMixer();
    cacheRef.current.forEach((cached, key) => {
      if (!isPlayable(cached)) return;
      if (liveKeys.has(key)) return;
      cached.element.pause();
      // The prefetch window pulls in the next few clips REGARDLESS of whether
      // they are disabled, so silence is decided here rather than there.
      mixer.setSourceGain(cached.element, 0);
    });
  }, [getMixer]);

  /**
   * Raise one live element to the current level.
   *
   * `silent` is passed rather than read from a ref because it is a PER-CLIP
   * fact and there is now more than one live clip: the picture can be disabled
   * (scrubbed into, drawn grayed, and heard by nobody) while the bed under it
   * plays perfectly normally. A single `activeClipDisabledRef` consulted here
   * would mute the bed for the picture's sake.
   */
  const applyGain = useCallback(
    // HTMLMediaElement, not HTMLVideoElement: the mixer takes either, and
    // audio clips need their gain applied on the same path or a volume change
    // reaches every clip except the one that is playing.
    (element: HTMLMediaElement, silent: boolean) => {
      const { volume: level, muted: isMuted } = audioLevelRef.current;
      getMixer().setSourceGain(element, isMuted || silent ? 0 : level);
    },
    [getMixer],
  );

  /**
   * Bring one media element into line with the clock: right source time, right
   * rate, right gain, playing or not.
   *
   * `draws` separates the picture from an under-layer. Both are seeked and both
   * are played; only the picture repaints the canvas when its seek lands. A
   * layer that repainted would be asking the surface to redraw the picture on
   * the layer's schedule, several times a second, for no change in pixels.
   *
   * `silent` is the clip's own disabled state — see `applyGain`.
   */
  const syncMediaElement = useCallback((
    media: DisplayMedia,
    { shouldPlay, forceSeek = false, draws, silent }:
      { shouldPlay: boolean; forceSeek?: boolean; draws: boolean; silent: boolean },
  ) => {
    const cached = ensureCachedMedia(media);
    if (!isPlayable(cached)) return;
    // Metadata-only preload is right for a clip the prefetch window merely
    // pulled in (a lossless voice take is large, and speculatively fetching
    // four of them to play one is waste). It is wrong the moment the element
    // has to actually play, so buying the rest of the file is deferred to
    // exactly here — the first time this element is live.
    if (shouldPlay && cached.element.preload !== "auto") cached.element.preload = "auto";

    // Named `video` throughout because every call below is HTMLMediaElement
    // API that an <audio> satisfies identically — readyState, currentTime,
    // playbackRate, play/pause. Widening the GATE was the whole fix.
    const video = cached.element;
    const seek = () => {
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
      const maxTime = Number.isFinite(video.duration)
        ? Math.max(0, video.duration - 0.001)
        : media.sourceTime;
      const targetTime = clamp(media.sourceTime, 0, maxTime);
      const drift = Math.abs(video.currentTime - targetTime);
      const maxDrift = shouldPlay ? 0.18 : 0.05;
      if (Number.isFinite(media.playbackRate) && media.playbackRate > 0) {
        video.playbackRate = clamp(media.playbackRate, 0.0625, 16);
        // A time-scaled clip would otherwise chipmunk: rate is a picture
        // decision, and the voice should not move with it.
        video.preservesPitch = true;
      }
      applyGain(video, silent);
      if (forceSeek || drift > maxDrift) {
        const pending = pendingSeekDrawCleanupRef.current;
        // This element's own pending cleanup, not whatever seeked last.
        pending.get(media.key)?.();
        pending.delete(media.key);

        if (draws) {
          const drawAfterSeek = () => {
            pending.get(media.key)?.();
            pending.delete(media.key);
            drawActiveFrame();
          };

          video.addEventListener("seeked", drawAfterSeek, { once: true });
          video.addEventListener("loadeddata", drawAfterSeek, { once: true });
          pending.set(media.key, () => {
            video.removeEventListener("seeked", drawAfterSeek);
            video.removeEventListener("loadeddata", drawAfterSeek);
          });
        }
        video.currentTime = targetTime;
      }
      if (shouldPlay && video.paused) {
        // Unmuted playback needs a user gesture. Swallowing the rejection here
        // would leave a silent-and-frozen preview with nothing to explain it,
        // so record it: the transport offers "click to enable sound", and the
        // next gesture-driven play clears the flag.
        void video
          .play()
          .then(() => setAudioBlocked(false))
          .catch(() => setAudioBlocked(true));
      } else if (!shouldPlay) {
        video.pause();
      }
      if (draws) drawActiveFrame();
    };

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      seek();
      return;
    }

    video.addEventListener("loadedmetadata", seek, { once: true });
    if (draws) video.addEventListener("loadeddata", drawActiveFrame, { once: true });
  }, [applyGain, drawActiveFrame, ensureCachedMedia]);

  const renderFrameAtTime = useCallback((timelineTime: number, shouldPlay: boolean, forceSeek = false) => {
    // An override owns the picture while it is set. Guarding HERE rather than
    // at each caller is what makes that true of all of them at once — the
    // `currentTime` effect, the clip-list effect, and the playback loop all
    // arrive through this function, and any one of them repainting mid-gesture
    // would flick the frame back to the clock's.
    if (frameOverrideRef.current !== null) return;
    const active = getActiveClip(sortedClipsRef.current, timelineTime, preferredClipId);
    const media = active
      ? resolveClipMedia(active, timelineTime, getCollectionClipFramePreview)
      : null;
    const mediaChanged = media?.key !== lastRenderedMediaKeyRef.current;

    activeMediaRef.current = media;
    lastRenderedMediaKeyRef.current = media?.key ?? null;
    // A REF, not a draw argument: `drawDrawable` is reached from half a dozen
    // async listeners (image load, video seeked/loadeddata) that have no idea
    // which clip they belong to. Setting it here — the one place the active
    // clip is resolved — makes every one of those redraws inherit the right
    // treatment.
    //
    // Only reachable while SCRUBBING: playing snaps the clock out of a
    // disabled span before anything is drawn (see nextPlayableTime).
    activeClipDisabledRef.current = active?.disabled === true;

    // The under-layers playing at this instant, alongside the picture rather
    // than instead of it. Resolved even when the picture is missing: a bed
    // running under a gap keeps playing, which is the whole point of a bed.
    const layers = getLiveLayers(
      sortedClipsRef.current,
      timelineTime,
      getCollectionClipFramePreview,
    );
    liveLayerMediaRef.current = layers;

    const liveKeys = new Set<string>();
    if (media) liveKeys.add(media.key);
    for (const layer of layers) liveKeys.add(layer.media.key);
    pauseClipsNotLive(liveKeys);

    for (const layer of layers) {
      // Never `draws`: a layer does not own the canvas, so it must not trigger
      // a repaint of its own. The picture does that, and `drawDrawable`
      // composites whatever is live at the time — so an inset lands on the
      // picture's schedule rather than each layer demanding its own.
      // Never `silent` — getLiveLayerClips already dropped the disabled ones.
      syncMediaElement(layer.media, { shouldPlay, forceSeek, draws: false, silent: false });
    }

    if (!media) {
      drawEmptyFrame();
      return;
    }

    const cached = ensureCachedMedia(media);

    if (cached.kind === "image") {
      if (cached.element.complete && cached.element.naturalWidth > 0) {
        drawDrawable(cached.element);
      } else {
        cached.element.addEventListener("load", drawActiveFrame, { once: true });
      }
      return;
    }

    syncMediaElement(media, {
      shouldPlay,
      forceSeek: forceSeek || mediaChanged,
      draws: true,
      silent: activeClipDisabledRef.current,
    });
  }, [
    drawActiveFrame,
    drawDrawable,
    drawEmptyFrame,
    ensureCachedMedia,
    getCollectionClipFramePreview,
    pauseClipsNotLive,
    preferredClipId,
    syncMediaElement,
  ]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(drawActiveFrame);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawActiveFrame]);

  /**
   * Apply (and release) `frameOverride` — the pane's own canvas drawing a frame
   * the clock is not on.
   *
   * Every video is paused for the duration. The override is a still: leaving
   * the previously active element running would have it advancing behind a
   * picture that is not it, which is the mistake the first version of this
   * feature made from the outside with an overlay.
   *
   * Releasing repaints from `currentTime` — unchanged throughout, because
   * nothing here writes it — so the pane lands back exactly where it was, with
   * whatever play state it actually has.
   */
  useEffect(() => {
    frameOverrideRef.current = frameOverride;

    if (frameOverride === null) {
      renderFrameAtTime(currentTimeRef.current, isPlayingRef.current, true);
      return;
    }

    // Always resolvable: the request carries its own `src`, so a source the
    // pane is not currently showing still draws. Matching a clip is an
    // optimisation (cache reuse), never a precondition — the earlier version
    // treated a lookup miss as "nothing to draw" and silently did nothing,
    // which is precisely what a path-qualified manifest id produced.
    const media = resolveOverrideMedia(sortedClipsRef.current, frameOverride);

    activeMediaRef.current = media;
    lastRenderedMediaKeyRef.current = media.key;
    activeClipDisabledRef.current = false;
    // NOTHING is live under an override — it owns the picture, and the layers
    // stop with it. An override is a still, so a bed left running underneath
    // would be sound advancing against a frame that is not moving.
    liveLayerMediaRef.current = [];
    pauseClipsNotLive(NO_LIVE_KEYS);
    ensureCachedMedia(media);
    // NOTE: no `syncMediaElement` here. The override's seeking is driven by the
    // settle loop below instead — see the comment there for why this path
    // cannot use the clock path's issue-and-listen approach.
  }, [
    ensureCachedMedia,
    frameOverride,
    pauseClipsNotLive,
    renderFrameAtTime,
  ]);

  /**
   * The override's seek loop: ONE IN-FLIGHT SEEK AT A TIME.
   *
   * The clock path issues a seek and listens for `seeked` to draw, cancelling
   * any pending listener when it issues the next one. That is fine when seeks
   * complete in milliseconds. It is not fine here, and the reason is specific:
   *
   * A trim drag asks for ~25 frames a second, and the browser's buffer window
   * FOLLOWS `currentTime` — so dragging the IN handle (near t=0) evicts the
   * end of the source, and the OUT handle is then genuinely cold again on the
   * very next gesture. A cold seek can take the better part of a second, and
   * every request that arrives while it is in flight cancelled the draw and
   * restarted it, so nothing landed until the pointer stopped. Symptom, as
   * reported: the right handle sticks for the whole drag, corrects on release,
   * behaves on a retry, and goes bad again after visiting the left handle.
   * Lowering the request rate (the first attempt) only made it rarer.
   *
   * So: seek only when the element is IDLE, and let a slow one finish. The
   * newest target is read from the ref each frame, so a drag that moves on
   * during a long seek simply lands on where it ended up, never on a stale
   * frame in between.
   *
   * A rAF loop rather than `seeked` bookkeeping, which is the same conclusion
   * `use-seeked-video` reached for the floating panel — it is self-healing: a
   * missed event, or a seek the browser coalesced, cannot strand a stale frame
   * because the next frame catches up. Keyed on WHETHER an override is active,
   * not on its value, so the loop is not torn down and rebuilt 25 times a
   * second.
   */
  const overrideActive = frameOverride !== null;
  useEffect(() => {
    if (!overrideActive) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const media = activeMediaRef.current;
      if (!media) return;
      const cached = cacheRef.current.get(media.key);
      if (!isPlayable(cached)) return;
      const video = cached.element;
      if (video.readyState < HTMLMediaElement.HAVE_METADATA || video.seeking) return;

      const maxTime = Number.isFinite(video.duration)
        ? Math.max(0, video.duration - 0.001)
        : media.sourceTime;
      const target = clamp(media.sourceTime, 0, maxTime);
      // `currentTime` reads back as the seek TARGET mid-seek, so this does not
      // re-issue while the browser is still decoding.
      if (Math.abs(video.currentTime - target) > 0.03) {
        try {
          video.currentTime = target;
        } catch {
          // Metadata raced away; the next frame retries.
        }
        return;
      }
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) drawActiveFrame();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [overrideActive, drawActiveFrame]);

  useEffect(() => {
    bufferedMedia.forEach((media) => {
      const cached = ensureCachedMedia(media);
      if (cached.kind === "image" && !cached.element.complete) {
        cached.element.addEventListener("load", drawActiveFrame, { once: true });
      }
    });
  }, [bufferedMedia, drawActiveFrame, ensureCachedMedia]);

  // Repaint on a new CLIP LIST as well as a new time. `renderFrameAtTime`
  // reads the clips through a ref (so playback doesn't re-create it every
  // frame), which means a caller that swaps the whole list — the graph view
  // drilling into another collection — left the canvas showing the previous
  // list's frame whenever the time didn't also change (it resets to 0, and
  // 0 → 0 is not a change). Consumers worked around that by remounting the
  // pane, throwing away the canvas, the media cache and the chosen height.
  // Depending on the sorted list makes the swap repaint itself.
  useEffect(() => {
    if (isPlayingRef.current) return;
    currentTimeRef.current = currentTime;
    renderFrameAtTime(currentTime, false, true);
  }, [currentTime, renderFrameAtTime, sortedClips]);

  const seekToClip = useCallback(
    (direction: -1 | 1) => {
      if (sortedClips.length === 0) return;

      const currentIndex = activeClipIndex === -1 ? 0 : activeClipIndex;
      const nextIndex =
        direction === -1 && activeClip && currentTime > getClipPlaybackStart(activeClip) + 0.25
          ? currentIndex
          : clamp(currentIndex + direction, 0, sortedClips.length - 1);
      const nextClip = sortedClips[nextIndex];
      if (!nextClip) return;

      const nextClipStart = getClipPlaybackStart(nextClip);
      currentTimeRef.current = nextClipStart;
      playbackAnchorRef.current = null;
      renderFrameAtTime(nextClipStart, false, true);
      onCurrentTimeChange(nextClipStart);
    },
    [activeClip, activeClipIndex, currentTime, onCurrentTimeChange, renderFrameAtTime, sortedClips],
  );

  /**
   * Jump to either END of the timeline, ignoring clip boundaries.
   *
   * Deliberately NOT expressed as "step until you run out of clips": that
   * lands on the last clip's START, which is not the end of the timeline, and
   * for a long final clip is nowhere near it.
   *
   * `duration` is a position the renderer already produces — reaching the end
   * during playback publishes exactly `durationRef.current` and draws that
   * frame (see the tick loop) — so seeking there is the same state the user
   * gets by letting it play out, not a new edge case.
   *
   * Same three lines as `seekToClip`, in the same order and for the same
   * reasons: drop the playback anchor so a running preview re-times from the
   * new position rather than snapping back, draw immediately, then publish.
   */
  const seekToEdge = useCallback(
    (edge: "start" | "end") => {
      if (sortedClips.length === 0) return;
      const target = edge === "start" ? 0 : duration;
      currentTimeRef.current = target;
      playbackAnchorRef.current = null;
      renderFrameAtTime(target, false, true);
      onCurrentTimeChange(target);
    },
    [duration, onCurrentTimeChange, renderFrameAtTime, sortedClips],
  );

  useEffect(() => {
    const cancelQueuedFrame = () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (timeoutFrameRef.current !== null) {
        window.clearTimeout(timeoutFrameRef.current);
        timeoutFrameRef.current = null;
      }
    };

    if (!isPlaying) {
      cancelQueuedFrame();
      playbackAnchorRef.current = null;
      renderFrameAtTime(currentTimeRef.current, false, true);
      return;
    }

    const clipsRef = sortedClipsRef;
    const startTime = nextPlayableTime(clipsRef.current, currentTimeRef.current, durationRef.current);
    currentTimeRef.current = startTime;
    playbackAnchorRef.current = {
      timelineTime: startTime,
      startedAtMs: performance.now(),
    };
    lastPublishedAtRef.current = 0;
    renderFrameAtTime(startTime, true, true);
    onCurrentTimeChange(startTime);

    const resetAnchor = (timelineTime: number, now: number) => {
      playbackAnchorRef.current = {
        timelineTime,
        startedAtMs: now,
      };
    };

    const publishTime = (timelineTime: number, now: number, force = false) => {
      if (!force && now - lastPublishedAtRef.current < 1000 / 30) return;
      lastPublishedAtRef.current = now;
      onCurrentTimeChange(timelineTime);
    };

    const queueNextFrame = () => {
      if (document.visibilityState === "hidden") {
        timeoutFrameRef.current = window.setTimeout(() => tick(performance.now()), 100);
        return;
      }

      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    const tick = (now: number) => {
      const anchor = playbackAnchorRef.current ?? {
        timelineTime: currentTimeRef.current,
        startedAtMs: now,
      };
      const rawTime = anchor.timelineTime + (now - anchor.startedAtMs) / 1000;
      const nextTime = nextPlayableTime(clipsRef.current, rawTime, durationRef.current);
      if (Math.abs(nextTime - rawTime) > 0.001) {
        resetAnchor(nextTime, now);
      }

      currentTimeRef.current = nextTime;
      renderFrameAtTime(nextTime, true);
      publishTime(nextTime, now);

      if (nextTime >= durationRef.current) {
        publishTime(durationRef.current, now, true);
        renderFrameAtTime(durationRef.current, false, true);
        setPlaying(false);
        return;
      }

      queueNextFrame();
    };

    const handleVisibilityChange = () => {
      cancelQueuedFrame();
      tick(performance.now());
    };

    window.addEventListener("visibilitychange", handleVisibilityChange);
    queueNextFrame();

    return () => {
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      cancelQueuedFrame();
    };
  }, [isPlaying, onCurrentTimeChange, renderFrameAtTime, setPlaying]);

  useEffect(() => {
    const mediaCache = cacheRef.current;
    return () => {
      mediaCache.forEach((cached) => {
        if (isPlayable(cached)) {
          cached.element.pause();
          cached.element.removeAttribute("src");
          cached.element.load();
        }
      });
      const pending = pendingSeekDrawCleanupRef.current;
      pending.forEach((cleanup) => cleanup());
      pending.clear();
      mediaCache.clear();
      mixerRef.current?.dispose();
      mixerRef.current = null;
    };
  }, []);

  // Master level lives on the mixer, but the ACTIVE source's own gain also
  // carries the mute (so a muted preview is silent even mid-clip). Re-apply
  // both whenever either changes.
  useEffect(() => {
    const mixer = getMixer();
    mixer.setMasterVolume(activeVolume);
    mixer.setMuted(activeMuted);

    // EVERY live source, not just the picture. A volume change that reached
    // only the active clip would leave a bed playing at the level it was
    // started with — audible proof that the two were on different paths.
    const raise = (key: string, silent: boolean) => {
      const cached = cacheRef.current.get(key);
      if (isPlayable(cached)) applyGain(cached.element, silent);
    };
    const activeKey = activeMediaRef.current?.key;
    if (activeKey) raise(activeKey, activeClipDisabledRef.current);
    for (const layer of liveLayerMediaRef.current) raise(layer.media.key, false);
  }, [activeMuted, activeVolume, applyGain, getMixer]);

  const canPlay = duration > 0 && sortedClips.length > 0;
  const canSeekPrevious = sortedClips.length > 0 && currentTime > 0;
  const canSeekNext = sortedClips.length > 0 && activeClipIndex < sortedClips.length - 1;
  // The EDGE pair asks a different question from the stepper pair above:
  // "is there anywhere left in that direction", not "is there another clip".
  // At the last clip's start `canSeekNext` is already false while the end of
  // the timeline is still seconds away, which is the gap these two close.
  const canSeekStart = sortedClips.length > 0 && currentTime > 0;
  const canSeekEnd = sortedClips.length > 0 && currentTime < duration;

  const isPointerOverPlaybackSurface = useCallback(
    (event: CanvasPointEvent) => {
      const playbackSurface = playbackSurfaceRectRef.current;
      if (!canPlay || !playbackSurface) return false;

      const canvasBounds = event.currentTarget.getBoundingClientRect();
      const pointerX = event.clientX - canvasBounds.left;
      const pointerY = event.clientY - canvasBounds.top;
      return (
        pointerX >= playbackSurface.left &&
        pointerX <= playbackSurface.left + playbackSurface.width &&
        pointerY >= playbackSurface.top &&
        pointerY <= playbackSurface.top + playbackSurface.height
      );
    },
    [canPlay],
  );

  return (
    <section
      aria-label="Workbench display surface"
      // BORDERLESS. The rounded corners, the near-black fill, and the shadow
      // already separate the preview from the page; the outline on top read as
      // a frame around a frame. Nothing else may move as it goes: the section's
      // own box is what the split pane sizes and what
      // `--workbench-preview-offset` is built from, so dropping the border
      // only gives the canvas inside its 1px back.
      className={cn(
        "relative flex min-h-0 flex-col overflow-visible rounded-lg bg-zinc-950 shadow-2xl",
        className,
      )}
      data-testid="workbench-display-surface"
      data-buffered-media-count={bufferedMedia.length}
      data-preview-playing={isPlaying}
      // How many UNDER-LAYERS are audible right now, alongside the picture.
      // A witness for the same reason as the audio ones below — that a bed is
      // sounding is not observable from a test — and the one that says the
      // preview and the export agree about what is playing.
      data-live-layer-count={liveLayers.length}
      // Which clip's frame the pane is drawing INSTEAD of the clock's, if any.
      // A witness, because the alternative is unobservable: whether a canvas
      // holds one decoded frame or another is not something a test can read
      // back, and the e2e fixture's "video" is a 1x1 GIF that never decodes at
      // all. This at least pins that the request reached the pane.
      data-frame-override={frameOverride ? frameOverride.src : undefined}
      // Audio witnesses, for the same reason as the frame override above and
      // more so: SOUND is not observable from a test at all, and the fixture's
      // 1x1 GIF has no audio track to make. These pin the state the mixer was
      // driven with, which is the part worth regressing on.
      data-preview-muted={activeMuted}
      data-preview-volume={activeVolume}
      data-preview-audio-blocked={audioBlocked || undefined}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[inherit] bg-black">
        <canvas
          ref={canvasRef}
          className={cn(
            "block h-full w-full bg-black",
            previewHovered ? "cursor-pointer" : "cursor-default",
          )}
          role="img"
          aria-label={activeMedia ? `${activeMedia.clipTitle} preview` : "Empty workbench preview"}
          data-testid="workbench-display-canvas"
          data-preview-playback-shortcut={canPlay}
          onPointerEnter={(event) => {
            setPreviewHovered(isPointerOverPlaybackSurface(event));
          }}
          onPointerMove={(event) => {
            const nextHovered = isPointerOverPlaybackSurface(event);
            setPreviewHovered((wasHovered) =>
              wasHovered === nextHovered ? wasHovered : nextHovered,
            );
          }}
          onPointerLeave={() => setPreviewHovered(false)}
          onClick={(event) => {
            if (isPointerOverPlaybackSurface(event)) setPlaying(!isPlaying);
          }}
        />
        <WorkbenchAudioControls
          volume={activeVolume}
          muted={activeMuted}
          audioBlocked={audioBlocked}
          onToggleMuted={() => {
            // This click IS a user gesture — resume the context on it.
            void getMixer().resume();
            // Unmuting from a zeroed slider must actually be audible, or the
            // control appears to do nothing.
            if (activeMuted && activeVolume <= 0) setVolume(1);
            setMuted(!activeMuted);
          }}
          onVolumeChange={(next) => {
            void getMixer().resume();
            setVolume(next);
            // Dragging the slider up is an unmute in every player people know.
            if (next > 0 && activeMuted) setMuted(false);
          }}
        />
        {/* Names what the grayed frame means. Only ever visible while
            SCRUBBING — playing jumps the span, so the clock never rests here.
            Top-LEFT: the close button owns the right corner. */}
        {activeClip?.disabled === true && (
          <span
            className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] leading-none font-semibold tracking-[0.08em] text-blue-400 ring-1 ring-blue-500/40"
            data-testid="workbench-display-disabled"
          >
            DISABLED
          </span>
        )}
        {/* Second way out of the preview, next to the sidebar's toggle. Pinned
            to the canvas's far-right corner, which is LETTERBOX: the frame is
            drawn centred at `min` scale, so this sits in the black gutter
            rather than over the picture. */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-2 z-10 grid size-7 place-items-center rounded-full border border-zinc-800 bg-zinc-900/80 text-zinc-400 backdrop-blur-sm transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 focus-visible:outline-offset-2"
            aria-label="Close preview"
            title="Close preview"
            data-testid="workbench-preview-close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <WorkbenchDividerTransport
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        canPlay={canPlay}
        canSeekPrevious={canSeekPrevious}
        canSeekNext={canSeekNext}
        canSeekStart={canSeekStart}
        canSeekEnd={canSeekEnd}
        previewHovered={canPlay && previewHovered}
        onTogglePlaying={() => {
          // This click IS the user gesture the AudioContext has been waiting
          // for, so resume before play() rather than after it is refused.
          void getMixer().resume();
          setPlaying(!isPlaying);
        }}
        onSeekPrevious={() => seekToClip(-1)}
        onSeekNext={() => seekToClip(1)}
        onSeekStart={() => seekToEdge("start")}
        onSeekEnd={() => seekToEdge("end")}
      />
    </section>
  );
}

type WorkbenchSplitPaneProps = {
  /**
   * Upper-pane content. Pass `null` to close it while keeping the lower pane
   * mounted, preserving stateful content such as a virtual strip's scroll.
   */
  surface: ReactNode | null;
  /**
   * Content pinned ABOVE the upper pane — a consumer's toolbar or breadcrumb
   * row. The pane measures it and pins `surface` beneath it, so the two form
   * one sticky stack in that order.
   *
   * A SLOT rather than a CSS variable the consumer publishes. The offset has
   * to travel from whatever sits on top down to the surface, and a variable
   * would mean this package reading something an app defines — the dependency
   * pointing the wrong way. Owning the stack keeps the knowledge here: the
   * pane needs only "something occupies the top", never what it is.
   */
  header?: ReactNode;
  children: ReactNode;
  /** Read ONCE at mount for a height carried over from a previous mount (e.g.
   *  the consumer toggled this pane off and back on). Returning a number makes
   *  the pane start there and SKIP the one-time fit — a height the user chose
   *  outranks the automatic one. A getter, not a value, so the consumer can
   *  keep it in a ref instead of re-rendering on every drag frame. */
  getInitialSurfaceHeight?: () => number | undefined;
  /** Fires whenever the surface height changes, so a consumer can remember it
   *  across unmounts. Store it in a ref: this fires per pointer move during a
   *  divider drag. */
  onSurfaceHeightChange?: (height: number) => void;
  /**
   * How the preview is uncovered and covered again.
   *
   * The DURATION and the EASING travel together, and the duration is a number
   * rather than CSS, because the close is also a timer: the pane has to stay
   * mounted for exactly as long as the slide takes. Split across a prop and a
   * stylesheet they would drift, and the failure is a pane that unmounts
   * mid-animation — or lingers invisibly afterwards, still holding a video.
   *
   * The default is a whisper of overshoot. Curves that overshoot are read as
   * physical rather than as animated, and the pane weighs nothing, so it takes
   * very little; the point is to look released rather than driven.
   */
  reveal?: RevealMotion;
};

export type RevealMotion = Readonly<{ durationMs: number; easing: string }>;

/**
 * Whether the preview is open AND has finished opening.
 *
 * EXISTS SO CONSUMER CONTENT CAN GET OUT OF THE WAY OF THE SLIDE. A height
 * animation is main-thread work, so anything that renders or repaints while it
 * runs competes with it directly — and the things that want to appear when the
 * preview opens are exactly the things that appear WHILE it is opening. Rails
 * over the board, a scrub bar, anything keyed off "preview is on": each one is
 * a paint landing in the middle of the movement, and it reads as the board
 * flickering under a pane that is still travelling.
 *
 * Waiting costs nothing that matters. These are controls for a pane you cannot
 * use yet.
 */
const PreviewSettledContext = createContext(false);

/** True once the preview is open and no longer moving. False while it slides,
 *  and false whenever it is shut. */
export function usePreviewSettled(): boolean {
  return useContext(PreviewSettledContext);
}

/**
 * Away from rest, along, and a small settle past the mark.
 *
 * IT STARTS FROM STANDING, which is the whole correction here. The obvious
 * choice for a reveal is an "out" curve — fast then slow — and every one of
 * them has its highest velocity at t=0. Measured, the old one moved the board
 * 74 PIXELS IN ITS FIRST FRAME: seventeen percent of the distance in five
 * percent of the time, from a dead stop. That is not an ease, it is a jump
 * with a decelerating tail, and it read as exactly the lurch it was.
 *
 * A zero-slope first control point (`0.45, 0`) means the first frame moves a
 * pixel or two and the speed builds, so the eye catches the movement starting
 * instead of finding it already underway. The second (`0.55, 1.15`) carries
 * the overshoot: past the mark and back, about 15% over at the peak, which on
 * a pane a few hundred pixels tall is enough to read as weight arriving
 * without looking like a bounce.
 */
/** A frame at or under this arrived on time — the thread is keeping up. */
const FRAME_BUDGET_MS = 22;
/** How many on-time frames in a row count as settled. One is not enough: a
 *  single good frame happens in the gap between two long tasks. */
const CALM_FRAMES = 2;
/**
 * Slide anyway once this long has passed.
 *
 * A DEADLINE IN MILLISECONDS, not a frame count, and the difference is not
 * academic: the whole reason this waits is that frames are running slow, so a
 * cap counted in frames stretches exactly when it most needs to hold. Twenty
 * frames is 330ms on an idle machine and several seconds on a busy one — which
 * is a preview that appears to hang under load, and a test suite that fails
 * only when run alongside everything else.
 */
const MAX_SETTLE_MS = 250;

export const REVEAL_SETTLE: RevealMotion = {
  durationMs: 380,
  easing: "cubic-bezier(0.45, 0, 0.55, 1.15)",
};

/**
 * A damped spring: over, back, over, settle.
 *
 * Needs `linear()` rather than a bezier, which has exactly one hump — an
 * oscillation is several, so it is spelled out as points along the curve.
 * Longer than the settle, because a spring that resolves in a third of a
 * second reads as a glitch rather than as elasticity.
 */
export const REVEAL_ELASTIC: RevealMotion = {
  durationMs: 620,
  // Re-shaped for the same reason as the settle: the first version put 13% of
  // the travel into the opening 3%, which is a spring that has already been
  // released before you see it. A real one accelerates out of rest, so the
  // opening tenth barely moves and the oscillation comes after.
  easing:
    "linear(0, 0.01 4%, 0.07 10%, 0.28 18%, 0.58 26%, 0.86 34%, 1.05 42%, 1.09 48%, 1.04 56%, 0.99 64%, 0.98 74%, 1.0 88%, 1)",
};

export function WorkbenchSplitPane({
  surface,
  header,
  children,
  getInitialSurfaceHeight,
  onSurfaceHeightChange,
  reveal = REVEAL_SETTLE,
}: WorkbenchSplitPaneProps) {
  const hasSurface = surface !== null;
  const headerRef = useRef<HTMLDivElement | null>(null);
  // MEASURED, not assumed. The header's height is whatever the consumer put
  // there — it wraps on a narrow viewport, and it swaps between rows of
  // different heights — so the surface's pin has to follow it live rather
  // than sit at a constant somebody has to remember to update.
  const [headerHeight, setHeaderHeight] = useState(0);
  // Read once, at mount. `undefined` means nothing to restore → fit instead.
  const [restoredSurfaceHeight] = useState(() => getInitialSurfaceHeight?.());
  const [surfaceHeight, setSurfaceHeight] = useState(
    () => restoredSurfaceHeight ?? DEFAULT_SURFACE_HEIGHT,
  );
  const [isDividerDragging, setIsDividerDragging] = useState(false);
  // False until the opening height has been measured AND painted (see the
  // double-rAF below), so the pane appears at its size instead of animating
  // into it.
  const [heightAnimated, setHeightAnimated] = useState(false);
  // THE REVEAL. Opening and closing the preview used to be a mount and an
  // unmount: the pane appeared at full size and everything below it jumped
  // down by that much in one frame. It reads as the page reflowing, which is
  // what it was.
  //
  // The shape it has now is a LID, not a drawer. The pane does not move; the
  // board slides down off it and the pane is uncovered from the top, which is
  // the one arrangement that looks like it was already sitting there. Done by
  // animating this region's height with its contents clipped and pinned to the
  // top — the surface keeps its real height throughout, so nothing inside is
  // ever squashed mid-reveal, which would give away that it is being built as
  // it appears.
  //
  // THREE PIECES OF STATE, not one, because "should it be open" and "is it on
  // screen" stop agreeing the moment closing takes time. `mounted` outlives
  // `hasSurface` for the length of the close; `revealed` is what the height
  // follows; `sliding` says a transition is in flight and is what turns on the
  // clipping (the region is `overflow-visible` at rest ON PURPOSE — the seek
  // thumb's overhang depends on it, so clipping is borrowed for the animation
  // and given straight back).
  const [mounted, setMounted] = useState(hasSurface);
  const [revealed, setRevealed] = useState(hasSurface);
  const [sliding, setSliding] = useState(false);
  // THE CHROME ARRIVES AFTER THE PICTURE. The divider and the transport are
  // controls for a thing that is not there yet while the pane is still opening
  // — drawing them mid-slide puts a play button on a two-inch sliver of video
  // — so they fade in once it has finished. Not a fade OUT on the way back:
  // they ride the close down still visible, which reads as the board covering
  // them rather than as two separate departures.
  const [chromeIn, setChromeIn] = useState(hasSurface);
  // Whether the pane was ALREADY open the last time this settled. A pane that
  // is open at first paint has nothing to fade in from, and hiding its chrome
  // in the mount effect only to bring it back is a flash.
  const wasOpenRef = useRef(hasSurface);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Depended on as a NUMBER, not as the object: a consumer passing an inline
  // `{durationMs, easing}` would otherwise restart the reveal on every render.
  const revealMs = reveal.durationMs;
  // WHAT THE CLOSE SLIDES OVER. The consumer drops `surface` to null the
  // instant the preview is switched off, so without this the region would
  // spend the close animating an EMPTY box shut — a blank gap collapsing,
  // which is not the pane being covered by anything. The last one rendered is
  // held for the length of the slide: frozen (it stops receiving props) and
  // unmounted the moment the region reaches zero, which is also what finally
  // stops its video.
  const lastSurfaceRef = useRef<React.ReactNode>(null);
  useEffect(() => {
    if (surface !== null) lastSurfaceRef.current = surface;
  }, [surface]);
  const shownSurface = surface ?? (mounted ? lastSurfaceRef.current : null);
  // Open, and no longer moving. `sliding` covers both directions, so this is
  // false for the whole of a close as well — nothing should be painting itself
  // into a pane on its way out either.
  const settled = mounted && revealed && !sliding;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dividerRef = useRef<HTMLButtonElement | null>(null);
  const lowerPaneRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ pointerY: number; height: number } | null>(null);
  const clampFrameRef = useRef<number | null>(null);
  const didInitialSizeRef = useRef(false);

  // LAYOUT effect, so the surface is pinned at the right offset in the same
  // frame the header first paints — measuring in a passive effect showed the
  // surface at top 0 for a frame and then jumped it down.
  useLayoutEffect(() => {
    const element = headerRef.current;
    if (!element) {
      setHeaderHeight(0);
      return;
    }
    const measure = () => setHeaderHeight(element.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [header]);

  const getViewportBoundaryBottom = useCallback(() => {
    const root = rootRef.current;
    const boundary = root?.closest("main") as HTMLElement | null;
    const boundaryBottom = boundary?.getBoundingClientRect().bottom ?? window.innerHeight;
    const drawerHeight = Number.parseFloat(
      window
        .getComputedStyle(document.documentElement)
        .getPropertyValue("--asset-library-height"),
    );
    const visibleViewportBottom =
      window.innerHeight - (Number.isFinite(drawerHeight) ? drawerHeight : 0);

    // A document-sized <main> can extend far below the viewport. Sticky
    // sizing must use the part that is visible now, while a genuinely
    // shorter embedding boundary should still win.
    return Math.min(boundaryBottom, visibleViewportBottom);
  }, []);

  const getManualMaxSurfaceHeight = useCallback(() => {
    if (typeof window === "undefined") {
      return DEFAULT_SURFACE_HEIGHT;
    }

    const root = rootRef.current;
    // Once the surface is stuck, its effective top is zero even though the
    // split-pane root continues moving above the viewport.
    const rootTop = Math.max(0, root?.getBoundingClientRect().top ?? 0);
    return Math.max(
      MIN_SURFACE_HEIGHT,
      getViewportBoundaryBottom() - rootTop - MIN_TIMELINE_SPACE,
    );
  }, [getViewportBoundaryBottom]);

  const clampSurfaceHeight = useCallback((height: number, maxHeight?: number) => {
    if (typeof window === "undefined") {
      return clamp(height, MIN_SURFACE_HEIGHT, DEFAULT_SURFACE_HEIGHT);
    }

    const maxFromViewport =
      maxHeight ?? getManualMaxSurfaceHeight();
    return clamp(height, MIN_SURFACE_HEIGHT, maxFromViewport);
  }, [getManualMaxSurfaceHeight]);

  /**
   * The height the surface OPENS at: a flat third of the viewport.
   *
   * This deliberately replaces a measure-and-fill pass that took whatever
   * space the lower pane left over. That produced a surface whose opening
   * size depended on how much content happened to be below it — a tall
   * timeline opened a squashed preview, a nearly empty one opened a giant
   * preview, and neither proportion was one anybody chose. A fixed fraction
   * is predictable, and the moment the user drags the divider their height
   * takes over for good (see the restore path in the mount effect).
   */
  const initialSurfaceHeight = useCallback(() => {
    if (dragStartRef.current) return;
    if (typeof window === "undefined") return;

    const divider = dividerRef.current;
    if (!divider) return;

    const dividerHeight = divider.getBoundingClientRect().height;
    // A third of what the user can actually SEE, not of a <main> that may
    // run far below the fold — getViewportBoundaryBottom already resolves
    // that, and measuring from the root's top keeps the fraction honest
    // when the board sits below other chrome.
    const rootTop = Math.max(0, rootRef.current?.getBoundingClientRect().top ?? 0);
    const availableHeight = getViewportBoundaryBottom() - rootTop;
    const maxSurfaceHeight = Math.max(MIN_SURFACE_HEIGHT, availableHeight - dividerHeight);
    const nextHeight = clampSurfaceHeight(availableHeight / 3, maxSurfaceHeight);

    setSurfaceHeight((height) =>
      Math.abs(height - nextHeight) < 0.5 ? height : nextHeight,
    );
  }, [clampSurfaceHeight, getViewportBoundaryBottom]);

  /** Keep the current height LEGAL for the viewport without re-deriving it —
   *  a shrinking window may force it down, nothing else does. */
  const clampToViewport = useCallback(() => {
    if (dragStartRef.current) return;
    setSurfaceHeight((height) => {
      const next = clampSurfaceHeight(height);
      return Math.abs(height - next) < 0.5 ? height : next;
    });
  }, [clampSurfaceHeight]);

  // A REF, not the state, so `scheduleClamp` keeps its identity — it is the
  // ResizeObserver's callback, and a new one every render would tear the
  // observer down and rebuild it on every frame of the very animation this
  // exists to stay out of.
  const slidingRef = useRef(false);

  const scheduleClamp = useCallback(() => {
    // NOT WHILE THE PANE IS SLIDING, because the pane is what is resizing the
    // boundary. The observer watches `<main>`, the reveal grows `<main>`, and
    // so the animation triggers this on nearly every one of its own frames —
    // measured at ten times across a 366ms slide, each one a forced
    // synchronous layout (`getBoundingClientRect` plus a read of a computed
    // custom property) followed by a `setState`. A self-inflicted render loop
    // running against the animation that caused it.
    //
    // Nothing is lost. This question is "has the VIEWPORT shrunk under us",
    // and the height being animated toward was already clamped when it was
    // chosen; a viewport that genuinely changes mid-slide is caught by the
    // clamp fired when the slide ends.
    if (slidingRef.current) return;
    if (clampFrameRef.current !== null || typeof window === "undefined") return;

    clampFrameRef.current = window.requestAnimationFrame(() => {
      clampFrameRef.current = null;
      clampToViewport();
    });
  }, [clampToViewport]);

  // Declared AFTER `scheduleClamp` so it can call it directly rather than
  // through a ref — the flag it maintains is read by that callback, but only
  // when the callback runs, so the order between them does not matter.
  useEffect(() => {
    const wasSliding = slidingRef.current;
    slidingRef.current = sliding;
    // ONE CLAMP ON THE WAY OUT. Skipping them during the slide means a window
    // resized mid-animation would otherwise leave the pane at an illegal
    // height until something else happened to ask.
    if (wasSliding && !sliding) scheduleClamp();
  }, [sliding, scheduleClamp]);

  // Arm the height transition only once the opening size has been painted.
  // The sizing pass below runs in a layout effect and its inputs (the
  // divider's box, the viewport boundary, the asset-drawer variable) settle
  // over the first frames, so the height can land a frame or two after the
  // first paint — late enough for the browser to have a before-change style
  // and animate the difference. Two frames is "after the next paint" without
  // guessing at a duration.
  useEffect(() => {
    if (!hasSurface) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setHeightAnimated(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [hasSurface]);

  /**
   * Drive the reveal from `hasSurface`.
   *
   * OPENING TAKES TWO FRAMES, and it is the same reason the height transition
   * above is armed on a double rAF: a height animates only if the browser had
   * a BEFORE style to animate from, and an element mounted and sized in one
   * commit never had one — it would simply appear at full height, which is the
   * behaviour being replaced. So it mounts closed, gets painted closed, and
   * only then is told to open.
   *
   * BOTH ENDS ARE TIMED RATHER THAN LISTENED FOR. `transitionend` does not
   * fire for a transition that never runs, and this one does not run whenever
   * the user has asked for reduced motion or the tab is in the background.
   * Waiting on it would strand a close at zero height forever — mounted,
   * invisible, still holding a video element — and strand an open with the
   * borrowed clipping never given back, which would quietly cut off the seek
   * thumb's overhang for the rest of the session. A timer always fires.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const clearCloseTimer = () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };

    if (hasSurface) {
      clearCloseTimer();
      setMounted(true);
      if (!wasOpenRef.current) setChromeIn(false);
      wasOpenRef.current = true;

      // WAIT FOR THE SURFACE TO SETTLE BEFORE SLIDING, because a height
      // animation runs on the MAIN THREAD — every frame of it needs layout —
      // so anything blocking that thread stalls the animation itself rather
      // than merely running beside it.
      //
      // Measured, at true wall-clock speed, this is not a subtle effect. The
      // click costs a 71ms long task (React mounting the surface), and the
      // posters and audio start loading 72-95ms later; the slide's own frame
      // gaps then came in at 6.6, 14.7, 82.6, 42.9, 44.5ms before settling to
      // a clean 16.6 for the rest. Across those three blocked frames the pane
      // leapt 85, 62 and 107 pixels — 253 of its 424 — which is precisely the
      // "hesitant then stuttery at the beginning" being reported. The back
      // half was always smooth, which is why it reads as a start-up problem.
      //
      // So: mount at zero height, let the expensive work happen where nothing
      // is moving, and start the slide once frames are arriving on time. TWO
      // consecutive good frames, not one — a single one lands in the gaps
      // between long tasks and starts the animation straight into the next.
      //
      // CAPPED, or a page that never goes quiet would never open its preview.
      // Past the cap it slides anyway and takes the jank, which is what it did
      // before this existed.
      let raf = 0;
      const startedAt = performance.now();
      let previous = startedAt;
      let calm = 0;
      let waited = 0;
      const startWhenSettled = (now: number) => {
        const delta = now - previous;
        previous = now;
        waited += 1;
        calm = delta <= FRAME_BUDGET_MS ? calm + 1 : 0;
        // AND THE PICTURE HAS TO BE DECODED. Calm frames alone left one hitch
        // roughly 60ms into the slide, every time, which is the video handing
        // its first frame to the compositor — work that happens off-thread and
        // then commits, so no amount of watching frame timings anticipates it.
        // Waiting for `HAVE_CURRENT_DATA` waits for the actual event.
        //
        // Reaching into the subtree for `video` is a liberty for a component
        // this generic, and it is taken deliberately: this pane exists to show
        // video, the cost is one querySelectorAll per frame for a handful of
        // frames, and the alternative is a readiness protocol threaded through
        // a `surface` prop that every consumer would have to implement.
        const undecoded = Array.from(
          rootRef.current?.querySelectorAll("video") ?? [],
        ).some((video) => video.readyState < 2 && video.currentSrc !== "");
        if (undecoded) calm = 0;
        // `waited > 1` so there is always at least one painted frame at zero
        // height for the transition to animate FROM.
        if (waited > 1 && (calm >= CALM_FRAMES || now - startedAt >= MAX_SETTLE_MS)) {
          setSliding(true);
          setRevealed(true);
          closeTimerRef.current = setTimeout(() => {
            closeTimerRef.current = null;
            setSliding(false);
            setChromeIn(true);
          }, revealMs);
          return;
        }
        raf = requestAnimationFrame(startWhenSettled);
      };
      raf = requestAnimationFrame(startWhenSettled);

      return () => {
        cancelAnimationFrame(raf);
        clearCloseTimer();
      };
    }

    setSliding(true);
    setRevealed(false);
    wasOpenRef.current = false;
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setMounted(false);
      setSliding(false);
    }, revealMs);
    return clearCloseTimer;
  }, [hasSurface, revealMs]);

  useLayoutEffect(() => {
    // Size ONCE, when the surface first opens. The split pane itself may have
    // mounted earlier with only its lower pane so that the lower content keeps
    // its DOM identity and scroll position across this toggle.
    if (hasSurface && !didInitialSizeRef.current) {
      didInitialSizeRef.current = true;
      if (restoredSurfaceHeight !== undefined) clampToViewport();
      else initialSurfaceHeight();
    }

    const root = rootRef.current;
    const boundary = root?.closest("main") as HTMLElement | null;
    // Observe the viewport boundary ONLY, and only to clamp. Watching the
    // lower pane here is what used to shrink the surface whenever the content
    // below it grew — expanding a sub-graph folder stole preview height.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleClamp);
    if (observer && boundary) observer.observe(boundary);

    window.addEventListener("resize", scheduleClamp);
    window.visualViewport?.addEventListener("resize", scheduleClamp);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", scheduleClamp);
      window.visualViewport?.removeEventListener("resize", scheduleClamp);
      if (clampFrameRef.current !== null) {
        window.cancelAnimationFrame(clampFrameRef.current);
        clampFrameRef.current = null;
      }
    };
  }, [
    initialSurfaceHeight,
    clampToViewport,
    scheduleClamp,
    restoredSurfaceHeight,
    hasSurface,
  ]);

  // Report the height so a consumer can restore it after an unmount.
  useEffect(() => {
    onSurfaceHeightChange?.(surfaceHeight);
  }, [surfaceHeight, onSurfaceHeightChange]);

  const handleDividerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDividerDragging(true);
      dragStartRef.current = {
        pointerY: event.clientY,
        height: surfaceHeight,
      };
    },
    [surfaceHeight],
  );

  const handleDividerPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const dragStart = dragStartRef.current;
      if (!dragStart) return;

      const nextHeight = dragStart.height + event.clientY - dragStart.pointerY;
      setSurfaceHeight(clampSurfaceHeight(nextHeight));
    },
    [clampSurfaceHeight],
  );

  const handleDividerPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    dragStartRef.current = null;
    setIsDividerDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <div
      ref={rootRef}
      // minmax(0,1fr): a bare auto track sizes to its items' MIN-CONTENT,
      // and a virtualized child timeline (whose scroll container reports its
      // full content width there) would blow the track — and the preview
      // surface with it — past the viewport. Capping the track keeps both
      // panes at the container's width; children overflow-scroll inside it.
      className="grid min-h-0 w-full grid-cols-[minmax(0,1fr)] gap-0"
      data-testid="workbench-split-pane"
      // The same fact as the context, for consumers that only need CSS — a
      // padding that should appear with the rails rather than with the click,
      // say, which is a class name and not a render.
      data-preview-settled={settled ? "" : undefined}
      // How far down the WHOLE sticky stack reaches — header, surface and
      // divider — published so a descendant wanting to pin below all of it has
      // a live offset as the divider resizes. The split pane remains mounted
      // while closed, so the surface's share is an explicit zero then; the
      // header's is not conditional, because a header pins whether or not the
      // upper pane is open.
      style={
        {
          "--workbench-preview-offset": `${
            headerHeight + (hasSurface ? surfaceHeight + DIVIDER_HEIGHT_PX : 0)
          }px`,
          // PUBLISHED ON THE ROOT, not on the region, so that consumer content
          // can move with the reveal instead of beside it. Anything inside the
          // pane can now spend the same duration and the same curve, which is
          // the difference between one motion and two that happen to overlap.
          "--workbench-reveal-ms": `${revealMs}ms`,
          "--workbench-reveal-ease": reveal.easing,
        } as React.CSSProperties
      }
    >
      {header === undefined ? null : (
        <div
          ref={headerRef}
          // TOP of the stack, so z-50 — above the surface's z-40, which is
          // itself above the strip's z-30 playhead overlay. Getting this
          // wrong is not subtle: at a lower index a marker in the timeline
          // scrolling underneath paints straight through the header.
          className="sticky top-0 z-50 min-w-0 bg-zinc-950"
          data-testid="workbench-header-region"
        >
          {header}
        </div>
      )}
      {mounted ? (
        <div
        // z-40 (above the strip's z-30 consumer overlay) so a playhead marker
        // in a timeline scrolling underneath is occluded by the sticky
        // preview, not painted over it. At z-30 the marker tied the preview
        // and, being later in the DOM, bled through into the preview area.
        //
        // Pinned BENEATH the header rather than at 0 — the two are one stack,
        // and the offset is measured because the header's height is the
        // consumer's business, not a constant this file can know.
        data-preview-revealed={revealed ? "" : undefined}
        // Read by the divider below and by the transport inside `surface`,
        // which this cannot reach with a prop — it is a node the consumer
        // passed in. A data attribute on their common ancestor is the seam
        // that does reach both.
        data-preview-chrome={chromeIn ? "in" : "out"}
        className={cn(
          "sticky z-40 min-w-0 bg-zinc-950",
          // CLIPPED ONLY WHILE SLIDING. At rest this must be
          // `overflow-visible` — the seek thumb deliberately hangs outside the
          // pane and the masks below depend on it — but a reveal IS a clip, so
          // it is borrowed for the length of the slide and handed straight
          // back on `transitionend`.
          sliding ? "overflow-hidden" : "overflow-visible",
          // Transitioned while SLIDING (the reveal) and for later height
          // changes (a shrinking viewport clamping the pane) — but never
          // during a divider drag, which must track the pointer exactly. The
          // condition mirrors the inner height's below on purpose: if only one
          // of the two animated, the pane and the board beneath it would
          // disagree about where the bottom edge is for the length of it.
          (sliding || (heightAnimated && !isDividerDragging)) &&
            // Duration and easing arrive as CUSTOM PROPERTIES rather than as
            // inline transition styles so `motion-reduce:transition-none`
            // still wins — an inline `transition` would outrank the class and
            // quietly animate for someone who asked for no animation.
            "transition-[height] duration-[var(--workbench-reveal-ms)] ease-[var(--workbench-reveal-ease)] motion-reduce:transition-none",
        )}
        style={{
          top: headerHeight,
          // ZERO TO FULL. The contents keep their real size inside this and
          // are pinned to its top, so what changes is how much of them shows
          // — the pane is uncovered rather than grown, and everything below
          // slides down off it.
          // ROUNDED. `surfaceHeight` is a float — a third of a measured
          // viewport — and this box is `sticky`, so a fractional height makes
          // the browser re-resolve the stuck position against a subpixel edge
          // on every frame of the slide while the content below it moves. That
          // is the judder: not the animation stuttering, the sticky element
          // disagreeing with itself about where its own bottom is.
          height: revealed
            ? `${Math.round(Math.max(surfaceHeight, MIN_SURFACE_HEIGHT)) + DIVIDER_HEIGHT_PX}px`
            : "0px",
        }}
        data-testid="workbench-preview-region"
      >
        {/* A seek thumb is intentionally centered on the timeline edge, so
            half of it sits outside the split pane. These narrow side masks
            hide that overhang only while it passes BEHIND the sticky preview.
            Clipping the split pane itself also cut the thumb off after it
            scrolled below the preview, where it should be fully visible. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-full w-2 bg-zinc-950"
          data-preview-edge-occluder="start"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-full w-2 bg-zinc-950"
          data-preview-edge-occluder="end"
        />
        <div
          className={cn(
            "min-h-0",
            // The transition is for LATER height changes (a shrinking
            // viewport clamping the pane). It must not run against the
            // mount-time sizing pass, which starts from a placeholder height
            // and measures the real one — that played as a visible shrink
            // every first open, and only the first, since a reopen restores
            // the remembered height and never re-measures.
            // AND NOT WHILE THE REVEAL IS RUNNING. The outer region is
            // already animating between zero and this pane's full height; if
            // this one animates too, two nested height transitions run at once
            // over the same pixels — the outer uncovering the pane while the
            // pane itself grows inside it, each on its own curve. On the first
            // open the inner one has somewhere to go, because the opening size
            // is measured in those same frames, and the result is the pane
            // appearing to fight its own reveal. It has no business moving
            // here: the reveal's whole premise is that what is inside stays
            // still and gets uncovered.
            heightAnimated &&
              !isDividerDragging &&
              !sliding &&
              "transition-[height] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          )}
          style={{
            height: `${surfaceHeight}px`,
            minHeight: `${MIN_SURFACE_HEIGHT}px`,
          }}
          >
            {shownSurface}
          </div>
        <button
          ref={dividerRef}
          type="button"
          role="separator"
          aria-orientation="horizontal"
          aria-valuemin={MIN_SURFACE_HEIGHT}
          aria-valuenow={Math.round(surfaceHeight)}
          aria-label="Resize workbench display"
          // h-11 = DIVIDER_HEIGHT_PX: the whole box is the drag target, and it
          // stays this height at every breakpoint. The visible band inside is
          // smaller and centered, so the space either side of it reads as the
          // gap between the preview and the timeline without being separate
          // padding on each.
          className="group relative block h-11 w-full cursor-row-resize bg-transparent transition-opacity duration-300 ease-out [[data-preview-chrome='out']_&]:opacity-0 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 focus-visible:outline-offset-2"
          data-workbench-divider
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={handleDividerPointerUp}
          onPointerCancel={handleDividerPointerUp}
        >
          {/* The band fades out across the transport group so no divider
              colour shows behind its background-free icons.

              THE WINDOW IS HALF THE GROUP'S WIDTH, and the numbers below are
              that and nothing else: the group is `w-[13.75rem]`, so the clear
              span reaches 6.875rem either side of centre and the fade adds
              2rem beyond it. When the group was three buttons those numbers
              were 4.125rem and 6.125rem — half of 8.25rem, the same rule.
              Adding the two outer buttons widened the group to five wells and
              left the window at three, so the jump-to-start and jump-to-end
              glyphs sat in the fade with the line still running under them.
              Kept in step by hand, because a CSS gradient cannot read the
              sibling's width; if the count changes again, both numbers move.

              CENTERED on DIVIDER_BAND_CENTER_PX rather than sized from the
              box's top: 8px at desktop, and 12px below `md`, where it has to
              stay tall enough to hold the grip icon. Because both heights
              share one mid-line, the transport that rides on it never moves. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 h-3 rounded-sm bg-[linear-gradient(to_right,currentColor_0,currentColor_calc(50%_-_8.875rem),transparent_calc(50%_-_6.875rem),transparent_calc(50%_+_6.875rem),currentColor_calc(50%_+_8.875rem),currentColor_100%)] text-zinc-800 transition-colors group-hover:text-zinc-700 group-active:text-zinc-600 md:h-2"
            style={{ top: DIVIDER_BAND_CENTER_PX, transform: "translateY(-50%)" }}
            data-divider-line
          />
          {/* Coarse-pointer devices never see the hover brighten, so at tablet
              width and below the band carries a standing grip instead. At the
              band's far LEFT: the centre belongs to the transport and the right
              end to the time readout, whose opaque pill can span half the
              width — anything placed there is simply painted over. */}
          <span
            aria-hidden="true"
            data-divider-grip
            className="pointer-events-none absolute left-2 text-zinc-500 md:hidden"
            style={{ top: DIVIDER_BAND_CENTER_PX, transform: "translateY(-50%)" }}
          >
            <GripHorizontal className="h-3 w-3" strokeWidth={2.5} />
          </span>
        </button>
        </div>
      ) : null}
      {/* Keep every lower-pane layer in one z-0 stacking context. Virtual
          strips intentionally use z-50 for local overlays; without this
          boundary those later layers could cover the transport where it
          grows below the divider. */}
      <div
        ref={lowerPaneRef}
        className="relative z-0 min-h-0 isolate"
        data-testid="workbench-lower-pane"
      >
        <PreviewSettledContext.Provider value={settled}>{children}</PreviewSettledContext.Provider>
      </div>
    </div>
  );
}
