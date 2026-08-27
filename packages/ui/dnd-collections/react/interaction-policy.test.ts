import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { buildGraph, parseNodeId, type CollectionsGraph, type GraphNodeSpec } from "@storyboard/collections-core/graph";
import { createCollectionsStore } from "./collections-store";
import {
  cancelPendingSelection,
  handleSelectionSurfaceClick,
  SELECTION_DEFER_MS,
  type CollectionsInteractionPolicy,
} from "./interaction-policy";

// DEFERRED click-selection, for consumers where a double-click opens a node.
//
// The bug it exists for is a visual one and so has no natural assertion: on a
// double-click the card SELECTED and then unselected on its way into the
// drill-in. Nothing was wrong with the end state — the selection was cleared —
// but the user saw it happen. Undoing it at `dblclick` is too late by
// construction: the browser fires click(1) → click(2) → dblclick, so click 1
// has already selected and painted.
//
// What these pin is therefore about TIMING, not the final value: nothing is
// selected during the window, and a second click inside the window means
// nothing ever gets selected at all.

const media = (id: string): GraphNodeSpec => ({ kind: "media", id, name: id });

function graphFixture(): CollectionsGraph {
  const result = buildGraph([
    {
      kind: "collection",
      id: "root",
      name: "Root",
      children: [
        { kind: "collection", id: "folder", name: "Folder", children: [media("m1")] },
        media("clip"),
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function setup(policyOverrides: Partial<CollectionsInteractionPolicy> = {}) {
  const store = createCollectionsStore(graphFixture());
  const policy: CollectionsInteractionPolicy = {
    clickSelection: "replace",
    trimRequiresSelection: false,
    // Collections defer; media does not — a clip has no double-click meaning.
    deferSelection: (_id, node) => node.kind === "collection",
    ...policyOverrides,
  };
  const click = (id: string, detail = 1, modifiers: Partial<MouseEvent> = {}) => {
    const nodeId = parseNodeId(id);
    const node = store.getSnapshot().graph.nodesById.get(nodeId);
    if (!node) throw new Error(`no node ${id}`);
    handleSelectionSurfaceClick({
      event: { ctrlKey: false, metaKey: false, shiftKey: false, detail, ...modifiers },
      id: nodeId,
      node,
      store,
      policy,
    });
  };
  const selected = () => [...store.getSnapshot().interaction.selectedIds].map(String);
  return { store, click, selected };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cancelPendingSelection();
  vi.useRealTimers();
});

describe("deferred click-selection", () => {
  test("a deferred node is NOT selected while the window is open", () => {
    // The whole point: at no instant before the deadline is it selected, so a
    // double-click that lands inside the window never paints one.
    const { click, selected } = setup();

    click("folder");
    expect(selected()).toEqual([]);

    vi.advanceTimersByTime(SELECTION_DEFER_MS - 1);
    expect(selected()).toEqual([]);
  });

  test("it lands once the window closes, so a plain click still selects", () => {
    const { click, selected } = setup();

    click("folder");
    vi.advanceTimersByTime(SELECTION_DEFER_MS);
    expect(selected()).toEqual(["folder"]);
  });

  test("a second click inside the window cancels it — nothing is ever selected", () => {
    // The double-click case. click 2 is where a second click first becomes
    // KNOWN, so it is where the held selection is dropped.
    const { click, selected } = setup();

    click("folder", 1);
    click("folder", 2);
    vi.advanceTimersByTime(SELECTION_DEFER_MS * 4);

    expect(selected()).toEqual([]);
  });

  test("media selects IMMEDIATELY — deferring it would buy nothing", () => {
    const { click, selected } = setup();

    click("clip");
    expect(selected()).toEqual(["clip"]);
  });

  test("no policy means no delay at all — existing consumers are untouched", () => {
    const { click, selected } = setup({ deferSelection: undefined });

    click("folder");
    expect(selected()).toEqual(["folder"]);
  });

  test("Ctrl+click is immediate even on a deferred node", () => {
    // An explicit multi-select gesture has no double-click meaning, so making
    // the user wait for it would be pure cost.
    const { click, selected } = setup();

    click("folder", 1, { ctrlKey: true });
    expect(selected()).toEqual(["folder"]);
  });

  test("clicking a DIFFERENT node supersedes a pending one", () => {
    // Only one selection can be in flight; the newer click wins rather than
    // both landing.
    const { click, selected } = setup();

    click("folder");
    click("root");
    vi.advanceTimersByTime(SELECTION_DEFER_MS);

    expect(selected()).toEqual(["root"]);
  });

  test("cancelPendingSelection stops a landed-nowhere selection, and is idempotent", () => {
    // Exported for the consumer's own drill-in routes: a keyboard open or a
    // chevron click during the window must not be followed by a selection
    // appearing behind the new view.
    const { click, selected } = setup();

    click("folder");
    cancelPendingSelection();
    cancelPendingSelection();
    vi.advanceTimersByTime(SELECTION_DEFER_MS * 4);

    expect(selected()).toEqual([]);
  });
});
