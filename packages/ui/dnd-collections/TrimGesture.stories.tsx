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

function TrimPreviewProbe() {
  const [previewState, setPreviewState] = useState<"idle" | "live" | "cleared">("idle");
  const previewTrim = useCallback<TrimPreview["previewTrim"]>((_nodeId, live) => {
    setPreviewState(live ? "live" : "cleared");
  }, []);
  const preview = useMemo<TrimPreview>(() => ({ previewTrim }), [previewTrim]);

  return (
    <TrimPreviewContext.Provider value={preview}>
      <output data-testid="trim-preview-state">{previewState}</output>
      <NodeCard id={VIDEO_ID} trimPixelsPerSecond={TRIM_PIXELS_PER_SECOND} />
    </TrimPreviewContext.Provider>
  );
}

const meta = {
  title: "UI/DndCollectionsTrimGesture",
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

export const NoOpReleaseClearsPreview: Story = {
  render: () => (
    <DndCollections initialGraph={graph()} animateMoves={false}>
      <div className="flex flex-col gap-3">
        <TrimPreviewProbe />
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

    // Move away, return exactly to the committed trim, then release. The
    // reducer rejects the update as same-position, but the preview session
    // must still finish.
    await dispatchPointerSequence([
      { element: leftHandle(), type: "pointerdown", clientX: x, clientY: y },
      {
        element: document,
        type: "pointermove",
        clientX: x + TRIM_PIXELS_PER_SECOND,
        clientY: y,
      },
      { element: document, type: "pointermove", clientX: x, clientY: y },
      { element: document, type: "pointerup", clientX: x, clientY: y },
    ]);

    await waitFor(() => expect(previewState()).toHaveTextContent("cleared"));

    // A following gesture starts and cancels as a fresh preview session.
    await dispatchPointerSequence([
      { element: leftHandle(), type: "pointerdown", clientX: x, clientY: y },
      {
        element: document,
        type: "pointermove",
        clientX: x - TRIM_PIXELS_PER_SECOND,
        clientY: y,
      },
    ]);
    await waitFor(() => expect(previewState()).toHaveTextContent("live"));

    await dispatchPointerSequence([
      { element: document, type: "pointercancel", clientX: x, clientY: y },
    ]);
    await waitFor(() => expect(previewState()).toHaveTextContent("cleared"));
  },
};
