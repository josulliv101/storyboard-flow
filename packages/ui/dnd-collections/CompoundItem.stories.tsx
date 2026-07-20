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

/** The same item, plus the TEXT INPUT the compound API's docblock promises is
 *  allowed inside a card. Its keys must reach it, not the collection. */
function EditableClipItem({ id }: { id: NodeId }) {
  const [name, setName] = useState("take one");
  return (
    <CollectionItem.Root id={id} trimPixelsPerSecond={24} className="h-24 w-40 shrink-0">
      <CollectionItem.SelectionSurface className="flex h-full w-full flex-col justify-between rounded-md border border-border bg-background p-2 pt-6 text-xs">
        <ClipLabel />
      </CollectionItem.SelectionSurface>
      <input
        data-rename={id}
        aria-label={`Rename ${id}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="absolute inset-x-1 bottom-1 z-10 rounded border border-border bg-background px-1 text-[10px]"
      />
      <CollectionItem.DragHandle className="absolute top-1 left-1 z-10 rounded bg-muted px-1.5 py-0.5 text-[10px]">
        ⠿
      </CollectionItem.DragHandle>
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

export const CompoundFlipAnimatesWholeItem: Story = {
  // FLIP animates the data-node-wrapper HOST — the whole compound item,
  // consumer controls and handles included — not just the selection surface
  // (which would let siblings teleport while the surface glides).
  render: () => (
    <DndCollections initialGraph={compoundGraph()}>
      <CompoundList />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "alpha"));
    const user = userEvent.setup();
    nodeCard(canvasElement, "alpha").focus();

    // The commit's FLIP sweep plays synchronously in the layout effect, so
    // animations are live the moment the awaited keypress returns.
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    const wrapper = canvasElement.querySelector<HTMLElement>('[data-node-wrapper="alpha"]')!;
    const flip = wrapper.getAnimations().flatMap((a) => {
      if (!(a.effect instanceof KeyframeEffect)) return [];
      const t = a.effect.getKeyframes()[0]?.transform;
      return typeof t === "string" && t.startsWith("translate") ? [t] : [];
    });
    expect(flip.length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(listOrder(canvasElement)).toEqual(["bravo", "alpha", "charlie"]);
    });
  },
};

export const CompoundKeyboardGrab: Story = {
  // The manual Enter-grab wiring on SelectionSurface (the KeyboardSensor
  // activator attached by hand): Enter picks the item up (ghost appears),
  // Escape cancels cleanly.
  render: () => (
    <DndCollections initialGraph={compoundGraph()} animateMoves={false}>
      <CompoundList />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "alpha"));
    const user = userEvent.setup();
    nodeCard(canvasElement, "alpha").focus();

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(
        canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost"]')
      ).not.toBeNull();
    });

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost"]')
      ).toBeNull();
    });
    expect(listOrder(canvasElement)).toEqual(["alpha", "bravo", "charlie"]);
  },
};

/**
 * The compound API promises interactive controls inside cards, but the
 * package's keyboard delegation used to contradict it: the Alt chords walk to
 * the nearest card wrapper, so Alt+Arrow in an <input> REORDERED the card
 * instead of moving the caret by word. Both handlers now bail on editable
 * targets.
 */
export const EditableControlsKeepTheirKeys: Story = {
  // The input is on BRAVO, the middle card: Alt+ArrowLeft is a legal move for
  // it, so an unguarded handler visibly reorders. (On the first card the
  // command is rejected anyway, and the test would pass either way — which is
  // exactly the mistake this comment exists to prevent.)
  render: () => (
    <DndCollections initialGraph={compoundGraph()} animateMoves={false}>
      <div data-testid="compound-list" className="flex gap-3">
        <ClipItem id={parseNodeId("alpha")} />
        <EditableClipItem id={parseNodeId("bravo")} />
        <ClipItem id={parseNodeId("charlie")} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "bravo"));
    const user = userEvent.setup();
    const input = canvasElement.querySelector<HTMLInputElement>("[data-rename]");
    expect(input).not.toBeNull();

    input!.focus();
    input!.setSelectionRange(input!.value.length, input!.value.length);

    // Alt+Arrow is the package's move chord AND a word-wise caret move.
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");

    // Bravo did not move, and focus stayed in the control.
    expect(listOrder(canvasElement)).toEqual(["alpha", "bravo", "charlie"]);
    expect(canvasElement.ownerDocument.activeElement).toBe(input);

    // And the input still edits normally.
    await user.keyboard("X");
    expect(input!.value).toContain("X");
  },
};
