import { describe, expect, it } from "vitest";

import type { TimelineDocument } from "@storyboard/timeline-model/types";

import { buildFocusedGraph, graphChildrenToClips } from "./adapter";

// A collection's `role` lives only on the DETAIL side-table, the same seam
// `tags` and `sourceAsset` use: the engine never reads it, so no graph command
// carries it and the write-back in `graphChildrenToClips` is the only thing
// keeping it alive.
//
// That makes this loop load-bearing AND invisible. Drop the write-back and
// there is no type error and nothing to notice — the marker simply disappears
// on the next ordinary save, the resolver silently falls back to matching the
// title again, and the bug it was added for (#464) is back with a field in the
// database that looks like it should be preventing it.

function collectionDoc(
  role: "renders" | undefined,
  extra: Partial<TimelineDocument> = {},
): TimelineDocument {
  return {
    id: "root",
    title: "Project",
    clips: [
      {
        id: "timeline-r",
        index: 0,
        kind: "collection",
        title: "Final cuts",
        childTimelineId: "timeline-r",
        ...(role === undefined ? {} : { role }),
        itemCount: 0,
        alt: "Final cuts collection",
        aspect: 16 / 9,
        trackIndex: 0,
        startTime: 0,
        duration: 3,
        sourceDuration: 3,
        trimIn: 0,
        trimOut: 0,
      },
    ],
    ...extra,
  };
}

function roundTrip(doc: TimelineDocument) {
  const built = buildFocusedGraph({ [doc.id]: doc }, doc.id, 1);
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error(built.error);
  return graphChildrenToClips(built.value.graph, built.value.details, doc.id);
}

describe("a collection's role survives the graph round-trip", () => {
  it("keeps the marker on a collection whose TITLE says nothing about it", () => {
    // The title is deliberately not "Renders": if the round-trip lost the role
    // and something later re-derived it from the name, this collection would
    // stop being findable at all rather than appear to still work.
    const out = roundTrip(collectionDoc("renders"));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("collection");
    expect(out[0]).toMatchObject({ title: "Final cuts", role: "renders" });
  });

  it("does not invent one for an ordinary collection", () => {
    // Absent is the normal case — every collection a person makes — so the
    // field must not appear merely because the clip went through the adapter.
    const out = roundTrip(collectionDoc(undefined));
    expect(out[0]).not.toHaveProperty("role");
  });

  it("survives a rename, which is the whole point of the marker", () => {
    const first = roundTrip(collectionDoc("renders"));
    const renamed: TimelineDocument = {
      id: "root",
      title: "Project",
      clips: [{ ...first[0], title: "Outputs 2026" }],
    };
    expect(roundTrip(renamed)[0]).toMatchObject({
      title: "Outputs 2026",
      role: "renders",
    });
  });
});
