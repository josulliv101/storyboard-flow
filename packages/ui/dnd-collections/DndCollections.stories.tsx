import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { buildGraph, parseNodeId, type GraphNodeSpec } from "./core/graph";
import { DndCollections } from "./react/DndCollections";
import { CollectionPanels } from "./react/node-views";
import { HistoryLog, UndoRedoControls } from "./react/history-views";
import {
  dragHoldAt,
  dragToPoint,
  gapBetween,
  moveHeldPointer,
  nodeCard,
  panelOrder,
  rectCenter,
  rectPoint,
  releaseAt,
  waitForLayout,
} from "./stories-helpers";

// Interaction test suite for dnd-collections: these play functions run in
// real Chromium via the storybook vitest project and are the package's
// end-to-end coverage of drag semantics — reorder, cross-panel moves,
// nesting, cycle rejection, multi-drag, undo/redo, and the render-
// efficiency guarantee.

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

/** panel-a: [alpha, bravo, charlie, folder-f(f1), delta]; panel-b: [xray, yankee]. */
const standardGraph = () =>
  graphOrThrow([
    collection("panel-a", "Panel A", [
      media("alpha"),
      media("bravo"),
      media("charlie"),
      collection("folder-f", "Folder F", [media("f1")]),
      media("delta"),
    ]),
    collection("panel-b", "Panel B", [media("xray"), media("yankee")]),
  ]);

function StandardBoard() {
  return (
    <DndCollections initialGraph={standardGraph()}>
      <div className="flex flex-col gap-4">
        <UndoRedoControls />
        <CollectionPanels
          collectionIds={[parseNodeId("panel-a"), parseNodeId("panel-b"), parseNodeId("folder-f")]}
        />
        <HistoryLog />
      </div>
    </DndCollections>
  );
}

const meta = {
  title: "UI/DndCollections",
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-3xl">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => <StandardBoard />,
};

export const ReorderWithinCollection: Story = {
  render: () => <StandardBoard />,
  play: async ({ canvasElement }) => {
    const alpha = nodeCard(canvasElement, "alpha");
    const charlie = nodeCard(canvasElement, "charlie");
    await waitForLayout(charlie);

    // Drop on charlie's right half -> insert after.
    await dragToPoint(alpha, rectPoint(charlie, 0.85));

    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual([
        "bravo",
        "charlie",
        "alpha",
        "folder-f",
        "delta",
      ]);
    });
  },
};

export const MoveAcrossCollections: Story = {
  render: () => <StandardBoard />,
  play: async ({ canvasElement }) => {
    const alpha = nodeCard(canvasElement, "alpha");
    const yankee = nodeCard(canvasElement, "yankee");
    await waitForLayout(yankee);

    // Drop on yankee's left half -> insert before it, in panel B.
    await dragToPoint(alpha, rectPoint(yankee, 0.15));

    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-b")).toEqual(["xray", "alpha", "yankee"]);
      expect(panelOrder(canvasElement, "panel-a")).toEqual([
        "bravo",
        "charlie",
        "folder-f",
        "delta",
      ]);
    });
  },
};

export const DropInGapInsertsBetween: Story = {
  // The pointer in the GAP between two cards is inside the panel droppable
  // but over neither card — without gap resolution that reads as
  // append-to-collection and the drop lands at the END. It must land
  // between the flanking cards.
  render: () => <StandardBoard />,
  play: async ({ canvasElement }) => {
    const delta = nodeCard(canvasElement, "delta");
    const bravo = nodeCard(canvasElement, "bravo");
    const charlie = nodeCard(canvasElement, "charlie");
    await waitForLayout(charlie);

    await dragToPoint(delta, gapBetween(bravo, charlie));

    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual([
        "alpha",
        "bravo",
        "delta",
        "charlie",
        "folder-f",
      ]);
    });
  },
};

export const NestIntoCollection: Story = {
  render: () => <StandardBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bravo = nodeCard(canvasElement, "bravo");
    const folder = nodeCard(canvasElement, "folder-f");
    await waitForLayout(folder);

    // Dead-center of the collection card = the nest hotspot.
    await dragToPoint(bravo, rectCenter(folder));

    await waitFor(() => {
      // Folder F is also mounted as a panel — bravo appears inside it...
      expect(panelOrder(canvasElement, "folder-f")).toEqual(["f1", "bravo"]);
      // ...and leaves panel A.
      expect(panelOrder(canvasElement, "panel-a")).toEqual([
        "alpha",
        "charlie",
        "folder-f",
        "delta",
      ]);
    });
    // The card's count line reflects the graph.
    await expect(canvas.getByLabelText(/folder f \(collection, 2 items\)/i)).toBeInTheDocument();
  },
};

export const DropOnPanelAppends: Story = {
  render: () => <StandardBoard />,
  play: async ({ canvasElement }) => {
    const delta = nodeCard(canvasElement, "delta");
    const panelB = canvasElement.querySelector(
      '[data-panel-droppable="panel-b"]'
    ) as HTMLElement;
    await waitForLayout(panelB);

    // Drop on the panel's empty right region (past the last card).
    const rect = panelB.getBoundingClientRect();
    await dragToPoint(delta, { x: rect.right - 12, y: rect.top + rect.height / 2 });

    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-b")).toEqual(["xray", "yankee", "delta"]);
    });
  },
};

const cycleGraph = () =>
  graphOrThrow([
    collection("root", "Root", [
      collection("outer", "Outer", [collection("inner", "Inner", [])]),
      media("m1"),
    ]),
  ]);

/**
 * Play-less twin of CycleRejectionFlash for the Playwright e2e suite.
 * E2E MUST target stories without play functions: Storybook auto-runs play()
 * when the iframe loads, and its synthetic pointer sequence interleaves with
 * Playwright's real mouse input — the stray synthetic pointerup ends the
 * real drag mid-flight (diagnosed from the raw event log; the untrusted
 * events carry this suite's exact simulation signature).
 */
export const CycleFixture: Story = {
  render: () => (
    <DndCollections initialGraph={cycleGraph()}>
      <CollectionPanels collectionIds={[parseNodeId("root"), parseNodeId("outer")]} />
    </DndCollections>
  ),
};

export const CycleRejectionFlash: Story = {
  render: () => (
    <DndCollections initialGraph={cycleGraph()}>
      <CollectionPanels collectionIds={[parseNodeId("root"), parseNodeId("outer")]} />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const outerCard = nodeCard(canvasElement, "outer");
    const innerCard = nodeCard(canvasElement, "inner");
    await waitForLayout(innerCard);

    // Hold over inner's nest hotspot: the live preview flags the cycle...
    await dragHoldAt(outerCard, rectCenter(innerCard));
    await waitFor(() => {
      const overlay = canvasElement.querySelector('[data-nest-state="invalid"]');
      expect(overlay).toBeTruthy();
      expect(overlay!.textContent).toMatch(/cannot drop \(cycle\)/i);
    });

    // ...and releasing anyway rejects the command, flashes, and announces.
    await releaseAt(rectCenter(innerCard));
    await waitFor(() => {
      expect(nodeCard(canvasElement, "outer")).toHaveAttribute("data-rejected", "true");
    });
    await expect(
      await canvas.findByText(/cannot move a collection into itself/i)
    ).toBeInTheDocument();
    // Graph unchanged.
    expect(panelOrder(canvasElement, "root")).toEqual(["outer", "m1"]);
    expect(panelOrder(canvasElement, "outer")).toEqual(["inner"]);
  },
};

export const MultiSelectDrag: Story = {
  render: () => <StandardBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alpha = nodeCard(canvasElement, "alpha");
    const charlie = nodeCard(canvasElement, "charlie");
    const xray = nodeCard(canvasElement, "xray");
    await waitForLayout(xray);

    // Build the multi-selection with ONE user session: the static
    // userEvent API resets keyboard state per call, so a held modifier only
    // carries across clicks on a shared setup() instance.
    const user = userEvent.setup();
    await user.click(alpha);
    await user.keyboard("{Control>}");
    await user.click(charlie);
    await user.keyboard("{/Control}");
    await waitFor(() => {
      expect(alpha).toHaveAttribute("data-selected", "true");
      expect(charlie).toHaveAttribute("data-selected", "true");
    });

    // Dragging a selected card drags the whole selection; ghost shows +1.
    await dragHoldAt(alpha, rectPoint(xray, 0.15));
    await waitFor(() => {
      const badge = canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost-count"]');
      expect(badge?.textContent).toBe("+1");
    });
    await releaseAt(rectPoint(xray, 0.15));

    await waitFor(() => {
      // Both moved, document order preserved, before xray.
      expect(panelOrder(canvasElement, "panel-b")).toEqual(["alpha", "charlie", "xray", "yankee"]);
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["bravo", "folder-f", "delta"]);
    });
    await expect(await canvas.findByText(/moved 2 items to "panel b"/i)).toBeInTheDocument();
  },
};

export const UndoRedo: Story = {
  render: () => <StandardBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alpha = nodeCard(canvasElement, "alpha");
    const yankee = nodeCard(canvasElement, "yankee");
    await waitForLayout(yankee);

    await dragToPoint(alpha, rectPoint(yankee, 0.85));
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-b")).toEqual(["xray", "yankee", "alpha"]);
    });
    // History log records the command.
    expect(canvasElement.querySelector("[data-history-entry='0']")?.textContent).toMatch(
      /move \[alpha\]/i
    );

    const undoButton = canvas.getByRole("button", { name: /undo/i });
    undoButton.click();
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual([
        "alpha",
        "bravo",
        "charlie",
        "folder-f",
        "delta",
      ]);
      expect(panelOrder(canvasElement, "panel-b")).toEqual(["xray", "yankee"]);
    });

    const redoButton = canvas.getByRole("button", { name: /redo/i });
    redoButton.click();
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-b")).toEqual(["xray", "yankee", "alpha"]);
    });
  },
};

export const KeyboardMoves: Story = {
  // The semantic keyboard layer: Alt+Arrows resolve to the SAME move-nodes
  // commands the pointer path produces — validation, undo, and
  // announcements all shared.
  render: () => <StandardBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const alpha = nodeCard(canvasElement, "alpha");
    await waitForLayout(alpha);

    // Focus alpha, Alt+ArrowRight: one step right.
    await user.click(alpha);
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual([
        "bravo",
        "alpha",
        "charlie",
        "folder-f",
        "delta",
      ]);
    });

    // Alt+ArrowDown: nest into the nearest sibling collection (folder-f).
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await waitFor(() => {
      expect(panelOrder(canvasElement, "folder-f")).toEqual(["f1", "alpha"]);
    });

    // Alt+ArrowUp: back out to the parent, landing right after folder-f's card.
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual([
        "bravo",
        "charlie",
        "folder-f",
        "alpha",
        "delta",
      ]);
      expect(panelOrder(canvasElement, "folder-f")).toEqual(["f1"]);
    });

    // Boundary: Alt+ArrowLeft at the far edge announces instead of moving.
    await user.keyboard("{Alt>}{Home}{/Alt}");
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")[0]).toBe("alpha");
    });
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    await expect(await canvas.findByText(/already first in its collection/i)).toBeInTheDocument();
  },
};

export const FlipAnimatesCommits: Story = {
  // The FLIP layer: committed moves (drop/undo/redo) play inverted-transform
  // animations on every displaced card — including cards that never
  // re-rendered (the sweep measures DOM, not React output).
  render: () => <StandardBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const alpha = nodeCard(canvasElement, "alpha");
    const charlie = nodeCard(canvasElement, "charlie");
    await waitForLayout(charlie);

    await dragToPoint(alpha, rectPoint(charlie, 0.85));
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")[2]).toBe("alpha");
    });

    // Undo commits synchronously inside the click handler; the FLIP sweep
    // runs in a layout effect before paint — so animations are live the
    // moment the awaited click returns. alpha travels back left, and bravo
    // (which never re-rendered) shifts too.
    await user.click(canvas.getByRole("button", { name: /undo/i }));
    const moved = nodeCard(canvasElement, "alpha");
    expect(moved.getAnimations().length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual([
        "alpha",
        "bravo",
        "charlie",
        "folder-f",
        "delta",
      ]);
    });
  },
};

export const TwoInstancesStayIsolated: Story = {
  // Two boards with IDENTICAL node ids — the sharp case for instance
  // scoping. Graph state is isolated by construction (separate stores);
  // this guards the DOM layers: the FLIP sweep and its id-keyed rect
  // registry must stay inside one provider's container. Pre-fix, a
  // body-wide sweep recorded board two's rects under board one's ids, so
  // board one's undo animated its card from board TWO's position (a huge
  // vertical delta).
  render: () => (
    <div className="flex flex-col gap-8">
      <div data-testid="board-one">
        <StandardBoard />
      </div>
      <div data-testid="board-two">
        <StandardBoard />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const boardOne = canvasElement.querySelector<HTMLElement>('[data-testid="board-one"]')!;
    const boardTwo = canvasElement.querySelector<HTMLElement>('[data-testid="board-two"]')!;
    const user = userEvent.setup();

    const alpha = nodeCard(boardOne, "alpha");
    const charlie = nodeCard(boardOne, "charlie");
    await waitForLayout(nodeCard(boardTwo, "charlie"));

    await dragToPoint(alpha, rectPoint(charlie, 0.85));
    await waitFor(() => {
      expect(panelOrder(boardOne, "panel-a")[2]).toBe("alpha");
    });
    // Graph isolation: board two never moved.
    expect(panelOrder(boardTwo, "panel-a")).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "folder-f",
      "delta",
    ]);

    // Undo commits synchronously in the click handler; FLIP animations are
    // live when the awaited click returns.
    await user.click(within(boardOne).getByRole("button", { name: /undo/i }));

    // getAnimations() also reports CSS transitions (the card has
    // transition-all), so pick out FLIP by its translate keyframe.
    const flipTransforms = (el: HTMLElement) =>
      el.getAnimations().flatMap((a) => {
        if (!(a.effect instanceof KeyframeEffect)) return [];
        const t = a.effect.getKeyframes()[0]?.transform;
        return typeof t === "string" && t.startsWith("translate") ? [t] : [];
      });

    // Board one's alpha slides home WITHIN ITS ROW: the inverted transform
    // must have a zero vertical component. A cross-instance rect collision
    // would produce a large dy (the distance between the boards).
    const transforms = flipTransforms(nodeCard(boardOne, "alpha"));
    expect(transforms.length).toBeGreaterThan(0);
    expect(transforms[0]).toMatch(/,\s*0px\)/);

    // And board two's same-id cards are untouched by board one's commit.
    for (const id of ["alpha", "bravo", "charlie"]) {
      expect(flipTransforms(nodeCard(boardTwo, id))).toHaveLength(0);
    }
  },
};

function FreshOnChangeHarness() {
  const [label, setLabel] = useState("stale");
  const [seen, setSeen] = useState("none");
  return (
    <DndCollections initialGraph={standardGraph()} onChange={() => setSeen(label)}>
      <div className="flex flex-col gap-4">
        <button type="button" onClick={() => setLabel("fresh")}>
          relabel
        </button>
        <output data-testid="seen-label">{seen}</output>
        <CollectionPanels collectionIds={[parseNodeId("panel-a")]} />
      </div>
    </DndCollections>
  );
}

export const OnChangeStaysFresh: Story = {
  // The store is created once, but callback props must not freeze with it:
  // onChange closes over the parent's CURRENT state. Pre-fix, the store
  // kept the first render's closure forever, so this story saw "stale".
  render: () => <FreshOnChangeHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const alpha = nodeCard(canvasElement, "alpha");
    await waitForLayout(alpha);

    // Re-render with a new onChange closure BEFORE the first commit.
    await user.click(canvas.getByRole("button", { name: /relabel/i }));

    // Commit a move (keyboard path: same dispatch pipeline as pointer).
    await user.click(alpha);
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");

    await waitFor(() => {
      expect(canvas.getByTestId("seen-label")).toHaveTextContent("fresh");
    });
  },
};

const wideGraph = () =>
  graphOrThrow([
    collection(
      "panel-wide",
      "Wide Panel",
      Array.from({ length: 40 }, (_, i) => media(`w${i}`, `W${i}`))
    ),
    collection("panel-target", "Target Panel", [media("t1", "T1")]),
  ]);

export const RenderEfficiencyDuringDrag: Story = {
  // The efficiency guarantee, asserted: while a drag moves (same resolved
  // intent), uninvolved cards must not re-render AT ALL — selector
  // subscriptions bail on Object.is, the intent gate dedupes store
  // notifications, and dnd-kit only re-renders the hovered droppable.
  render: () => (
    <DndCollections initialGraph={wideGraph()}>
      <CollectionPanels />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const source = nodeCard(canvasElement, "w0");
    const target = nodeCard(canvasElement, "t1");
    const bystander = nodeCard(canvasElement, "w20");
    await waitForLayout(target);

    // Establish the drag and settle on the target's left half.
    const holdPoint = rectPoint(target, 0.15);
    await dragHoldAt(source, holdPoint);
    await waitFor(() => {
      expect(target.parentElement?.querySelector('[data-drop-indicator="before"]')).toBeTruthy();
    });

    const bystanderRendersBefore = bystander.getAttribute("data-render-count");
    // Jitter the pointer within the same intent (still left half of t1).
    await moveHeldPointer({ x: holdPoint.x + 3, y: holdPoint.y + 2 });
    await moveHeldPointer({ x: holdPoint.x - 3, y: holdPoint.y - 2 });
    await moveHeldPointer({ x: holdPoint.x + 2, y: holdPoint.y + 1 });
    await moveHeldPointer(holdPoint);

    // Zero re-renders for the uninvolved card across four pointer moves.
    expect(bystander.getAttribute("data-render-count")).toBe(bystanderRendersBefore);

    await releaseAt(holdPoint);
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-target")).toEqual(["w0", "t1"]);
    });
  },
};
