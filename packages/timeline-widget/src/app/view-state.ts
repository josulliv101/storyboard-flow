import type { Timeline } from "../types";

// The view's entire navigable state, and the ONE reducer that changes it.
//
// Both drivers go through here: the user clicking a card, and the model calling
// a registered view tool. That is the whole reason this is a pure reducer in
// its own file rather than a pile of useState setters — "open the Bank Heist
// collection" has to mean exactly the same thing and land in exactly the same
// place whichever side asks for it.
//
// Framework-free and side-effect-free so it can be unit tested without a host.

/** Which screen the view is on. `detail` drills into a collection's own
 *  timeline document, reached by its `childTimelineId`. */
export type ViewRoute =
  | { name: "strip" }
  | { name: "detail"; timelineId: string; title: string };

export type ViewState = {
  /** Project (root timeline document) currently open. */
  projectId: string | null;
  /** Navigation stack. The last entry is the current screen; everything before
   *  it is the trail back out, which is what makes "back" work at any depth. */
  stack: ViewRoute[];
  /** Clip the user (or the model) has focused, by clip id. */
  focusedClipId: string | null;
};

export type ViewAction =
  | { type: "set-project"; projectId: string }
  | { type: "open-collection"; timelineId: string; title: string }
  | { type: "focus-clip"; clipId: string | null }
  | { type: "back" }
  | { type: "reset-to-strip" };

export const initialViewState: ViewState = {
  projectId: null,
  stack: [{ name: "strip" }],
  focusedClipId: null,
};

export function currentRoute(state: ViewState): ViewRoute {
  return state.stack[state.stack.length - 1] ?? { name: "strip" };
}

/** The timeline document the current screen should load. */
export function currentTimelineId(state: ViewState): string | null {
  const route = currentRoute(state);
  return route.name === "detail" ? route.timelineId : state.projectId;
}

export function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case "set-project": {
      // Switching projects abandons any drill-in: the stack's timeline ids
      // belong to the project being left and mean nothing in the new one.
      if (action.projectId === state.projectId) return state;
      return {
        projectId: action.projectId,
        stack: [{ name: "strip" }],
        focusedClipId: null,
      };
    }
    case "open-collection": {
      const route = currentRoute(state);
      // Re-opening the screen you are already on is a no-op, not a new stack
      // entry — otherwise "back" has to be pressed twice for one drill-in.
      if (route.name === "detail" && route.timelineId === action.timelineId) return state;
      return {
        ...state,
        stack: [...state.stack, { name: "detail", timelineId: action.timelineId, title: action.title }],
        focusedClipId: null,
      };
    }
    case "focus-clip":
      if (action.clipId === state.focusedClipId) return state;
      return { ...state, focusedClipId: action.clipId };
    case "back": {
      if (state.stack.length <= 1) return state;
      return { ...state, stack: state.stack.slice(0, -1), focusedClipId: null };
    }
    case "reset-to-strip":
      if (state.stack.length === 1) return state;
      return { ...state, stack: [{ name: "strip" }], focusedClipId: null };
    default:
      return state;
  }
}

/**
 * A one-line description of where the view is, sent to the model as context.
 *
 * The model cannot see inside the iframe. Without this it has no idea the user
 * just drilled into a scene, and answers about the wrong thing.
 */
export function describeView(state: ViewState, timeline: Timeline | null): string {
  const route = currentRoute(state);
  const where =
    route.name === "detail"
      ? `viewing the "${route.title}" collection`
      : `viewing the "${timeline?.title ?? "timeline"}" timeline`;

  const clips = timeline?.clips ?? [];
  const focused = state.focusedClipId
    ? clips.find((clip) => clip.id === state.focusedClipId)
    : undefined;
  const focusNote = focused
    ? ` The user has selected "${focused.title ?? focused.alt ?? focused.kind ?? "a clip"}".`
    : "";

  return `The timeline view is ${where} (${clips.length} clip${
    clips.length === 1 ? "" : "s"
  }).${focusNote}`;
}
