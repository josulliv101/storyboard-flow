import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { buildGraph, getChildren, parseNodeId, type NodeId } from "./core/graph";
import { DndCollections } from "./react/DndCollections";
import { useCollectionsSelector } from "./react/collections-store";
import { NodeCard } from "./react/node-views";
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
