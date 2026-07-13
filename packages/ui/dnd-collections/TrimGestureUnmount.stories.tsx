import { useCallback, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";

import { buildGraph, parseNodeId } from "./core/graph";
import { DndCollections } from "./react/DndCollections";
import { NodeCard } from "./react/node-views";
import {
  TrimPreviewContext,
  type TrimPreview,
} from "./react/trim-preview-context";
import { dispatchPointerSequence, nodeCard, waitForLayout } from "./stories-helpers";

const VIDEO_ID = parseNodeId("video");
const TRIM_PIXELS_PER_SECOND = 24;

function graph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "strip",
      name: "Strip",
      children: [
        {
          kind: "media",
          mediaKind: "video",
          id: VIDEO_ID,
          name: "Video",
          fullDurationSeconds: 10,
          trimInSeconds: 2,
          trimOutSeconds: 1,
        },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function UnmountDuringTrimProbe() {
  const [cardMounted, setCardMounted] = useState(true);
  const [previewState, setPreviewState] = useState<"idle" | "live" | "cleared">("idle");
  const previewTrim = useCallback<TrimPreview["previewTrim"]>((_nodeId, live) => {
    setPreviewState(live ? "live" : "cleared");
  }, []);
  const preview = useMemo<TrimPreview>(() => ({ previewTrim }), [previewTrim]);

  return (
    <TrimPreviewContext.Provider value={preview}>
      <button type="button" onClick={() => setCardMounted(false)}>
        Unmount card
      </button>
      <output data-testid="trim-preview-state">{previewState}</output>
      {cardMounted && (
        <NodeCard id={VIDEO_ID} trimPixelsPerSecond={TRIM_PIXELS_PER_SECOND} />
      )}
    </TrimPreviewContext.Provider>
  );
}

const meta = {
  title: "UI/DndCollectionsTrimGestureUnmount",
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

export const UnmountClearsActiveGesture: Story = {
  render: () => (
    <DndCollections initialGraph={graph()} animateMoves={false}>
      <div className="flex flex-col gap-3">
        <UnmountDuringTrimProbe />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const previewState = () =>
      canvasElement.querySelector<HTMLOutputElement>('[data-testid="trim-preview-state"]')!;
    const leftHandle = () =>
      nodeCard(canvasElement, VIDEO_ID)
        .closest("[data-node-wrapper]")!
        .querySelector<HTMLElement>('[data-trim-handle="left"]')!;

    await waitForLayout(nodeCard(canvasElement, VIDEO_ID));
    const handleRect = leftHandle().getBoundingClientRect();
    const x = handleRect.left + handleRect.width / 2;
    const y = handleRect.top + handleRect.height / 2;

    await dispatchPointerSequence([
      { element: leftHandle(), type: "pointerdown", clientX: x, clientY: y },
      {
        element: document,
        type: "pointermove",
        clientX: x + TRIM_PIXELS_PER_SECOND,
        clientY: y,
      },
    ]);
    await waitFor(() => expect(previewState()).toHaveTextContent("live"));

    canvasElement.querySelector<HTMLButtonElement>("button")!.click();
    await waitFor(() => {
      expect(canvasElement.querySelector(`[data-node-id="${VIDEO_ID}"]`)).toBeNull();
      expect(previewState()).toHaveTextContent("cleared");
    });

    // The unmounted hook must no longer respond to the old pointer stream.
    await dispatchPointerSequence([
      {
        element: document,
        type: "pointermove",
        clientX: x + TRIM_PIXELS_PER_SECOND * 2,
        clientY: y,
      },
    ]);
    expect(previewState()).toHaveTextContent("cleared");
  },
};
