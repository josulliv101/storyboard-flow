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
import { CornerRightDown, Maximize2 } from "lucide-react";

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
  type CollectionPreviewFrame,
  type DetailsById,
} from "@storyboard/timeline-domain";

import { useClipDetail, useGraphDetailsStore, useTimelineTitle } from "./graph-details-context";
import { isDisabledByAncestor } from "./graph-playhead-model";
import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";
import { useCollectionHoverTarget } from "./graph-collection-hover";
import { useItemDetails } from "./graph-item-details-context";
import { GraphViewNavContext } from "./graph-navigation";
import { TrimPanel } from "./graph-trim-panel";
import { createDerivedCache } from "@/lib/derived-cache";
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
function useElementSize(): [(element: HTMLElement | null) => void, { width: number; height: number }] {
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
): readonly CollectionPreviewFrame[] {
  const store = useCollectionsStore();
  const [derive] = useState(() =>
    createDerivedCache({
      compute: (graph: CollectionsGraph, nodeId: string) =>
        hydratedCollectionPreviews(graph, nodeId),
      contentKey: (previews) =>
        previews
          .map((p) => `${p.id}\0${p.poster ?? p.src}\0${p.trimIn ?? 0}`)
          .join("\x01"),
    }),
  );
  const getSnapshot = useCallback(() => {
    if (!enabled) return NO_PREVIEWS;
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
  const all = hydrated ? live : (stored ?? NO_PREVIEWS);
  return useMemo(() => (all.length > 1 ? [all[0], all[all.length - 1]] : all), [all]);
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
function useHydratedCollectionSeconds(id: string, enabled: boolean): number | null {
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

/** Compact clock-ish duration label for a collection card ("12.4s", "1:23"). */
function formatCollectionSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** Leaf subscription: only the clip being trimmed re-renders per pointer move. */
function LiveDurationPill({ id, node }: { id: NodeId; node: MediaNode }) {
  const live = useLiveTrim(id);
  const showing = live ? live.effectiveSeconds : mediaDurationSeconds(node);
  return (
    <span className="pointer-events-none absolute right-1 bottom-1 z-10 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-zinc-100">
      {node.mediaKind === "video"
        ? `${showing.toFixed(2)}s / ${node.fullDurationSeconds.toFixed(2)}s`
        : `${showing.toFixed(2)}s`}
    </span>
  );
}

/**
 * Whether a COLLECTION above this card is disabled. Primitive return, per the
 * store's selector contract — the walk itself is
 * `isDisabledByAncestor` in graph-playhead-model, shared with the seek rail so
 * the card and the rail can never disagree about what is off.
 */
function useDisabledByAncestor(id: NodeId): boolean {
  return useCollectionsSelector((snapshot) => isDisabledByAncestor(snapshot.graph, id as string));
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
function CollectionFolderGlyph({ className }: Readonly<{ className?: string }>) {
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
        <span className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">
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
        className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9px] leading-none font-semibold tracking-[0.08em] text-zinc-100"
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
          <span className="flex h-full w-full items-center justify-center bg-muted text-[10px] text-muted-foreground select-none">
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
      ? livePreviews
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
          <CollectionFolderGlyph className="h-7 w-7 text-sky-200" />
        </span>
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
          <span className="truncate text-[11px] font-semibold text-zinc-100">{node.name}</span>
          <span className="font-mono text-[9px] text-zinc-400">
            {mediaDurationSeconds(node).toFixed(2)}s
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
              className="flex flex-1 items-center justify-center"
            />
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
          className={[
            "mt-1.5 flex items-center justify-between gap-1.5 pl-1 pb-0.5",
            muted ? "pr-[4.75rem]" : "pr-1",
          ].join(" ")}
        >
          <span
            onDoubleClick={(event) => {
              event.stopPropagation();
              rename.begin();
              // (keyboard: F2 on the focused card — see OpenKeyBoundary)
            }}
            title="Double-click or press F2 to rename"
            className="min-w-0 flex-1 cursor-text truncate text-xs font-semibold text-zinc-100"
          >
            {displayName}
          </span>
          <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] font-medium text-zinc-300">
            {typeof totalSeconds === "number" && totalSeconds > 0 ? (
              <>
                <span className="text-sky-300/90" title="Total duration of contents">
                  {formatCollectionSeconds(totalSeconds)}
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

      {/* The drill affordance — a REAL button now that it composes as a
          SIBLING of the selection surface. Centred over the preview area (the
          card minus its label row), sized as a fraction of the card so it
          stays prominent at every item size. Pointer-only by design:
          tabIndex -1 keeps roving views at one tab stop per item, and
          keyboard drill-in stays on the O key (OpenKeyBoundary). The
          data-collections-keyboard-ignore marker also excludes it from the
          strip's pan surface (see isPannableStripSurface), so a press here
          drills without the strip scrolling under it — no pointerdown guard
          needed. */}
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
        className="absolute left-1/2 top-[41%] flex aspect-square h-[34%] -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-zinc-950/70 text-sky-200 ring-1 ring-sky-400/50 backdrop-blur-[2px] transition-colors hover:bg-zinc-900/85 hover:text-sky-100 hover:ring-sky-300"
      >
        {/* CornerRightDown — turn and descend, the verb this control performs:
            NAVIGATE into the timeline. The sidebar's FolderTree toggles whether
            the children tree is shown, which is a different verb and does not
            share this icon. */}
        {/* 45%, not 55%: the mark crowded the ring it sits in. The circle's
            own size is unchanged — only the glyph inside it shrank. */}
        <CollectionFolderGlyph className="h-[45%] w-[45%]" />
      </button>

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
        "h-full w-full",
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
 * The details trigger on a media card (PL11-002): top-right, revealed on
 * hover or keyboard focus, and a real tab stop when its card is the roving
 * one.
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
const ItemDetailsTrigger = memo(function ItemDetailsTrigger({
  id,
  rovingTabIndex,
}: Readonly<{ id: NodeId; rovingTabIndex: number | undefined }>) {
  const store = useCollectionsStore();
  const { setOpenId } = useItemDetails();

  return (
    <button
      type="button"
      data-item-details-trigger={id}
      aria-label="Open item details"
      title="Open item details"
      {...(rovingTabIndex !== undefined ? { tabIndex: rovingTabIndex } : {})}
      onPointerDown={(event) => {
        // Keep the press off the surface gestures underneath — the strip's
        // pan and (in grid) the hold-drag both start on pointerdown.
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        // Open it AND select it: the details view is about one item, and
        // leaving the selection on some other card makes every selection-scoped
        // readout in the board disagree with what the modal is showing.
        store.setSelection([id]);
        setOpenId(id as string);
      }}
      className={[
        "absolute top-1 right-1 z-20 flex size-6 items-center justify-center rounded",
        "bg-zinc-950/80 text-zinc-300 shadow-sm shadow-black/40 backdrop-blur-[1px]",
        "hover:bg-zinc-900 hover:text-zinc-50",
        // Hidden until the card is hovered or something inside it has focus —
        // including this button, which is why `focus-within` is on the group
        // rather than `focus-visible` here alone.
        "opacity-0 transition-opacity duration-150",
        "group-hover/media-item:opacity-100 group-focus-within/media-item:opacity-100",
        "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300",
      ].join(" ")}
    >
      <Maximize2 aria-hidden="true" className="h-3.5 w-3.5" />
    </button>
  );
});

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
  const detail = useClipDetail(props.id as string);
  // Seeded with the AUTHORED title when there is one, so re-naming edits what
  // the user wrote rather than making them delete a filename first.
  const rename = useInlineRename(props.id, detail?.title ?? "", "card");

  return (
    <div className={["group/media-item relative", className ?? ""].join(" ")}>
      <NodeCard {...props} className="h-full w-full" />
      <ItemDetailsTrigger id={props.id} rovingTabIndex={props.rovingTabIndex} />
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
const GraphItemShell = memo(function GraphItemShell(props: CollectionItemShellProps) {
  const isCollection = useCollectionsSelector(
    (s) => s.graph.nodesById.get(props.id)?.kind === "collection",
  );
  return isCollection ? <GraphCollectionItem {...props} /> : <GraphMediaItem {...props} />;
});

export const GRAPH_VIEW_COMPONENTS: CollectionsComponents = {
  ItemContent: GraphClipContent,
  ItemShell: GraphItemShell,
  TrimHandleContent: GraphTrimHandle,
  OverviewContent: GraphTrimOverviewContent,
  GhostContent: GraphGhost,
};
