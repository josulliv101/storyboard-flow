import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { buildGraph, parseNodeId, type GraphNodeSpec } from "./core/graph";
import { useCollectionsStore } from "./react/collections-store";
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

export const ReleaseOutsideBoardCancels: Story = {
  // Releasing where nothing is under the pointer must CANCEL, not commit.
  // pointerWithin returns nothing out there; the pointer-drag path no longer
  // falls back to unbounded closestCenter (which would always find "some
  // card, somewhere" and move the item next to it). Nothing changes.
  render: () => <StandardBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alpha = nodeCard(canvasElement, "alpha");
    const panelA = canvasElement.querySelector(
      '[data-panel-droppable="panel-a"]'
    ) as HTMLElement;
    await waitForLayout(panelA);

    // Release far to the right of every panel — background, no droppable.
    const rect = panelA.getBoundingClientRect();
    await dragToPoint(alpha, { x: rect.right + 400, y: rect.top + 20 });

    // No move: both panels are exactly as they started.
    expect(panelOrder(canvasElement, "panel-a")).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "folder-f",
      "delta",
    ]);
    expect(panelOrder(canvasElement, "panel-b")).toEqual(["xray", "yankee"]);
    // The gesture is announced as a cancel, and no history entry is recorded.
    await expect(await canvas.findByText(/cancelled drag/i)).toBeInTheDocument();
    expect(canvasElement.querySelector("[data-history-entry='0']")).toBeNull();
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

export const DragGhostScales: Story = {
  // dragGhostScale shrinks the drag ghost so the drop target under it stays
  // visible. Default (unset) is 1 — every other story asserts the ghost is
  // full size implicitly by never seeing this wrapper.
  render: () => (
    <DndCollections initialGraph={standardGraph()} dragGhostScale={0.5}>
      <CollectionPanels collectionIds={[parseNodeId("panel-a"), parseNodeId("panel-b")]} />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const alpha = nodeCard(canvasElement, "alpha");
    await waitForLayout(alpha);

    // Hold mid-drag: the overlay is live, so the scaled wrapper exists.
    await dragHoldAt(alpha, rectPoint(nodeCard(canvasElement, "bravo"), 0.5));

    const wrapper = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-drag-ghost-scale]");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(wrapper.dataset.dragGhostScale).toBe("0.5");

    // The shrink is a real transition (1 -> 0.5), so it lands on scale(0.5)
    // after its 160ms — not an instant swap and not stuck at 1.
    await waitFor(() => {
      expect(wrapper.style.transform).toBe("scale(0.5)");
    });
    // Grows FROM the grab point, not the element's own centre.
    expect(wrapper.style.transformOrigin).not.toBe("center");

    await releaseAt(rectPoint(nodeCard(canvasElement, "bravo"), 0.5));
    // Ghost gone once the drag ends.
    await waitFor(() => {
      expect(document.querySelector("[data-drag-ghost-scale]")).toBeNull();
    });
  },
};

export const DragGhostFixedSquare: Story = {
  // dragGhostWidth + dragGhostHeight pin the ghost to a fixed SIZE (here a
  // 120x120 square), independent of the source card's width or height —
  // centred on the grabbed pixel. Consumers pair this with a GhostContent that
  // paints the item's own artwork (see the graph view's square thumbnail
  // ghost); the box geometry is what this story asserts.
  render: () => (
    <DndCollections
      initialGraph={standardGraph()}
      dragGhostWidth={120}
      dragGhostHeight={120}
    >
      <CollectionPanels collectionIds={[parseNodeId("panel-a"), parseNodeId("panel-b")]} />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const alpha = nodeCard(canvasElement, "alpha");
    await waitForLayout(alpha);

    await dragHoldAt(alpha, rectPoint(nodeCard(canvasElement, "bravo"), 0.5));

    const wrapper = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-drag-ghost-width]");
      expect(el).toBeTruthy();
      return el!;
    });
    // A fixed SQUARE box: both axes pinned to 120px (a duration-shaped card
    // would be far wider than tall).
    expect(wrapper.dataset.dragGhostWidth).toBe("120");
    expect(wrapper.dataset.dragGhostHeight).toBe("120");
    expect(wrapper.style.width).toBe("120px");
    expect(wrapper.style.height).toBe("120px");
    // Centred on the grab point in BOTH axes (origin is the box centre, not
    // the top-anchored width-only origin).
    expect(wrapper.style.transformOrigin).toBe("60px 60px");

    await releaseAt(rectPoint(nodeCard(canvasElement, "bravo"), 0.5));
    await waitFor(() => {
      expect(document.querySelector("[data-drag-ghost-width]")).toBeNull();
    });
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
    // §20: selection changes are announced to the live region.
    await waitFor(() => {
      expect(canvasElement.ownerDocument.body.textContent).toMatch(/2 items selected/i);
    });

    // Dragging a selected card drags the whole selection; the PRESSED card
    // is the primary ghost (not the earliest-selected one), with a +1 badge.
    await dragHoldAt(charlie, rectPoint(xray, 0.15));
    await waitFor(() => {
      const ghost = canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost"]');
      expect(ghost?.textContent).toContain("CHARLIE");
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

export const KeyboardSelectAndGrab: Story = {
  // The keyboard grammar split: Space SELECTS the focused card, Enter GRABS
  // it for a drag. Before this, dnd-kit's KeyboardSensor claimed Space/Enter
  // for grabbing, so keyboard users could not select at all.
  render: () => <StandardBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const alpha = nodeCard(canvasElement, "alpha");
    const charlie = nodeCard(canvasElement, "charlie");
    await waitForLayout(charlie);

    // Focus WITHOUT clicking (a click would select via the mouse path), then
    // Space to select via the keyboard.
    alpha.focus();
    await user.keyboard("[Space]");
    await waitFor(() => {
      expect(nodeCard(canvasElement, "alpha")).toHaveAttribute("data-selected", "true");
    });

    // Ctrl+Space adds to the selection — multi-select with no mouse.
    charlie.focus();
    await user.keyboard("{Control>}[Space]{/Control}");
    await waitFor(() => {
      expect(nodeCard(canvasElement, "alpha")).toHaveAttribute("data-selected", "true");
      expect(nodeCard(canvasElement, "charlie")).toHaveAttribute("data-selected", "true");
    });
    await expect(await canvas.findByText(/2 items selected/i)).toBeInTheDocument();

    // Enter GRABS (does not select): a drag ghost appears; Escape cancels.
    const bravo = nodeCard(canvasElement, "bravo");
    bravo.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(
        canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost"]')
      ).not.toBeNull();
    });
    expect(nodeCard(canvasElement, "bravo")).not.toHaveAttribute("data-selected", "true");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost"]')
      ).toBeNull();
    });
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

export const RepeatedAnnouncementsReinsertExactText: Story = {
  render: () => <StandardBoard />,
  play: async ({ canvasElement }) => {
    const user = userEvent.setup();
    const alpha = nodeCard(canvasElement, "alpha");
    const status = canvasElement.querySelector<HTMLElement>('[role="status"]')!;
    const boundaryMessage = "Already first in its collection.";
    const observed: string[] = [];
    const observer = new MutationObserver(() => {
      const text = status.textContent ?? "";
      if (text) observed.push(text);
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });

    try {
      alpha.focus();
      await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
      await waitFor(() =>
        expect(observed.filter((text) => text === boundaryMessage)).toHaveLength(1)
      );

      await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
      await waitFor(() =>
        expect(observed.filter((text) => text === boundaryMessage)).toHaveLength(2)
      );
      expect(status.textContent).toBe(boundaryMessage);
    } finally {
      observer.disconnect();
    }
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
    // FLIP animates the WRAPPER (the whole item, siblings included).
    const moved = flipHost(nodeCard(canvasElement, "alpha"));
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

// FLIP animates the data-node-wrapper HOST (the whole item — button plus
// sibling grip/handles/indicators), keyed by the data-node-id element.
// Resolve a card button to the element the sweep actually animates.
function flipHost(el: HTMLElement): HTMLElement {
  return el.closest<HTMLElement>("[data-node-wrapper]") ?? el;
}

// FLIP keyframe transforms of a card, excluding CSS transitions (the card
// has transition-all) — picked out by the translate keyframe.
function flipTransforms(el: HTMLElement): string[] {
  return flipHost(el)
    .getAnimations()
    .flatMap((a) => {
      if (!(a.effect instanceof KeyframeEffect)) return [];
      const t = a.effect.getKeyframes()[0]?.transform;
      return typeof t === "string" && t.startsWith("translate") ? [t] : [];
    });
}

// The in-flight FLIP animation on a card (its translate keyframe effect),
// or undefined once it has finished/cancelled.
function flipAnimation(el: HTMLElement): Animation | undefined {
  return flipHost(el)
    .getAnimations()
    .find((a) => {
      if (!(a.effect instanceof KeyframeEffect)) return false;
      const t = a.effect.getKeyframes()[0]?.transform;
      return typeof t === "string" && t.startsWith("translate");
    });
}

// Wait for an element's FLIP animation to advance past its start. A commit
// that supersedes another within the SAME animation-timeline tick sees the
// card still pinned at the prior animation's start position — which, for a
// reverse move, equals the new target — so the delta is a genuine zero and
// the FLIP layer correctly animates nothing. A real user's next keypress
// always lands a frame later, where the move has real distance to cover;
// these tests reproduce that by letting the first animation tick first.
async function waitForFlipToAdvance(el: HTMLElement): Promise<void> {
  await waitFor(() => expect(Number(flipAnimation(el)?.currentTime ?? 0)).toBeGreaterThan(0));
}

function DuplicateViewsBoard() {
  return (
    <DndCollections initialGraph={standardGraph()}>
      <div className="flex flex-col gap-8">
        <div data-testid="duplicate-view-a">
          <CollectionPanels collectionIds={[parseNodeId("panel-a")]} />
        </div>
        <div data-testid="duplicate-view-b">
          <CollectionPanels collectionIds={[parseNodeId("panel-a")]} />
        </div>
      </div>
    </DndCollections>
  );
}

export const FlipSeparatesDuplicateRenderedNodeIds: Story = {
  render: () => <DuplicateViewsBoard />,
  play: async ({ canvasElement }) => {
    const user = userEvent.setup();
    const viewA = canvasElement.querySelector<HTMLElement>('[data-testid="duplicate-view-a"]')!;
    const viewB = canvasElement.querySelector<HTMLElement>('[data-testid="duplicate-view-b"]')!;
    await waitForLayout(nodeCard(viewB, "alpha"));

    nodeCard(viewA, "alpha").focus();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");

    for (const view of [viewA, viewB]) {
      const transforms = flipTransforms(nodeCard(view, "alpha"));
      expect(transforms).toHaveLength(1);
      expect(transforms[0]).toMatch(/,\s*0px\)/);
    }
  },
};

export const FlipCancelsSupersededAnimations: Story = {
  render: () => <StandardBoard />,
  play: async ({ canvasElement }) => {
    const user = userEvent.setup();
    const alpha = nodeCard(canvasElement, "alpha");
    await waitForLayout(alpha);

    alpha.focus();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    const firstFlip = flipAnimation(alpha);
    expect(firstFlip).toBeDefined();

    // Let the first animation tick before superseding it (see
    // waitForFlipToAdvance) so the reverse move has a real delta to animate.
    await waitForFlipToAdvance(alpha);

    alpha.focus();
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(firstFlip!.playState).toBe("idle");
    expect(flipTransforms(alpha).length).toBeGreaterThan(0);
  },
};

function ScrollBetweenCommitsBoard() {
  return (
    <div data-testid="flip-scroller" style={{ height: 200, overflowY: "auto" }}>
      <div style={{ paddingBottom: 400 }}>
        <DndCollections initialGraph={standardGraph()}>
          <CollectionPanels collectionIds={[parseNodeId("panel-a"), parseNodeId("panel-b")]} />
        </DndCollections>
      </div>
    </div>
  );
}

export const FlipSurvivesScrollBetweenCommits: Story = {
  // The FLIP sweep must measure FIRST and LAST in the same scroll frame.
  // Scrolling the container between two commits shifts every card's viewport
  // position; a version that stashed FIRST at the PREVIOUS commit would read
  // that scroll delta as movement and slide the whole board by the scroll
  // amount. Here: commit, scroll, commit again — the moved card animates only
  // its real (horizontal) delta and the untouched panel does not animate.
  render: () => <ScrollBetweenCommitsBoard />,
  play: async ({ canvasElement }) => {
    const user = userEvent.setup();
    const scroller = canvasElement.querySelector<HTMLElement>('[data-testid="flip-scroller"]')!;
    await waitForLayout(nodeCard(canvasElement, "alpha"));

    // Commit 1: nudge alpha one step right.
    nodeCard(canvasElement, "alpha").focus();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")[1]).toBe("alpha");
    });

    // Let commit 1's FLIP advance a frame so the post-scroll reverse below has
    // a real delta to animate (see waitForFlipToAdvance).
    await waitForFlipToAdvance(nodeCard(canvasElement, "alpha"));

    // Scroll the container between the two commits.
    scroller.scrollTop = 100;
    expect(scroller.scrollTop).toBeGreaterThan(0); // the scroll really took

    // Commit 2 (post-scroll): move alpha back. FLIP plays synchronously in
    // the layout effect, so read the animations before they finish.
    nodeCard(canvasElement, "alpha").focus();
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");

    const alphaFlip = flipTransforms(nodeCard(canvasElement, "alpha"));
    const bystanderFlip = flipTransforms(nodeCard(canvasElement, "xray"));

    // alpha slid horizontally within its row — the 100px scroll must NOT
    // appear as a vertical component.
    expect(alphaFlip.length).toBeGreaterThan(0);
    expect(alphaFlip[0]).toMatch(/,\s*0px\)/);
    // The untouched panel-b never moved in the graph — pre-fix it would have
    // animated by the scroll delta.
    expect(bystanderFlip).toHaveLength(0);

    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")[0]).toBe("alpha");
    });
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

function ReplaceGraphButton() {
  const store = useCollectionsStore();
  return (
    <button
      type="button"
      onClick={() =>
        store.replaceGraph(
          graphOrThrow([
            collection("panel-a", "Panel A", [media("neo"), media("trinity")]),
            collection("panel-b", "Panel B", []),
          ])
        )
      }
    >
      replace graph
    </button>
  );
}

export const ReplaceGraphResetsBoard: Story = {
  // replaceGraph is the escape hatch for async/server-loaded data that the
  // initial-only initialGraph can't handle: it swaps the committed graph,
  // clears undo history (old patches can't replay on a new graph), and prunes
  // interaction — without a remount.
  render: () => (
    <DndCollections initialGraph={standardGraph()}>
      <div className="flex flex-col gap-4">
        <UndoRedoControls />
        <ReplaceGraphButton />
        <CollectionPanels collectionIds={[parseNodeId("panel-a"), parseNodeId("panel-b")]} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const alpha = nodeCard(canvasElement, "alpha");
    const charlie = nodeCard(canvasElement, "charlie");
    await waitForLayout(charlie);

    // A move builds history, so undo is enabled.
    await dragToPoint(alpha, rectPoint(charlie, 0.85));
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")[2]).toBe("alpha");
    });
    expect(canvas.getByRole("button", { name: /undo/i })).toBeEnabled();

    // Replace the whole graph: new cards render, old ones are gone...
    await user.click(canvas.getByRole("button", { name: /replace graph/i }));
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["neo", "trinity"]);
    });
    expect(canvasElement.querySelector('[data-node-id="alpha"]')).toBeNull();

    // ...and history is cleared — the pre-replace move is no longer undoable.
    expect(canvas.getByRole("button", { name: /undo/i })).toBeDisabled();
  },
};

const wideGraph = () =>
  graphOrThrow([
    collection(
      "panel-wide",
      "Wide Panel",
      Array.from({ length: 40 }, (_, i) => media(`w${i}`, `W${i}`))
    ),
    // THREE cards, not one, and that is load-bearing. With a single card the
    // panel droppable and the card droppable have nearly the same centre, so
    // dnd-kit's collision between them is a near-tie and a 3px jitter can flip
    // which one is `over` — churning its context and re-rendering every
    // droppable, the bystander included. That is what made
    // RenderEfficiencyDuringDrag fail about one run in three (and twice on CI):
    // the story said "jitter within the same intent" while the fixture made the
    // pointer sit on a collision boundary. Extra cards move the panel's centre
    // off the card's and the tie disappears.
    collection("panel-target", "Target Panel", [
      media("t1", "T1"),
      media("t2", "T2"),
      media("t3", "T3"),
    ]),
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

    // Establish the drag, THEN re-aim at the target's LIVE left half:
    // starting a drag can shift layout (here the wide panel reflows and t1
    // rises), so a hold point computed from the pre-drag rect would strand
    // the pointer off the card. Read the rect after the drag has settled.
    await dragHoldAt(source, rectPoint(target, 0.15));
    const holdPoint = rectPoint(target, 0.15);
    await moveHeldPointer(holdPoint);
    await waitFor(() => {
      expect(target.parentElement?.querySelector('[data-drop-indicator="before"]')).toBeTruthy();
    });

    // Sampled immediately, NOT after waiting for the render count to settle.
    // A settle was tried (PR #251) on the theory that a drag-start straggler
    // was being charged to the jitter — and it inserted a pause mid-drag that
    // had not been there. The very next CI run failed differently: the DROP
    // stopped landing. dnd-kit recomputes `over` on a measure cadence, so
    // holding the pointer still for extra frames gives the resolved intent
    // more chances to move before release. Reverted rather than defended: it
    // was a speculative fix for a failure that was never reproduced, and it
    // plausibly bought a worse one.
    const bystanderRendersBefore = bystander.getAttribute("data-render-count");

    // Jitter the pointer within the same intent (still left half of t1),
    // recording after EACH move. The assertion needs one number, but a failure
    // needs to say WHICH move caused the render — three CI failures were
    // reported as a bare "expected 10 to be 9", which is undiagnosable after
    // the fact and is why this flake survived two rounds of investigation.
    //
    // The INTENT is recorded beside the count, because the two failures
    // together are ambiguous without it. CI has shown both (+2,+1,0,0) and
    // (+1,+1,+1,0): renders landing per move rather than trickling in from
    // drag-start. That is either the efficiency guarantee failing on slow
    // hardware, or the jitter leaving the intent it claims to stay inside —
    // and only the resolved intent tells them apart.
    const indicator = () => {
      const parent = target.parentElement;
      if (parent?.querySelector('[data-drop-indicator="before"]')) return "before";
      if (parent?.querySelector('[data-drop-indicator="after"]')) return "after";
      return "none";
    };
    const jitter: Array<{ move: string; count: string | null; intent: string }> = [];
    const jitterTo = async (label: string, x: number, y: number) => {
      await moveHeldPointer({ x, y });
      jitter.push({
        move: label,
        count: bystander.getAttribute("data-render-count"),
        intent: indicator(),
      });
    };
    await jitterTo("+3,+2", holdPoint.x + 3, holdPoint.y + 2);
    await jitterTo("-3,-2", holdPoint.x - 3, holdPoint.y - 2);
    await jitterTo("+2,+1", holdPoint.x + 2, holdPoint.y + 1);
    await jitterTo("back", holdPoint.x, holdPoint.y);

    const trace = jitter
      .map((step) => `${step.move}:${step.count}/${step.intent}`)
      .join(" ");

    // PRECONDITION, checked before the guarantee it qualifies. The story's
    // premise is "jitter within the SAME intent"; if the intent moved, the
    // scenario never ran, and reporting that as an efficiency failure is how
    // this test wasted two investigations. A drop-intent change legitimately
    // re-renders every droppable — that is dnd-kit's context churning, not
    // this package's selectors leaking.
    const intentsSeen = [...new Set(jitter.map((step) => step.intent))];
    expect(
      intentsSeen,
      `the jitter left its intent, so the render assertion below never had its premise (${trace})`,
    ).toEqual(["before"]);

    // Zero re-renders for the uninvolved card across four pointer moves.
    expect(
      bystander.getAttribute("data-render-count"),
      `bystander re-rendered during jitter (baseline ${bystanderRendersBefore}; ${trace})`,
    ).toBe(bystanderRendersBefore);

    await releaseAt(holdPoint);
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-target")).toEqual(["w0", "t1", "t2", "t3"]);
    });
  },
};
