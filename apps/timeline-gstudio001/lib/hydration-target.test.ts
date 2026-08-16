import { describe, expect, it } from "vitest";

import { hydrationDocumentId, isFetchableTimelineId } from "./hydration-target";

// The real id from the network log, decoded. `dup:<parent>:<clip>` is a node in
// the graph and a document nowhere.
const DUP_NODE = "dup:timeline-msdyfi6tpueex2:timeline-msdw9kbuz52eel";
const REFERENCED = "timeline-msdw9kbuz52eel";

describe("isFetchableTimelineId", () => {
  it.each([
    ["an ordinary timeline", "timeline-msrisjr4yjpa1h"],
    ["a project", "project-1785765266842-92sagu"],
    ["a trash bin", "trash-LIdEO2P4EwWsn0ux1WmRAOvTDXu2"],
  ])("accepts %s", (_name, id) => {
    expect(isFetchableTimelineId(id)).toBe(true);
  });

  it.each([
    ["a duplicate node id (colons)", DUP_NODE],
    ["a media clip id (slashes)", "clip-timeline-gstudio001/uid/project/loc_van-1786244080409"],
    ["an empty string", ""],
    ["a url-ish id", "https://example.test/x"],
  ])("rejects %s", (_name, id) => {
    // Mirrors the route's own `^[a-zA-Z0-9_-]+$`. The point is to not SEND a
    // request the server will reject.
    expect(isFetchableTimelineId(id)).toBe(false);
  });
});

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

  it("returns null when the RECORDED reference is itself unfetchable", () => {
    // Stored data is not a promise. A reference that cannot be a document id
    // is still not worth a request.
    expect(hydrationDocumentId({ duplicateOfTimelineId: "dup:a:b" }, DUP_NODE)).toBeNull();
  });
});
