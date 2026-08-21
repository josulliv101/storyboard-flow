import { memo, useRef, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { cn } from "../lib/utils";
import {
  buildGraph,
  mediaDurationSeconds,
  parseNodeId,
  type GraphNodeSpec,
  type MediaNode,
  type NodeId,
} from "./core/graph";
import { DndCollections } from "./react/DndCollections";
import {
  type CollectionGhostContentProps,
  type CollectionItemContentProps,
  type CollectionTrimHandleContentProps,
  type CollectionTrimOverviewContentProps,
} from "./react/collections-components";
import { useCollectionsSelector } from "./react/collections-store";
import { useLiveTrim } from "./react/live-trim";
import { CollectionPanels } from "./react/node-views";
import { VirtualStrip } from "./virtual/VirtualStrip";
import {
  dispatchPointerSequence,
  dragHoldAt,
  moveHeldPointer,
  nodeCard,
  panelOrder,
  rectCenter,
  rectPoint,
  releaseAt,
  TRIM_ARM_SETTLE_MS,
  waitForLayout,
} from "./stories-helpers";

// The consumer-content seam, exercised the way a real consumer would use it:
// module-scope memoized components registered on the provider (or per view),
// receiving only the node + rarely-changing primitives. The efficiency
// story is asserted in BOTH directions: drag jitter re-renders neither the
// bystander shell nor its content, and a consumer's own external store
// re-renders only the subscribed CONTENT, never the shells.

const media = (id: string, name = id.toUpperCase()): GraphNodeSpec => ({
  kind: "media",
  id,
  name,
  durationSeconds: 4,
});
const collection = (
  id: string,
  name: string,
  children: readonly GraphNodeSpec[] = []
): GraphNodeSpec => ({ kind: "collection", id, name, children });

function graphOrThrow(roots: readonly GraphNodeSpec[]) {
  const result = buildGraph(roots);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

const meta = {
  title: "UI/DndCollectionsCustomItemContent",
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Timeline lookalike: the app-style clip card, built as consumer pixels ──

const clipFrames = [
  new URL("./fixtures/dog-tracking-2s.png", import.meta.url).href,
  new URL("./fixtures/dog-exit-4s.png", import.meta.url).href,
] as const;
const collectionFrames = [
  new URL("./fixtures/clip-field.jpg", import.meta.url).href,
  new URL("./fixtures/clip-chop.jpg", import.meta.url).href,
] as const;

const CLIP_PPS = 24;

/** App-style clip: filmstrip fill, VIDEO badge + amber frame when selected,
 *  showing/full readout pill — all consumer-owned pixels. */
const TimelineClipContent = memo(function TimelineClipContent({
  node,
  childCount,
  selected,
  isDragSource,
}: CollectionItemContentProps) {
  if (node.kind !== "media") {
    return (
      <span
        data-timeline-collection={selected ? "selected" : "idle"}
        className={cn(
          "flex h-full w-full flex-col justify-between overflow-hidden rounded-md border bg-muted p-2 text-left",
          selected ? "border-primary ring-4 ring-primary" : "border-border",
          isDragSource && "opacity-40"
        )}
      >
        <span className="text-[9px] font-bold tracking-wide text-muted-foreground uppercase">
          Collection
        </span>
        <span className="truncate text-sm font-semibold">{node.name}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {childCount} {childCount === 1 ? "item" : "items"}
        </span>
      </span>
    );
  }
  const showing = mediaDurationSeconds(node);
  const full = node.mediaKind === "video" ? node.fullDurationSeconds : showing;
  const posters = node.mediaKind === "video" ? (node.posterSrcs ?? []) : node.src ? [node.src] : [];
  const frames = Math.max(1, Math.min(6, Math.round(showing / 2)));
  return (
    <span
      data-timeline-clip={selected ? "selected" : "idle"}
      className={[
        "relative flex h-full w-full overflow-hidden rounded-md",
        selected ? "ring-4 ring-amber-400" : "ring-1 ring-border",
        isDragSource ? "opacity-40" : "",
      ].join(" ")}
    >
      <span className="flex h-full w-full bg-zinc-900">
        {Array.from({ length: frames }).map((_, i) => (
          <img
            key={i}
            src={posters[i % Math.max(1, posters.length)]}
            alt=""
            draggable={false}
            className="h-full min-w-0 flex-1 border-r border-black/60 object-cover last:border-r-0"
          />
        ))}
      </span>
      {selected && (
        <span
          data-timeline-clip-badge
          className="absolute top-1 left-1 rounded bg-black/80 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-amber-300"
        >
          VIDEO
        </span>
      )}
      <span className="absolute right-1 bottom-1 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9px] text-zinc-100 tabular-nums">
        {showing.toFixed(2)}s / {full.toFixed(2)}s
      </span>
    </span>
  );
});

function timelineGraph() {
  return graphOrThrow([
    {
      kind: "collection",
      id: "strip",
      name: "Timeline",
      children: [
        { kind: "media", id: "intro", name: "Intro", src: clipFrames[0], durationSeconds: 3 },
        {
          kind: "media",
          mediaKind: "video",
          id: "vid",
          name: "Vid",
          posterSrcs: clipFrames,
          fullDurationSeconds: 10,
          trimInSeconds: 2,
          trimOutSeconds: 1,
        },
        { kind: "media", id: "outro", name: "Outro", src: clipFrames[1], durationSeconds: 4 },
      ],
    },
  ]);
}

function timelineGraphWithCollection() {
  return graphOrThrow([
    {
      kind: "collection",
      id: "strip",
      name: "Timeline",
      children: [
        { kind: "media", id: "intro", name: "Intro", src: clipFrames[0], durationSeconds: 3 },
        {
          kind: "media",
          mediaKind: "video",
          id: "vid",
          name: "Vid",
          posterSrcs: clipFrames,
          fullDurationSeconds: 10,
          trimInSeconds: 2,
          trimOutSeconds: 1,
        },
        {
          kind: "collection",
          id: "b-roll",
          name: "B-roll",
          children: [
            {
              kind: "media",
              id: "b-roll-1",
              name: "Field",
              src: collectionFrames[0],
              durationSeconds: 2,
            },
            {
              kind: "media",
              id: "b-roll-2",
              name: "Chop",
              src: collectionFrames[1],
              durationSeconds: 4,
            },
          ],
        },
        { kind: "media", id: "outro", name: "Outro", src: clipFrames[1], durationSeconds: 4 },
      ],
    },
  ]);
}

type UserCollectionCoverProps = Readonly<{
  id: NodeId;
  name: string;
  childCount: number;
  selected: boolean;
  isDragSource: boolean;
}>;

const UserCollectionCover = memo(function UserCollectionCover({
  id,
  name,
  childCount,
  selected,
  isDragSource,
}: UserCollectionCoverProps) {
  const firstImageSrc = useCollectionsSelector((snapshot) => {
    const childIds = snapshot.graph.childrenById.get(id) ?? [];
    for (const childId of childIds) {
      const child = snapshot.graph.nodesById.get(childId);
      if (child?.kind === "media" && child.mediaKind !== "video" && child.src) {
        return child.src;
      }
    }
    return null;
  });

  return (
    <span
      data-user-collection-cover={selected ? "selected" : "idle"}
      className={cn(
        "relative flex h-full w-full overflow-hidden rounded-md border bg-muted text-left",
        selected ? "border-primary ring-4 ring-primary" : "border-border",
        isDragSource && "opacity-40"
      )}
    >
      {firstImageSrc ? (
        <img
          data-user-collection-first-image
          src={firstImageSrc}
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          data-user-collection-empty-cover
          className="flex h-full w-full items-center justify-center text-xs text-muted-foreground"
        >
          No image
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 flex flex-col bg-background/90 px-2 py-1">
        <span className="truncate text-xs font-semibold">{name}</span>
        <span className="text-[9px] text-muted-foreground tabular-nums">
          {childCount} {childCount === 1 ? "item" : "items"}
        </span>
      </span>
    </span>
  );
});

const FirstChildImageItemContent = memo(function FirstChildImageItemContent(
  props: CollectionItemContentProps
) {
  if (props.node.kind === "collection") {
    return (
      <UserCollectionCover
        id={props.id}
        name={props.node.name}
        childCount={props.childCount}
        selected={props.selected}
        isDragSource={props.isDragSource}
      />
    );
  }
  return <TimelineClipContent {...props} />;
});

const UserCollectionBookendCover = memo(function UserCollectionBookendCover({
  id,
  name,
  childCount,
  selected,
  isDragSource,
}: UserCollectionCoverProps) {
  const firstImageSrc = useCollectionsSelector((snapshot) => {
    const childIds = snapshot.graph.childrenById.get(id) ?? [];
    for (const childId of childIds) {
      const child = snapshot.graph.nodesById.get(childId);
      if (child?.kind === "media" && child.mediaKind !== "video" && child.src) {
        return child.src;
      }
    }
    return null;
  });
  const lastImageSrc = useCollectionsSelector((snapshot) => {
    const childIds = snapshot.graph.childrenById.get(id) ?? [];
    for (let index = childIds.length - 1; index >= 0; index -= 1) {
      const childId = childIds[index];
      if (childId === undefined) continue;
      const child = snapshot.graph.nodesById.get(childId);
      if (
        child?.kind === "media" &&
        child.mediaKind !== "video" &&
        child.src &&
        child.src !== firstImageSrc
      ) {
        return child.src;
      }
    }
    return null;
  });

  return (
    <span
      data-user-collection-bookends={selected ? "selected" : "idle"}
      className={cn(
        "relative flex h-full w-full overflow-hidden rounded-md border bg-muted text-left",
        selected ? "border-primary ring-4 ring-primary" : "border-border",
        isDragSource && "opacity-40"
      )}
    >
      <span className="grid size-full grid-cols-1 gap-px bg-border has-[img]:grid-cols-2">
        {firstImageSrc ? (
          <img
            data-user-collection-first-image
            src={firstImageSrc}
            alt=""
            draggable={false}
            className="size-full min-w-0 object-cover"
          />
        ) : (
          <span className="bg-muted" />
        )}
        {lastImageSrc ? (
          <img
            data-user-collection-last-image
            src={lastImageSrc}
            alt=""
            draggable={false}
            className="size-full min-w-0 object-cover"
          />
        ) : (
          <span className="bg-muted" />
        )}
      </span>
      <span className="absolute inset-x-0 bottom-0 flex flex-col bg-background/90 px-2 py-1">
        <span className="truncate text-xs font-semibold">{name}</span>
        <span className="text-[9px] text-muted-foreground tabular-nums">
          {childCount} {childCount === 1 ? "item" : "items"}
        </span>
      </span>
    </span>
  );
});

const FirstAndLastChildImageItemContent = memo(function FirstAndLastChildImageItemContent(
  props: CollectionItemContentProps
) {
  if (props.node.kind === "collection") {
    return (
      <UserCollectionBookendCover
        id={props.id}
        name={props.node.name}
        childCount={props.childCount}
        selected={props.selected}
        isDragSource={props.isDragSource}
      />
    );
  }
  return <TimelineClipContent {...props} />;
});

/** App-style trim-handle pixels: an amber zone whose intensity follows the
 *  card's selection, with a grip line — filling the shell-owned hit zone. */
const TimelineTrimHandle = memo(function TimelineTrimHandle({
  side,
  selected,
}: CollectionTrimHandleContentProps) {
  return (
    <span
      data-timeline-handle={side}
      className={[
        "flex h-full w-full items-center justify-center",
        side === "left" ? "rounded-l-md" : "rounded-r-md",
        selected ? "bg-amber-400" : "bg-amber-400/40",
      ].join(" ")}
    >
      <span className="h-5 w-0.5 rounded bg-black/50" />
    </span>
  );
});

export const TimelineLookalike: Story = {
  // The end goal, as a story: consumer pixels dictate the entire card look
  // (filmstrip, selection chrome, readout pill, trim-handle visuals) while
  // the package keeps widths-from-duration, trim gestures, selection, and
  // drag behavior. Registered at the provider so cards, handles, and ghost
  // stay in sync from one place.
  render: () => (
    <DndCollections
      initialGraph={timelineGraph()}
      animateMoves={false}
      components={{ ItemContent: TimelineClipContent, TrimHandleContent: TimelineTrimHandle }}
    >
      <div className="w-[640px] pt-10">
        <VirtualStrip
          collectionId={parseNodeId("strip")}
          itemDragActivation="hold"
          itemWidthFor={(node) =>
            node.kind === "media" ? mediaDurationSeconds(node) * CLIP_PPS : undefined
          }
          trimPixelsPerSecond={CLIP_PPS}
        />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const vid = nodeCard(canvasElement, "vid");
    await waitForLayout(vid);

    // Widths still come from duration: vid shows 7s at 24 px/s.
    expect(Math.round(vid.getBoundingClientRect().width)).toBe(7 * CLIP_PPS);
    // Consumer pixels render inside the shell: pill + idle chrome.
    expect(vid.querySelector("[data-timeline-clip]")).toHaveAttribute(
      "data-timeline-clip",
      "idle"
    );
    expect(vid.textContent).toContain("7.00s / 10.00s");
    expect(vid.querySelector("[data-timeline-clip-badge]")).toBeNull();
    // No duplicate readout: the default pill belongs to DefaultItemContent,
    // which custom content replaces wholesale.
    expect(vid.querySelector("[data-trim-pill]")).toBeNull();

    // Selection is still shell behavior; the BADGE is consumer pixels.
    const user = userEvent.setup();
    await user.click(vid);
    await waitFor(() => {
      expect(nodeCard(canvasElement, "vid")).toHaveAttribute("data-selected", "true");
      expect(vid.querySelector("[data-timeline-clip-badge]")).not.toBeNull();
    });

    // Package-owned trim-handle HIT ZONES coexist with consumer pixels
    // (siblings of the button) — and their visuals are the registered
    // TrimHandleContent, reflecting the selection.
    const wrapper = vid.closest("[data-node-wrapper]")!;
    expect(
      wrapper.querySelector('[data-trim-handle="left"] [data-timeline-handle="left"]')
    ).not.toBeNull();
    expect(
      wrapper.querySelector('[data-trim-handle="right"] [data-timeline-handle="right"]')
    ).not.toBeNull();
  },
};

export const TimelineLookalikeWithCollectionItem: Story = {
  // The same consumer-owned timeline pixels, now with a collection node in
  // the strip. Media keeps its filmstrip treatment; collections receive the
  // same shell behavior plus their own label, name, child count, and selected
  // state without pretending to be trimmable media.
  render: () => (
    <DndCollections
      initialGraph={timelineGraphWithCollection()}
      animateMoves={false}
      components={{ ItemContent: TimelineClipContent, TrimHandleContent: TimelineTrimHandle }}
    >
      <div className="w-[640px] pt-10">
        <VirtualStrip
          collectionId={parseNodeId("strip")}
          itemDragActivation="hold"
          itemWidthFor={(node) =>
            node.kind === "media" ? mediaDurationSeconds(node) * CLIP_PPS : undefined
          }
          trimPixelsPerSecond={CLIP_PPS}
        />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const video = nodeCard(canvasElement, "vid");
    const collectionCard = nodeCard(canvasElement, "b-roll");
    const collectionContent = () =>
      collectionCard.querySelector<HTMLElement>("[data-timeline-collection]")!;
    await waitForLayout(video);
    await waitForLayout(collectionCard);

    // Both node kinds use the consumer content slot in the same strip.
    expect(video.querySelector("[data-timeline-clip]")).not.toBeNull();
    expect(collectionCard).toHaveAttribute("data-node-kind", "collection");
    expect(collectionContent()).toHaveAttribute("data-timeline-collection", "idle");
    expect(collectionContent().textContent).toContain("B-roll");
    expect(collectionContent().textContent).toContain("2 items");

    // Collections participate in selection, but never receive media trim handles.
    expect(
      collectionCard.closest("[data-node-wrapper]")?.querySelector("[data-trim-handle]")
    ).toBeNull();
    const user = userEvent.setup();
    await user.click(collectionCard);
    await waitFor(() => {
      expect(collectionCard).toHaveAttribute("data-selected", "true");
      expect(collectionContent()).toHaveAttribute("data-timeline-collection", "selected");
    });
  },
};

export const CollectionItemWithFirstChildImage: Story = {
  // A consumer-defined collection card can derive its own visuals from the
  // graph. This renderer scans the collection's direct children and uses the
  // first image media node with a source as the collection cover.
  render: () => (
    <DndCollections
      initialGraph={timelineGraphWithCollection()}
      animateMoves={false}
      components={{ ItemContent: FirstChildImageItemContent, TrimHandleContent: TimelineTrimHandle }}
    >
      <div className="w-[640px] pt-10">
        <VirtualStrip
          collectionId={parseNodeId("strip")}
          itemDragActivation="hold"
          itemWidthFor={(node) =>
            node.kind === "media" ? mediaDurationSeconds(node) * CLIP_PPS : undefined
          }
          trimPixelsPerSecond={CLIP_PPS}
        />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const collectionCard = nodeCard(canvasElement, "b-roll");
    await waitForLayout(collectionCard);
    const cover = () =>
      collectionCard.querySelector<HTMLElement>("[data-user-collection-cover]")!;
    const coverImage = () =>
      collectionCard.querySelector<HTMLImageElement>("[data-user-collection-first-image]")!;

    expect(cover()).toHaveAttribute("data-user-collection-cover", "idle");
    expect(coverImage()).toHaveAttribute("src", collectionFrames[0]);
    expect(cover().textContent).toContain("B-roll");
    expect(cover().textContent).toContain("2 items");
    expect(collectionCard.querySelector("[data-user-collection-empty-cover]")).toBeNull();

    const user = userEvent.setup();
    await user.click(collectionCard);
    await waitFor(() => {
      expect(collectionCard).toHaveAttribute("data-selected", "true");
      expect(cover()).toHaveAttribute("data-user-collection-cover", "selected");
    });
  },
};

export const CollectionItemWithFirstAndLastChildImages: Story = {
  // Another consumer-owned collection treatment: the first and last direct
  // image children become a split cover. The fixture intentionally supplies
  // different sources so both ends of the collection are visible.
  render: () => (
    <DndCollections
      initialGraph={timelineGraphWithCollection()}
      animateMoves={false}
      components={{
        ItemContent: FirstAndLastChildImageItemContent,
        TrimHandleContent: TimelineTrimHandle,
      }}
    >
      <div className="w-[640px] pt-10">
        <VirtualStrip
          collectionId={parseNodeId("strip")}
          itemDragActivation="hold"
          itemWidthFor={(node) =>
            node.kind === "media" ? mediaDurationSeconds(node) * CLIP_PPS : undefined
          }
          trimPixelsPerSecond={CLIP_PPS}
        />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const collectionCard = nodeCard(canvasElement, "b-roll");
    await waitForLayout(collectionCard);
    const cover = () =>
      collectionCard.querySelector<HTMLElement>("[data-user-collection-bookends]")!;
    const firstImage = () =>
      collectionCard.querySelector<HTMLImageElement>("[data-user-collection-first-image]")!;
    const lastImage = () =>
      collectionCard.querySelector<HTMLImageElement>("[data-user-collection-last-image]")!;

    expect(cover()).toHaveAttribute("data-user-collection-bookends", "idle");
    expect(firstImage()).toHaveAttribute("src", collectionFrames[0]);
    expect(lastImage()).toHaveAttribute("src", collectionFrames[1]);
    expect(firstImage().getAttribute("src")).not.toBe(lastImage().getAttribute("src"));
    expect(cover().textContent).toContain("B-roll");
    expect(cover().textContent).toContain("2 items");

    const user = userEvent.setup();
    await user.click(collectionCard);
    await waitFor(() => {
      expect(collectionCard).toHaveAttribute("data-selected", "true");
      expect(cover()).toHaveAttribute("data-user-collection-bookends", "selected");
    });
  },
};

// ── Overview background slot ────────────────────────────────────────────────

const CustomOverviewContent = memo(function CustomOverviewContent({
  node,
}: CollectionTrimOverviewContentProps) {
  return (
    <span
      data-custom-overview
      className="flex h-full w-full items-center justify-center bg-zinc-800 text-[10px] text-amber-300"
    >
      {node.name} · {node.fullDurationSeconds}s source
    </span>
  );
});

export const CustomOverviewSlot: Story = {
  // OverviewContent replaces the source-window overview's BACKGROUND pixels
  // (filmstrip + labels); the package keeps the geometry and interactivity —
  // the amber showing-window, its trim grips, and the move gesture.
  render: () => (
    <DndCollections
      initialGraph={timelineGraph()}
      animateMoves={false}
      components={{ OverviewContent: CustomOverviewContent }}
    >
      <div className="w-[640px] pt-16">
        <VirtualStrip collectionId={parseNodeId("strip")} pixelsPerSecond={24} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const vid = nodeCard(canvasElement, "vid");
    await waitForLayout(vid);
    const user = userEvent.setup();
    await user.click(vid);

    await waitFor(() => {
      const overview = canvasElement.querySelector('[data-trim-overview="vid"]');
      expect(overview).not.toBeNull();
      // Consumer background pixels...
      expect(overview!.querySelector("[data-custom-overview]")).not.toBeNull();
      expect(overview!.textContent).toContain("Vid · 10s source");
      expect(overview!.textContent).not.toContain("full clip"); // default label replaced
      // ...with the package's interactive window and grips intact.
      expect(overview!.querySelector("[data-trim-overview-window]")).not.toBeNull();
      expect(overview!.querySelector('[data-trim-overview-handle="left"]')).not.toBeNull();
      expect(overview!.querySelector('[data-trim-overview-handle="right"]')).not.toBeNull();
    });
  },
};

// ── Live trim readout via useLiveTrim ───────────────────────────────────────

/** Leaf readout: the ONLY component that re-renders per trim move. */
function LiveSeconds({ id, node }: { id: NodeId; node: MediaNode }) {
  const live = useLiveTrim(id);
  const seconds = live ? live.effectiveSeconds : mediaDurationSeconds(node);
  return (
    <span data-live-seconds={live ? "live" : "committed"} className="font-mono tabular-nums">
      {seconds.toFixed(2)}s
    </span>
  );
}

const LiveReadoutContent = memo(function LiveReadoutContent({
  id,
  node,
  trimEnabled,
}: CollectionItemContentProps) {
  const renders = useRef(0);
  renders.current += 1;
  return (
    <span
      data-content-render-count={renders.current}
      className="flex h-full w-full flex-col justify-between rounded-md border border-border bg-background p-2 text-xs"
    >
      <span className="truncate">{node.name}</span>
      {trimEnabled && node.kind === "media" && <LiveSeconds id={id} node={node} />}
    </span>
  );
});

export const LiveTrimReadout: Story = {
  // A consumer duration readout that tracks the drag live via useLiveTrim:
  // live during the gesture, committed after release — and scoped: the
  // BYSTANDER card's content never re-renders during the trim.
  render: () => (
    <DndCollections
      initialGraph={graphOrThrow([
        {
          kind: "collection",
          id: "strip",
          name: "Strip",
          children: [
            { kind: "media", id: "still", name: "Still", durationSeconds: 4 },
            {
              kind: "media",
              mediaKind: "video",
              id: "clip",
              name: "Clip",
              fullDurationSeconds: 10,
              trimInSeconds: 0,
              trimOutSeconds: 0,
            },
          ],
        },
      ])}
      animateMoves={false}
      components={{ ItemContent: LiveReadoutContent }}
    >
      <div className="w-[640px]">
        <VirtualStrip
          collectionId={parseNodeId("strip")}
          itemWidthFor={(node) =>
            node.kind === "media" ? mediaDurationSeconds(node) * CLIP_PPS : undefined
          }
          trimPixelsPerSecond={CLIP_PPS}
        />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const clip = nodeCard(canvasElement, "clip");
    const still = nodeCard(canvasElement, "still");
    await waitForLayout(clip);
    const liveSeconds = () => clip.querySelector<HTMLElement>("[data-live-seconds]")!;
    const stillContent = () => still.querySelector<HTMLElement>("[data-content-render-count]")!;

    expect(liveSeconds()).toHaveAttribute("data-live-seconds", "committed");
    expect(liveSeconds().textContent).toBe("10.00s");
    const bystanderBefore = stillContent().getAttribute("data-content-render-count");

    // Drag the right handle IN 48px (trim-out +2s) and HOLD: the readout
    // tracks the drag live, before any commit.
    const handle = clip
      .closest("[data-node-wrapper]")!
      .querySelector<HTMLElement>('[data-trim-handle="right"]')!;
    const start = rectCenter(handle);
    await dispatchPointerSequence([
      { element: handle, type: "pointerdown", clientX: start.x, clientY: start.y, delayAfterMs: TRIM_ARM_SETTLE_MS },
      { element: document, type: "pointermove", clientX: start.x - 24, clientY: start.y, delayAfterMs: 30 },
      { element: document, type: "pointermove", clientX: start.x - 48, clientY: start.y, delayAfterMs: 30 },
    ]);
    await waitFor(() => {
      expect(liveSeconds()).toHaveAttribute("data-live-seconds", "live");
      expect(liveSeconds().textContent).toBe("8.00s");
    });
    // The bystander's content did not re-render for someone else's trim.
    expect(stillContent().getAttribute("data-content-render-count")).toBe(bystanderBefore);

    // Release commits: the readout settles on the committed value, no flash
    // (the last live value equals the committed one).
    await dispatchPointerSequence([
      { element: document, type: "pointerup", clientX: start.x - 48, clientY: start.y, delayAfterMs: 30 },
    ]);
    await waitFor(() => {
      expect(liveSeconds()).toHaveAttribute("data-live-seconds", "committed");
      expect(liveSeconds().textContent).toBe("8.00s");
    });
  },
};

// ── Render efficiency with consumer content + a consumer store ─────────────

function createTicker() {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    bump: () => {
      value += 1;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
const ticker = createTicker();

/** Consumer-style content with its OWN render probe and its own external
 *  store subscription — the shape of a real app card. */
const ProbedContent = memo(function ProbedContent({
  node,
  selected,
}: CollectionItemContentProps) {
  const renders = useRef(0);
  renders.current += 1;
  const tick = useSyncExternalStore(ticker.subscribe, ticker.get, ticker.get);
  return (
    <span
      data-content-render-count={renders.current}
      className={[
        "flex h-full w-full flex-col justify-between rounded-md border p-2 text-xs",
        selected ? "border-primary ring-2 ring-primary" : "border-border bg-background",
      ].join(" ")}
    >
      <span className="truncate">{node.name}</span>
      <span data-content-tick className="text-[10px] text-muted-foreground">
        tick {tick}
      </span>
    </span>
  );
});

const efficiencyGraph = () =>
  graphOrThrow([
    collection(
      "panel-wide",
      "Wide Panel",
      Array.from({ length: 24 }, (_, i) => media(`w${i}`, `W${i}`))
    ),
    collection("panel-target", "Target Panel", [media("t1", "T1")]),
  ]);

export const CustomContentRenderEfficiency: Story = {
  // The efficiency guarantee survives consumer content, asserted BOTH ways:
  // (1) drag jitter re-renders neither a bystander's shell nor its content;
  // (2) the consumer's own store update re-renders only the subscribed
  // content — every shell render count stays frozen.
  render: () => (
    <DndCollections
      initialGraph={efficiencyGraph()}
      animateMoves={false}
      components={{ ItemContent: ProbedContent }}
    >
      <CollectionPanels />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const source = nodeCard(canvasElement, "w0");
    const target = nodeCard(canvasElement, "t1");
    const bystander = nodeCard(canvasElement, "w12");
    await waitForLayout(target);
    const bystanderContent = () =>
      bystander.querySelector<HTMLElement>("[data-content-render-count]")!;

    // Hold a live drag over the target's left half, settled.
    await dragHoldAt(source, rectPoint(target, 0.15));
    const holdPoint = rectPoint(target, 0.15);
    await moveHeldPointer(holdPoint);
    await waitFor(() => {
      expect(target.parentElement?.querySelector('[data-drop-indicator="before"]')).toBeTruthy();
    });

    const shellBefore = bystander.getAttribute("data-render-count");
    const contentBefore = bystanderContent().getAttribute("data-content-render-count");
    // Jitter within the same intent.
    await moveHeldPointer({ x: holdPoint.x + 3, y: holdPoint.y + 2 });
    await moveHeldPointer({ x: holdPoint.x - 3, y: holdPoint.y - 2 });
    await moveHeldPointer({ x: holdPoint.x + 2, y: holdPoint.y + 1 });
    await moveHeldPointer(holdPoint);

    // (1) Neither the bystander shell nor its consumer content re-rendered.
    expect(bystander.getAttribute("data-render-count")).toBe(shellBefore);
    expect(bystanderContent().getAttribute("data-content-render-count")).toBe(contentBefore);

    await releaseAt(holdPoint);
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-target")).toEqual(["w0", "t1"]);
    });

    // (2) A consumer-store update re-renders CONTENT only — shells frozen.
    const shellAfterDrop = bystander.getAttribute("data-render-count");
    const contentAfterDrop = Number(
      bystanderContent().getAttribute("data-content-render-count")
    );
    const tickTextBefore = bystanderContent().querySelector("[data-content-tick]")!.textContent;
    ticker.bump();
    await waitFor(() => {
      expect(
        Number(bystanderContent().getAttribute("data-content-render-count"))
      ).toBeGreaterThan(contentAfterDrop);
      expect(
        bystanderContent().querySelector("[data-content-tick]")!.textContent
      ).not.toBe(tickTextBefore);
    });
    expect(bystander.getAttribute("data-render-count")).toBe(shellAfterDrop);
  },
};

// ── Ghost slot + resolution order ───────────────────────────────────────────

const CustomGhost = memo(function CustomGhost({ node, extraCount }: CollectionGhostContentProps) {
  return (
    <span
      data-testid="custom-ghost"
      className="flex h-full w-full items-center justify-center rounded-md bg-amber-400 text-xs font-bold text-black"
    >
      {node.name}
      {extraCount > 0 ? ` +${extraCount}` : ""}
    </span>
  );
});

const RegistryContent = memo(function RegistryContent({ node }: CollectionItemContentProps) {
  return (
    <span data-content-variant="registry" className="flex h-full w-full items-center rounded-md border border-border p-2 text-xs">
      {node.name}
    </span>
  );
});

const OverrideContent = memo(function OverrideContent({ node }: CollectionItemContentProps) {
  return (
    <span data-content-variant="override" className="flex h-full w-full items-center rounded-md border border-primary p-2 text-xs">
      {node.name}
    </span>
  );
});

export const GhostAndOverrideResolution: Story = {
  // One provider: the registry supplies ItemContent + GhostContent; the
  // strip's per-view itemContent overrides the registry; panels fall back
  // to the registry. The drag ghost renders the registered GhostContent.
  render: () => (
    <DndCollections
      initialGraph={graphOrThrow([
        collection("panel-a", "Panel A", [media("alpha"), media("bravo")]),
        collection("strip", "Strip", [media("s1"), media("s2")]),
      ])}
      animateMoves={false}
      components={{ ItemContent: RegistryContent, GhostContent: CustomGhost }}
    >
      <div className="flex w-[640px] flex-col gap-4">
        <CollectionPanels collectionIds={[parseNodeId("panel-a")]} />
        <VirtualStrip collectionId={parseNodeId("strip")} itemContent={OverrideContent} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const alpha = nodeCard(canvasElement, "alpha");
    await waitForLayout(alpha);
    await waitForLayout(nodeCard(canvasElement, "s1"));

    // Resolution order: per-view override beats the registry; the registry
    // beats the default.
    expect(alpha.querySelector('[data-content-variant="registry"]')).not.toBeNull();
    expect(
      nodeCard(canvasElement, "s1").querySelector('[data-content-variant="override"]')
    ).not.toBeNull();

    // The drag overlay renders the registered ghost pixels.
    const bravo = nodeCard(canvasElement, "bravo");
    await dragHoldAt(alpha, rectPoint(bravo, 0.85));
    await waitFor(() => {
      expect(
        canvasElement.ownerDocument.querySelector('[data-testid="custom-ghost"]')
      ).not.toBeNull();
    });
    await releaseAt(rectPoint(bravo, 0.85));
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["bravo", "alpha"]);
    });
  },
};
