import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { buildGraph, getChildren, parseNodeId, type NodeId } from "@storyboard/collections-core/graph";
import { DndCollections } from "./react/DndCollections";
import { useCollectionsSelector } from "./react/collections-store";
import { NodeCard } from "./react/node-views";
import { VirtualStrip } from "./virtual/VirtualStrip";
import { nodeCard, waitForLayout } from "./stories-helpers";

// The provider-level interaction policy (react/interaction-policy.ts):
// click-toggle selection, click-to-open collections, and selection-gated
// trim handles. Everything here rides on the gesture arbitration that
// already exists — an activated drag or hold-grab suppresses its trailing
// click (dnd-kit), a pan squashes its own (use-pan-with-momentum) — so
// these stories exercise the semantics of the clicks that survive.

function mediaGraph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "board",
      name: "Board",
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

/** Five cards: a range needs an inside and two ends to be worth asserting. */
function wideGraph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "board",
      name: "Board",
      children: ["alpha", "bravo", "charlie", "delta", "echo"].map((id) => ({
        kind: "media" as const,
        id,
        name: id,
        durationSeconds: 4,
      })),
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function mixedGraph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "board",
      name: "Board",
      children: [
        { kind: "media", id: "alpha", name: "Alpha", durationSeconds: 4 },
        {
          kind: "collection",
          id: "scene",
          name: "Scene",
          children: [{ kind: "media", id: "nested", name: "Nested", durationSeconds: 4 }],
        },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function BoardCards({ trimPixelsPerSecond }: { trimPixelsPerSecond?: number }) {
  const childIds = useCollectionsSelector((s) => getChildren(s.graph, parseNodeId("board")));
  return (
    <div data-testid="board" className="flex gap-3">
      {childIds.map((id) => (
        <NodeCard key={id} id={id} trimPixelsPerSecond={trimPixelsPerSecond} />
      ))}
    </div>
  );
}

const meta = {
  title: "UI/DndCollectionsInteractionPolicy",
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

const isSelected = (canvasElement: HTMLElement, id: string) =>
  nodeCard(canvasElement, id).hasAttribute("data-selected");

export const ClickToggleSelection: Story = {
  render: () => (
    <DndCollections initialGraph={mediaGraph()} animateMoves={false} clickSelection="toggle">
      <BoardCards />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "alpha"));
    const user = userEvent.setup();

    // Click toggles ON: the clicked card becomes the sole selection.
    await user.click(nodeCard(canvasElement, "alpha"));
    await waitFor(() => expect(isSelected(canvasElement, "alpha")).toBe(true));

    // Click the sole-selected card again: toggles OFF.
    await user.click(nodeCard(canvasElement, "alpha"));
    await waitFor(() => expect(isSelected(canvasElement, "alpha")).toBe(false));

    // Clicking another card collapses the selection to it.
    await user.click(nodeCard(canvasElement, "alpha"));
    await user.click(nodeCard(canvasElement, "bravo"));
    await waitFor(() => {
      expect(isSelected(canvasElement, "alpha")).toBe(false);
      expect(isSelected(canvasElement, "bravo")).toBe(true);
    });

    // Ctrl+click stays the additive toggle: builds a multi-selection…
    await user.keyboard("{Control>}");
    await user.click(nodeCard(canvasElement, "charlie"));
    await user.keyboard("{/Control}");
    await waitFor(() => {
      expect(isSelected(canvasElement, "bravo")).toBe(true);
      expect(isSelected(canvasElement, "charlie")).toBe(true);
    });

    // …and a plain click on a member of a multi-selection collapses to it.
    await user.click(nodeCard(canvasElement, "charlie"));
    await waitFor(() => {
      expect(isSelected(canvasElement, "bravo")).toBe(false);
      expect(isSelected(canvasElement, "charlie")).toBe(true);
    });
  },
};

export const DoubleClickDoesNotClearSelection: Story = {
  // A double-click is the rename-in-place gesture on the graph's collection
  // cards; its SECOND click must not re-run the toggle. Before the
  // `event.detail > 1` guard, double-clicking a selected card collapsed on
  // click 1 and CLEARED on click 2, leaving the user renaming with nothing
  // selected. Here the card stays selected across the whole double-click.
  render: () => (
    <DndCollections initialGraph={mediaGraph()} animateMoves={false} clickSelection="toggle">
      <BoardCards />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "alpha"));
    const user = userEvent.setup();

    // A double-click leaves a card in the SAME state a single click would.
    // From UNSELECTED, that is selected: click 1 selects, click 2 (detail ===
    // 2) is ignored. Before the guard, click 2 re-ran the toggle and switched
    // it straight back off — so a double-click on an unselected card selected
    // then deselected in one gesture.
    expect(isSelected(canvasElement, "alpha")).toBe(false);
    await user.dblClick(nodeCard(canvasElement, "alpha"));
    await waitFor(() => expect(isSelected(canvasElement, "alpha")).toBe(true));

    // The case the guard exists for: from a MULTI-selection, double-click a
    // member. Click 1 collapses the selection to that member; click 2 is
    // ignored — so it STAYS selected instead of clearing to nothing (which is
    // what left the user renaming with an empty selection).
    await user.keyboard("{Control>}");
    await user.click(nodeCard(canvasElement, "bravo"));
    await user.keyboard("{/Control}");
    await waitFor(() => {
      expect(isSelected(canvasElement, "alpha")).toBe(true);
      expect(isSelected(canvasElement, "bravo")).toBe(true);
    });
    await user.dblClick(nodeCard(canvasElement, "bravo"));
    await waitFor(() => {
      expect(isSelected(canvasElement, "alpha")).toBe(false);
      expect(isSelected(canvasElement, "bravo")).toBe(true);
    });
  },
};

function OpenOnClickBoard() {
  const [opened, setOpened] = useState<string>("none");
  return (
    <DndCollections
      initialGraph={mixedGraph()}
      animateMoves={false}
      clickSelection="toggle"
      onOpenNode={(id: NodeId) => setOpened(id as string)}
    >
      <output data-testid="opened">{opened}</output>
      <BoardCards />
    </DndCollections>
  );
}

export const ClickOpensCollections: Story = {
  render: () => <OpenOnClickBoard />,
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "scene"));
    const user = userEvent.setup();
    const opened = () =>
      canvasElement.querySelector<HTMLElement>('[data-testid="opened"]')!.textContent;

    // A plain pointer click on a collection card OPENS it — and does not
    // select it.
    await user.click(nodeCard(canvasElement, "scene"));
    await waitFor(() => expect(opened()).toBe("scene"));
    expect(isSelected(canvasElement, "scene")).toBe(false);

    // A plain click on a media card selects (toggle mode) and never opens.
    await user.click(nodeCard(canvasElement, "alpha"));
    await waitFor(() => expect(isSelected(canvasElement, "alpha")).toBe(true));
    expect(opened()).toBe("scene");

    // Ctrl+click on the collection SELECTS it (how open-targets join a
    // multi-drag) without opening.
    await user.keyboard("{Control>}");
    await user.click(nodeCard(canvasElement, "scene"));
    await user.keyboard("{/Control}");
    await waitFor(() => expect(isSelected(canvasElement, "scene")).toBe(true));
    expect(opened()).toBe("scene");

    // Keyboard activation (Space) keeps SELECTION semantics on a collection
    // — keyboard users open through their own key, so Space must not drill.
    await user.click(nodeCard(canvasElement, "alpha")); // reset: collapse to alpha
    nodeCard(canvasElement, "scene").focus();
    await user.keyboard(" ");
    await waitFor(() => expect(isSelected(canvasElement, "scene")).toBe(true));
    expect(opened()).toBe("scene");
  },
};

const trimHandlesOf = (canvasElement: HTMLElement, id: string) =>
  canvasElement
    .querySelector(`[data-node-wrapper="${id}"]`)!
    .querySelectorAll("[data-trim-handle]").length;

export const SelectionGatedTrimHandles: Story = {
  render: () => (
    <DndCollections
      initialGraph={mediaGraph()}
      animateMoves={false}
      clickSelection="toggle"
      trimRequiresSelection
    >
      <BoardCards trimPixelsPerSecond={24} />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "alpha"));
    const user = userEvent.setup();

    // Unselected media cards have NO trim handles — their edges are plain
    // card body.
    expect(trimHandlesOf(canvasElement, "alpha")).toBe(0);
    expect(trimHandlesOf(canvasElement, "bravo")).toBe(0);

    // Selecting a card grows its handles (image: right edge only) — nobody
    // else's.
    await user.click(nodeCard(canvasElement, "alpha"));
    await waitFor(() => expect(trimHandlesOf(canvasElement, "alpha")).toBe(1));
    expect(trimHandlesOf(canvasElement, "bravo")).toBe(0);

    // Toggling the selection off removes them again.
    await user.click(nodeCard(canvasElement, "alpha"));
    await waitFor(() => expect(trimHandlesOf(canvasElement, "alpha")).toBe(0));
  },
};

export const ShiftClickSelectsARange: Story = {
  render: () => (
    <DndCollections initialGraph={wideGraph()} animateMoves={false} clickSelection="toggle">
      <BoardCards />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "alpha"));
    // ONE session: the static userEvent API resets keyboard state per call, so
    // a held modifier across several clicks needs a single setup().
    const user = userEvent.setup();
    const selected = () =>
      ["alpha", "bravo", "charlie", "delta", "echo"].filter((id) =>
        isSelected(canvasElement, id),
      );

    // Plain click sets the pivot.
    await user.click(nodeCard(canvasElement, "alpha"));
    await waitFor(() => expect(selected()).toEqual(["alpha"]));

    // Shift+click takes the inclusive run, in the order the parent renders
    // its children — which is the order on screen.
    await user.keyboard("{Shift>}");
    await user.click(nodeCard(canvasElement, "delta"));
    await user.keyboard("{/Shift}");
    await waitFor(() => expect(selected()).toEqual(["alpha", "bravo", "charlie", "delta"]));

    // THE reason the pivot is state: shift+click back and the range SHRINKS
    // rather than starting again from the overshoot. Anchoring the range to
    // "the last card clicked" would give ["charlie", "delta"] here, and there
    // would be no way to correct an overshoot at all.
    await user.keyboard("{Shift>}");
    await user.click(nodeCard(canvasElement, "bravo"));
    await user.keyboard("{/Shift}");
    await waitFor(() => expect(selected()).toEqual(["alpha", "bravo"]));

    // A range runs the same backwards.
    await user.click(nodeCard(canvasElement, "echo"));
    await user.keyboard("{Shift>}");
    await user.click(nodeCard(canvasElement, "charlie"));
    await user.keyboard("{/Shift}");
    await waitFor(() => expect(selected()).toEqual(["charlie", "delta", "echo"]));

    // A plain click re-pivots, so the next range measures from here.
    await user.click(nodeCard(canvasElement, "bravo"));
    await user.keyboard("{Shift>}");
    await user.click(nodeCard(canvasElement, "charlie"));
    await user.keyboard("{/Shift}");
    await waitFor(() => expect(selected()).toEqual(["bravo", "charlie"]));
  },
};

export const ArrowKeysCarryTheSelection: Story = {
  render: () => (
    <DndCollections initialGraph={wideGraph()} animateMoves={false} clickSelection="toggle">
      <VirtualStrip collectionId={parseNodeId("board")} itemWidth={120} itemHeight={90} />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "alpha"));
    const user = userEvent.setup();
    const selected = () =>
      ["alpha", "bravo", "charlie", "delta", "echo"].filter((id) =>
        isSelected(canvasElement, id),
      );

    await user.click(nodeCard(canvasElement, "alpha"));
    await waitFor(() => expect(selected()).toEqual(["alpha"]));

    // A bare arrow moves the selection with the focus. Without this the
    // keyboard route needed an arrow AND a Space at every stop, which is why
    // roving focus alone was never enough to act on anything.
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(selected()).toEqual(["bravo"]));
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(selected()).toEqual(["charlie"]));

    // Shift+arrow EXTENDS rather than replacing, from wherever the last bare
    // arrow left the pivot — charlie, not alpha. A bare arrow IS a plain
    // selection, so it re-pivots exactly as a plain click does; only the
    // shifted gestures leave the pivot alone.
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await waitFor(() => expect(selected()).toEqual(["charlie", "delta"]));
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await waitFor(() => expect(selected()).toEqual(["charlie", "delta", "echo"]));

    // And shrinks on the way back, for the same reason a shift+click does:
    // the pivot has not moved, so the run is re-measured rather than restarted.
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    await waitFor(() => expect(selected()).toEqual(["charlie", "delta"]));
  },
};
