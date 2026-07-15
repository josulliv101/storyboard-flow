"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Button } from "@storyboard/ui/core/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@storyboard/ui/core/card";
import { Kbd, KbdGroup } from "@storyboard/ui/core/kbd";
import {
  DndCollections,
  UndoRedoControls,
  VirtualStrip,
  buildGraph,
  createTimeToOffset,
  mediaDurationSeconds,
  parseNodeId,
  useCollectionsStore,
  useLiveTrim,
  videoFrameCount,
  type CollectionGhostContentProps,
  type CollectionItemContentProps,
  type CollectionTrimHandleContentProps,
  type CollectionsComponents,
  type CollectionsGraph,
  type GraphNodeSpec,
  type MediaNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import {
  MEDIA_COLLECTIONS,
  getCollection,
  type RoutedMediaStripItem,
} from "../lib/collections";

// The timeline lab: the SAME collection data the media-strip routes render,
// projected through dnd-collections' consumer-UI surface. Everything visible
// on a clip is app-owned pixels (registry ItemContent / TrimHandleContent /
// GhostContent); the package owns behavior and geometry — duration-mapped
// widths (pixelsPerSecond), pan + momentum, drag reordering, live trim
// resizing, the source-window overview, undo. The red playhead is the
// documented per-frame pattern: `createTimeToOffset` prefix sums rebuilt at
// commit cadence via `store.subscribeToChanges`, an amortized-O(1) cursor
// per frame, and an imperative transform write — React never renders on a
// playhead tick.

const STRIP_ID = parseNodeId("timeline");
const TIMELINE_PPS = 16;
/** Generated clips appended after the authored ones — enough that the strip
 *  virtualizes and pans, without turning the demo into a soak test. */
const GENERATED_CLIP_COUNT = 40;

function toSpec(item: RoutedMediaStripItem): GraphNodeSpec {
  if (item.kind === "video") {
    return {
      kind: "media",
      mediaKind: "video",
      id: item.id,
      name: item.name,
      src: item.src,
      posterSrcs: item.posterSrcs,
      fullDurationSeconds: item.sourceDurationSeconds,
      trimInSeconds: item.trimInSeconds,
      trimOutSeconds: item.trimOutSeconds,
    };
  }
  if (item.kind === "image") {
    return {
      kind: "media",
      id: item.id,
      name: item.name,
      src: item.posterSrcs?.[0] ?? item.src,
      durationSeconds: item.durationSeconds,
    };
  }
  // A routed folder: nest the referenced collection's first few media items
  // so nesting/un-nesting has something real to act on.
  const referenced = getCollection(item.collectionId);
  const children = (referenced?.items ?? [])
    .filter((child) => child.kind !== "collection")
    .slice(0, 3)
    .map(toSpec);
  return { kind: "collection", id: item.id, name: item.name, children };
}

function createTimelineGraph(): CollectionsGraph {
  const assembly = getCollection("assembly");
  if (!assembly) throw new Error("assembly collection missing");
  const authored = assembly.items.filter((item) => !item.id.startsWith("assembly-virtual"));
  const generated = assembly.items
    .filter((item) => item.id.startsWith("assembly-virtual"))
    .slice(0, GENERATED_CLIP_COUNT);
  const result = buildGraph([
    {
      kind: "collection",
      id: "timeline",
      name: "Assembly timeline",
      children: [...authored, ...generated].map(toSpec),
    },
  ]);
  if (!result.ok) {
    throw new Error(`Invalid timeline graph: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const TIMELINE_GRAPH = createTimelineGraph();

// ── Consumer pixels ─────────────────────────────────────────────────────────

/** Live-tracking duration readout — a LEAF on purpose: `useLiveTrim`
 *  re-renders its caller per trim pointer-move, so only this pill (on the
 *  one clip being trimmed) re-renders mid-gesture. */
function LiveDurationPill({ id, node }: { id: NodeId; node: MediaNode }) {
  const live = useLiveTrim(id);
  const showing = live ? live.effectiveSeconds : mediaDurationSeconds(node);
  const label =
    node.mediaKind === "video"
      ? `${showing.toFixed(2)}s / ${node.fullDurationSeconds.toFixed(2)}s`
      : `${showing.toFixed(2)}s`;
  return (
    <span className="pointer-events-none absolute right-1 bottom-1 z-10 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-zinc-100">
      {label}
    </span>
  );
}

const TimelineClipContent = memo(function TimelineClipContent({
  id,
  node,
  childCount,
  selected,
  rejected,
  isDragSource,
  trimEnabled,
}: CollectionItemContentProps) {
  if (node.kind === "collection") {
    return (
      <span
        className={[
          "flex h-full w-full flex-col justify-between rounded-md border border-dashed border-white/20 bg-white/[0.06] p-2",
          selected ? "ring-2 ring-amber-400" : "",
          isDragSource ? "opacity-40" : "",
        ].join(" ")}
      >
        <span className="truncate text-xs font-semibold text-foreground">{node.name}</span>
        <span className="text-[10px] text-muted-foreground">Folder · {childCount} items</span>
      </span>
    );
  }

  const isVideo = node.mediaKind === "video";
  const posters = isVideo ? (node.posterSrcs ?? []) : node.src ? [node.src] : [];
  const frames = isVideo ? videoFrameCount(mediaDurationSeconds(node), 6) : 1;
  return (
    <span
      data-timeline-clip
      className={[
        "relative flex h-full w-full overflow-hidden rounded-md bg-zinc-900",
        selected ? "ring-2 ring-amber-400" : "ring-1 ring-white/15",
        rejected ? "ring-2 ring-red-500 motion-safe:animate-pulse" : "",
        isDragSource ? "opacity-40" : "",
      ].join(" ")}
    >
      {posters.length === 0 ? (
        <span className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
          No preview
        </span>
      ) : (
        <span className="flex h-full w-full">
          {Array.from({ length: frames }).map((_, index) => (
            // Cycled poster frames — a video clip is a frame SEQUENCE.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={posters[index % posters.length]}
              alt=""
              draggable={false}
              loading="lazy"
              className="h-full min-w-0 flex-1 border-r border-black/60 object-cover last:border-r-0"
            />
          ))}
        </span>
      )}
      {selected && (
        <span className="absolute top-1 left-1 z-10 rounded bg-black/80 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-amber-300">
          {isVideo ? "VIDEO" : "STILL"}
        </span>
      )}
      {trimEnabled && <LiveDurationPill id={id} node={node} />}
    </span>
  );
});

/** Selection-aware trim-handle pixels filling the package-owned hit zones. */
const TimelineTrimHandle = memo(function TimelineTrimHandle({
  side,
  selected,
}: CollectionTrimHandleContentProps) {
  return (
    <span
      className={[
        "flex h-full w-full items-center justify-center transition-opacity",
        side === "left" ? "rounded-l-md" : "rounded-r-md",
        selected ? "bg-amber-400 opacity-95" : "bg-amber-400/50 opacity-0 group-hover:opacity-90",
      ].join(" ")}
    >
      <span className="h-4 w-0.5 rounded bg-black/60" />
    </span>
  );
});

const TimelineGhost = memo(function TimelineGhost({
  node,
  extraCount,
}: CollectionGhostContentProps) {
  return (
    <span className="relative flex h-full w-full flex-col justify-between rounded-md bg-zinc-900/95 p-2 text-xs shadow-2xl ring-2 ring-amber-400">
      <span className="truncate font-semibold text-zinc-100">{node.name}</span>
      <span className="font-mono text-[10px] text-zinc-400">
        {node.kind === "collection" ? "Folder" : `${mediaDurationSeconds(node).toFixed(2)}s`}
      </span>
      {extraCount > 0 && (
        <span className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-400 px-1 text-[11px] font-bold text-black shadow">
          +{extraCount}
        </span>
      )}
    </span>
  );
});

// Registered ONCE at module scope: the registry keeps clips, trim handles,
// and the drag ghost in sync, and stable identities keep every card's
// content subtree mounted across renders.
const TIMELINE_COMPONENTS: CollectionsComponents = {
  ItemContent: TimelineClipContent,
  TrimHandleContent: TimelineTrimHandle,
  GhostContent: TimelineGhost,
};

// ── Playhead ────────────────────────────────────────────────────────────────

/** The documented per-frame pattern: prefix-sum lookup rebuilt at COMMIT
 *  cadence (trims/reorders change the mapping), an amortized-O(1) cursor per
 *  frame, and an imperative transform write — no React render per tick. */
function TimelinePlayhead({ playing }: { playing: boolean }) {
  const store = useCollectionsStore();
  const lineRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(0);

  useEffect(() => {
    const build = () =>
      createTimeToOffset({
        graph: store.getSnapshot().graph,
        collectionId: STRIP_ID,
        pixelsPerSecond: TIMELINE_PPS,
      });
    let lookup = build();
    let cursor = lookup.cursor();

    const paint = () => {
      const line = lineRef.current;
      if (line) line.style.transform = `translateX(${cursor.at(timeRef.current)}px)`;
    };
    const unsubscribe = store.subscribeToChanges(() => {
      lookup = build();
      cursor = lookup.cursor();
      paint();
    });

    paint();
    let raf = 0;
    if (playing) {
      let last = performance.now();
      const loop = (now: number) => {
        const total = lookup.totalDurationSeconds;
        timeRef.current = total > 0 ? (timeRef.current + (now - last) / 1000) % total : 0;
        last = now;
        paint();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, [store, playing]);

  return (
    <div
      ref={lineRef}
      className="absolute inset-y-0 left-0 w-0.5 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]"
    />
  );
}

// ── The showcase card ───────────────────────────────────────────────────────

export function DndTimelineShowcase() {
  const [playing, setPlaying] = useState(true);

  return (
    <DndCollections initialGraph={TIMELINE_GRAPH} components={TIMELINE_COMPONENTS}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Assembly timeline</h2>
          </CardTitle>
          <CardDescription>
            The media-strip data rendered as app-owned clip pixels over dnd-collections: widths map
            duration at {TIMELINE_PPS}px/s, edges trim live, a selected video floats its
            source-window overview, and the playhead runs on an imperative cursor — no React render
            per frame.
          </CardDescription>
          <CardAction>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                aria-pressed={playing}
                onClick={() => setPlaying((current) => !current)}
              >
                {playing ? "Pause playhead" : "Play playhead"}
              </Button>
              <UndoRedoControls />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Headroom for the floating source-window overview tooltip. */}
          <div className="pt-14">
            <VirtualStrip
              collectionId={STRIP_ID}
              pixelsPerSecond={TIMELINE_PPS}
              itemHeight={88}
              itemDragActivation="hold"
              overlay={<TimelinePlayhead playing={playing} />}
              className="bg-black/25"
            />
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <li>Drag the strip to pan (momentum on release); press-and-hold a clip to drag it.</li>
            <li>Drag a clip&apos;s amber edges to trim; click a video to open its source overview.</li>
            <li className="flex flex-wrap items-center gap-1.5">
              <KbdGroup>
                <Kbd>Alt</Kbd>
                <span aria-hidden="true">+</span>
                <Kbd>Shift</Kbd>
                <span aria-hidden="true">+</span>
                <Kbd>←</Kbd>
                <Kbd>→</Kbd>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
              </KbdGroup>
              <span>trims the focused clip&apos;s edges.</span>
            </li>
            <li className="flex flex-wrap items-center gap-1.5">
              <KbdGroup>
                <Kbd>Alt</Kbd>
                <span aria-hidden="true">+</span>
                <Kbd>Shift</Kbd>
                <span aria-hidden="true">+</span>
                <Kbd>Home</Kbd>
                <Kbd>End</Kbd>
              </KbdGroup>
              <span>slides a video&apos;s source window without changing its length.</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </DndCollections>
  );
}
