import { describe, expect, it } from "vitest";

import { describeChange } from "./graph-item-details-change-note";

// A media node just complete enough for the describer, which reads four
// fields and ignores the rest.
const clip = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: "clip-a",
    kind: "media",
    mediaKind: "video",
    name: "van pan",
    src: "x.mp4",
    fullDurationSeconds: 6.465,
    trimInSeconds: 0,
    trimOutSeconds: 1.298,
    ...over,
  }) as never;

const updated = (before: unknown, after: unknown) =>
  ({
    type: "nodes-updated",
    updates: [{ nodeId: "clip-a", before, after }],
  }) as never;

describe("describeChange", () => {
  it("names the out point in the terms the user set it in", () => {
    // trimOut 1.423 -> 1.298 on a 6.465s source is out 5.042 -> 5.167.
    const note = describeChange({
      command: { type: "update-media", nodeId: "clip-a" },
      patch: updated(clip({ trimOutSeconds: 1.423 }), clip({ trimOutSeconds: 1.298 })),
      direction: "undo",
      label: "clip 6",
      name: null,
    });
    expect(note).toEqual({
      action: "Undid trim",
      subject: "clip 6",
      detail: "out 5.042 → 5.167",
    });
  });

  it("names the in point when that is the edge that moved", () => {
    const note = describeChange({
      command: { type: "update-media", nodeId: "clip-a" },
      patch: updated(clip({ trimInSeconds: 1.708 }), clip({ trimInSeconds: 0.5 })),
      direction: "redo",
      label: "clip 2",
      name: null,
    });
    expect(note?.action).toBe("Redid trim");
    expect(note?.detail).toBe("in 1.708 → 0.500");
  });

  it("quotes a rename", () => {
    const note = describeChange({
      command: { type: "rename-node", nodeId: "clip-a" },
      patch: updated(clip({ name: "old" }), clip({ name: "new" })),
      direction: "undo",
      label: "clip 3",
      name: null,
    });
    expect(note?.detail).toBe('"old" → "new"');
  });

  it("reads a skip off the node it landed on, not off the command", () => {
    const note = describeChange({
      command: { type: "set-node-disabled", nodeIds: ["clip-a"] },
      patch: updated(clip({ disabled: false }), clip({ disabled: true })),
      direction: "undo",
      label: "clip 4",
      name: null,
    });
    expect(note).toEqual({
      action: "Undid skip",
      subject: "clip 4",
      detail: "now skipped at play",
    });
  });

  it("falls back to the node name when the row cannot place the clip", () => {
    const note = describeChange({
      command: { type: "update-media", nodeId: "clip-a" },
      patch: updated(clip(), clip({ trimInSeconds: 1 })),
      direction: "undo",
      label: null,
      name: "van pan",
    });
    expect(note?.subject).toBe("van pan");
  });

  it("says nothing about a command this view cannot make", () => {
    expect(
      describeChange({
        command: { type: "move-nodes", nodeIds: ["clip-a", "clip-b"] },
        patch: updated(clip(), clip()),
        direction: "undo",
        label: "clip 6",
        name: null,
      }),
    ).toBeNull();
  });

  it("still names the edit when the patch carries no values to show", () => {
    // A structural patch alongside a media command should not suppress the
    // notice: the press DID something, and reporting nothing at all is the
    // failure this feature exists to fix.
    const note = describeChange({
      command: { type: "update-media", nodeId: "clip-a" },
      patch: { type: "nodes-moved", moves: [] } as never,
      direction: "undo",
      label: "clip 6",
      name: null,
    });
    expect(note).toEqual({ action: "Undid trim", subject: "clip 6", detail: "" });
  });
});
