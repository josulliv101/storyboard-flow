import { describe, expect, it } from "vitest";

import {
  ITEM_ACTION_SPECS,
  visibleItemActions,
  type ItemActionState,
} from "./graph-item-action-specs";

// PL14-007. One ordered list, two surfaces: the sidebar's contextual rail
// (which respects `group` and folds the rest behind "More") and a card's
// right-click menu (which ignores `group` and shows everything).
//
// These pin the SHAPES both surfaces depend on. The rail's and the menu's own
// rendering is covered by the graph-view e2e; what cannot be seen from either
// of those is that they are still reading the same list — which is the whole
// point of the list existing.

const state = (over: Partial<ItemActionState> = {}): ItemActionState => ({
  hasSelection: true,
  isSingleSelection: true,
  canPaste: false,
  busy: false,
  allDisabled: false,
  ...over,
});

const labels = (s: ItemActionState, group?: "primary" | "overflow") =>
  visibleItemActions(s, group).map((spec) => spec.label(s));

describe("item action specs", () => {
  it("gives the rail exactly the run it had: Edit, Copy, Cut, Delete", () => {
    expect(labels(state(), "primary")).toEqual(["Edit", "Copy", "Cut", "Delete"]);
    expect(labels(state(), "overflow")).toEqual(["Duplicate", "Disable"]);
  });

  it("gives the flat menu the same actions with the overflow inlined", () => {
    // Same relative order, both overflow actions in place, and Delete still
    // LAST — a destructive action at the end is harder to hit in passing, and
    // a menu has no "More" button to sit before.
    expect(labels(state())).toEqual([
      "Edit",
      "Copy",
      "Cut",
      "Duplicate",
      "Disable",
      "Delete",
    ]);
  });

  it("the two surfaces cover the same actions — no drift", () => {
    // The reason this list exists. A rail action with no menu entry (or the
    // reverse) is the failure it prevents.
    const menu = visibleItemActions(state()).map((s) => s.action);
    const rail = [
      ...visibleItemActions(state(), "primary"),
      ...visibleItemActions(state(), "overflow"),
    ].map((s) => s.action);
    expect([...menu].sort()).toEqual([...rail].sort());
  });

  it("Copy and Cut swap for Paste when the clipboard is armed", () => {
    expect(labels(state({ canPaste: true }))).toEqual([
      "Edit",
      "Paste",
      "Duplicate",
      "Disable",
      "Delete",
    ]);
  });

  it("Disable becomes Enable when the whole selection is already skipped", () => {
    const enabled = visibleItemActions(state()).find((s) => s.action === "toggle-disabled")!;
    const disabled = state({ allDisabled: true });
    expect(enabled.label(state())).toBe("Disable");
    expect(enabled.label(disabled)).toBe("Enable");
    // The icon follows the word — one concept, not two.
    expect(enabled.icon(state())).not.toBe(enabled.icon(disabled));
  });

  it("Edit is the only action that needs a SINGLE selection", () => {
    const multi = state({ isSingleSelection: false });
    const blocked = ITEM_ACTION_SPECS.filter((s) => s.disabled(multi) && !s.disabled(state()));
    expect(blocked.map((s) => s.action)).toEqual(["details"]);
  });

  it("everything that touches the selection disables without one", () => {
    const empty = state({ hasSelection: false, isSingleSelection: false });
    // Paste is the exception by design: it acts on the CLIPBOARD, so it is
    // available with nothing selected.
    const live = visibleItemActions(empty).filter((s) => !s.disabled(empty));
    expect(live.map((s) => s.action)).toEqual([]);
    const armed = state({ hasSelection: false, isSingleSelection: false, canPaste: true });
    expect(visibleItemActions(armed).filter((s) => !s.disabled(armed)).map((s) => s.action))
      .toEqual(["paste"]);
  });

  it("busy disables everything, so nothing double-fires", () => {
    const busy = state({ busy: true, canPaste: true });
    expect(visibleItemActions(busy).every((s) => s.disabled(busy))).toBe(true);
  });
});
