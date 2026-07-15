import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import {
  buildGraph,
  getChildren,
  mediaDurationSeconds,
  parseNodeId,
  type NodeId,
} from "./core/graph";
import { DndCollections } from "./react/DndCollections";
import { CollectionItem, useCollectionItemState } from "./react/collection-item";
import { useCollectionsSelector } from "./react/collections-store";
import {
  dispatchPointerSequence,
  dragHoldAt,
  dragToPoint,
  moveHeldPointer,
  nodeCard,
  rectCenter,
  rectPoint,
  releaseAt,
  waitForLayout,
} from "./stories-helpers";

// The compound-primitive escape hatch, exercised the way a consumer with an
// INTERACTIVE card would use it: a custom DOM shape hosting a real button
// (which must neither select nor drag), a grip placed by the consumer, a
// trim handle embedded in custom chrome, and the package's drop indicators —
// with selection, keyboard moves, drag reordering, trims, and the
// no-bystander-re-render guarantee all intact.

function compoundGraph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "panel-c",
      name: "Panel C",
      children: [
        { kind: "media", id: "alpha", name: "Alpha", durationSeconds: 4 },
        { kind: "media", id: "bravo", name: "Bravo", durationSeconds: 4 },
        { kind: "media", id: "charlie", name: "Charlie", durationSeconds: 4 },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** Consumer content reading item state through the public hook. */
function ClipLabel() {
  const { node } = useCollectionItemState();
  return (
    <>
      <span className="truncate font-medium text-foreground">{node.name}</span>
      {node.kind === "media" && (
        <span data-clip-duration className="text-[10px] text-muted-foreground">
          {mediaDurationSeconds(node).toFixed(2)}s
        </span>
      )}
    </>
  );
}

/** A fully custom item: selection surface, a REAL consumer button, a
 *  consumer-placed grip, an embedded trim handle, package indicators. */
function ClipItem({ id }: { id: NodeId }) {
  const [muteClicks, setMuteClicks] = useState(0);
  return (
    <CollectionItem.Root id={id} trimPixelsPerSecond={24} className="h-24 w-40 shrink-0">
      <CollectionItem.SelectionSurface className="flex h-full w-full flex-col justify-between rounded-md border border-border bg-background p-2 pt-6 text-xs data-[selected=true]:ring-2 data-[selected=true]:ring-primary">
        <ClipLabel />
      </CollectionItem.SelectionSurface>
      {/* Interactive consumer control: must not select, must not drag. */}
      <button
        type="button"
        data-mute={id}
        onClick={() => setMuteClicks((clicks) => clicks + 1)}
        className="absolute top-1 right-1 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white"
      >
        M{muteClicks}
      </button>
      <CollectionItem.DragHandle className="absolute top-1 left-1 z-10 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
        ⠿
      </CollectionItem.DragHandle>
      <CollectionItem.TrimHandle side="right">
        <span className="flex h-full w-full items-center justify-center rounded-r-md bg-amber-300/80">
          <span className="h-3 w-0.5 rounded bg-black/50" />
        </span>
      </CollectionItem.TrimHandle>
      <CollectionItem.DropIndicators />
    </CollectionItem.Root>
  );
}

/** A consumer-owned container: no CollectionPanel, just a mapped list. */
function CompoundList() {
  const childIds = useCollectionsSelector((s) => getChildren(s.graph, parseNodeId("panel-c")));
  return (
    <div data-testid="compound-list" className="flex gap-3">
      {childIds.map((id) => (
        <ClipItem key={id} id={id} />
      ))}
    </div>
  );
}

const meta = {
  title: "UI/DndCollectionsCompoundItem",
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

function listOrder(canvasElement: HTMLElement): string[] {
  return [
    ...canvasElement.querySelectorAll<HTMLElement>('[data-testid="compound-list"] [data-node-id]'),
  ].map((el) => el.dataset.nodeId ?? "");
}

export const InteractiveCompoundItems: Story = {
  render: () => (
    <DndCollections initialGraph={compoundGraph()} animateMoves={false}>
      <CompoundList />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "alpha"));
    expect(listOrder(canvasElement)).toEqual(["alpha", "bravo", "charlie"]);
    const user = userEvent.setup();

    // 1) The consumer's embedded button is genuinely interactive — and
    //    neither selects nor starts a drag.
    const mute = canvasElement.querySelector<HTMLElement>('[data-mute="alpha"]')!;
    await user.click(mute);
    expect(mute.textContent).toBe("M1");
    expect(nodeCard(canvasElement, "alpha")).not.toHaveAttribute("data-selected");
    expect(canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost"]')).toBeNull();

    // 2) The SelectionSurface selects (with the standard grammar).
    await user.click(nodeCard(canvasElement, "alpha"));
    await waitFor(() => {
      expect(nodeCard(canvasElement, "alpha")).toHaveAttribute("data-selected", "true");
    });

    // 3) Alt+ArrowRight semantic move works through the same keyboard
    //    delegation (data-node-id anchors it).
    nodeCard(canvasElement, "alpha").focus();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await waitFor(() => {
      expect(listOrder(canvasElement)).toEqual(["bravo", "alpha", "charlie"]);
    });

    // 4) Pointer reordering from the CONSUMER-PLACED grip.
    const bravoGrip = canvasElement.querySelector<HTMLElement>('[data-drag-handle="bravo"]')!;
    await dragToPoint(bravoGrip, rectPoint(nodeCard(canvasElement, "charlie"), 0.85));
    await waitFor(() => {
      expect(listOrder(canvasElement)).toEqual(["alpha", "charlie", "bravo"]);
    });

    // 5) The embedded trim handle commits update-media (no live resize in a
    //    plain list — no TrimPreview — but the data trims and undo applies).
    const alphaTrim = canvasElement
      .querySelector<HTMLElement>('[data-node-wrapper="alpha"]')!
      .querySelector<HTMLElement>('[data-trim-handle="right"]')!;
    const start = rectCenter(alphaTrim);
    await dispatchPointerSequence([
      { element: alphaTrim, type: "pointerdown", clientX: start.x, clientY: start.y },
      { element: document, type: "pointermove", clientX: start.x - 24, clientY: start.y, delayAfterMs: 30 },
      { element: document, type: "pointerup", clientX: start.x - 24, clientY: start.y, delayAfterMs: 30 },
    ]);
    await waitFor(() => {
      expect(
        canvasElement
          .querySelector('[data-node-wrapper="alpha"]')!
          .querySelector("[data-clip-duration]")!.textContent
      ).toBe("3.00s");
    });

    // 6) Efficiency holds for compound items: mid-drag jitter over one item
    //    re-renders neither the bystander's Root nor its content.
    const alphaGrip = canvasElement.querySelector<HTMLElement>('[data-drag-handle="alpha"]')!;
    const holdPoint = rectPoint(nodeCard(canvasElement, "bravo"), 0.15);
    await dragHoldAt(alphaGrip, holdPoint);
    await waitFor(() => {
      expect(
        canvasElement
          .querySelector('[data-node-wrapper="bravo"]')!
          .querySelector('[data-drop-indicator="before"]')
      ).not.toBeNull();
    });
    const bystander = canvasElement.querySelector<HTMLElement>('[data-node-wrapper="charlie"]')!;
    const bystanderBefore = bystander.getAttribute("data-render-count");
    await moveHeldPointer({ x: holdPoint.x + 3, y: holdPoint.y + 2 });
    await moveHeldPointer({ x: holdPoint.x - 3, y: holdPoint.y - 2 });
    await moveHeldPointer(holdPoint);
    expect(bystander.getAttribute("data-render-count")).toBe(bystanderBefore);
    await releaseAt(holdPoint);
    await waitFor(() => {
      expect(listOrder(canvasElement)).toEqual(["charlie", "alpha", "bravo"]);
    });
  },
};
