import { describe, expect, it } from "vitest";

import { parseNodeId } from "@storyboard/collections-core";

import { describeDispatchRejection } from "./results";

// Every rejection an agent can provoke must come back as something it can act
// on. Six reasons used to fall through to the bare "The edit was refused",
// which is indistinguishable from a real failure — a reorder that was actually
// a no-op read as a broken tool and cost real diagnosis time.

const NODE = parseNodeId("clip-a");

describe("describeDispatchRejection", () => {
  it("explains a no-op instead of reporting a refusal", () => {
    const message = describeDispatchRejection({ reason: "same-position" });

    expect(message).toMatch(/nothing changed/i);
    expect(message).not.toBe("The edit was refused.");
  });

  it.each([
    ["invalid-index", /index/i],
    ["nothing-to-move", /movable/i],
    ["nothing-to-add", /add/i],
  ] as const)("explains %s", (reason, pattern) => {
    const message = describeDispatchRejection({ reason });

    expect(message).toMatch(pattern);
    expect(message).not.toBe("The edit was refused.");
  });

  it.each([
    ["not-media-node", /collection, not a clip/i],
    ["invalid-node-name", /blank name/i],
    ["invalid-media-update", /media kind|non-finite/i],
  ] as const)("explains %s and names the node", (reason, pattern) => {
    const message = describeDispatchRejection({ reason, nodeId: NODE });

    expect(message).toMatch(pattern);
    expect(message).toContain("clip-a");
  });

  it("still names the node for the reasons that already worked", () => {
    expect(describeDispatchRejection({ reason: "missing-node", nodeId: NODE })).toContain(
      "clip-a",
    );
  });
});
