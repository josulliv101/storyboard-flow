import { describe, expect, it } from "vitest";

import {
  applyPatch,
  buildGraph,
  getChildren,
  parseNodeId,
  verifyPatchApplies,
  type CollectionsGraph,
  type GraphNodeSpec,
} from "@storyboard/collections-core";

import { buildRemovalPatch, diffRemoteChildren } from "./graph-remote-diff";

// Convergence on remote REMOVALS. Additions were already handled; leaving
// removals out is what let a project silently revert — an agent removed
// collections over MCP, the open tab kept them in its live graph, and
// re-asserted them on its next write against a fresh revision.

function media(id: string): GraphNodeSpec {
  return { kind: "media", id, name: id };
}

function graph(childIds: string[]): CollectionsGraph {
  const built = buildGraph([
    { kind: "collection", id: "root", name: "root", children: childIds.map(media) },
  ]);
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  return built.value;
}

const ROOT = parseNodeId("root");

describe("diffRemoteChildren", () => {
  it("reports a child that departed remotely", () => {
    const diff = diffRemoteChildren(graph(["a", "b", "c"]), graph(["a", "c"]), ROOT);

    expect(diff.departed.map(String)).toEqual(["b"]);
    expect(diff.added).toEqual([]);
  });

  it("still reports additions", () => {
    const diff = diffRemoteChildren(graph(["a"]), graph(["a", "b"]), ROOT);

    expect(diff.added.map(String)).toEqual(["b"]);
    expect(diff.departed).toEqual([]);
  });

  it("reports both when a child is swapped", () => {
    const diff = diffRemoteChildren(graph(["a", "b"]), graph(["a", "c"]), ROOT);

    expect(diff.added.map(String)).toEqual(["c"]);
    expect(diff.departed.map(String)).toEqual(["b"]);
  });

  it("reports nothing when a child merely moved position", () => {
    // Reordering is NOT convergence's job — applying it would fight a local
    // drag. Membership is what matters.
    const diff = diffRemoteChildren(graph(["a", "b", "c"]), graph(["c", "b", "a"]), ROOT);

    expect(diff.added).toEqual([]);
    expect(diff.departed).toEqual([]);
  });
});

describe("buildRemovalPatch", () => {
  it("produces a patch that verifies and removes the node", () => {
    const live = graph(["a", "b", "c"]);
    const patch = buildRemovalPatch(live, ROOT, [parseNodeId("b")]);
    if (!patch) throw new Error("expected a patch");

    expect(verifyPatchApplies(live, patch).ok).toBe(true);
    const next = applyPatch(live, patch);
    expect(getChildren(next, ROOT).map(String)).toEqual(["a", "c"]);
  });

  it("indexes against the graph passed in, not the pre-addition one", () => {
    // The bridge applies additions first, which shifts indices. A patch built
    // from the stale graph would remove the wrong child.
    const afterAdditions = graph(["new", "a", "b"]);
    const patch = buildRemovalPatch(afterAdditions, ROOT, [parseNodeId("b")]);
    if (!patch) throw new Error("expected a patch");

    expect(verifyPatchApplies(afterAdditions, patch).ok).toBe(true);
    expect(getChildren(applyPatch(afterAdditions, patch), ROOT).map(String)).toEqual([
      "new",
      "a",
    ]);
  });

  it("removes several departed children at once", () => {
    const live = graph(["a", "b", "c", "d"]);
    const patch = buildRemovalPatch(live, ROOT, [parseNodeId("b"), parseNodeId("d")]);
    if (!patch) throw new Error("expected a patch");

    expect(verifyPatchApplies(live, patch).ok).toBe(true);
    expect(getChildren(applyPatch(live, patch), ROOT).map(String)).toEqual(["a", "c"]);
  });

  it("returns null for an id that is not in the graph", () => {
    // Skips the verify/apply round trip rather than emitting an empty patch.
    expect(buildRemovalPatch(graph(["a"]), ROOT, [parseNodeId("ghost")])).toBeNull();
  });

  it("returns null when nothing departed", () => {
    expect(buildRemovalPatch(graph(["a"]), ROOT, [])).toBeNull();
  });
});
