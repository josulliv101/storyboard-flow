import { describe, expect, it, vi } from "vitest";

import { parseNodeId, type CollectionItemNode } from "@storyboard/ui/dnd-collections";

import type { ClipboardEntry } from "./graph-clipboard";

// The singleton is module state; import the factory indirectly by re-importing
// a fresh module instance per test so tests can't leak into each other.
async function freshClipboard() {
  vi.resetModules();
  const { graphClipboard } = await import("./graph-clipboard");
  return graphClipboard;
}

const node: CollectionItemNode = {
  id: parseNodeId("m1"),
  kind: "media",
  mediaKind: "image",
  name: "Pic",
  src: "a.png",
  durationSeconds: 4,
};
const entry: ClipboardEntry = { node, detail: undefined, documents: {} };

describe("graphClipboard", () => {
  it("set / read / clear / isEmpty round-trip, with change notifications", async () => {
    const clipboard = await freshClipboard();
    const seen: boolean[] = [];
    const unsubscribe = clipboard.subscribe(() => seen.push(clipboard.isEmpty()));

    expect(clipboard.isEmpty()).toBe(true);
    expect(clipboard.set([entry])).toBe(true);
    expect(clipboard.read()).toEqual([entry]);
    expect(clipboard.isEmpty()).toBe(false);
    clipboard.clear();
    expect(clipboard.isEmpty()).toBe(true);
    // One notify per real change; clearing an empty clipboard notifies nobody.
    clipboard.clear();
    expect(seen).toEqual([false, true]);
    unsubscribe();
  });

  // The pending-cut half had no coverage at all, and Done now depends on it:
  // leaving select mode without pasting calls `clear()` to abandon the move,
  // and the un-dimming of the sources is exactly this set emptying.
  it("clear() abandons a pending cut, in the same notify as the contents", async () => {
    const clipboard = await freshClipboard();
    const seen: number[] = [];
    const unsubscribe = clipboard.subscribe(() => seen.push(clipboard.pendingCutIds().size));

    clipboard.set([entry]);
    clipboard.markPendingCut([parseNodeId("m1"), parseNodeId("m2")]);
    expect(clipboard.pendingCutIds().size).toBe(2);
    expect(clipboard.isPendingCut(parseNodeId("m1"))).toBe(true);
    expect(clipboard.isPendingCut(parseNodeId("nope"))).toBe(false);

    clipboard.clear();
    expect(clipboard.pendingCutIds().size).toBe(0);
    expect(clipboard.isEmpty()).toBe(true);
    // set → markPendingCut → clear. One notify each, and the clear reports
    // both halves gone at once rather than emptying them in two steps.
    expect(seen).toEqual([0, 2, 0]);
    unsubscribe();
  });

  it("a fresh copy replaces a pending cut, so nothing stays dimmed for it", async () => {
    const clipboard = await freshClipboard();
    clipboard.set([entry]);
    clipboard.markPendingCut([parseNodeId("m1")]);
    // `set` clears the pending move: the dimmed sources belonged to a cut this
    // copy just replaced, and a paste will no longer carry them.
    clipboard.set([entry]);
    expect(clipboard.pendingCutIds().size).toBe(0);
    expect(clipboard.isEmpty()).toBe(false);
  });

  it("binding a DIFFERENT user wipes the contents; same user keeps them", async () => {
    const clipboard = await freshClipboard();
    clipboard.bindUser("user-a");
    clipboard.set([entry]);

    clipboard.bindUser("user-a"); // re-bind, same uid — contents survive
    expect(clipboard.isEmpty()).toBe(false);

    clipboard.bindUser("user-b"); // another user — never their data to paste
    expect(clipboard.isEmpty()).toBe(true);
  });

  it("refuses a stale write from a capture that straddled a user switch", async () => {
    const clipboard = await freshClipboard();
    clipboard.bindUser("user-a");
    const atGeneration = clipboard.generation();

    // The async capture is mid-flight when another user signs in…
    clipboard.bindUser("user-b");

    // …so the capture's set must NOT land user A's data in B's session.
    expect(clipboard.set([entry], atGeneration)).toBe(false);
    expect(clipboard.isEmpty()).toBe(true);
  });
});
