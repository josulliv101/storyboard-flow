import { useCallback, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";

import { buildGraph, mediaDurationSeconds, parseNodeId } from "./core/graph";
import { DndCollections } from "./react/DndCollections";
import { useCollectionsSelector } from "./react/collections-store";
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

/** The card lives INSIDE the provider — a card rendered as a sibling never
 *  reaches this probe, and its trim looks inert for a reason that has nothing
 *  to do with the code under test. Parameterised so audio can use it too. */
/** The COMMITTED window, read back from the store. On a successful trim the
 *  preview deliberately stays "live" — clearing it would flash, since the
 *  committed node already carries the previewed values — so the preview state
 *  cannot tell a commit from an abort. This can. */
function CommittedEffective({ id }: { id: typeof VIDEO_ID }) {
  const seconds = useCollectionsSelector((s) => {
    const node = s.graph.nodesById.get(id);
    return node && node.kind === "media" ? mediaDurationSeconds(node) : null;
  });
  return <output data-testid="committed-effective">{seconds ?? ""}</output>;
}

function TrimPreviewProbe({ id = VIDEO_ID }: { id?: typeof VIDEO_ID } = {}) {
  const [previewState, setPreviewState] = useState<"idle" | "live" | "cleared">("idle");
  const [liveEffective, setLiveEffective] = useState<number | null>(null);
  const previewTrim = useCallback<TrimPreview["previewTrim"]>((_nodeId, live) => {
    setPreviewState(live ? "live" : "cleared");
    setLiveEffective(live ? live.effectiveSeconds : null);
  }, []);
  const preview = useMemo<TrimPreview>(() => ({ previewTrim }), [previewTrim]);

  return (
    <TrimPreviewContext.Provider value={preview}>
      <output data-testid="trim-preview-state">{previewState}</output>
      <output data-testid="trim-live-effective">{liveEffective ?? ""}</output>
      <CommittedEffective id={id} />
      <NodeCard id={id} trimPixelsPerSecond={TRIM_PIXELS_PER_SECOND} />
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

// The gesture belongs to the pointer that opened it: a non-primary pointer
// cannot start one, and a second pointer can neither steer nor end the
// gesture the primary owns. Initial video: full 10s, trimIn 2s, trimOut 1s,
// so effective = 7s; the left handle grows trimIn (shrinking effective).
export const EnforcesPointerOwnership: Story = {
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
    const liveEffective = () =>
      canvasElement.querySelector<HTMLOutputElement>('[data-testid="trim-live-effective"]')!;
    const leftHandle = () =>
      nodeCard(canvasElement, VIDEO_ID)
        .closest("[data-node-wrapper]")!
        .querySelector<HTMLElement>('[data-trim-handle="left"]')!;

    await waitForLayout(nodeCard(canvasElement, VIDEO_ID));
    const handleRect = leftHandle().getBoundingClientRect();
    const x = handleRect.left + handleRect.width / 2;
    const y = handleRect.top + handleRect.height / 2;

    // A non-primary pointer must not open a trim at all — no live preview.
    await dispatchPointerSequence([
      { element: leftHandle(), type: "pointerdown", clientX: x, clientY: y, pointerId: 5, isPrimary: false },
      { element: document, type: "pointermove", clientX: x + TRIM_PIXELS_PER_SECOND, clientY: y, pointerId: 5, isPrimary: false },
    ]);
    expect(previewState()).toHaveTextContent("idle");

    // The primary pointer owns the gesture: +1s of trim-in → effective 6s.
    await dispatchPointerSequence([
      { element: leftHandle(), type: "pointerdown", clientX: x, clientY: y },
      { element: document, type: "pointermove", clientX: x + TRIM_PIXELS_PER_SECOND, clientY: y },
    ]);
    await waitFor(() => expect(previewState()).toHaveTextContent("live"));
    expect(liveEffective()).toHaveTextContent("6");

    // A second pointer's move must not steer the owner's gesture (a huge
    // interloper delta would clamp effective to 0 if it were honored).
    await dispatchPointerSequence([
      { element: document, type: "pointermove", clientX: x + TRIM_PIXELS_PER_SECOND * 10, clientY: y, pointerId: 2 },
    ]);
    expect(liveEffective()).toHaveTextContent("6");

    // ...and its cancel must not end the gesture — the preview stays live.
    await dispatchPointerSequence([
      { element: document, type: "pointercancel", clientX: x, clientY: y, pointerId: 2 },
    ]);
    expect(previewState()).toHaveTextContent("live");

    // The owner still drives it: +2s of trim-in → effective 5s, then ends it.
    await dispatchPointerSequence([
      { element: document, type: "pointermove", clientX: x + TRIM_PIXELS_PER_SECOND * 2, clientY: y },
    ]);
    await waitFor(() => expect(liveEffective()).toHaveTextContent("5"));
    await dispatchPointerSequence([
      { element: document, type: "pointercancel", clientX: x, clientY: y },
    ]);
    await waitFor(() => expect(previewState()).toHaveTextContent("cleared"));
  },
};

// ── AUDIO ───────────────────────────────────────────────────────────────────
//
// Audio always windowed into a longer source and the reducer always accepted
// the update, but the affordance was deliberately unshipped: `resolveTrim`
// returned the node's CURRENT window so the drag was inert, and the left
// handle was never drawn. A card therefore showed a right handle that did
// nothing, and nothing tested any of it.

const AUDIO_ID = parseNodeId("bed");

function audioGraph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "strip",
      name: "Strip",
      children: [
        {
          kind: "media",
          mediaKind: "audio",
          id: AUDIO_ID,
          name: "Bed",
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

/** BOTH handles, where there used to be one — and the one there was did
 *  nothing. */
export const AudioHasBothTrimHandles: Story = {
  render: () => (
    <DndCollections initialGraph={audioGraph()} animateMoves={false}>
      <TrimPreviewProbe id={AUDIO_ID} />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, AUDIO_ID));
    const wrapper = nodeCard(canvasElement, AUDIO_ID).closest("[data-node-wrapper]")!;
    expect(wrapper.querySelector('[data-trim-handle="left"]')).not.toBeNull();
    expect(wrapper.querySelector('[data-trim-handle="right"]')).not.toBeNull();
  },
};

/** And dragging one COMMITS, rather than resolving to where it already was. */
export const DraggingAudioTrimsIt: Story = {
  render: () => (
    <DndCollections initialGraph={audioGraph()} animateMoves={false}>
      <div className="flex flex-col gap-3">
        <TrimPreviewProbe id={AUDIO_ID} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const previewState = () =>
      canvasElement.querySelector<HTMLOutputElement>('[data-testid="trim-preview-state"]')!;
    const leftHandle = () =>
      nodeCard(canvasElement, AUDIO_ID)
        .closest("[data-node-wrapper]")!
        .querySelector<HTMLElement>('[data-trim-handle="left"]')!;

    await waitForLayout(nodeCard(canvasElement, AUDIO_ID));
    const rect = leftHandle().getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // A full second inward, at 24px/s.
    await dispatchPointerSequence([
      { element: leftHandle(), type: "pointerdown", clientX: x, clientY: y },
      {
        element: document,
        type: "pointermove",
        clientX: x + TRIM_PIXELS_PER_SECOND,
        clientY: y,
      },
    ]);
    // The live preview reports the NEW window — 10 − 3 − 1 — which is the
    // proof the gesture is no longer inert.
    await waitFor(() => expect(previewState()).toHaveTextContent("live"));
    // The VALUE, not just the state: 10 − 3 − 1. A gesture that resolved to
    // the node's current window would report 7 and still say "live".
    expect(
      canvasElement.querySelector<HTMLOutputElement>('[data-testid="trim-live-effective"]'),
    ).toHaveTextContent("6");

    await dispatchPointerSequence([
      {
        element: document,
        type: "pointerup",
        clientX: x + TRIM_PIXELS_PER_SECOND,
        clientY: y,
      },
    ]);
    // THE COMMITTED WINDOW. Not the preview state — that stays "live" after a
    // successful commit on purpose. This is the assertion that would have
    // failed while the audio gesture resolved to the node's current window.
    await waitFor(() =>
      expect(
        canvasElement.querySelector<HTMLOutputElement>('[data-testid="committed-effective"]'),
      ).toHaveTextContent("6"),
    );
  },
};
