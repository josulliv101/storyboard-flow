import { memo, useRef, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import {
  buildGraph,
  mediaDurationSeconds,
  parseNodeId,
  type GraphNodeSpec,
} from "./core/graph";
import { DndCollections } from "./react/DndCollections";
import {
  type CollectionGhostContentProps,
  type CollectionItemContentProps,
} from "./react/collections-components";
import { CollectionPanels } from "./react/node-views";
import { VirtualStrip } from "./virtual/VirtualStrip";
import {
  dragHoldAt,
  moveHeldPointer,
  nodeCard,
  panelOrder,
  rectPoint,
  releaseAt,
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
      <span className="flex h-full w-full items-center justify-center rounded-md border border-border bg-muted/60 text-xs">
        {node.name} · {childCount}
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

export const TimelineLookalike: Story = {
  // The end goal, as a story: consumer pixels dictate the entire card look
  // (filmstrip, selection chrome, readout pill) while the package keeps
  // widths-from-duration, trimming, selection, and drag behavior.
  render: () => (
    <DndCollections initialGraph={timelineGraph()} animateMoves={false}>
      <div className="w-[640px] pt-10">
        <VirtualStrip
          collectionId={parseNodeId("strip")}
          itemContent={TimelineClipContent}
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

    // Selection is still shell behavior; the BADGE is consumer pixels.
    const user = userEvent.setup();
    await user.click(vid);
    await waitFor(() => {
      expect(nodeCard(canvasElement, "vid")).toHaveAttribute("data-selected", "true");
      expect(vid.querySelector("[data-timeline-clip-badge]")).not.toBeNull();
    });

    // Package-owned trim handles coexist with consumer pixels (siblings of
    // the button, so they never live inside the consumer's markup).
    const wrapper = vid.closest("[data-node-wrapper]")!;
    expect(wrapper.querySelector('[data-trim-handle="left"]')).not.toBeNull();
    expect(wrapper.querySelector('[data-trim-handle="right"]')).not.toBeNull();
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
