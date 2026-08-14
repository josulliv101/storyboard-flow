"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Check,
  CornerRightDown,
  Image as ImageIcon,
  Layers,
  Music,
  Video,
} from "lucide-react";

import {
  CollectionItem,
  NodeCard,
  mediaDurationSeconds,
  useCollectionItemState,
  useCollectionsSelector,
  useCollectionsStore,
  useLiveTrim,
  videoFrameCount,
  type CollectionGhostContentProps,
  type CollectionItemContentProps,
  type CollectionItemShellProps,
  type CollectionTrimHandleContentProps,
  type CollectionTrimOverviewContentProps,
  type CollectionsComponents,
  type CollectionsGraph,
  type MediaNode,
  type NodeCardDragActivation,
  type NodeId,
} from "@storyboard/ui/dnd-collections";
import {
  hydratedCollectionPlayableDuration,
  hydratedCollectionPreviews,
  resolveCollectionPreviews,
  type CollectionPreviewFrame,
  type CollectionPreviewsResult,
  type DetailsById,
} from "@storyboard/timeline-domain";

import { useClipDetail, useGraphDetailsStore, useTimelineTitle } from "./graph-details-context";
import { useTagFilterMiss } from "./graph-tag-filter";
import { isDisabledByAncestor } from "./graph-playhead-model";
import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";
import { useCollectionHoverTarget } from "./graph-collection-hover";
import { GraphViewNavContext } from "./graph-navigation";
import { TrimPanel } from "./graph-trim-panel";
import { GraphItemContextMenu } from "./graph-item-context-menu";
import { CardCornerSlot, ClipCornerSlot } from "./graph-anchor-menu";
import { createDerivedCache } from "@/lib/derived-cache";
import { graphClipboard } from "@/lib/graph-clipboard";
import { graphPasteFlash } from "@/lib/graph-paste-flash";
import { formatDuration, formatSeconds } from "@/lib/format-duration";
import { fittedTagCount } from "@/lib/caption-tag-fit";
import { resolveCardProvenance } from "@/lib/card-provenance";
import {
  OVERVIEW_FRAME_SIZE,
  ghostPreviewFrames,
  mediaGhostSrc,
  overviewFrameCount,
} from "@/lib/card-ghost-frames";
import { sortTagsStatusFirst } from "@/lib/tag-facets";
import { TagAccentDot } from "./tag-accent-dot";
import {
  collectionPreviewFrameUrl,
  videoFrameUrls,
} from "@/lib/video-frame-url";

/** Never sample more than this many frames for one card, however wide. */
const VIDEO_FRAME_CAP = 16;

/**
 * Marks the bounded virtual-strip window as safe to load eagerly. The same
 * card renderer is used in grid view, where eager loading would request every
 * video at once, so lazy remains the default outside this boundary.
 */
const VideoFrameLoadingContext = createContext<"lazy" | "eager">("lazy");

export function VideoFrameLookAhead({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <VideoFrameLoadingContext.Provider value="eager">
      {children}
    </VideoFrameLoadingContext.Provider>
  );
}

/** Live width/height of a card, via ResizeObserver — drives how many frames a
 *  video filmstrip shows, so it stays a sensible sequence at every zoom (R6
 *  #8) instead of tiling one still wider and wider. Zero until first measured;
 *  callers fall back to a duration-based count meanwhile. */
export function useElementSize(): [
  (element: HTMLElement | null) => void,
  { width: number; height: number },
] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      // Read the size the observer already measured — calling
      // getBoundingClientRect() here would force a second, synchronous layout
      // on every resize, and a zoom fans this callback out across every card.
      const rect = entries[entries.length - 1]?.contentRect;
      if (!rect) return;
      setSize((previous) =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);
  return [ref, size];
}

/**
 * How long a CHANGED frame-count measurement must hold before the filmstrip
 * re-samples. A continuous px/s drag sweeps a card's width→count ratio
 * through several integers, and adopting each crossing re-times every frame
 * slot — swapping every `<img>` src on the card (a fresh CDN URL per slot)
 * several times per drag, per video card. Generous on purpose: the drag's
 * layout already tracks live (widths are CSS), only the frame REFINEMENT
 * waits for the size to hold still.
 */
const FRAME_COUNT_SETTLE_MS = 400;

/**
 * The measured frame count, SETTLED: the first real measurement is adopted
 * immediately — a freshly (re)mounted card, virtualization remounts included,
 * must not wait out the delay to show its filmstrip — while later changes
 * must hold for FRAME_COUNT_SETTLE_MS before they re-sample. The first
 * adoption happens during render (the repo's cascading-render-safe pattern;
 * a synchronous setState in the effect would trip the lint), so this pass
 * already returns the measured value; changes adopt from the timer, which is
 * async by nature.
 */
function useSettledFrameCount(measured: number): number {
  const [settled, setSettled] = useState(measured);
  if (settled === 0 && measured !== 0) setSettled(measured);
  useEffect(() => {
    // settled === 0 means the render-time first adoption is already in
    // flight — nothing to debounce yet.
    if (measured === settled || settled === 0) return;
    const timer = setTimeout(() => setSettled(measured), FRAME_COUNT_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [measured, settled]);
  return settled === 0 ? measured : settled;
}

const NO_PREVIEWS: readonly CollectionPreviewFrame[] = [];
/** Stable identity for the disabled path — a fresh object each call would
 *  make useSyncExternalStore loop. */
const NO_PREVIEW_RESULT: CollectionPreviewsResult = {
  frames: NO_PREVIEWS,
  firstFrameUncertain: false,
};

/**
 * A hydrated collection card's preview frames, derived from its LIVE graph
 * children so a child edit (add, delete, reorder) refreshes the parent card
 * immediately — exactly as its live child COUNT already does — instead of
 * showing the stored frames until a reload. Disabled (empty) for media and
 * for un-hydrated placeholders, which keep their stored summary.
 *
 * Memoized on the committed graph's IDENTITY (createDerivedCache): the store
 * notifies for interaction-only updates too — drag begin/end, every distinct
 * drop intent — but `snapshot.graph` keeps its reference until a COMMIT, so
 * during a drag this getSnapshot is a pure reference check and the child walk
 * never runs (review finding: the old content-key cache stabilized the
 * returned reference but still recomputed the walk per notification). On a
 * commit the walk runs once, and the content-key layer keeps the returned
 * reference stable when this collection wasn't the one that changed —
 * bystander cards don't re-render, per the package's efficiency model.
 * Delimiters: \0 between fields, \x01 between entries — node ids are
 * arbitrary strings, so printable separators could collide.
 */
function useHydratedCollectionPreviews(
  id: string,
  enabled: boolean,
): CollectionPreviewsResult {
  const store = useCollectionsStore();
  const [derive] = useState(() =>
    createDerivedCache({
      compute: (graph: CollectionsGraph, nodeId: string) =>
        hydratedCollectionPreviews(graph, nodeId),
      // The flag JOINS the key. A walk can go from "ran into an unloaded
      // sub-collection" to "did not" while the frames it found stay identical
      // (both empty) — and those two resolve to different rendered frames. Key
      // on the frames alone and the cache hands back the stale reference, so
      // the card never repaints when its children finish loading.
      contentKey: (result) =>
        `${result.firstFrameUncertain ? 1 : 0}\x02` +
        result.frames
          .map((p) => `${p.id}\0${p.poster ?? p.src}\0${p.trimIn ?? 0}`)
          .join("\x01"),
    }),
  );
  const getSnapshot = useCallback(() => {
    if (!enabled) return NO_PREVIEW_RESULT;
    return derive(store.getSnapshot().graph, id);
  }, [store, derive, id, enabled]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * A collection's ENABLED child count, from its live graph children.
 *
 * Memoized on the committed graph's IDENTITY for the same reason the preview
 * frames are: as a bare `useCollectionsSelector` this scanned the children
 * array on EVERY store notification — and the store notifies for
 * interaction-only updates too, so every drop-intent tick during a drag
 * re-counted the children of every hydrated collection on screen. Primitive
 * equality stopped the re-RENDER; it never stopped the scan. `snapshot.graph`
 * keeps its reference until a commit, so this is now a reference check during
 * a drag and the walk runs once per commit.
 *
 * Exported because the sub-timeline ROW shows the same number as the card —
 * two copies of "enabled children" would drift, and the two sit on screen
 * together.
 */
/**
 * Whether this collection LEADS with audio.
 *
 * A collection's thumbnail is its first child's frame, and audio has no frame
 * — so a collection of voice takes fell through to `CollectionLeaderPlaceholder`,
 * the film-leader crosshair, which says "no picture here" when the honest
 * answer is "this is sound". The audio card already has the right glyph
 * (`AudioPlaceholder`); this is what lets the collection reach for it.
 *
 * FIRST child, not "any" and not "all": it mirrors exactly what the thumbnail
 * would otherwise have shown, so the glyph and the frame it replaces are
 * answering the same question. A collection whose first item is a video and
 * whose second is audio still shows the video's frame, which is correct.
 *
 * Hydrated collections only. A placeholder has no graph children to read and
 * its stored summary carries no preview entry for audio, so it keeps the
 * leader — visibly wrong-ish, but inventing an answer from no data is worse.
 */
export function useFirstChildIsAudio(id: NodeId): boolean {
  const store = useCollectionsStore();
  const getSnapshot = useCallback(() => {
    const graph = store.getSnapshot().graph;
    const first = graph.childrenById.get(id)?.[0];
    if (first === undefined) return false;
    const node = graph.nodesById.get(first);
    return node?.kind === "media" && node.mediaKind === "audio";
  }, [store, id]);
  // A boolean, so the selector's identity is stable by construction — the
  // package's render-efficiency model requires selectors not to allocate.
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function useEnabledChildCount(id: NodeId): number {
  const store = useCollectionsStore();
  const [derive] = useState(() =>
    createDerivedCache({
      compute: (graph: CollectionsGraph, nodeId: NodeId) => {
        let total = 0;
        for (const child of graph.childrenById.get(nodeId) ?? []) {
          if (graph.nodesById.get(child)?.disabled !== true) total += 1;
        }
        return total;
      },
      contentKey: (count) => String(count),
    }),
  );
  const getSnapshot = useCallback(
    () => derive(store.getSnapshot().graph, id),
    [store, derive, id],
  );
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * The frames a collection PRESENTS: first and last, live once hydrated and the
 * stored summary until then.
 *
 * First and last only — "a timeline runs from here to there" is what two
 * frames tell and three do not. A single-item collection has no "last"
 * distinct from its first, so it yields one frame rather than the same image
 * twice.
 *
 * Exported because the sub-timeline ROW shows the same frames as the card.
 * Two copies of this rule would drift the moment either changed, and the two
 * sit on screen together — the row is the tree view of the very cards beside
 * it, so a disagreement would be visible rather than theoretical.
 */
export function useCollectionPreviewFrames(
  id: string,
  hydrated: boolean,
  stored: readonly CollectionPreviewFrame[] | undefined,
): readonly CollectionPreviewFrame[] {
  const live = useHydratedCollectionPreviews(id, hydrated);
  // Live frames win, EXCEPT when the walk came up empty because a
  // sub-collection was not loaded — there the server's stored summary knows
  // more. See resolveCollectionPreviews.
  const all = hydrated ? resolveCollectionPreviews(live, stored) : (stored ?? NO_PREVIEWS);
  // ONE frame, full width (PL13-003). It used to be a first/last PAIR, which
  // at card size meant two ~80px slots: too narrow to recognize a face, and the
  // crop turned a composition into a slice of one. The item count beside the
  // duration already says how many, so the pair was not carrying that either.
  //
  // KNOWN LIMITATION, deliberate and worth revisiting: this is the FIRST
  // child's frame, and in a video project a first frame is very often a slate,
  // a logo or a fade from black — this repo's own demo renders "A Universal
  // Picture" for one collection. A representative frame (the midpoint of the
  // collection's own duration) is the better answer and needs the preview
  // machinery to resolve a time, which is its own change.
  // `slice(0, 1)` rather than `[all[0]]`: it yields the same one-frame list
  // without constructing an array that could hold `undefined`.
  return useMemo(() => (all.length > 1 ? all.slice(0, 1) : all), [all]);
}

/**
 * A hydrated collection card's TOTAL content duration, derived from its live
 * graph children (recursively) so it tracks child edits immediately — the same
 * live-over-stored treatment the count and preview frames already get.
 * Disabled (null) for media and un-hydrated placeholders, which fall back to
 * the stored `detail.duration`.
 *
 * Memoized on the identities of BOTH inputs (createDerivedCache): the
 * committed graph is replaced only by a commit, and the details table's
 * `read()` returns a stable object until an entry actually changes — so the
 * recursive descendant walk runs only when one of them really did, never on
 * interaction-only notifications (the store notifies for those too, and this
 * derivation used to re-walk the subtree per drag notification). The rounded
 * content key keeps sub-millisecond recompute jitter from churning the value.
 */
export function useHydratedCollectionSeconds(id: string, enabled: boolean): number | null {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const [derive] = useState(() =>
    createDerivedCache({
      // PLAYABLE seconds, not the layout span: this is the card's readout, and
      // it should say what a viewer would sit through. The layout twin
      // (`hydratedCollectionDuration`) still drives the clip's duration in the
      // projection, where the disabled slot has to survive.
      compute: (graph: CollectionsGraph, details: DetailsById, nodeId: NodeId) =>
        hydratedCollectionPlayableDuration(graph, details, nodeId),
      contentKey: (seconds) => String(Math.round(seconds * 1000)),
    }),
  );
  const getSnapshot = useCallback(() => {
    if (!enabled) return null;
    return derive(store.getSnapshot().graph, detailsStore.read(), id as NodeId);
  }, [store, detailsStore, derive, id, enabled]);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const unsubStore = store.subscribe(onChange);
      const unsubDetails = detailsStore.subscribe(onChange);
      return () => {
        unsubStore();
        unsubDetails();
      };
    },
    [store, detailsStore],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Leaf subscription: only the clip being trimmed re-renders per pointer move. */
function LiveDurationPill({ id, node }: { id: NodeId; node: MediaNode }) {
  const live = useLiveTrim(id);
  const showing = live ? live.effectiveSeconds : mediaDurationSeconds(node);
  return (
    <span className="pointer-events-none absolute right-1 bottom-1 z-10 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-zinc-100">
      {node.mediaKind === "video"
        ? `${formatSeconds(showing)} / ${formatSeconds(node.fullDurationSeconds)}`
        : formatSeconds(showing)}
    </span>
  );
}

/**
 * Whether a COLLECTION above this card is disabled. The walk itself is
 * `isDisabledByAncestor` in graph-playhead-model, shared with the seek rail so
 * the card and the rail can never disagree about what is off.
 *
 * Memoized on the committed graph's IDENTITY, for the same reason as the two
 * derivations above. As a bare `useCollectionsSelector` this ran the parent
 * walk — allocating a `Set` each time — on EVERY store notification, and the
 * store notifies for interaction updates too: drag begin/end, and each
 * DISTINCT drop intent (`intentEqual` gates the raw pointer moves, so this was
 * never per-tick, but it was still O(mounted cards × depth) per intent change
 * on the drag hot path). Primitive equality stopped the re-RENDER; it never
 * stopped the walk.
 */
function useDisabledByAncestor(id: NodeId): boolean {
  const store = useCollectionsStore();
  const [derive] = useState(() =>
    createDerivedCache({
      compute: (graph: CollectionsGraph, nodeId: NodeId) =>
        isDisabledByAncestor(graph, nodeId as string),
      contentKey: String,
    }),
  );
  const getSnapshot = useCallback(
    () => derive(store.getSnapshot().graph, id),
    [store, derive, id],
  );
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * Where a card's item actually LIVES, when that is not the timeline you are
 * looking at — the flat strip's answer to the context it gives up.
 *
 * Returns null in the ordinary nested strip, and it needs no mode flag to do
 * so: there, every card's parent IS the focused collection, so the comparison
 * is false by construction. In a flat run the cards drawn from nested
 * collections differ, and exactly those get a label. Direct children of the
 * focused timeline stay unlabelled in both readings, which is right — their
 * collection is the one on screen.
 */
function useCardProvenance(
  id: NodeId,
): Readonly<{ parentId: NodeId; name: string }> | null {
  const nav = useContext(GraphViewNavContext);
  const focusedId = nav?.focusedId ?? null;
  // Primitive returns, per the store's selector contract.
  const parentId = useCollectionsSelector(
    (snapshot) => snapshot.graph.parentById.get(id) ?? null,
  );
  const nodeName = useCollectionsSelector((snapshot) => {
    const parent = snapshot.graph.parentById.get(id);
    return parent ? (snapshot.graph.nodesById.get(parent)?.name ?? null) : null;
  });
  // The document title is the source of truth for a collection's name (the
  // graph node is the optimistic fallback until it loads) — same resolution
  // the collection card and the breadcrumb use, so a rename shows here too.
  const title = useTimelineTitle((parentId ?? "") as string);

  // The DECISION lives in lib/card-provenance (unit-tested); this hook owns
  // only the three subscriptions above.
  const resolved = resolveCardProvenance({
    parentId: (parentId as string | null) ?? null,
    focusedId,
    title: title ?? null,
    nodeName,
  });
  return resolved === null ? null : { parentId: resolved.parentId as NodeId, name: resolved.name };
}

/**
 * The card's "this will not play" badge, top-right.
 *
 * Two causes, two words, because the fix differs: a card disabled OUTRIGHT is
 * re-enabled on itself, while one that is off because an ancestor collection
 * is off cannot be re-enabled here at all — you have to go up and turn the
 * collection back on. Muting them identically but labelling them the same
 * would strand someone clicking a toggle that cannot help them.
 */
function DisabledChip({ inherited }: { inherited: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-disabled-chip={inherited ? "inherited" : "self"}
      title={
        inherited
          ? "Skipped — a collection above this one is disabled"
          : "Skipped during playback"
      }
      className={[
        "pointer-events-none absolute right-2 bottom-2 z-20 rounded px-1 py-0.5 font-mono text-[8px] leading-none font-semibold tracking-[0.08em]",
        inherited
          ? "bg-zinc-950/95 text-zinc-100 ring-1 ring-zinc-400/70"
          : "bg-zinc-950/95 text-blue-300",
      ].join(" ")}
    >
      {inherited ? "PARENT OFF" : "DISABLED"}
    </span>
  );
}

/** Shared collection glyph for both the card affordance and an empty drag
 * ghost. A single-stroke turn-and-descend mark reads at small sizes where the
 * old compound folder/arrow went muddy, and it says the verb the control
 * actually performs: go DOWN into this timeline. */
/**
 * What an EMPTY collection shows: an academy-leader countdown frame.
 *
 * The slot used to be blank — a dark rectangle that read as a broken thumbnail
 * rather than as "nothing in here yet". A leader frame is the film industry's
 * own mark for "before the picture starts", which is exactly the state, and it
 * gives the card a recognizable silhouette at strip size where any label would
 * be too small to read.
 *
 * Drawn rather than loaded. At card size the geometry is the whole message —
 * the ring, the crosshair, the sweep — and the reference photograph's grain and
 * scratches are invisible; a vector costs no request, stays crisp in the grid's
 * much larger cells, and takes the board's own palette instead of fighting it
 * with a bright sepia field. (If the scanned frame itself is wanted, this is the
 * one place to swap it.)
 *
 * `preserveAspectRatio="none"` on the CROSSHAIR only would stretch the ring, so
 * the whole thing scales as one and the card's own overflow crops the excess —
 * the leader is centred, which is where a projectionist would expect it.
 */
/**
 * An audio card's stand-in: a music glyph on paper.
 *
 * A SYMBOL, not a drawn waveform. The drawn waveform this replaces was a fixed
 * pseudo-random bar set — it looked like data while being decoration, and the
 * peaks it implied belonged to no particular file, so two different takes drew
 * the identical "waveform". A glyph makes no such claim: it says "this is
 * sound" and stops.
 *
 * Real peaks are still not an option here, for the reason the drawn version
 * gave: decoding requires fetching whole files and a board holds dozens of
 * cards. Actual peaks belong to the waveform LANE, which is cached, capped at
 * three concurrent decodes and limited to visible cards.
 *
 * Paper, not black — the same call `CollectionLeaderPlaceholder` makes: an
 * audio card is a FRAME with no picture, not a hole where one failed to load.
 */
function AudioPlaceholder() {
  return (
    <span className="flex h-full w-full items-center justify-center bg-zinc-800/40">
      <Music
        aria-hidden="true"
        strokeWidth={1.5}
        // Sized off the CARD's height rather than fixed, so one glyph serves a
        // tall grid cell and a short strip clip alike; clamped at both ends so
        // it can neither fill a large cell nor shrink to a speck. Height-based
        // because a strip clip's WIDTH is its duration — keying off that would
        // swell the note on a long clip and crush it on a short one.
        className="h-1/2 max-h-10 min-h-3 w-auto text-zinc-400/70"
      />
    </span>
  );
}

function CollectionLeaderPlaceholder() {
  return (
    <svg
      viewBox="0 0 160 90"
      aria-hidden="true"
      className="h-full w-full text-zinc-500/70"
      preserveAspectRatio="xMidYMid slice"
    >
      {/* Paper, not black: an empty card reads as a FRAME rather than a hole. */}
      <rect width="160" height="90" className="fill-zinc-800/40" />
      {/* The sweep — the sector a leader's rotating hand has already passed. */}
      <path d="M80 45 L80 6 A39 39 0 0 1 114 26 Z" className="fill-zinc-700/45" />
      <g stroke="currentColor" fill="none" strokeWidth="1.5">
        {/* Crosshair, edge to edge. */}
        <path d="M80 0 V90 M0 45 H160" strokeWidth="1" />
        {/* The ring: two concentric strokes, the leader's signature. */}
        <circle cx="80" cy="45" r="39" />
        <circle cx="80" cy="45" r="33" />
      </g>
    </svg>
  );
}

/**
 * SELECTED, as a badge — a tick in the card's top-left, present only while the
 * card is selected.
 *
 * A BADGE, not a control, and the distinction is the whole design. A checkbox
 * you click to select was built and rejected (PL13-001): with the card body
 * already selecting, it was a second affordance for one act, and being
 * invisible-but-clickable it swallowed clicks meant for the card. This appears
 * BECAUSE the card is selected and does nothing when pressed —
 * `pointer-events-none`, so it cannot repeat that mistake.
 *
 * It earns its place by making a MULTI-selection legible. The `ring-blue-400`
 * on a selected card is a fine binary signal on one card and a weak one across
 * a board of forty, where the eye has to compare border colours; a row of ticks
 * reads at a glance. Same amber as the ring on purpose — one selection colour,
 * two ways of saying it.
 *
 * `aria-hidden`: the card already exposes `aria-pressed` and `data-selected`.
 * Announcing "selected" twice per card is noise, not access.
 *
 * Top-LEFT, mirroring the control cluster in the top-right, and 20px against
 * their 24px — a marker should not read as a button you failed to press.
 *
 * The 8px inset is shared with that cluster and the two must move TOGETHER
 * (PL14-002/003 bumped both from 6px): they are top-aligned, so nudging one
 * off the other's line is exactly what stops them reading as a pair.
 */
/**
 * How far a card's corner controls sit in from its edge. ONE value, every card
 * kind.
 *
 * It is 20px because of TRIM HANDLES: a handle's hit zone is 8px (`w-2`, pinned
 * to `left-0`/`right-0` in the package's TrimHandles), and at the old 8px inset
 * the checkmark and the `⋮` landed flush against the amber handles, reading as
 * one crowded cluster. 20px clears a handle by its own width again.
 *
 * APPLIED EVERYWHERE, INCLUDING COLLECTIONS, which have no handles. That looks
 * like padding a card for a constraint it does not have — and it was, until the
 * two kinds were seen side by side. Collections sat at 8px and clips at 20px, so
 * the check and the drill control visibly JUMPED as the eye moved between card
 * kinds in the same grid. A shared inset with one card kind's reason behind it
 * beats two correct-in-isolation values that disagree on screen.
 *
 * THIS TRACKS THE CONTROL SIZE. It was 16px while the controls were 24px; they
 * grew to 28px and the measured gap fell from 8px to 4px, which the e2e
 * clearance test caught. Anything that changes `CARD_CONTROL_CLASS`'s size has
 * to move this with it — the two numbers are not independent, and nothing but
 * that test connects them.
 *
 * Written as WHOLE literal class names. Tailwind's JIT scans source text, so an
 * interpolated `left-${n}` is a class that never gets generated — the control
 * would silently fall back to `left: auto` and sit in the wrong place.
 */
/** Right inset, shared by every card kind. (The LEFT twin went with the amber
 *  selected-badge — it was the only thing in that corner, and nothing has
 *  replaced it.) */
export const CARD_CONTROL_INSET_RIGHT = "right-5";
/** Top inset, `top-3` (12px) rather than the `top-2` these started at: at
 *  8px the controls sat tight under the card's edge once they grew to 28px.
 *  `CardCornerSlot` in graph-anchor-menu carries the literal twin of this —
 *  it cannot import from here without a cycle. */
export const CARD_CONTROL_INSET_TOP = "top-3";

// THE AMBER CHECK IN THE TOP-LEFT CORNER IS GONE.
//
// It marked a selected card, and by the end it was the third thing doing that.
// The ring around the card says it (`ring-2 ring-blue-500`), the bottom-right
// checkbox says it, and this said it a third time in a different corner in a
// different colour — which reads as three different facts rather than one.
//
// The checkbox is the one that survives because it is the one that can say the
// most: it is on every card, so it shows the UNPICKED ones too, which a mark
// that only appears when selected never could.
//
// Worth keeping from its long comment, for whatever next needs a status mark on
// artwork: a bare glyph with a layered drop-shadow halo (three tight passes for
// a hard edge, one wide soft pass to drop the artwork behind it) stays legible
// over a sunlit frame WITHOUT wearing a chip — and a chip is what made an
// earlier version read as a button it was not.

// THE SHARED CARD-CONTROL LOOK IS GONE, with the last control that wore it.
//
// `CARD_CONTROL_CLASS` was a 28px dark square — one look, so a card read as
// having ONE kind of control rather than a collection of one-offs. It outlived
// its wearers: the details trigger went first, the corner drill button last
// (a plain click opens a collection now). The `⋮` that owns this corner today
// styles itself in graph-anchor-menu, which is also where the corner's
// positioning lives.
//
// Two things it knew are still true and still needed, so they are recorded
// where they are used rather than lost with it: the 28px control size that
// `CARD_CONTROL_INSET_*` above tracks, and — for whatever wears this look next
// — that `cursor-pointer` is NOT redundant on a <button> under Tailwind v4's
// preflight, and that a hover step from `bg-zinc-950/80` has to clear
// `zinc-900` to register over artwork at all.

/**
 * The mark on the DRAG GHOST of a collection that has no frames to show.
 *
 * CornerRightDown — turn and descend. It was named `CollectionDrillGlyph` while
 * it was the drill control's glyph, and that control is gone; this is the one
 * place it survived, where the job is to say "the thing you are dragging is a
 * collection", not "go into this". Kept rather than swapped for the caption's
 * Layers: at 28px on a translucent ghost the heavier arrow reads, and the two
 * marks are never on screen together.
 *
 * NOT a folder, despite what this was called until PL13-004 — the sidebar's
 * FolderTree toggles whether the children tree is SHOWN, a different verb that
 * deliberately does not share an icon with anything here.
 */
function CollectionGhostGlyph({ className }: Readonly<{ className?: string }>) {
  return <CornerRightDown aria-hidden="true" className={className} strokeWidth={1.5} />;
}

/**
 * Which collection this card's item lives in, drawn along the card's bottom
 * edge — the flat strip's orientation, and what makes the drop rule ("lands in
 * the left neighbour's collection") readable BEFORE you release.
 *
 * A SPAN, not a button, deliberately. This renders inside NodeCard's selection
 * `<button>`, and nesting interactive semantics is invalid HTML and an
 * ambiguous a11y tree — the package makes that an invariant and a story
 * asserts it. So the reveal rides a double-click, which needs no role, and the
 * O key covers the same action from the keyboard (see OpenKeyBoundary).
 *
 * KNOWN GAP: `aria-hidden`, matching the card's other chips, so the collection
 * name is not announced. Fixing that means composing it into the card's
 * accessible name, which lives in the package's NodeCard — a change worth
 * making deliberately rather than smuggling in here.
 */
function ProvenanceLabel({
  parentId,
  name,
}: Readonly<{ parentId: NodeId; name: string }>) {
  const nav = useContext(GraphViewNavContext);
  return (
    <span
      aria-hidden="true"
      data-provenance={parentId as string}
      title={`In "${name}" — double-click to open it (or press O)`}
      // The single click is SWALLOWED, and that is what keeps the double-click
      // reachable. A plain click on a clip card opens its edit overlay now, so
      // without this click 1 of the double-click puts a modal over the board
      // and click 2 lands on the modal — the gesture this label advertises
      // could never complete. Exactly the trap the collection's NAME span
      // already avoids, for exactly the same reason.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        nav?.openTimeline(parentId);
      }}
      // TOP-LEFT: the bottom band is already three-deep (kind tag left,
      // duration pill right, and the label spanning both would sit under
      // them), and the top-right belongs to the disabled chip. Capped width so
      // a long collection name truncates instead of running into that chip.
      className="pointer-events-auto absolute left-1 top-1 z-10 max-w-[70%] cursor-pointer truncate rounded bg-sky-950/85 px-1 py-0.5 text-[8px] leading-none font-semibold text-sky-200 ring-1 ring-sky-400/30 hover:bg-sky-900/90 hover:text-sky-100"
    >
      {name}
    </span>
  );
}

// The strip's overlay `TagRow` lived here, with a pair of card-width
// thresholds (132px to show anything, 220px for a third chip) deciding how
// many chips a clip got. It is GONE with the strip tag row itself: a strip
// clip's width is its DURATION, so those thresholds meant a clip's length
// decided which of its tags you saw. Tags are a grid idea now, and the grid
// caption's `CaptionTagRow` below is the one renderer.

/**
 * The caption's tag chips — in flow, under the artwork, grid only.
 *
 * A separate component from the overlay `TagRow` above rather than a mode on
 * it: that one is an absolutely-positioned stack pinned over a picture and
 * legible against arbitrary artwork; this one sits on the card's own
 * background in a row that has to share width with the meta line. They have
 * different jobs and almost no shared pixels.
 *
 * MEASURED, not counted. It used to show a fixed two and fold the rest, on the
 * reasoning that a grid cell is a known width per item size. That is true of
 * the CELL and false of this row: tags are free text, so two long ones overflow
 * where four short ones would have fitted, and a fixed count both clipped the
 * long case and hid tags there was room for in the short one. The row now fits
 * as many whole chips as the width actually takes and folds the remainder.
 *
 * Same ruler technique as the select row's verbs (`useFittedVerbCount`): an
 * invisible, out-of-flow copy of every chip is what gets measured, because
 * measuring the real row would be circular — hiding a chip changes the width
 * you are measuring from, so the answer would depend on the previous answer.
 */
/**
 * The caption's two rows, shared by BOTH card kinds.
 *
 * A grid caption is always TWO rows: identity on top (kind glyph, name, and the
 * metadata trailing right), tags underneath, right-justified. The two kinds
 * used to disagree about the shape — a collection put its metadata on row one
 * and its tags in a span of their own, media stacked name over
 * metadata-plus-tags — so a mixed grid showed two different objects.
 *
 * Shared as CONSTANTS rather than as matching literals in two places, because
 * matching literals is exactly what drifted: the alignment work before this had
 * to reconcile four separate numbers that were only ever meant to be equal.
 */
const CAPTION_ROW_CLASS = "flex min-h-5 min-w-0 items-center gap-1.5";

/**
 * Row two, and it is ALWAYS RENDERED — an untagged card keeps an empty one.
 *
 * That is the whole point of the `min-h`: with the row omitted, a tagged card
 * was taller than an untagged one, so a grid of mixed cards had captions of two
 * heights and the artwork above them started at two different places. Reserving
 * the height costs one empty row and buys every card the same box.
 *
 * The height is held by a SPACER (`CaptionTagRowSpacer`), not by a `min-h` on
 * the row. `min-h` was the first attempt and it was measurably wrong: under
 * `border-box` a min-height includes the element's own padding, so the
 * collection's row — which carries `pt-1 pb-1.5` where the media card's does
 * not — reserved 14px total and got 4px of content, then grew to 24px once real
 * chips arrived. Media was 14px either way; the collection was 14 vs 24, so its
 * artwork moved 10px depending on whether the card happened to be tagged. A
 * spacer reserves CONTENT height, which every padding then adds to equally.
 *
 * NO display utility here, deliberately. The collection's copy is grid-gated
 * (`hidden [[data-virtual-grid]_&]:flex`) and a `flex` baked in would collide
 * with that `hidden` — two display utilities on one element, resolved by CSS
 * source order rather than by the order they are written, which is a coin toss
 * dressed up as a class list. Each caller states its own.
 */
const CAPTION_TAG_ROW_CLASS = "min-w-0 items-center justify-end";

/**
 * Holds row two open at exactly one chip's height when there are no tags.
 *
 * 14px is a chip's own box (`text-[10px] leading-none` + `py-0.5`); the ring is
 * a box-shadow and costs no layout. Zero WIDTH so it cannot push the chips it
 * stands in for, and `shrink-0` so a crowded row cannot squeeze it back to
 * nothing — which would silently restore the height difference it exists to
 * remove.
 */
function CaptionTagRowSpacer() {
  return <span aria-hidden="true" className="block h-[14px] w-0 shrink-0" />;
}

/**
 * The trailing metadata on row one — duration, and a collection's item count.
 *
 * Modelled on the collection card's, which is the one the owner picked: mono,
 * medium, zinc-300, stepping up a size in the grid. `ml-auto` is what puts it
 * at the row's right edge without a `justify-between` that would also fight the
 * name's `flex-1`.
 */
const CAPTION_META_CLASS =
  "ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px] font-medium text-zinc-300 [[data-virtual-grid]_&]:text-xs";

function CaptionTagRow({ tags }: Readonly<{ tags: readonly string[] }>) {
  const ordered = useMemo(() => sortTagsStatusFirst(tags), [tags]);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const rulerRef = useRef<HTMLSpanElement | null>(null);
  const counterRef = useRef<HTMLSpanElement | null>(null);
  const [fitted, setFitted] = useState(ordered.length);

  useEffect(() => {
    const container = containerRef.current;
    const ruler = rulerRef.current;
    if (!container || !ruler) return;

    // MEASURE here, DECIDE in lib/caption-tag-fit. The two-pass rule and the
    // at-least-one-chip floor are the interesting part and they are now
    // unit-tested; this side owns only the DOM reads.
    const measure = () => {
      const widths = Array.from(ruler.children).map((child) =>
        Math.ceil((child as HTMLElement).getBoundingClientRect().width),
      );
      const next = fittedTagCount({
        widths,
        budget: container.clientWidth,
        counterWidth: counterRef.current?.getBoundingClientRect().width ?? 0,
      });
      // null = the row is not laid out yet; keep the previous answer rather
      // than folding everything for a frame.
      if (next !== null) setFitted(next);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [ordered]);

  const shown = ordered.slice(0, fitted);
  const extra = ordered.length - shown.length;
  const chipClass =
    "inline-flex max-w-[7rem] shrink-0 items-center gap-1 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] leading-none font-medium text-zinc-300 ring-1 ring-white/10";

  return (
    <span
      ref={containerRef}
      data-clip-caption-tags={tags.length}
      // `flex-1 min-w-0`, NOT `ml-auto shrink`. The budget has to come from the
      // ROW, never from these chips: a content-sized box reports the width its
      // contents already take, so measuring it asks "do the chips fit in the
      // space the chips are using", which is always yes — the fold then never
      // fires, or fires against a box that shrank because of the last answer.
      // Same one-way rule the select row's verb container follows.
      //
      // RIGHT-JUSTIFIED via `justify-end` rather than by letting the box shrink
      // to its contents — the two look identical until the row is measured, and
      // shrinking is the thing that breaks the fold. The container still spans
      // the leftover width; only the chips inside it sit at its right edge.
      className="relative flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden"
    >
      {/* The ruler: every chip, laid out but invisible. `visibility:hidden`
          rather than `display:none` so the boxes still measure, absolute so it
          cannot widen the container it is measured against, and `inert` so a
          hidden copy of the row is not in the tab order or the a11y tree. */}
      <span
        ref={rulerRef}
        aria-hidden="true"
        inert
        data-clip-caption-tags-ruler=""
        className="pointer-events-none invisible absolute top-0 left-0 flex items-center gap-1"
      >
        {ordered.map((tag) => (
          <span key={tag} className={chipClass}>
            <TagAccentDot tag={tag} />
            <span className="min-w-0 truncate">{tag}</span>
          </span>
        ))}
      </span>
      {/* The counter's own width, measured the same way rather than guessed —
          it grows with the digit count ("+9" against "+12"). */}
      <span
        ref={counterRef}
        aria-hidden="true"
        inert
        className="pointer-events-none invisible absolute top-0 left-0 shrink-0 font-mono text-[10px] leading-none"
      >
        +{ordered.length}
      </span>

      {shown.map((tag) => (
        <span key={tag} title={tag} className={chipClass}>
          <TagAccentDot tag={tag} />
          <span className="min-w-0 truncate">{tag}</span>
        </span>
      ))}
      {extra > 0 && (
        <span
          data-clip-caption-tags-overflow={extra}
          // HOVER LISTS THE REST. A `title` rather than a real tooltip, and not
          // for lack of one: this renders inside the card's selection surface,
          // which is a `<button>`, and a Radix tooltip trigger is interactive
          // content — nesting it would auto-close the card's own button and
          // eject the rest of the card out of its box (the same wall the
          // select-mode checkbox hit). A title costs nothing and works.
          title={ordered.slice(fitted).join("\n")}
          className="shrink-0 cursor-help font-mono text-[10px] leading-none text-zinc-500"
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

/**
 * The selection checkbox, bottom-right, while select mode is armed.
 *
 * DECORATIVE, not a control — and that is forced, not a shortcut. This renders
 * inside NodeCard's real `<button>`, and a button may not contain interactive
 * content: browsers auto-close the outer one at the first nested button, which
 * ejects the rest of the card out of its own box. (The design's own notes hit
 * the same wall and answered it by making the card a `div role="button"`, which
 * costs hand-wiring Enter/Space and the focus ring across every card in both
 * surfaces. Worth doing one day; not smuggled in behind a checkbox.)
 *
 * Nothing is lost in select mode, because the whole card is already the toggle
 * there — the design's card does the same thing (`if (selecting) toggleSelect`),
 * so its checkbox is only ever a second way to hit the same target.
 *
 * OUTSIDE the mode it appears on HOVER, which is the design's own behaviour,
 * and CLICKING IT TOGGLES *and ARMS the mode*. That matters most on a
 * collection: the rest of that card drills in, so this circle is the only
 * pointer route to picking one at all. Arming is the point rather than a side
 * effect — it is what swaps the breadcrumb trail for the selection row, so the
 * pick has somewhere to be counted and acted on. See the handler for why it
 * arms on the way in only.
 *
 * It is a span that handles its own click rather than a `<button>` — see the
 * note on the element itself for why, and for the keyboard path that covers
 * what a non-focusable control gives up.
 *
 * DESKTOP ONLY, via `@media (hover: hover)`. A touch device has no hover state
 * to reveal it with, and without the query a tap would leave the checkbox
 * stuck on the last-tapped card — the sticky-hover bug — where it would read as
 * a selection that is not there. The repo writes these as arbitrary variants
 * (see the `[@media(pointer:coarse)]` sizing elsewhere) rather than trusting a
 * framework default, so the intent survives a Tailwind upgrade.
 *
 * `revealOnHover` is a literal class string per card kind rather than an
 * interpolated group name: Tailwind's JIT scans source text, so a computed
 * `group-hover/${kind}` is a class that never gets generated and the checkbox
 * would silently never appear.
 *
 * Two details worth keeping if this is ever restyled. The check is ALWAYS
 * rendered and only its opacity changes, so the circle never resizes as it
 * fills. And the ring is `border-2` on a translucent, blurred fill rather than
 * a flat chip, because it sits on arbitrary artwork — a light frame and a dark
 * one both have to keep it legible.
 */
// Hover-reveal, per card kind. Whole literal class names — see the note on
// `revealOnHover` above.
//
// `pointer-events-none` travels WITH the opacity and is not decoration: the
// checkbox is a click target now, and an invisible one would be a trap. On
// touch the `@media (hover: hover)` gate never opens, so without this a tap in
// the card's bottom-right corner would toggle a selection through a control the
// user cannot see. Hidden means unclickable, in the same rule, so the two can
// never drift apart.
const SELECT_HOVER_REVEAL_MEDIA = [
  "pointer-events-none opacity-0 motion-safe:transition-opacity motion-safe:duration-150",
  "[@media(hover:hover)]:group-hover/media-item:pointer-events-auto",
  "[@media(hover:hover)]:group-hover/media-item:opacity-100",
].join(" ");

/** The same, for a COLLECTION card's group. */
const SELECT_HOVER_REVEAL_COLLECTION = [
  "pointer-events-none opacity-0 motion-safe:transition-opacity motion-safe:duration-150",
  "[@media(hover:hover)]:group-hover/collection-item:pointer-events-auto",
  "[@media(hover:hover)]:group-hover/collection-item:opacity-100",
].join(" ");

function SelectionIndicator({
  id,
  selected,
  armed,
  revealOnHover,
}: Readonly<{
  selected: boolean;
  /** Select mode is on, so the checkbox is permanent rather than hover-only. */
  armed: boolean;
  /** Literal hover-reveal classes for THIS card kind's group. */
  revealOnHover: string;
  /** The card this toggles. */
  id: NodeId;
}>) {
  const store = useCollectionsStore();
  return (
    <span
      aria-hidden="true"
      data-selection-indicator={selected ? "on" : "off"}
      // Distinguishes "permanently shown because the mode is armed" from
      // "revealed by the pointer", which a geometry-only assertion cannot see.
      data-selection-indicator-reveal={armed ? "armed" : "hover"}
      // THE CHECKBOX IS THE TOGGLE, and on a collection it is the only one: the
      // rest of that card drills in, so without this there is no pointer route
      // to picking a collection outside select mode at all.
      //
      // A SPAN with its own click, not a <button>. This renders inside the
      // card's selection surface, which IS a button, and nesting interactive
      // semantics is invalid HTML — the composed-card tests pin that. The
      // precedent is a few lines down: the collection's NAME span swallows its
      // own click the same way so the card body's drill-in does not fire under
      // it. `stopPropagation` is what makes that work; React's synthetic
      // bubbling never reaches the surface's handler.
      //
      // The cost is that this is not keyboard-reachable, which is why it stays
      // `aria-hidden`. Keyboard users are not stranded: select mode plus Space
      // on the focused card is the same toggle, and it is the path a screen
      // reader is already told about through the card's own name and state.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        store.toggleSelected(id);
        // PICKING IS ENTERING THE MODE. The header row is driven by
        // `multiSelectMode` alone (see GraphBoard's `selectModeRow`), so
        // toggling the selection without arming left the checkbox filling in
        // while the breadcrumb trail sat there unchanged — a selection with no
        // way to act on it and no visible way out. Since a plain click OPENS
        // and never selects, this checkbox IS the pointer gesture that means
        // "I am selecting now", and that is the same statement the Select
        // button makes.
        //
        // Only on the way IN. Un-checking the last item leaves the mode armed
        // at "0 selected · Done", which is exactly where pressing Select and
        // picking nothing lands you — whereas disarming on empty would yank
        // the row away mid-correction, the moment a mis-pick is undone.
        if (!selected) store.setMultiSelectMode(true);
      }}
      className={[
        "absolute right-2 bottom-2 z-20 grid size-[26px] cursor-pointer place-items-center",
        "rounded-full border-2 backdrop-blur-sm motion-safe:transition-colors",
        selected ? "border-blue-500 bg-blue-500" : "border-white/90 bg-black/35",
        armed ? "" : revealOnHover,
      ].join(" ")}
    >
      <Check
        className={["size-4 text-white", selected ? "opacity-100" : "opacity-0"].join(" ")}
        strokeWidth={3}
      />
    </span>
  );
}

const GraphClipContent = memo(function GraphClipContent({
  id,
  node,
  selected,
  rejected,
  isDragSource,
  trimEnabled,
}: CollectionItemContentProps) {
  // Card geometry for the video filmstrip's frame count. Frame count follows
  // the card's WIDTH (roughly one ~square frame per card height), SETTLED so
  // a continuous zoom drag doesn't re-sample the whole filmstrip at every
  // integer-ratio crossing — computed above the early return because the
  // settle hook must run unconditionally.
  const [cardSizeRef, cardSize] = useElementSize();
  // Which SURFACE this card is being drawn in, read from the container's own
  // `[data-virtual-grid]` marker rather than passed down.
  //
  // Deliberately the same mechanism the CSS uses (`[[data-virtual-grid]_&]:…`
  // all over this file). The card renderer is shared by both surfaces and has
  // no idea which one it is in; threading a prop just to change a frame count
  // would put a layout concern into the item contract, and the two surfaces
  // would then have two different ways of answering the same question.
  const [inGrid, setInGrid] = useState(false);
  const surfaceRef = useCallback((element: HTMLElement | null) => {
    setInGrid(element !== null && element.closest("[data-virtual-grid]") !== null);
  }, []);
  // One element, two callback refs — React takes a single ref per element, so
  // they are composed here rather than by giving the node two attributes.
  const cardRef = useCallback(
    (element: HTMLElement | null) => {
      cardSizeRef(element);
      surfaceRef(element);
    },
    [cardSizeRef, surfaceRef],
  );
  const measuredFrames =
    cardSize.height > 0 ? Math.round(cardSize.width / cardSize.height) : 0;
  const settledFrames = useSettledFrameCount(measuredFrames);
  // Above the collection early-return below — hooks may not be conditional.
  const inheritedDisabled = useDisabledByAncestor(id);
  // Above the collection early-return below, with the other hooks — hooks may
  // not be conditional. A filter MISS is a SEPARATE state from disabled, so it
  // gets its own signal and its own treatment (opacity only): `opacity-45
  // grayscale` is already disabled's language, and a card that is both must
  // still read as both.
  const filterMiss = useTagFilterMiss(id as string);
  // Select mode, for the checkbox below. Above the collection early-return with
  // the other hooks — hooks may not be conditional.
  const selectMode = useCollectionsSelector((s) => s.interaction.multiSelectMode);
  const provenance = useCardProvenance(id);
  const frameLoading = useContext(VideoFrameLoadingContext);
  // The AUTHORED name, read straight from the side table rather than from
  // `node.name`: the node's name falls back to the derived alt, so it can't
  // tell "named by someone" from "named by the file system".
  const detail = useClipDetail(id as string);

  // MEDIA pixels only. Collections don't render through this seam anymore:
  // their card carries interactive controls (folder drill-in, inline rename),
  // which cannot legally nest inside NodeCard's <button> — so the registered
  // ItemShell (GraphItemShell below) routes collections to the composed
  // CollectionItem-based card instead. This guard is defensive: nothing in
  // the graph view reaches it with a collection node.
  if (node.kind === "collection") return null;

  const isVideo = node.mediaKind === "video";
  const isAudio = node.mediaKind === "audio";
  const muted = node.disabled === true || inheritedDisabled;
  // In the GRID a video is ONE frame, full width — a thumbnail, the same shape
  // an image card has. The filmstrip below is a STRIP idea and stays there:
  // that surface makes a card as wide as its clip is long, so extra width is
  // extra time and a sequence of frames is the honest thing to put in it. A
  // grid cell's width is just the cell's, so splitting it between a first and
  // last frame was showing two half-width pictures to say nothing about
  // duration, and neither of them read as a thumbnail.
  //
  // A wider STRIP clip shows MORE distinct frames rather than the same still
  // tiled — falling back to a duration-based count until first measured.
  const frames = !isVideo
    ? 1
    : inGrid
      ? 1
      : Math.max(
          1,
          Math.min(
            settledFrames || videoFrameCount(mediaDurationSeconds(node), 6),
            VIDEO_FRAME_CAP,
          ),
        );
  // Each video frame is sampled at its own time across the visible clip (R6
  // #6); an image is just its one src.
  const frameSrcs =
    node.mediaKind === "video"
      ? videoFrameUrls(node.posterSrcs ?? [], frames, {
          trimInSeconds: node.trimInSeconds,
          effectiveSeconds: mediaDurationSeconds(node),
        })
      : // Audio yields NO frame srcs. Its `src` is a media file, and the
        // fallthrough below would hand it to an <img> — a broken-image icon on
        // every audio card. It renders a drawn placeholder instead.
        isAudio || !node.src
        ? []
        : [node.src];
  // CAPTION values (grid only — see the caption span at the end of the card).
  const KindIcon = isVideo ? Video : isAudio ? Music : ImageIcon;
  // ONLY a real, authored name — no fallback.
  //
  // This used to fall back to the KIND ("Image", "Video", "Audio") on the
  // reasoning that a caption whose first line can be empty reads as broken.
  // That was the wrong trade: it put a word on every unnamed card, in the
  // name's own typography, that said nothing the leading kind icon was not
  // already saying — so an unnamed card read as though it had been named
  // "Image". PL11-004 keeps `detail.title` absent until someone actually names
  // a clip, precisely so a library of filenames does not look like a rename
  // backlog, and inventing a name here undid that.
  //
  // The row does NOT collapse when this is null: the kind icon still holds the
  // line, so an unnamed card's caption stays on the same grid as a named one's
  // and as a collection's.
  const captionName = detail?.title ?? null;
  const captionSeconds = Number(mediaDurationSeconds(node)) || 0;
  return (
    <span
      ref={cardRef}
      className={[
        // p-1.5 on BOTH surfaces: the artwork is inset like the collection
        // card's (its frame + label row keep its pixels off the card edges),
        // so media and collections read as the SAME height and the artwork
        // stays clear of the seek rail riding above — the strip's rail has
        // the identical adjacency, so full-bleed pressed into it there too.
        // The card's outer box (and so width = duration) is unchanged.
        "relative flex h-full w-full overflow-hidden rounded-md bg-zinc-900 p-1.5",
        // GRID STACKS: artwork on top, a real caption underneath — the shape
        // the grid cell was already sized for (see ITEM_SIZE_DIMENSIONS, which
        // made grid cells tall and boxy for exactly this) and the shape the
        // collection card has always had. The strip stays one artwork box: a
        // caption row there is fixed overhead on every clip, and clip width is
        // duration, so a narrow clip has no room for one anyway.
        "[[data-virtual-grid]_&]:flex-col",
        selected ? "ring-2 ring-inset ring-blue-500" : "ring-1 ring-white/15",
        rejected ? "ring-2 ring-red-500 motion-safe:animate-pulse" : "",
        // Disabled reads as MUTED, never as missing: the card keeps its slot
        // and its full width (its duration still shapes the board), it just
        // stops looking like content that plays. Grayscale + reduced opacity
        // survives on top of any artwork, where a tint would not.
        //
        // Inherited disabling looks IDENTICAL — a viewer sees neither — and
        // only the chip distinguishes them.
      ].join(" ")}
      // Distinct VALUES so e2e can assert which cause is in play; both are
      // truthy for "this card is muted".
      data-disabled={node.disabled ? "true" : inheritedDisabled ? "inherited" : undefined}
    >
      {/* THE ARTWORK BOX — the frame, plus anything that belongs ON the frame
          rather than on the card.

          It exists to be a positioning context that is not also the dimmed one.
          In the grid this box stops filling the card (the caption below takes
          the rest), so anything anchored to the CARD's bottom would sit over
          the caption; anchored here it stays on the picture, which is what it
          means. And keeping the dimming on the inner span means the selection
          checkbox does not fade with the artwork — a filter miss drops the
          frame to opacity-30, and a checkbox that went with it would make the
          selection unreadable exactly while someone is picking through a
          filtered board. */}
      <span className="relative flex h-full min-h-0 w-full overflow-hidden rounded-sm [[data-virtual-grid]_&]:flex-1">
      <span
        data-disabled-visuals={muted ? "true" : undefined}
        data-filter-miss={filterMiss ? "true" : undefined}
        className={[
          "flex h-full w-full overflow-hidden rounded-sm",
          isDragSource ? "opacity-40" : muted ? "opacity-45" : filterMiss ? "opacity-30" : "",
          muted ? "grayscale" : "",
          "motion-safe:transition-opacity motion-safe:duration-150",
        ].join(" ")}
      >
      {frameSrcs.length === 0 ? (
        isAudio ? (
          <AudioPlaceholder />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[11px] text-zinc-500">
            No preview
          </span>
        )
      ) : (
        <span className="flex h-full w-full overflow-hidden rounded-sm">
          {frameSrcs.map((src, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={src}
              alt=""
              draggable={false}
              // The virtual strip itself is the loading boundary: only the
              // visible cards plus its bounded look-ahead are mounted. Start
              // those frames immediately so a fast horizontal pan cannot
              // outrun the browser's native lazy-load distance.
              loading={frameLoading}
              decoding="async"
              className="h-full min-w-0 flex-1 border-r border-black/60 object-cover last:border-r-0"
            />
          ))}
        </span>
      )}
      </span>
      {/* Bottom-RIGHT of the ARTWORK, opposite the duration, so the two never
          contend for a corner — the design makes the same split. Shown on muted
          cards too: a disabled clip is still something you might be gathering
          up to delete.

          ALWAYS RENDERED now. Select mode pins it on; otherwise it is revealed
          by hover, on hover-capable devices only. Rendering it unconditionally
          is what lets CSS own that, so no pointer state has to reach React —
          a hover that re-rendered every card would land on the drag/INP hot
          path the playhead comment above is careful about. */}
      <SelectionIndicator
        id={id}
        selected={selected}
        armed={selectMode}
        revealOnHover={SELECT_HOVER_REVEAL_MEDIA}
      />
      </span>
      {/* Kind tag (R6 #7): a WORD, bottom-left. The glyph version (a 4px film
          or picture icon in the top corner) was ambiguous at small item sizes
          — the two lucide marks read as the same smudge — so it says which it
          is. Bottom-left pairs it with the duration pill on the right without
          either covering the artwork's centre. Decorative for AT (the card's
          own label names the clip). */}
      <span
        aria-hidden="true"
        data-media-kind={isVideo ? "video" : isAudio ? "audio" : "image"}
        // Hidden in the GRID, where the kind is the caption's leading icon
        // instead. A word stamped on the artwork and an icon under it would say
        // the same thing twice, and the word is the one that costs picture.
        className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] leading-none font-semibold tracking-[0.08em] text-zinc-100 [[data-virtual-grid]_&]:hidden"
      >
        {isVideo ? "VIDEO" : isAudio ? "AUDIO" : "IMAGE"}
      </span>
      {/* NO tag row in the strip. Tags are a GRID idea now: they live in the
          caption, under the artwork, on both card kinds.

          They used to be stamped over the picture here, folded by a pair of
          card-width thresholds. A strip clip's width IS its duration, so which
          tags a clip showed depended on how long it was — two cards with the
          same tags disagreed about them, and a short clip covered most of its
          own frame to say so. The grid cell has a stable width and a row of
          its own for exactly this, which is where they went. */}
      {/* The clip's NAME, shown only when someone gave it one (PL11-004).
          Every clip has an `alt` — a filename, usually — so a card that
          rendered "the name" would render something on all of them, and a
          library of two thousand machine-named clips reads as a rename
          backlog. `detail.title` is absent until authored, so an unnamed card
          simply has no label rather than an empty-looking slot.
          Decorative for AT: the card's own aria-label already names it. */}
      {detail?.title && !muted && (
        <span
          aria-hidden="true"
          data-clip-title
          // Hidden in the GRID: the caption below carries the name there, which
          // is the whole point of giving the cell room for one. Stamping it on
          // the artwork as well would cover the picture to repeat the line
          // directly beneath it.
          className="pointer-events-none absolute inset-x-2 top-2 z-10 truncate rounded bg-black/75 px-1.5 py-0.5 text-[11px] leading-tight font-semibold text-zinc-100 [[data-virtual-grid]_&]:hidden"
        >
          {detail.title}
        </span>
      )}
      {muted && (
        <DisabledChip inherited={node.disabled !== true} />
      )}
      {provenance && <ProvenanceLabel parentId={provenance.parentId} name={provenance.name} />}
      {trimEnabled && !muted && <LiveDurationPill id={id} node={node} />}
      {/* The live trim frame (video only): the source at the edge being
          dragged, floated into the header band for the length of the gesture.
          Rides the same per-node live-trim channel as the pill. Its other
          half, the source map, is docked under the strip by the board. */}
      {trimEnabled && <TrimPanel id={id} node={node} />}
      {/* THE CAPTION — grid only, and the point of the whole restructure.
          Everything here used to be stamped ON the artwork: the name across the
          top, the kind bottom-left, the tags stacked above it. That is right in
          the strip, where a card is as wide as its clip is long and every pixel
          of height is charged to every row. In the grid the cell is already
          tall and boxy for this, so the picture gets to be a picture and the
          words get a line of their own.

          Two rows, following the design: identity first (what is this), then
          data (how long, how filed). Decorative for AT — NodeCard's button
          already names the card, which is why the overlay title it replaces was
          aria-hidden too. */}
      <span
        aria-hidden="true"
        data-clip-caption
        // Metrics MATCH the collection caption's grid values — 6px right, 6px
        // bottom, 10px above (`pt-2.5` against its `mt-2.5`). They were
        // 4px/2px/2px/8px here, so a grid mixing the two card kinds showed two
        // different left edges and two name positions.
        //
        // The left is `7px`, NOT 6, and the odd pixel is the point. A
        // collection card's surface carries a real 1px dashed border, and a
        // border consumes layout under `border-box` where this card's `ring`
        // does not — so an identical 6px padding still lands a pixel to the
        // left of a collection's. This makes up the difference at the caption,
        // which is where the alignment is visible.
        //
        // Deliberately NOT solved by giving this card a matching transparent
        // border: that aligns the caption by moving the card's whole content
        // box, which shifts the artwork and everything positioned off it — it
        // moved the floating trim frame a pixel and the e2e caught it.
        //
        // If either side is retuned, retune both. The alignment is the
        // contract, not the individual numbers, and the stories measure it.
        className="hidden min-w-0 flex-col gap-1 pt-2.5 pr-1.5 pb-1.5 pl-[7px] [[data-virtual-grid]_&]:flex"
      >
        {/* ROW ONE: kind, name, metadata — the collection card's shape. */}
        <span className={CAPTION_ROW_CLASS}>
          {/* `size-4` AND lucide's default stroke, both matching the collection
              caption's Layers glyph.

              The size was the visible half: at `size-3.5` the two icon boxes
              differed by 2px, so every name in a mixed grid started at one of
              two x positions. The WEIGHT was the quieter half — this carried
              `strokeWidth={1.7}` against Layers' default 2, so at identical
              size the media glyph still drew a lighter line than the collection
              beside it. Same size, same weight, same colour: the two card kinds
              lead their captions with one glyph style. */}
          <KindIcon aria-hidden="true" className="size-4 shrink-0 text-zinc-400" />
          {/* Omitted, not blanked, when the clip has no authored name — see
              `captionName`. The icon holds the row's height and left edge, and
              the metadata's `ml-auto` holds its right edge, so the row keeps
              its shape whether or not there is a name between them. */}
          {captionName === null ? null : (
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100">
              {captionName}
            </span>
          )}
          {/* The duration, trailing right — where a collection's count sits. It
              used to head row two, which put a number under the name on media
              and beside it on collections. */}
          <span className={CAPTION_META_CLASS}>
            {captionSeconds > 0 ? (
              <span className="text-sky-300/90" title="Duration">
                {formatDuration(captionSeconds)}
              </span>
            ) : null}
          </span>
        </span>
        {/* ROW TWO: tags, right-justified — and PRESENT even when empty, so a
            tagged card and an untagged one are the same height. See
            CAPTION_TAG_ROW_CLASS. */}
        <span data-clip-caption-tag-row className={`flex ${CAPTION_TAG_ROW_CLASS}`}>
          {detail?.tags?.length ? (
            <CaptionTagRow tags={detail.tags} />
          ) : (
            <CaptionTagRowSpacer />
          )}
        </span>
      </span>
    </span>
  );
});

/** Square overview frames — the strip is h-11 (44px), matching the package
 *  default so only the SAMPLING differs. */
/**
 * The trim overview's background (the "sequence above" a selected video),
 * replacing the package default via the `OverviewContent` registry slot. The
 * default TILES the 1–2 stored posters by modulo — with one poster every
 * frame is the same still, which reads as broken (R7 #2). This samples each
 * slot at its own time across the FULL SOURCE through the same
 * `videoFrameUrls` seam the card filmstrip uses, so the two strips show the
 * same kind of sequence — including the last-slot end-frame pin (R7 #3).
 * The default's "full clip x.xs" readout is dropped on request (R7 #3); the
 * trim readouts around the window already carry the numbers.
 *
 * Memo comparator (mirrors the package default's): the contract carries live
 * trimIn/trimOut that change per pointer move during a drag, but this
 * renderer reads only `node` and `fullWidth` — shallow memo would reconcile
 * up to 40 <img> elements per move for nothing.
 */
const GraphTrimOverviewContent = memo(
  function GraphTrimOverviewContent({ node, fullWidth }: CollectionTrimOverviewContentProps) {
    const posters = node.posterSrcs ?? [];
    // Enough square frames to cover the strip width (ceil so the row fills;
    // the container clips the overflow), capped so a long source stays
    // bounded.
    const frameCount = overviewFrameCount(fullWidth);
    // The overview shows the FULL source (the amber window marks the visible
    // part), so the sample range is [0, fullDurationSeconds] — not the
    // trimmed range the card uses.
    const frameSrcs = videoFrameUrls(posters, frameCount, {
      trimInSeconds: 0,
      effectiveSeconds: Math.max(0, node.fullDurationSeconds),
    });
    return (
      <div className="flex h-full w-full">
        {frameSrcs.length === 0 ? (
          <span className="flex h-full w-full items-center justify-center bg-muted text-[11px] text-muted-foreground select-none">
            No preview frames
          </span>
        ) : (
          frameSrcs.map((src, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={src}
              alt=""
              draggable={false}
              style={{ width: OVERVIEW_FRAME_SIZE }}
              className="h-full shrink-0 border-r border-black/60 object-cover last:border-r-0"
            />
          ))
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.node === next.node &&
    prev.pixelsPerSecond === next.pixelsPerSecond &&
    prev.fullWidth === next.fullWidth,
);

const GraphTrimHandle = memo(function GraphTrimHandle({
  side,
}: CollectionTrimHandleContentProps) {
  // Handles exist only on SELECTED clips (trimRequiresSelection at the
  // provider), so these pixels are always the active affordance — no
  // hover-reveal state for unselected cards to style anymore.
  return (
    <span
      className={[
        // blue-500 — the SELECTION colour (the ring on a selected card, the
        // count in the select row). These handles only exist on a selected
        // clip, so wearing the selection's colour is what ties them to the
        // thing they act on. Amber is left over from when amber WAS the
        // selection colour; once selection moved to blue it read as a second,
        // unrelated accent on the one card already wearing the first.
        "flex h-full w-full items-center justify-center bg-blue-500 opacity-95",
        side === "left" ? "rounded-l-md" : "rounded-r-md",
      ].join(" ")}
    >
      <span className="h-4 w-0.5 rounded bg-black/60" />
    </span>
  );
});

/** A media clip's own frame: a video's poster, an image's source (null when
 *  it has neither — the ghost then falls back to a labelled tile). */
/**
 * The drag ghost: a SQUARE thumbnail of the item being moved (the provider
 * sizes the overlay box square via `dragGhostWidth`/`dragGhostHeight`), so the
 * preview reads as "this picture" rather than a duration-shaped card. A media
 * clip shows its own frame; a COLLECTION shows the same child preview frames
 * its card paints (first/middle/last of its media), derived from the LIVE
 * graph — which is available inside the drag overlay even though the details
 * side-table is not. A poster-less clip, or a collection with no media to
 * show, falls back to a labelled tile so the ghost is never empty or broken.
 */
const GraphGhost = memo(function GraphGhost({ node, extraCount }: CollectionGhostContentProps) {
  const isCollection = node.kind === "collection";
  // Mirror the CARD (GraphCollectionItemParts) exactly, so the ghost shows what
  // the card shows: a HYDRATED collection uses its live recursive preview
  // frames; a placeholder falls back to the stored summary in the details
  // side-table — reachable here now that the provider wraps the drag overlay.
  const detail = useClipDetail(node.id as string);
  const hydrated = detail?.hydrated === true;
  const livePreviews = useHydratedCollectionPreviews(node.id as string, isCollection && hydrated);
  const all: readonly CollectionPreviewFrame[] = isCollection
    ? hydrated
      ? resolveCollectionPreviews(livePreviews, detail?.previewItems)
      : (detail?.previewItems ?? [])
    : [];
  // FIRST and LAST only (or the single frame) — never three, exactly as the
  // card picks its two representative frames.
  const chosen = ghostPreviewFrames(all);
  const derivedFrames: string[] = isCollection
    ? chosen.map((preview) => collectionPreviewFrameUrl(preview)).filter(Boolean)
    : (() => {
        const src = mediaGhostSrc(node);
        return src ? [src] : [];
      })();
  // STICKY for the life of the ghost. A collection's frames are derived from
  // the LIVE graph plus the details table, and both move under us mid-drag:
  // dragging over an un-hydrated collection hydrates it, which re-runs this
  // derivation. Any moment where it yields fewer frames (or none) swapped the
  // thumbnail for the grey fallback tile and back — the flicker into a
  // "disabled-looking" ghost. The ghost is a transient, read-only picture of
  // what is being dragged, so it may only ever GAIN detail, never lose it.
  // (State adjusted during render, not a ref: reading or writing a ref while
  // rendering is a lint error here, and this is the documented pattern.)
  const [bestFrames, setBestFrames] = useState(derivedFrames);
  if (derivedFrames.length > bestFrames.length) setBestFrames(derivedFrames);
  const frames = derivedFrames.length >= bestFrames.length ? derivedFrames : bestFrames;

  return (
    // Slightly transparent so the breadcrumb drop zones read THROUGH the ghost
    // while dragging over them — the user can see where they're aiming.
    <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-md bg-zinc-900 opacity-80 shadow-2xl ring-2 ring-blue-500">
      {frames.length > 0 ? (
        <span className="flex h-full w-full gap-px">
          {frames.map((src, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={src}
              alt=""
              draggable={false}
              className="h-full min-w-0 flex-1 object-cover"
            />
          ))}
        </span>
      ) : isCollection ? (
        <span
          data-empty-collection-ghost
          className="flex h-full w-full items-center justify-center"
        >
          <CollectionGhostGlyph className="h-7 w-7 text-sky-200" />
        </span>
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
          <span className="truncate text-[11px] font-semibold text-zinc-100">{node.name}</span>
          <span className="font-mono text-[11px] text-zinc-400">
            {formatSeconds(mediaDurationSeconds(node))}
          </span>
        </span>
      )}
      {extraCount > 0 && (
        <span className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-blue-500 px-1 text-[11px] font-bold text-black shadow">
          +{extraCount}
        </span>
      )}
    </span>
  );
});

/**
 * The composed collection ITEM, rendered through the package's item-shell
 * seam instead of NodeCard (review finding 1). This card carries INTERACTIVE
 * controls — the folder drill-in and the inline rename editor — and inside
 * NodeCard they had to fake their semantics (`role="button"` span, a
 * contentEditable "textbox") because real ones can't nest in the card
 * <button>. Here the CollectionItem primitives keep the package behavior
 * (drag, selection, keyboard grab, drop indicators, FLIP identity) and the
 * controls compose as SIBLINGS of the selection surface: a real <button> and
 * a real <input>, legally.
 */
const GraphCollectionItemParts = memo(function GraphCollectionItemParts({
  dragActivation,
}: {
  dragActivation: NodeCardDragActivation;
}) {
  const { id, node, childCount, selected, rejected, isDragSource } = useCollectionItemState();
  const detail = useClipDetail(id as string);
  // Same source of truth as the tree/breadcrumb, so a rename shows here too.
  const title = useTimelineTitle(id as string);
  const rename = useInlineRename(id, title ?? node.name, "card");
  const nav = useContext(GraphViewNavContext);
  const calledOut = useCollectionHoverTarget(id as string);
  // Hydrated collections derive their preview frames and total duration from
  // live children (like the count), so editing a loaded child refreshes this
  // card without a reload; placeholders fall back to their stored summary.
  const hydrated = detail?.hydrated === true;
  const enabledChildCount = useEnabledChildCount(id);
  // Audio has no frame, so a collection leading with it has no thumbnail to
  // show — see useFirstChildIsAudio.
  const leadsWithAudio = useFirstChildIsAudio(id);
  const liveSeconds = useHydratedCollectionSeconds(id as string, hydrated);

  // ENABLED children only, so the card agrees with the time totals and with
  // the served summary (which derives itemCount from the effective document).
  // `childCount` from the primitive counts every child, disabled included.
  const count = hydrated ? enabledChildCount : (detail?.itemCount ?? enabledChildCount);
  // Playable seconds both ways: live for a hydrated collection, and for a
  // placeholder the stored `playableDuration` summary — falling back to
  // `duration` for documents saved before the split, where the two are equal.
  const totalSeconds = hydrated ? liveSeconds : (detail?.playableDuration ?? detail?.duration);
  const previews = useCollectionPreviewFrames(id as string, hydrated, detail?.previewItems);
  const displayName = title ?? node.name;
  const inheritedDisabled = useDisabledByAncestor(id);
  const filterMiss = useTagFilterMiss(id as string);
  const selectMode = useCollectionsSelector((s) => s.interaction.multiSelectMode);
  const muted = node.disabled === true || inheritedDisabled;
  // Anchor state is not read here any more: `CardCornerSlot` subscribes to it
  // itself, narrowed to this node, so an anchor moving between two OTHER cards
  // no longer re-renders this whole card body.

  return (
    <>
      {/* Interaction split: the surface (card body) SELECTS — like any clip —
          and drags; only the folder button below drills in. Selected cards
          can then be trashed with Delete alongside media. */}
      <CollectionItem.SelectionSurface
        dragActivation={dragActivation === "hold" ? "hold" : "body"}
        // Announce the count the card actually SHOWS — the stored summary for a
        // placeholder, the live children once hydrated. The primitive's default
        // reads live childCount alone, which speaks "0 items" over a card
        // displaying "9" until its clips load.
        ariaLabel={`${displayName} (collection, ${count} ${count === 1 ? "item" : "items"})`}
        className={[
          // `relative` so the disabled chip below can pin to this card's own
          // top-right corner rather than some ancestor's.
          "relative flex h-full w-full flex-col justify-between overflow-hidden rounded-md border border-dashed border-sky-500/40 bg-sky-500/[0.08] p-1.5",
          selected ? "ring-2 ring-inset ring-blue-500" : "",
          rejected ? "ring-2 ring-red-500 motion-safe:animate-pulse" : "",
          // No `data-disabled` twin here: SelectionSurface takes an explicit
          // prop list with no rest spread, so a hyphenated attribute passed to
          // it is silently dropped — and TS does not flag it, because excess
          // property checks skip hyphenated JSX names. The marker classes below
          // are what tests and e2e can query on a collection card; the
          // inherited one gets its own so the two causes stay separable, the
          // way `data-disabled`'s values do on a media card.
          muted ? "is-disabled-card" : "",
          muted && node.disabled !== true ? "is-parent-disabled-card" : "",
          // PL10-001: the call-out lives ON the card because it SCALES the
          // card — a transform on the inset overlay this used to be would
          // animate nothing anyone can see. Same marker-class trick as the
          // disabled states above, and for the same reason: a hyphenated
          // `data-` attribute passed to SelectionSurface is silently dropped.
          //
          // Toggling the class is also what restarts the one-shot. Moving
          // between folders drops it off one card and adds it to the next, so
          // the animation re-fires without a counter or a manual restart, and
          // re-entering the same folder replays it.
          calledOut ? "is-called-out-card animate-collection-paired-callout" : "",
        ].join(" ")}
      >
        {muted && <DisabledChip inherited={node.disabled !== true} />}
        {/* Collections are taggable too — `tags` sits on TimelineItemBase, not
            on the media members — and they route through THIS component rather
            than GraphClipContent (which returns null for them at the guard
            above). Skipping it here would ship a half-feature where a tagged
            collection silently shows nothing. */}
        {/* NO tag row in the strip — see the note on the media card's, which
            this used to mirror. Collections keep theirs in the GRID caption
            (further down), so the two card kinds still file tags in the same
            place as each other. */}
        <span
          data-disabled-visuals={muted ? "true" : undefined}
          data-filter-miss={filterMiss ? "true" : undefined}
          // `relative`, so the checkbox below anchors to the PREVIEW FRAMES
          // rather than to the whole card. Anchored to the card it landed on
          // the name-and-count row underneath and truncated it ("51.8s / 5
          // it…"), because that row is inside the selection surface too.
          className={[
            "relative flex min-h-0 flex-1 gap-0.5 overflow-hidden",
            isDragSource ? "opacity-40" : muted ? "opacity-45" : filterMiss ? "opacity-30" : "",
            muted ? "grayscale" : "",
            "motion-safe:transition-opacity motion-safe:duration-150",
          ].join(" ")}
        >
          {/* Collections get the same checkbox as media, and they are the cards
              that need it most: a plain click drills INTO a collection now, so
              select mode is the only pointer route to picking one at all — and
              on hover this is the only thing that says so. */}
          <SelectionIndicator
            id={id}
            selected={selected}
            armed={selectMode}
            revealOnHover={SELECT_HOVER_REVEAL_COLLECTION}
          />
          {/* THE COLLECTION MARK, dead centre over the frames.
              A collection's frames are its children's pictures, so at a glance
              the card looks like the media inside it — the dashed border and
              the caption glyph both say "collection" at the EDGES, where the
              eye is not. This says it over the picture itself.

              Half-opacity on purpose: it has to be legible without hiding the
              frame it sits on, since the frame is how you recognise WHICH
              collection this is. `pointer-events-none` keeps the card's own
              click, drag and checkbox untouched, and it is `aria-hidden`
              because the surface's label already announces "collection".

              Only over real frames — the empty state below draws its own
              placeholder, and two glyphs stacked would just read as a bug. */}
          {previews.length > 0 ? (
            <span
              data-collection-mark
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
            >
              <Layers
                className="h-10 w-10 text-white opacity-50 drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]"
                strokeWidth={1.5}
              />
            </span>
          ) : null}
          {previews.length === 0 ? (
            <span
              data-empty-collection-preview
              data-collection-preview-kind={leadsWithAudio ? "audio" : "leader"}
              aria-hidden="true"
              className="flex flex-1 items-center justify-center overflow-hidden rounded-sm"
            >
              {/* The film leader means "no picture". For a collection of voice
                  takes that is the wrong sentence — the right one is "this is
                  sound", and the audio card's own glyph already says it. */}
              {leadsWithAudio ? <AudioPlaceholder /> : <CollectionLeaderPlaceholder />}
            </span>
          ) : (
            previews.map((preview, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                // Key by the SLOT, not the content. `previews` is a
                // fixed-length, order-stable first/last pair; keying by
                // `preview.id` both collides (the same asset can be both the
                // first and last frame) AND remounts the <img> whenever a child
                // edit changes which clip is first/last — flashing an
                // already-loaded frame. The slot is the stable identity, so the
                // element persists and only its `src` swaps.
                key={index}
                src={collectionPreviewFrameUrl(preview)}
                alt=""
                draggable={false}
                loading="lazy"
                className="h-full min-w-0 flex-1 rounded-sm object-cover"
              />
            ))
          )}
        </span>
        <span
          data-collection-metadata
          // Whether this card's numbers come from LIVE children or from the
          // stored summary. The two look identical now that the placeholder's
          // "Open to load" text is gone (PL6-001 made the empty preview
          // icon-only), and hydration decides whether a drop into this
          // collection is legal at all — so the state needs to stay
          // observable to the drop-policy e2e that asserts on it.
          data-collection-hydrated={hydrated ? "true" : "false"}
          // The grid-scoped variants are what make the two surfaces read as
          // different objects rather than the same card wrapped. A grid cell is
          // boxy and tall (see ITEM_SIZE_DIMENSIONS) precisely so this row can
          // be a real caption; in the strip it stays a tight one-line footer,
          // because height there is pure overhead on every clip.
          //
          // Scoped by the container's own `data-virtual-grid` marker rather
          // than by a prop: the card renderer is shared by both surfaces and
          // has no idea which one it is in, and threading that down just to
          // change two font sizes would put a layout concern into the item
          // contract.
          className={[
            "mt-1.5 flex items-center justify-between gap-1.5 pl-1 pb-0.5",
            // GRID: no bottom padding, because this is no longer the caption's
            // last row — the tag row below carries the caption's bottom edge and
            // the 4px between the two. Left as-is in the STRIP, where this row
            // IS the footer and there is nothing under it.
            // `min-h-5` in the grid, matching CAPTION_ROW_CLASS on the media
            // card: row one is a text line tall whether or not it holds text,
            // so a nameless card is not shorter than a named one.
            "[[data-virtual-grid]_&]:mt-2.5 [[data-virtual-grid]_&]:min-h-5 [[data-virtual-grid]_&]:pl-1.5 [[data-virtual-grid]_&]:pb-0",
            muted ? "pr-[4.75rem]" : "pr-1 [[data-virtual-grid]_&]:pr-1.5",
          ].join(" ")}
        >
          {/* The KIND, as an icon leading the name — the same shape the media
              caption has ([icon] name), so the two card kinds read as one
              family instead of two. Grid only: the strip's footer is a tight
              one-liner where this would cost more than it says.

              A LABEL, not a control. The same Layers glyph used to sit in the
              card's top-right corner as a drill button; that button is gone
              (a plain click opens the collection now), and the glyph earns its
              place here by naming the card kind instead of duplicating the
              card's own gesture. Nothing about it should ever become clickable
              — the story below pins that. */}
          <Layers
            data-collection-kind
            aria-hidden="true"
            className="hidden size-4 shrink-0 text-zinc-400 [[data-virtual-grid]_&]:block"
          />
          <span
            // ONE CLICK RENAMES. The name already swallowed the click — it had
            // to, because a plain click on the card DRILLS IN, which unmounts
            // this card before a second click can land, and that is what broke
            // double-click-to-rename in the first place. So the click was being
            // caught and thrown away: the label's advertised gesture cost two
            // presses while one press did nothing at all. It now does the thing
            // the label is for.
            //
            // `stopPropagation` is still what makes it work — without it the
            // drill-in fires underneath and navigates away from the field that
            // just opened. React's synthetic bubbling never reaches the
            // surface's handler.
            onClick={(event) => {
              event.stopPropagation();
              rename.begin();
              // (keyboard: F2 on the focused card — see OpenKeyBoundary)
            }}
            title="Click or press F2 to rename"
            className={[
              "min-w-0 flex-1 cursor-text truncate text-xs font-semibold text-zinc-100",
              "[[data-virtual-grid]_&]:text-sm",
              // HOVER SAYS IT IS A FIELD. A one-click target that looks exactly
              // like static text is a trap in both directions: nobody discovers
              // the rename, and anyone aiming at the card is surprised by an
              // editor. The tint is the same shape the field itself takes, so
              // the hover reads as a preview of what the click opens.
              //
              // Negative margin against the padding, so the hit area grows
              // without the name shifting sideways on hover — and without it
              // taking width from the count beside it at rest.
              "-mx-1 rounded-sm px-1 transition-colors hover:bg-white/10",
            ].join(" ")}
          >
            {displayName}
          </span>
          <span className={CAPTION_META_CLASS}>
            {typeof totalSeconds === "number" && totalSeconds > 0 ? (
              <>
                <span className="text-sky-300/90" title="Total duration of contents">
                  {formatDuration(totalSeconds)}
                </span>
                <span aria-hidden="true" className="text-zinc-500">
                  /
                </span>
              </>
            ) : null}
            <span>
              {count} {count === 1 ? "item" : "items"}
            </span>
          </span>
        </span>
        {/* ROW TWO: the collection's tags, right-justified — the media card's
            second row exactly, from the same two constants.

            ALWAYS RENDERED in the grid, empty or not. It used to appear only
            when there were tags, which made a tagged collection taller than an
            untagged one sitting beside it. `data-collection-caption-tags` still
            carries the count, so a test can tell "no tags" from "no row".

            Grid-only, like everything else in this caption: the strip's footer
            is a tight one-liner with no room for a second row. */}
        <span
          aria-hidden="true"
          data-collection-caption-tags={detail?.tags?.length ?? 0}
          // `pt-1` is the media caption's `gap-1` written as padding: these two
          // rows are siblings on the selection surface rather than children of
          // one flex column (row one is the STRIP's footer too, so it cannot be
          // moved into a grid-only wrapper), and a gap needs a shared parent.
          // Same 4px either way — the stories measure the two captions against
          // each other rather than trusting that.
          className={[
            "hidden pt-1 pr-1.5 pb-1.5 pl-1.5",
            "[[data-virtual-grid]_&]:flex",
            CAPTION_TAG_ROW_CLASS,
          ].join(" ")}
        >
          {detail?.tags?.length ? (
            <CaptionTagRow tags={detail.tags} />
          ) : (
            <CaptionTagRowSpacer />
          )}
        </span>
      </CollectionItem.SelectionSurface>

      {/* (PL10-001 moved the call-out itself onto the selection surface above.
          The overlay span that used to live here painted a glow; a scale has
          to be on the card, and an element's own `overflow-hidden` clips its
          children, never its own transform.) */}

      {/* The card's controls, as ONE cluster in the top-right: drill, then
          details. Both were placed independently before — details at the top
          corner, the drill badge down at the artwork's bottom edge — which read
          as two unrelated marks and made the drill's offset a per-surface
          tuning problem against the label row's height. Grouped, they align by
          construction, and a media card's single control lands in exactly the
          same place.

          The chevron sits nearest the corner deliberately: read left to right,
          the mark closest to the edge is the one that takes you past it.

          Still real buttons composed as SIBLINGS of the selection surface — a
          button inside the surface's button would be invalid HTML, which is why
          this is positioned rather than placed. Pointer-only: tabIndex -1 keeps
          roving views at one tab stop per item, keyboard drill-in stays on the
          O key (OpenKeyBoundary), and data-collections-keyboard-ignore excludes
          them from the strip's pan surface (isPannableStripSurface), so a press
          here never scrolls the strip out from under it. */}
      {/* (No selected-badge here any more — see the note by the checkbox. R5.3
          was "every selected card keeps its badge, the anchor included", and
          that stays true of the marks that remain: the ring is on every
          selected card, anchor or not, so nothing reads as almost-selected.) */}
      {/* THE DRILL CONTROL IS GONE. The slot now hosts only the anchor's `⋮`.

          It was the one pointer route into a collection back when a plain click
          SELECTED the card. The click opens it now — the whole card, not a
          28px corner — so the button was a second way to do the easy thing,
          sitting permanently over the artwork of every collection card. The
          caption's Layers icon says "this is a stack of timelines" without
          claiming to be a control.

          Keyboard drill-in is unaffected: O still opens the focused collection
          (OpenKeyBoundary), which was always the pointerless twin of this. */}
      <CardCornerSlot
        nodeId={id}
      />

      {/* The rename editor — a REAL input, overlaying the label row while
          editing. A sibling of the surface, so it nests in no button. */}
      {rename.editing && (
        <InlineNameEditor
          initialValue={displayName}
          onInput={rename.setDraft}
          onCommit={rename.commit}
          onCancel={rename.cancel}
          className="absolute inset-x-2.5 bottom-2 z-20 rounded-sm bg-zinc-950/95 px-1 py-0.5 text-xs font-semibold text-zinc-100 outline-none ring-1 ring-blue-500/70"
        />
      )}

      {/* Same control the media card carries (PL11-012): a timeline has
          details worth reading — what is inside it, how long it runs, whether
          it is loaded — without drilling in to find out. */}

      <CollectionItem.DropIndicators />
    </>
  );
});

const GraphCollectionItem = memo(function GraphCollectionItem({
  id,
  className,
  dragActivation = "body",
  rovingTabIndex,
}: CollectionItemShellProps) {
  return (
    <CollectionItem.Root
      id={id}
      rovingTabIndex={rovingTabIndex}
      className={[
        "group/collection-item h-full w-full",
        // PL10-003: the call-out's scale pushes the card ~7px past this
        // wrapper, and a transform that spills counts as SCROLLABLE overflow —
        // so calling out the last card in a strip or a grid row grew the
        // scroller and flashed a scrollbar for the length of the animation.
        //
        // `clip` (not `hidden`) makes this box swallow that overflow without
        // becoming a scroll container itself, and the clip margin is what keeps
        // it from being a cure worse than the disease: the card's own growth
        // (~7px) stays visible, and so do the drop-indicator bars, which sit
        // half a gap OUTSIDE the card by design.
        "overflow-clip [overflow-clip-margin:12px]",
        className ?? "",
      ].join(" ")}
    >
      <GraphCollectionItemParts dragActivation={dragActivation} />
    </CollectionItem.Root>
  );
});

/**
 * The details trigger (PL11-002, both card kinds since PL11-012): top-right,
 * revealed on hover or keyboard focus, and a real tab stop when its card is
 * the roving one.
 *
 * It is a SIBLING of NodeCard, not a child. NodeCard's shell is a single
 * `<button>`, and a button inside a button is invalid HTML — the same
 * constraint that put this control in the toolbar to begin with, and that
 * made the collection rename a contentEditable span. Living outside that
 * button also means a press here never reaches the card's drag wiring.
 *
 * `tabIndex` follows the surface's ROVING value rather than being a flat 0:
 * a virtualized strip mounts dozens of cards, and a fixed tab stop per card
 * would put dozens of them in the tab order. Roving keeps the surface at one
 * stop; this adds exactly one more, on the card the user is actually on.
 */
/*
 * REMOVED (PL13-009): `ItemDetailsTrigger`, the per-card button that opened the
 * details view.
 *
 * It was a control on the artwork of every card — and PL13-005 had just made it
 * permanent, so both card kinds carried a standing mark for a view most people
 * open rarely. Details is an item ACTION now, first in the sidebar's contextual
 * cluster, disabled unless exactly one item is selected. That also settles the
 * consistency question that produced PL13-005 (where should the trigger sit on
 * each card kind) by not having one.
 *
 * Its `openId`-and-also-select coupling went with it: from the rail the
 * selection is the input, so the details listener reads it rather than setting
 * it (see graph-item-details-context).
 */


/**
 * The media card: the stock NodeCard, wrapped so a details trigger and a
 * rename editor can sit BESIDE it. The wrapper carries the surface's sizing
 * className and the hover group; NodeCard fills it.
 *
 * The editor is a sibling for the reason everything else here is: NodeCard's
 * shell is a `<button>`, and an `<input>` inside it is invalid interactive
 * content. Naming a run of similar clips is arrow → F2 → type → Enter →
 * arrow, with no modal in the loop (PL11-005) — the same grammar the
 * collection card, breadcrumb and sub-timeline row already share.
 */
const GraphMediaItem = memo(function GraphMediaItem({
  className,
  ...props
}: CollectionItemShellProps) {
  const node = useCollectionsSelector((s) => s.graph.nodesById.get(props.id) ?? null);
  // (A per-card `selectedIds` subscription lived here to drive the amber
  // selected-badge, which was a SIBLING of NodeCard's shell because a span
  // inside the card's `<button>` would still be inside a button. The badge is
  // gone and the marks that replaced it live inside the card, where NodeCard
  // already knows its own selection — so this shell no longer subscribes at
  // all, and a selection change on the board re-renders one card fewer.)
  const detail = useClipDetail(props.id as string);
  // Seeded with the AUTHORED title when there is one, so re-naming edits what
  // the user wrote rather than making them delete a filename first.
  const rename = useInlineRename(props.id, detail?.title ?? "", "card");
  // A clip's width is its DURATION, so this card can be 12px across. The corner
  // control is measured against that (see ClipCornerSlot) — the one place v3
  // still cares how wide a card is, and it answers with "render it or don't"
  // rather than with a fold ladder.
  const [sizeRef, size] = useElementSize();

  return (
    <div ref={sizeRef} className={["group/media-item relative", className ?? ""].join(" ")}>
      <NodeCard {...props} className="h-full w-full" />
      {/* (The selected-badge that used to sit here is gone with its collection
          twin. It was the mark that had to clear a selected clip's LEFT trim
          handle; nothing occupies that corner now, so only the `⋮` below still
          owes the handles clearance.) */}
      {/* A clip has no chevron to morph, so the `⋮` simply fades in (R5.6).
          No chevron is added here for symmetry. */}
      <ClipCornerSlot nodeId={props.id} width={size.width} />
      {rename.editing && node?.kind === "media" && (
        <InlineNameEditor
          initialValue={detail?.title ?? ""}
          onInput={rename.setDraft}
          onCommit={rename.commit}
          onCancel={rename.cancel}
          ariaLabel="Clip name"
          className="absolute inset-x-1 top-1 z-30 rounded-sm bg-zinc-950/95 px-1 py-0.5 text-[11px] font-semibold text-zinc-100 outline-none ring-1 ring-blue-500/70"
        />
      )}
    </div>
  );
});

/**
 * The graph's per-item renderer (registered as the provider `ItemShell`):
 * media keeps the stock NodeCard shell (its content is presentational, so the
 * single-button card is exactly right) with the details trigger beside it;
 * collections get the composed card above. The kind subscription is a
 * primitive, so the dispatcher re-renders only if a node changes kind — which
 * never happens after creation.
 */
/**
 * This card's two clipboard states, each subscribed PER NODE.
 *
 * Narrowed on purpose. Both stores publish a set of ids, and reading the set
 * would re-render every card on the board whenever anything anywhere was cut or
 * pasted — the package's render-efficiency invariant, and the mistake the
 * context menu's state hook already exists to avoid. Asking "is it me?" returns
 * a boolean that does not move for an uninvolved card.
 */
function useCardClipboardState(id: NodeId): Readonly<{
  pendingCut: boolean;
  flashing: boolean;
}> {
  const pendingCut = useSyncExternalStore(
    graphClipboard.subscribe,
    () => graphClipboard.isPendingCut(id),
    () => false,
  );
  const flashing = useSyncExternalStore(
    graphPasteFlash.subscribe,
    () => graphPasteFlash.isFlashing(id),
    () => false,
  );
  return { pendingCut, flashing };
}

const GraphItemShell = memo(function GraphItemShell(props: CollectionItemShellProps) {
  const isCollection = useCollectionsSelector(
    (s) => s.graph.nodesById.get(props.id)?.kind === "collection",
  );
  const { pendingCut, flashing } = useCardClipboardState(props.id);
  // Merged into the content root's own class rather than painted here: the
  // shell is a transparent interaction layer and all pixels belong to the
  // content, which is also the only element in this chain with a box — the
  // wrapper below is `display: contents` so the strip's width measurements
  // cannot see it.
  const className = [
    props.className ?? "",
    // Cut, not yet pasted: still here, still yours, visibly waiting (R9.9).
    pendingCut ? "opacity-50" : "",
    // Just arrived from a paste. `transition-shadow` is what makes it FADE
    // rather than blink out when the flash store clears — Tailwind's ring is a
    // box-shadow, so the same transition covers both ends.
    "transition-shadow duration-500 motion-reduce:transition-none",
    flashing ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-950" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // The right-click menu wraps at the SHELL (PL14-007), which is the one place
  // both card kinds pass through — so collections and media get it from a
  // single wiring rather than each content component growing its own.
  return (
    <GraphItemContextMenu nodeId={props.id}>
      {/* `display: contents`, for the same reason the context-menu trigger is:
          this sits inside a virtualized strip that measures item widths, and an
          extra layout box would change them. It exists to carry the state as an
          ATTRIBUTE — the classes above say how it looks, this says what it is,
          which is what a test can ask about. */}
      <span
        className="contents"
        data-card-pending-cut={pendingCut ? "true" : undefined}
        data-card-just-pasted={flashing ? "true" : undefined}
      >
        {isCollection ? (
          <GraphCollectionItem {...props} className={className} />
        ) : (
          <GraphMediaItem {...props} className={className} />
        )}
      </span>
    </GraphItemContextMenu>
  );
});

export const GRAPH_VIEW_COMPONENTS: CollectionsComponents = {
  ItemContent: GraphClipContent,
  ItemShell: GraphItemShell,
  TrimHandleContent: GraphTrimHandle,
  OverviewContent: GraphTrimOverviewContent,
  GhostContent: GraphGhost,
};
