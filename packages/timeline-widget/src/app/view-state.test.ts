import { describe, expect, it } from "vitest";

import {
  currentRoute,
  currentTimelineId,
  describeView,
  initialViewState,
  viewReducer,
} from "./view-state";
import type { ViewState } from "./view-state";

function open(state: ViewState, timelineId: string, title = timelineId): ViewState {
  return viewReducer(state, { type: "open-collection", timelineId, title });
}

const withProject: ViewState = viewReducer(initialViewState, {
  type: "set-project",
  projectId: "project-1",
});

describe("viewReducer", () => {
  it("starts on the strip with nothing focused", () => {
    expect(currentRoute(initialViewState).name).toBe("strip");
    expect(initialViewState.focusedClipId).toBeNull();
  });

  it("loads the project's own document while on the strip", () => {
    expect(currentTimelineId(withProject)).toBe("project-1");
  });

  it("drills into a collection and loads its child document", () => {
    const state = open(withProject, "timeline-heist", "Bank Heist");
    expect(currentRoute(state)).toEqual({
      name: "detail",
      timelineId: "timeline-heist",
      title: "Bank Heist",
    });
    expect(currentTimelineId(state)).toBe("timeline-heist");
  });

  it("nests drill-ins and unwinds them one at a time", () => {
    const state = open(open(withProject, "a"), "b");
    expect(state.stack).toHaveLength(3);

    const back = viewReducer(state, { type: "back" });
    expect(currentTimelineId(back)).toBe("a");

    const backAgain = viewReducer(back, { type: "back" });
    expect(currentRoute(backAgain).name).toBe("strip");
  });

  // Without this guard one drill-in pushes two entries and "back" appears broken.
  it("ignores re-opening the collection already on screen", () => {
    const state = open(withProject, "a");
    expect(open(state, "a")).toBe(state);
  });

  it("cannot go back past the strip", () => {
    expect(viewReducer(withProject, { type: "back" })).toBe(withProject);
  });

  // The stack holds timeline ids belonging to the project being left; carrying
  // them into a different project would load documents that aren't in it.
  it("abandons the drill-in stack when the project changes", () => {
    const deep = open(open(withProject, "a"), "b");
    const switched = viewReducer(deep, { type: "set-project", projectId: "project-2" });
    expect(switched.stack).toEqual([{ name: "strip" }]);
    expect(switched.focusedClipId).toBeNull();
    expect(currentTimelineId(switched)).toBe("project-2");
  });

  it("treats re-selecting the same project as a no-op", () => {
    expect(viewReducer(withProject, { type: "set-project", projectId: "project-1" })).toBe(
      withProject,
    );
  });

  it("focuses and clears a clip", () => {
    const focused = viewReducer(withProject, { type: "focus-clip", clipId: "clip-1" });
    expect(focused.focusedClipId).toBe("clip-1");
    expect(viewReducer(focused, { type: "focus-clip", clipId: null }).focusedClipId).toBeNull();
  });

  it("drops the focused clip when navigating", () => {
    const focused = viewReducer(withProject, { type: "focus-clip", clipId: "clip-1" });
    expect(open(focused, "a").focusedClipId).toBeNull();
  });

  it("resets to the strip from any depth", () => {
    const deep = open(open(withProject, "a"), "b");
    expect(viewReducer(deep, { type: "reset-to-strip" }).stack).toEqual([{ name: "strip" }]);
  });
});

describe("describeView", () => {
  const timeline = {
    id: "project-1",
    title: "Foobar",
    clips: [
      { id: "clip-1", kind: "collection", title: "Bank Heist", duration: 40 },
      { id: "clip-2", kind: "image", alt: "A still", duration: 3.5 },
    ],
  };

  it("names the timeline and its clip count", () => {
    expect(describeView(withProject, timeline)).toContain('"Foobar"');
    expect(describeView(withProject, timeline)).toContain("2 clips");
  });

  it("names the collection when drilled in", () => {
    const state = open(withProject, "timeline-heist", "Bank Heist");
    expect(describeView(state, timeline)).toContain('"Bank Heist" collection');
  });

  it("reports the selected clip so the model knows what the user means", () => {
    const state = viewReducer(withProject, { type: "focus-clip", clipId: "clip-2" });
    expect(describeView(state, timeline)).toContain('selected "A still"');
  });

  it("survives a timeline that has not loaded yet", () => {
    expect(describeView(initialViewState, null)).toContain("0 clips");
  });
});
