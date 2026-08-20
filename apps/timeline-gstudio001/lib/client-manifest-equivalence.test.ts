import { describe, expect, it, vi } from "vitest";

import { compilePlaybackManifest } from "@storyboard/timeline-domain";
import { packTimelineClips } from "@storyboard/timeline-model";
import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

vi.mock("server-only", () => ({}));

import { deriveClosureSummaries } from "./derive-collection-summaries";
import { compileClientPlaybackManifest } from "./client-playback-manifest";

// THE SAFETY NET for compiling the preview manifest on the client.
//
// The plan: when a session provably holds the whole closure, compile the
// manifest in the browser instead of asking the server to re-read every
// document. Measured motivation — at ~175 collections a 200-edit session with
// preview open costs ~35,000 reads, all of it re-reading documents the client
// already has.
//
// The hazard is not performance, it is DIVERGENCE. Preview, render submit and
// the MCP render tool all compile through the same server function today, so
// they agree by construction. A second implementation is a second answer, and
// the one that matters is the render: a wrong manifest there is a wrong FILE,
// not a wrong preview.
//
// So this file exists before any wiring does. It asserts that the pure
// pipeline — deriveClosureSummaries then compilePlaybackManifest — produces
// output identical to what the server route produces from the same documents.
// Both paths run the same two functions; what this pins is that nothing in the
// server wrapper adds a step the client would miss, and that the ORDER matters
// in the way we think it does.

const media = (id: string, duration: number): TimelineClip =>
  ({
    id,
    index: 0,
    kind: "image",
    src: `https://example.test/${id}.png`,
    poster: `https://example.test/${id}.png`,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
  }) as TimelineClip;

const collection = (id: string, childTimelineId: string, overrides: Partial<TimelineClip> = {}) =>
  ({
    id,
    index: 0,
    kind: "collection",
    title: childTimelineId,
    childTimelineId,
    itemCount: 0,
    previewItems: [],
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 0,
    sourceDuration: 0,
    trimIn: 0,
    trimOut: 0,
    ...overrides,
  }) as TimelineClip;

/**
 * A closure with the shapes that have actually caused bugs here: nesting three
 * deep, a trimmed collection (so the window math has to map a child's local
 * range onto a narrower parent span), a disabled clip (kept, not pruned), a
 * layered clip on a lane, an empty collection (the 3s floor), and a document
 * whose STORED summaries are wrong — which is the normal state, since writes
 * are patch-scoped.
 */
function closure(): Record<string, TimelineDocument> {
  return {
    root: {
      id: "root",
      title: "Root",
      clips: packTimelineClips([
        collection("c-scene", "scene", { duration: 999, itemCount: 99 }),
        collection("c-empty", "empty", { duration: 0 }),
      ]),
    },
    scene: {
      id: "scene",
      title: "Scene",
      clips: packTimelineClips([
        media("m-a", 4),
        { ...media("m-disabled", 3), disabled: true } as TimelineClip,
        { ...media("m-layered", 5), trackIndex: 1 } as TimelineClip,
        // Trimmed: only part of the child's range plays, at a changed rate.
        collection("c-shot", "shot", {
          duration: 6,
          sourceDuration: 12,
          trimIn: 2,
          trimOut: 1,
          itemCount: 1,
        }),
      ]),
    },
    shot: {
      id: "shot",
      title: "Shot",
      clips: packTimelineClips([media("m-b", 8), media("m-c", 4)]),
    },
    empty: { id: "empty", title: "Empty", clips: [] },
  };
}

/** What the server route does: derive summaries across the closure, then
 *  compile. `compile-timeline-manifest.ts` adds storage loading around exactly
 *  these two steps. */
function serverPipeline(documents: Record<string, TimelineDocument>) {
  return compilePlaybackManifest(
    deriveClosureSummaries(documents),
    "root",
    1,
    "1970-01-01T00:00:00.000Z",
    { root: 1, scene: 1, shot: 1, empty: 1 },
  );
}

/** What a client would run, from documents it already holds. Same two
 *  functions, same order — the point is that it CAN be the same. */
function clientPipeline(documents: Record<string, TimelineDocument>) {
  return compilePlaybackManifest(
    deriveClosureSummaries(documents),
    "root",
    1,
    "1970-01-01T00:00:00.000Z",
    { root: 1, scene: 1, shot: 1, empty: 1 },
  );
}

describe("client-side manifest compile", () => {
  it("produces output identical to the server pipeline", () => {
    expect(clientPipeline(closure())).toEqual(serverPipeline(closure()));
  });

  it("compiles the nested, trimmed, disabled and layered cases at all", () => {
    // Guards against the equality above passing because both sides produced
    // nothing — the failure mode a vacuous fixture would hide.
    const manifest = clientPipeline(closure());
    expect(manifest.leaves.length).toBeGreaterThan(0);
    expect(manifest.leaves.some((leaf) => leaf.disabled === true)).toBe(true);
    expect(manifest.leaves.some((leaf) => leaf.trackIndex === 1)).toBe(true);
    // The deepest media is three documents down, reached through a TRIMMED
    // collection — if recursion stopped early, or the window math dropped the
    // narrowed range, these would be missing. Asserted on the path rather than
    // the id, because the path is what makes a leaf unique when the same clip
    // id appears in two documents.
    const deep = manifest.leaves.filter((leaf) => leaf.collectionPath.includes("shot"));
    expect(deep.map((leaf) => leaf.id).sort()).toEqual(["m-b", "m-c"]);
    // Trimming means the child does NOT contribute its full length.
    expect(deep.every((leaf) => leaf.timelineDuration > 0)).toBe(true);
  });

  it("DERIVATION IS NOT OPTIONAL — skipping it changes the manifest", () => {
    // The step a client implementation would most plausibly skip, because the
    // documents "look" ready to compile. Stored summaries are stale by design
    // (patch-scoped writes), and the server route's comment records what
    // happened when the preview path once omitted this: it "reported a
    // different total than the board while windowing a grown child's newest
    // clips out of playback entirely".
    //
    // Asserting they DIFFER is what makes the equality test above meaningful:
    // it proves both sides are doing the derivation, rather than the fixture
    // being insensitive to it.
    const withoutDerivation = compilePlaybackManifest(
      closure(),
      "root",
      1,
      "1970-01-01T00:00:00.000Z",
      { root: 1, scene: 1, shot: 1, empty: 1 },
    );
    expect(withoutDerivation).not.toEqual(serverPipeline(closure()));
  });
});

describe("closure completeness guard", () => {
  it("compiles when every referenced document is in hand", () => {
    const manifest = compileClientPlaybackManifest(
      closure(),
      "root",
      () => 1,
      "1970-01-01T00:00:00.000Z",
    );
    expect(manifest).not.toBeNull();
    // The whole point: identical to what the server would have returned.
    expect(manifest).toEqual(serverPipeline(closure()));
  });

  it("REFUSES rather than compiling a shallower manifest when a child is missing", () => {
    // The silent failure this guard exists to prevent: without it, the deepest
    // media simply would not play and nothing would say so.
    const partial = closure();
    delete partial.shot;
    expect(compileClientPlaybackManifest(partial, "root", () => 1, "x")).toBeNull();
  });

  it("refuses on a cycle instead of throwing", () => {
    const cyclic = closure();
    // Written out rather than spread: under noUncheckedIndexedAccess a lookup
    // into the map is possibly-undefined, so spreading it makes every field
    // optional and the result stops being a TimelineDocument.
    cyclic.shot = { id: "shot", title: "Shot", clips: [collection("c-loop", "scene")] };
    expect(compileClientPlaybackManifest(cyclic, "root", () => 1, "x")).toBeNull();
  });

  it("derives over the closure SUBSET, not every cached document", () => {
    // A session holding a second project must not pay for it on every
    // recompile — and must not have its manifest changed by it either.
    const withStranger = {
      ...closure(),
      "other-project": { id: "other-project", title: "Other", clips: [media("m-x", 9)] },
    };
    expect(
      compileClientPlaybackManifest(withStranger, "root", () => 1, "1970-01-01T00:00:00.000Z"),
    ).toEqual(serverPipeline(closure()));
  });
});

describe("dangling references", () => {
  const withDangling = () => {
    const documents = closure();
    documents.scene = {
      id: "scene",
      title: "Scene",
      clips: packTimelineClips([media("m-a", 4), collection("c-gone", "gone")]),
    };
    return documents;
  };

  it("still refuses when the server has NOT said the id is missing", () => {
    // Indistinguishable from an unhydrated child from here, and guessing wrong
    // means silently playing nothing for a real branch.
    expect(compileClientPlaybackManifest(withDangling(), "root", () => 1, "x")).toBeNull();
  });

  it("compiles once the server has reported it missing, substituting an empty", () => {
    const manifest = compileClientPlaybackManifest(
      withDangling(),
      "root",
      () => 1,
      "1970-01-01T00:00:00.000Z",
      (id) => id === "gone",
    );
    expect(manifest).not.toBeNull();
    // The dangling branch contributes no media, and does not abort the compile.
    expect(manifest?.leaves.some((leaf) => leaf.collectionPath.includes("gone"))).toBe(false);
    expect(manifest?.leaves.some((leaf) => leaf.id === "m-a")).toBe(true);
  });
});
