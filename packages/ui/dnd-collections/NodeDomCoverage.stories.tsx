import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";

import { parseNodeId } from "@storyboard/collections-core/graph";
import { findNodeElement, focusNodeWhenMounted } from "./react/node-dom";

function FocusLifecycleHarness() {
  return (
    <div>
      <button type="button" data-focus-sentinel="true">
        Focus sentinel
      </button>
      <div data-focus-root="true">
        <button type="button" data-node-id="immediate">
          Immediate node
        </button>
        <button type="button" data-node-id="fallback">
          Fallback node
        </button>
        <button type="button" data-node-id="legacy:node">
          Legacy selector node
        </button>
      </div>
    </div>
  );
}

const meta = {
  title: "UI/DndCollections/NodeDomCoverage",
  render: () => <FocusLifecycleHarness />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const FocusLifecycleBranches: Story = {
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>('[data-focus-root="true"]')!;
    const sentinel = canvasElement.querySelector<HTMLElement>('[data-focus-sentinel="true"]')!;
    const immediate = findNodeElement(root, parseNodeId("immediate"))!;
    const fallback = findNodeElement(root, parseNodeId("fallback"))!;

    // Existing cards focus on the first animation frame and clear all observers/timers.
    const cancelImmediate = focusNodeWhenMounted(root, parseNodeId("immediate"), {
      timeoutMs: 100,
    });
    await waitFor(() => expect(document.activeElement).toBe(immediate));
    cancelImmediate();

    // A virtualized card can mount later; MutationObserver focuses it as soon as it appears.
    const cancelDelayed = focusNodeWhenMounted(root, parseNodeId("delayed"), {
      timeoutMs: 100,
    });
    const delayed = document.createElement("button");
    delayed.type = "button";
    delayed.dataset.nodeId = "delayed";
    delayed.textContent = "Delayed node";
    root.append(delayed);
    await waitFor(() => expect(document.activeElement).toBe(delayed));
    cancelDelayed();

    // If the requested card never mounts, timeout moves focus to the supplied fallback.
    focusNodeWhenMounted(root, parseNodeId("missing"), {
      fallbackId: parseNodeId("fallback"),
      timeoutMs: 20,
    });
    await waitFor(() => expect(document.activeElement).toBe(fallback));

    // With no fallback, timeout performs cleanup without moving focus.
    sentinel.focus();
    focusNodeWhenMounted(root, parseNodeId("still-missing"), { timeoutMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(document.activeElement).toBe(sentinel);

    // Cancellation prevents a later mount from stealing focus and exercises the default timeout.
    const cancelPending = focusNodeWhenMounted(root, parseNodeId("cancelled"));
    cancelPending();
    cancelPending();
    const cancelled = document.createElement("button");
    cancelled.type = "button";
    cancelled.dataset.nodeId = "cancelled";
    cancelled.textContent = "Cancelled node";
    root.append(cancelled);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(document.activeElement).toBe(sentinel);

    // Older DOM hosts without CSS.escape use the dataset scan fallback.
    const originalEscape = CSS.escape;
    Object.defineProperty(CSS, "escape", { configurable: true, value: undefined });
    try {
      expect(findNodeElement(root, parseNodeId("legacy:node"))?.textContent).toBe(
        "Legacy selector node"
      );
      expect(findNodeElement(root, parseNodeId("absent"))).toBeNull();
    } finally {
      Object.defineProperty(CSS, "escape", { configurable: true, value: originalEscape });
    }
  },
};
