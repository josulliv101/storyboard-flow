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
import { Check, CornerRightDown, Layers } from "lucide-react";

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
  sawChildlessCollection: false,
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
        `${result.sawChildlessCollection ? 1 : 0}\x02` +
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
  return useMemo(() => (all.length > 1 ? [all[0]] : all), [all]);
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

  if (parentId === null || focusedId === null) return null;
  if ((parentId as string) === focusedId) return null;
  return { parentId, name: title ?? nodeName ?? (parentId as string) };
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
          : "bg-zinc-950/95 text-amber-200",
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
 * It earns its place by making a MULTI-selection legible. The `ring-amber-300`
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
/** Left/right inset, shared by every card kind. */
export const CARD_CONTROL_INSET_LEFT = "left-5";
export const CARD_CONTROL_INSET_RIGHT = "right-5";
/** Top inset, `top-3` (12px) rather than the `top-2` these started at: at
 *  8px the controls sat tight under the card's edge once they grew to 28px.
 *  The badge and the corner slot are TOP-ALIGNED and must move together, so
 *  `CardCornerSlot` in graph-anchor-menu carries the literal twin of this —
 *  it cannot import from here without a cycle. */
export const CARD_CONTROL_INSET_TOP = "top-3";

function CardSelectedBadge() {
  return (
    <span
      data-card-selected-badge
      aria-hidden="true"
      className={[
        "pointer-events-none absolute top-3 z-20 flex items-center justify-center",
        // NO CHIP, deliberately — this is a STATUS MARK, not a control.
        //
        // It has been three things, and the middle one is the instructive
        // failure. It began as a filled amber block, which at equal measured
        // size read as larger than its two siblings (irradiation: a bright
        // shape on a dark ground appears to expand past its own edges). The fix
        // for that was to give it the same dark chip the drill and overflow
        // controls wear — which cured the size illusion and immediately caused
        // a worse problem: it then looked exactly like the two things beside it
        // that ARE buttons, while being `pointer-events-none`. Matching the
        // controls' surface is matching their AFFORDANCE, and the affordance is
        // a lie here.
        //
        // A bare glyph carries no surface and so promises no press. The dark
        // halo does the work the chip used to: it is what keeps amber legible
        // over bright artwork, without drawing a pressable-looking box.
        //
        // Amber stays — it is the selection colour (PL13-006), and that meaning
        // has to survive however the mark is drawn.
        "text-amber-300",
        // FOUR passes, and the mix is the point. Three tight ones stack into a
        // dense hard edge — each pass darkens what the last left translucent,
        // which is how a blur becomes an outline — and the fourth, wider and
        // softer, drops the artwork immediately around the mark so amber still
        // separates from a sunlit frame.
        //
        // Two tight passes was the first attempt and it vanished on bright
        // thumbnails: enough to define the glyph against mid tones, nowhere near
        // enough against a lit sky. A single heavier blur is not the fix either
        // — it reads as a smudge under the mark rather than an edge around it.
        "[filter:drop-shadow(0_0_1.5px_rgb(9_9_11))_drop-shadow(0_0_1.5px_rgb(9_9_11))_drop-shadow(0_0_1.5px_rgb(9_9_11))_drop-shadow(0_0_3px_rgb(0_0_0/0.85))]",
        CARD_CONTROL_INSET_LEFT,
      ].join(" ")}
    >
      {/* size-6 and a heavy stroke, where the CONTROLS use size-5 at lucide's
          default. Deliberately not matched: those glyphs sit inside a 28px chip
          that lends them presence, and this one has none, so an identical glyph
          would read as the smaller, fainter mark of the three. */}
      <Check className="size-6" strokeWidth={3} />
    </span>
  );
}

/** The drill mark: CornerRightDown — turn and descend, the verb "go into this
 *  timeline". NOT a folder, despite what this was called until PL13-004: the
 *  old name read as a container mark, which is how it ended up paired with a
 *  chevron in the drill badge — two direction arrows for one act. The
 *  sidebar's FolderTree toggles whether the children tree is SHOWN, a
 *  different verb that deliberately does not share this icon. */
/**
 * The look every CARD-LEVEL control shares: a 28px square on the card's right
 * edge, dark enough to sit on artwork, always visible.
 *
 * Shared so a card reads as having ONE kind of control rather than a collection
 * of one-offs. Before this the details trigger and the drill badge differed in
 * corner, shape, colour and reveal rule — four differences, which is why they
 * looked unrelated. Position and focus ring stay with the caller; everything
 * else is here.
 *
 * It must LOOK pressable, which took two things (PL14-002):
 *
 * - `cursor-pointer` is not redundant. Tailwind v4's preflight stopped setting
 *   it on `<button>`, so every control wearing this class fell back to the UA
 *   arrow — the one cue that says "this is a control and not a decal" was
 *   simply absent.
 * - The hover was `bg-zinc-950/80 → bg-zinc-900`: near-black onto near-black,
 *   a step too small to register over artwork. `zinc-800` is a visible change
 *   at the same neutral temperature. Deliberately NOT amber or sky — amber is
 *   the selection colour (PL13-006) and colouring a hover with it would say
 *   "selected" about a thing you are merely pointing at.
 */
const CARD_CONTROL_CLASS = [
  "z-20 flex size-7 shrink-0 items-center justify-center rounded",
  "bg-zinc-950/80 text-zinc-300 shadow-sm shadow-black/40 backdrop-blur-[1px]",
  "cursor-pointer transition-colors hover:bg-zinc-800 hover:text-zinc-50",
].join(" ");

// (The corner cluster's own positioning moved into `CardCornerSlot` in
// graph-anchor-menu.tsx, which is what now owns that corner on both card
// kinds. Its 8px inset is still shared with `CardSelectedBadge` in the
// opposite corner — see the note there; the two are top-aligned and move
// together.)

function CollectionDrillGlyph({ className }: Readonly<{ className?: string }>) {
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
  const measuredFrames =
    cardSize.height > 0 ? Math.round(cardSize.width / cardSize.height) : 0;
  const settledFrames = useSettledFrameCount(measuredFrames);
  // Above the collection early-return below — hooks may not be conditional.
  const inheritedDisabled = useDisabledByAncestor(id);
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
  const muted = node.disabled === true || inheritedDisabled;
  // A wider clip shows MORE distinct frames rather than the same still tiled
  // — falling back to a duration-based count until first measured.
  const frames = isVideo
    ? Math.max(
        1,
        Math.min(settledFrames || videoFrameCount(mediaDurationSeconds(node), 6), VIDEO_FRAME_CAP),
      )
    : 1;
  // Each video frame is sampled at its own time across the visible clip (R6
  // #6); an image is just its one src.
  const frameSrcs =
    node.mediaKind === "video"
      ? videoFrameUrls(node.posterSrcs ?? [], frames, {
          trimInSeconds: node.trimInSeconds,
          effectiveSeconds: mediaDurationSeconds(node),
        })
      : node.src
        ? [node.src]
        : [];
  return (
    <span
      ref={cardSizeRef}
      className={[
        // p-1.5 on BOTH surfaces: the artwork is inset like the collection
        // card's (its frame + label row keep its pixels off the card edges),
        // so media and collections read as the SAME height and the artwork
        // stays clear of the seek rail riding above — the strip's rail has
        // the identical adjacency, so full-bleed pressed into it there too.
        // The card's outer box (and so width = duration) is unchanged.
        "relative flex h-full w-full overflow-hidden rounded-md bg-zinc-900 p-1.5",
        selected ? "ring-1 ring-inset ring-amber-300/65" : "ring-1 ring-white/15",
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
      <span
        data-disabled-visuals={muted ? "true" : undefined}
        className={[
          "relative flex h-full w-full overflow-hidden rounded-sm",
          isDragSource ? "opacity-40" : muted ? "opacity-45" : "",
          muted ? "grayscale" : "",
        ].join(" ")}
      >
      {frameSrcs.length === 0 ? (
        <span className="flex h-full w-full items-center justify-center text-[11px] text-zinc-500">
          No preview
        </span>
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
      {/* Kind tag (R6 #7): a WORD, bottom-left. The glyph version (a 4px film
          or picture icon in the top corner) was ambiguous at small item sizes
          — the two lucide marks read as the same smudge — so it says which it
          is. Bottom-left pairs it with the duration pill on the right without
          either covering the artwork's centre. Decorative for AT (the card's
          own label names the clip). */}
      <span
        aria-hidden="true"
        data-media-kind={isVideo ? "video" : "image"}
        className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] leading-none font-semibold tracking-[0.08em] text-zinc-100"
      >
        {isVideo ? "VIDEO" : "IMAGE"}
      </span>
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
          className="pointer-events-none absolute inset-x-2 top-2 z-10 truncate rounded bg-black/75 px-1.5 py-0.5 text-[11px] leading-tight font-semibold text-zinc-100"
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
    </span>
  );
});

/** Square overview frames — the strip is h-11 (44px), matching the package
 *  default so only the SAMPLING differs. */
const OVERVIEW_FRAME_SIZE = 44;
const OVERVIEW_FRAME_CAP = 40;

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
    const frameCount = Math.max(
      1,
      Math.min(OVERVIEW_FRAME_CAP, Math.ceil(fullWidth / OVERVIEW_FRAME_SIZE)),
    );
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
        "flex h-full w-full items-center justify-center bg-amber-400 opacity-95",
        side === "left" ? "rounded-l-md" : "rounded-r-md",
      ].join(" ")}
    >
      <span className="h-4 w-0.5 rounded bg-black/60" />
    </span>
  );
});

/** A media clip's own frame: a video's poster, an image's source (null when
 *  it has neither — the ghost then falls back to a labelled tile). */
function mediaGhostSrc(node: CollectionGhostContentProps["node"]): string | null {
  if (node.kind !== "media") return null;
  return node.mediaKind === "video" ? (node.posterSrcs?.[0] ?? null) : (node.src ?? null);
}

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
  const chosen = all.length > 1 ? [all[0], all[all.length - 1]] : all;
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
    <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-md bg-zinc-900 opacity-80 shadow-2xl ring-2 ring-amber-400">
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
          <CollectionDrillGlyph className="h-7 w-7 text-sky-200" />
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
        <span className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-400 px-1 text-[11px] font-bold text-black shadow">
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
          selected ? "ring-1 ring-inset ring-amber-300/65" : "",
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
        <span
          data-disabled-visuals={muted ? "true" : undefined}
          className={[
            "flex min-h-0 flex-1 gap-0.5 overflow-hidden",
            isDragSource ? "opacity-40" : muted ? "opacity-45" : "",
            muted ? "grayscale" : "",
          ].join(" ")}
        >
          {previews.length === 0 ? (
            <span
              data-empty-collection-preview
              aria-hidden="true"
              className="flex flex-1 items-center justify-center overflow-hidden rounded-sm"
            >
              <CollectionLeaderPlaceholder />
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
            "[[data-virtual-grid]_&]:mt-2.5 [[data-virtual-grid]_&]:pl-1.5 [[data-virtual-grid]_&]:pb-1.5",
            muted ? "pr-[4.75rem]" : "pr-1 [[data-virtual-grid]_&]:pr-1.5",
          ].join(" ")}
        >
          <span
            onDoubleClick={(event) => {
              event.stopPropagation();
              rename.begin();
              // (keyboard: F2 on the focused card — see OpenKeyBoundary)
            }}
            title="Double-click or press F2 to rename"
            className="min-w-0 flex-1 cursor-text truncate text-xs font-semibold text-zinc-100 [[data-virtual-grid]_&]:text-sm"
          >
            {displayName}
          </span>
          <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] font-medium text-zinc-300 [[data-virtual-grid]_&]:text-xs">
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
      {/* Every selected card keeps its badge, the anchor included (R5.3). In
          v2 the anchor gave it up to make room for a toolbar in the same band,
          and the missing checkmark was doing double duty as "this is the
          anchor" — which meant the anchor read as the one selected card that
          was not quite selected. The `⋮` and its count say "anchor" now, so the
          selection signal can be consistent across all of them. */}
      {selected && <CardSelectedBadge />}
      {/* One slot, two controls: the drill chevron, and — on the anchor — the
          `⋮` it cross-fades into (R6.2). Same corner, same inset, same size,
          so the swap costs no layout and leaves no gap. */}
      <CardCornerSlot
        nodeId={id}
        chevron={
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Open ${displayName}`}
            title="Open this timeline"
            data-collections-keyboard-ignore
            onClick={(event) => {
              event.stopPropagation();
              nav?.openTimeline(id);
            }}
            className={[
              CARD_CONTROL_CLASS,
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300",
            ].join(" ")}
          >
            {/* LAYERS, not a direction arrow.
                This was a chevron, on the reasoning that the card itself says
                "container" so the badge only had to say "enter". True as far as
                it went, but it left the control saying nothing about WHAT it
                opens — and a chevron is the most generic glyph in the set,
                doing disclosure duty everywhere else in the UI. Layers names
                the thing: a stack of timelines, which is what a collection is.
                Still ONE glyph. An earlier version paired the arrow with
                CornerRightDown and ended up with two direction marks saying the
                same thing twice; pairing layers with an arrow would repeat that
                in a new costume.
                No `strokeWidth` — lucide's default of 2 is deliberate and a
                story asserts it (the old CornerRightDown ran at 1.5 only
                because it was drawn much larger). */}
            <Layers className="size-5" aria-hidden="true" />
          </button>
        }
      />

      {/* The rename editor — a REAL input, overlaying the label row while
          editing. A sibling of the surface, so it nests in no button. */}
      {rename.editing && (
        <InlineNameEditor
          initialValue={displayName}
          onInput={rename.setDraft}
          onCommit={rename.commit}
          onCancel={rename.cancel}
          className="absolute inset-x-2.5 bottom-2 z-20 rounded-sm bg-zinc-950/95 px-1 py-0.5 text-xs font-semibold text-zinc-100 outline-none ring-1 ring-amber-400/70"
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
  // NodeCard knows whether it is selected, but keeps it inside its own shell —
  // and the badge has to be a SIBLING of that shell, like everything else here,
  // because a span inside the card's `<button>` would still be inside a button.
  // A boolean selector, so this re-renders only when THIS card's selection
  // actually flips, not on every selection change on the board.
  const mediaSelected = useCollectionsSelector((s) =>
    s.interaction.selectedIds.has(props.id),
  );
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
      {/* The anchor keeps its badge too (R5.3) — see the collection card. It
          clears the trim handles, which a selected clip always carries. */}
      {mediaSelected && <CardSelectedBadge />}
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
          className="absolute inset-x-1 top-1 z-30 rounded-sm bg-zinc-950/95 px-1 py-0.5 text-[11px] font-semibold text-zinc-100 outline-none ring-1 ring-amber-400/70"
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
    flashing ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-zinc-950" : "",
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
