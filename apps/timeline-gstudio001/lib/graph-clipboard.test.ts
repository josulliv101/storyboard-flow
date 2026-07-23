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
