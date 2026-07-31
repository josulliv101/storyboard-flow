import { describe, expect, it } from "vitest";

import {
  ITEM_ACTION_SPECS,
  visibleItemActions,
  type ItemActionState,
} from "./graph-item-action-specs";

// PL14-007, reshaped for the floating selection toolbar. One ordered list,
// three surfaces: the toolbar's row (`primary`), its `⋮` (`overflow`), and a
// card's right-click menu (which ignores `group` and shows everything).
//
// These pin the SHAPES those surfaces depend on. Their rendering is covered by
// the graph-view e2e; what cannot be seen from there is that they are still
// reading the same list — which is the whole point of the list existing.

const state = (over: Partial<ItemActionState> = {}): ItemActionState => ({
  hasSelection: true,
  selectionCount: 1,
  isSingleSelection: true,
  canPaste: false,
  busy: false,
  allDisabled: false,
  allCollections: false,
  allMedia: true,
  singleName: "Car Chase",
  openable: false,
  ...over,
});

const multi = (over: Partial<ItemActionState> = {}): ItemActionState =>
  state({ selectionCount: 3, isSingleSelection: false, ...over });

const labels = (s: ItemActionState, group?: "primary" | "overflow") =>
  visibleItemActions(s, group).map((spec) => spec.label(s));

const actions = (s: ItemActionState, group?: "primary" | "overflow") =>
  visibleItemActions(s, group).map((spec) => spec.action);

describe("item action specs", () => {
  it("gives the pill its row: Open, Edit, Copy, Cut, Delete", () => {
    // Open LEADS, because it took the drill chevron's place — the anchor card
    // gives up its corner controls to host the pill, so the chevron's verb
    // lives here or stops existing on that card.
    expect(labels(state(), "primary")).toEqual(["Open", "Edit", "Copy", "Cut", "Delete"]);
    expect(labels(state(), "overflow")).toEqual(["Duplicate", "Rename", "Disable"]);
  });

  it("gives the flat menu the same actions with the overflow inlined", () => {
    expect(labels(state())).toEqual([
      "Open",
      "Edit",
      "Copy",
      "Cut",
      "Delete",
      "Duplicate",
      "Rename",
      "Disable",
    ]);
  });

  it("the surfaces cover the same actions — no drift", () => {
    // The reason this list exists. A toolbar action with no menu entry (or the
    // reverse) is the failure it prevents.
    const menu = actions(state());
    const toolbar = [...actions(state(), "primary"), ...actions(state(), "overflow")];
    expect([...menu].sort()).toEqual([...toolbar].sort());
  });

  it("keeps every primary action in place when the clipboard is armed", () => {
    // R5.1. Copy and Cut used to be REPLACED by Paste here, which moved Delete
    // one slot left the instant anything was copied. Paste now lives in the
    // header, and this row does not move.
    expect(labels(state(), "primary")).toEqual(labels(state({ canPaste: true }), "primary"));
  });

  it("never removes a primary action as the selection grows", () => {
    // The muscle-memory guarantee, stated as identity of the action list —
    // labels legitimately gain counts, positions must not move.
    expect(actions(state(), "primary")).toEqual(actions(multi(), "primary"));
    expect(actions(state({ hasSelection: false, selectionCount: 0 }), "primary")).toEqual(
      actions(multi(), "primary"),
    );
  });

  it("says the count out loud once a selection is plural", () => {
    expect(labels(multi(), "primary")).toEqual([
      "Open",
      "Edit",
      "Copy 3 items",
      "Cut 3 items",
      "Delete 3 items",
    ]);
  });

  it("Disable becomes Enable when the whole selection is already skipped", () => {
    const toggle = visibleItemActions(state()).find((s) => s.action === "toggle-disabled")!;
    const off = state({ allDisabled: true });
    expect(toggle.label(state())).toBe("Disable");
    expect(toggle.label(off)).toBe("Enable");
    // The icon follows the word — one concept, not two.
    expect(toggle.icon(state())).not.toBe(toggle.icon(off));
  });

  it("Open, Edit and Rename are the actions that need a SINGLE selection", () => {
    const openable = state({ openable: true });
    const blocked = ITEM_ACTION_SPECS.filter(
      (s) => s.disabled(multi({ openable: true })) && !s.disabled(openable),
    );
    expect(blocked.map((s) => s.action)).toEqual(["open", "details", "rename"]);
  });

  it("Open dims for a clip, and says why rather than pretending", () => {
    // Open is not "is a collection" — a media card that REFERENCES a timeline
    // opens too, which is the rule the card body already uses.
    const clip = state({ openable: false });
    const spec = ITEM_ACTION_SPECS.find((s) => s.action === "open")!;

    expect(spec.disabled(clip)).toBe(true);
    expect(spec.unavailableReason(clip)).toBe("Only timelines can be opened");
    expect(spec.disabled(state({ openable: true }))).toBe(false);
    expect(spec.unavailableReason(state({ openable: true }))).toBeNull();
  });

  it("states a reason for every action it dims on a multi-selection", () => {
    // R5.3/R12.9: a dimmed control that cannot say why is a dead end, and the
    // reason has to exist as DATA to reach a screen reader rather than only a
    // tooltip.
    for (const spec of visibleItemActions(multi())) {
      if (!spec.disabled(multi())) continue;
      expect(spec.unavailableReason(multi()), spec.action).not.toBeNull();
    }
  });

  it("does not explain a dimmed action when nothing is selected", () => {
    // The board already says so; a reason on every control would be six copies
    // of "select something first".
    const empty = state({ hasSelection: false, selectionCount: 0, isSingleSelection: false });
    for (const spec of visibleItemActions(empty)) {
      expect(spec.unavailableReason(empty), spec.action).toBeNull();
    }
  });

  it("everything disables without a selection", () => {
    const empty = state({ hasSelection: false, selectionCount: 0, isSingleSelection: false });
    expect(visibleItemActions(empty).filter((s) => !s.disabled(empty))).toEqual([]);
  });

  it("offers Paste into only for a single selected collection", () => {
    const collection = state({ allCollections: true, allMedia: false, canPaste: true });
    expect(actions(collection, "overflow")).toContain("paste-into");
    expect(labels(collection, "overflow")).toContain("Paste into “Car Chase”");

    // A clip has no inside to paste into, and neither does a multi-selection —
    // hidden rather than dimmed, because the label names a destination that
    // does not exist.
    expect(actions(state({ canPaste: true }), "overflow")).not.toContain("paste-into");
    expect(
      actions(multi({ allCollections: true, allMedia: false, canPaste: true }), "overflow"),
    ).not.toContain("paste-into");
  });

  it("dims Paste into with an empty clipboard rather than hiding it", () => {
    const collection = state({ allCollections: true, allMedia: false, canPaste: false });
    const spec = visibleItemActions(collection, "overflow").find((s) => s.action === "paste-into")!;
    expect(spec.disabled(collection)).toBe(true);
    expect(spec.unavailableReason(collection)).toBe("Nothing on the clipboard");
  });

  it("busy disables everything, so nothing double-fires", () => {
    const busy = state({ busy: true, canPaste: true, allCollections: true, allMedia: false });
    expect(visibleItemActions(busy).every((s) => s.disabled(busy))).toBe(true);
  });
});
