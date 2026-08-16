import { describe, expect, it } from "vitest";

import { hydrationDocumentId } from "./hydration-target";

// The real id from the network log, decoded. `dup:<parent>:<clip>` is a node in
// the graph and a document nowhere.
const DUP_NODE = "dup:timeline-msdyfi6tpueex2:timeline-msdw9kbuz52eel";
const REFERENCED = "timeline-msdw9kbuz52eel";

describe("hydrationDocumentId", () => {
  it("loads a duplicate from the timeline it REFERENCES", () => {
    // The resolution already existed — `openTimeline` and three other call
    // sites read `duplicateOfTimelineId`. The hydration path skipped it, which
    // is the whole bug.
    expect(hydrationDocumentId({ duplicateOfTimelineId: REFERENCED }, DUP_NODE)).toBe(REFERENCED);
  });

  it("loads an ordinary collection from its own id", () => {
    // Node id and timeline id are the same string here, which is why the bug
    // stayed invisible until someone made a duplicate.
    expect(hydrationDocumentId({}, "timeline-msrisjr4yjpa1h")).toBe("timeline-msrisjr4yjpa1h");
    expect(hydrationDocumentId(undefined, "timeline-msrisjr4yjpa1h")).toBe(
      "timeline-msrisjr4yjpa1h",
    );
  });

  it("returns NULL for a duplicate with no reference recorded", () => {
    // Not a fallback to the node id. That fallback IS the bug: it produces
    // `GET /api/timelines/dup:...`, which 400s once per duplicate per pass and
    // reads as a broken app rather than an unresolvable reference.
    expect(hydrationDocumentId(undefined, DUP_NODE)).toBeNull();
    expect(hydrationDocumentId({}, DUP_NODE)).toBeNull();
  });

  it("returns null when the RECORDED reference is itself synthetic", () => {
    // Stored data is not a promise. A reference that names another node rather
    // than a document is still nothing to ask the server for.
    expect(hydrationDocumentId({ duplicateOfTimelineId: "dup:a:b" }, DUP_NODE)).toBeNull();
  });

  // AN ID IS NOT VALIDATED BY ITS CHARACTERS, and this is the regression that
  // taught it. The first version of this rule mirrored the route's
  // `^[a-zA-Z0-9_-]+$` — sound reasoning about the SERVER, wrong question
  // here. A NodeId may contain any non-whitespace character, so the mirror
  // also refused these: real collections, with real documents, which then
  // announced themselves as a missing reference and never hydrated. The e2e
  // suite has a test per shape; both failed, and neither is exotic.
  it.each([
    ["a slash", "scene/a"],
    ["a comma", "timeline-e2e,comma"],
    ["a space", "scene a"],
    ["a colon that is not the dup prefix", "scene:a"],
    ["unicode", "scène-á"],
  ])("hydrates an ordinary collection whose id contains %s", (_name, id) => {
    expect(hydrationDocumentId(undefined, id)).toBe(id);
  });

  it("follows a REFERENCE whose target contains exotic characters", () => {
    // Same rule on the other side of the resolution: the referenced document
    // is a document whatever it is called.
    expect(hydrationDocumentId({ duplicateOfTimelineId: "scene/a" }, DUP_NODE)).toBe("scene/a");
  });
});
