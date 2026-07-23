"use client";

import { memo, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FolderTree, Image as ImageIcon, Video } from "lucide-react";

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
  hydratedCollectionDuration,
  hydratedCollectionPreviews,
  type CollectionPreviewFrame,
  type DetailsById,
} from "@storyboard/timeline-domain";

import { useClipDetail, useGraphDetailsStore, useTimelineTitle } from "./graph-details-context";
import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";
import { GraphViewNavContext } from "./graph-navigation";
import { TrimFramePreview } from "./graph-trim-frame-preview";
import { createDerivedCache } from "@/lib/derived-cache";
import { videoFrameUrls } from "@/lib/video-frame-url";

/** Never sample more than this many frames for one card, however wide. */
const VIDEO_FRAME_CAP = 16;

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
        previews.map((p) => `${p.id}\0${p.poster ?? p.src}`).join("\x01"),
    }),
  );
  const getSnapshot = useCallback(() => {
    if (!enabled) return NO_PREVIEWS;
    return derive(store.getSnapshot().graph, id);
  }, [store, derive, id, enabled]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
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
      compute: (graph: CollectionsGraph, details: DetailsById, nodeId: NodeId) =>
        hydratedCollectionDuration(graph, details, nodeId),
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

  // MEDIA pixels only. Collections don't render through this seam anymore:
  // their card carries interactive controls (folder drill-in, inline rename),
  // which cannot legally nest inside NodeCard's <button> — so the registered
  // ItemShell (GraphItemShell below) routes collections to the composed
  // CollectionItem-based card instead. This guard is defensive: nothing in
  // the graph view reaches it with a collection node.
  if (node.kind === "collection") return null;

  const isVideo = node.mediaKind === "video";
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
        selected ? "ring-2 ring-amber-400" : "ring-1 ring-white/15",
        rejected ? "ring-2 ring-red-500 motion-safe:animate-pulse" : "",
        isDragSource ? "opacity-40" : "",
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
              loading="lazy"
              className="h-full min-w-0 flex-1 border-r border-black/60 object-cover last:border-r-0"
            />
          ))}
        </span>
      )}
      {/* Kind tag (R6 #7): a corner badge so video vs image reads at a glance,
          at every item size. Decorative for AT (the card's own label names the
          clip); the title gives a pointer tooltip. */}
      <span
        aria-hidden="true"
        data-media-kind={isVideo ? "video" : "image"}
        title={isVideo ? "Video" : "Image"}
        className="pointer-events-none absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-zinc-950/75 text-zinc-100 ring-1 ring-white/15 backdrop-blur-[1px]"
      >
        {isVideo ? (
          <Video aria-hidden="true" className="h-2.5 w-2.5" />
        ) : (
          <ImageIcon aria-hidden="true" className="h-2.5 w-2.5" />
        )}
      </span>
      {trimEnabled && <LiveDurationPill id={id} node={node} />}
      {/* Floating frame-at-the-edge panel during a trim drag (video only) —
          rides the same per-node live-trim channel as the pill. */}
      {trimEnabled && <TrimFramePreview id={id} node={node} />}
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
  const frames: string[] = isCollection
    ? chosen.map((preview) => preview.poster ?? preview.src).filter(Boolean)
    : (() => {
        const src = mediaGhostSrc(node);
        return src ? [src] : [];
      })();

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
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
          <span className="truncate text-[11px] font-semibold text-zinc-100">{node.name}</span>
          <span className="font-mono text-[9px] text-zinc-400">
            {node.kind === "collection" ? "Timeline" : `${mediaDurationSeconds(node).toFixed(2)}s`}
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
  const rename = useInlineRename(id, title ?? node.name);
  const nav = useContext(GraphViewNavContext);
  // Hydrated collections derive their preview frames and total duration from
  // live children (like the count), so editing a loaded child refreshes this
  // card without a reload; placeholders fall back to their stored summary.
  const hydrated = detail?.hydrated === true;
  const livePreviews = useHydratedCollectionPreviews(id as string, hydrated);
  const liveSeconds = useHydratedCollectionSeconds(id as string, hydrated);

  const count = hydrated ? childCount : (detail?.itemCount ?? childCount);
  const totalSeconds = hydrated ? liveSeconds : detail?.duration;
  // FIRST and LAST only — the card says "a timeline runs from here to
  // there", which two frames tell and three do not. A single-item
  // collection has no "last" distinct from its first, so it shows one
  // frame across the full width rather than the same image twice.
  const all: readonly CollectionPreviewFrame[] = hydrated
    ? livePreviews
    : (detail?.previewItems ?? []);
  const previews = all.length > 1 ? [all[0], all[all.length - 1]] : all;
  const displayName = title ?? node.name;

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
        ariaLabel={`${displayName} (collection, ${count} items)`}
        className={[
          "flex h-full w-full flex-col justify-between overflow-hidden rounded-md border border-dashed border-sky-500/40 bg-sky-500/[0.08] p-1.5",
          selected ? "ring-2 ring-amber-400" : "",
          rejected ? "ring-2 ring-red-500 motion-safe:animate-pulse" : "",
          isDragSource ? "opacity-40" : "",
        ].join(" ")}
      >
        <span className="flex min-h-0 flex-1 gap-0.5 overflow-hidden">
          {previews.length === 0 ? (
            <span className="flex flex-1 items-center justify-center text-[9px] text-zinc-500">
              {/* Previews are direct MEDIA children only, so a collection of
                  nothing but sub-collections has none — that is not "Empty"
                  (count > 0). Reserve "Empty" for a truly childless collection. */}
              {!hydrated ? "Open to load" : count === 0 ? "Empty" : "No media preview"}
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
                src={preview.poster ?? preview.src}
                alt=""
                draggable={false}
                loading="lazy"
                className="h-full min-w-0 flex-1 rounded-sm object-cover"
              />
            ))
          )}
        </span>
        <span className="mt-1 flex items-center justify-between gap-1">
          <span
            onDoubleClick={(event) => {
              event.stopPropagation();
              rename.begin();
            }}
            title="Double-click to rename"
            className="min-w-0 flex-1 cursor-text truncate text-[10px] font-semibold text-zinc-100"
          >
            {displayName}
          </span>
          <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] text-zinc-400">
            {typeof totalSeconds === "number" && totalSeconds > 0 ? (
              <span className="text-sky-300/90" title="Total duration of contents">
                {formatCollectionSeconds(totalSeconds)}
              </span>
            ) : null}
            <span>{count}</span>
          </span>
        </span>
      </CollectionItem.SelectionSurface>

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
        {/* FolderTree, matching the sidebar's children-timelines toggle — one
            icon for "this has child timelines" everywhere. */}
        <FolderTree className="h-[55%] w-[55%]" />
      </button>

      {/* The rename editor — a REAL input, overlaying the label row while
          editing. A sibling of the surface, so it nests in no button. */}
      {rename.editing && (
        <InlineNameEditor
          initialValue={displayName}
          onInput={rename.setDraft}
          onCommit={rename.commit}
          onCancel={rename.cancel}
          className="absolute inset-x-1.5 bottom-1.5 z-20 rounded-sm bg-zinc-950/95 px-1 py-0.5 text-[10px] font-semibold text-zinc-100 outline-none ring-1 ring-amber-400/70"
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
      className={["h-full w-full", className ?? ""].join(" ")}
    >
      <GraphCollectionItemParts dragActivation={dragActivation} />
    </CollectionItem.Root>
  );
});

/**
 * The graph's per-item renderer (registered as the provider `ItemShell`):
 * media keeps the stock NodeCard shell (its content is presentational, so the
 * single-button card is exactly right); collections get the composed card
 * above. The kind subscription is a primitive, so the dispatcher re-renders
 * only if a node changes kind — which never happens after creation.
 */
const GraphItemShell = memo(function GraphItemShell(props: CollectionItemShellProps) {
  const isCollection = useCollectionsSelector(
    (s) => s.graph.nodesById.get(props.id)?.kind === "collection",
  );
  return isCollection ? <GraphCollectionItem {...props} /> : <NodeCard {...props} />;
});

export const GRAPH_VIEW_COMPONENTS: CollectionsComponents = {
  ItemContent: GraphClipContent,
  ItemShell: GraphItemShell,
  TrimHandleContent: GraphTrimHandle,
  OverviewContent: GraphTrimOverviewContent,
  GhostContent: GraphGhost,
};
