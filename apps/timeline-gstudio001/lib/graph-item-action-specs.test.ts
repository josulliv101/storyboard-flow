import { describe, expect, it } from "vitest";

import {
  ITEM_ACTION_SPECS,
  itemActionSections,
  itemActionSpec,
  visibleItemActions,
  type ItemActionState,
} from "./graph-item-action-specs";

// ONE ordered list, three surfaces: the anchor card's `⋮`, a card's right-click
// menu, and the header's `⋮`. All three render it identically now — v3 dropped
// the icon row that used to promote a few actions and fold the rest, so there
// is no `group` and no way for two surfaces to offer different things.
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
  ...over,
});

const multi = (over: Partial<ItemActionState> = {}): ItemActionState =>
  state({ selectionCount: 3, isSingleSelection: false, ...over });

const labels = (s: ItemActionState) => visibleItemActions(s).map((spec) => spec.label(s));
const actions = (s: ItemActionState) => visibleItemActions(s).map((spec) => spec.action);

describe("item action specs", () => {
  it("orders the menu by kind: identity, clipboard, state, destructive", () => {
    expect(labels(state())).toEqual([
      "Edit",
      "Rename",
      "Copy",
      "Cut",
      "Duplicate",
      "Disable",
      "Delete",
    ]);
  });

  it("groups those into runs the renderer draws separators between", () => {
    // Returned as runs rather than a flat list with markers, so a leading,
    // trailing or doubled separator is not expressible — "Paste into" comes and
    // goes on its own and is the last row of its run.
    expect(itemActionSections(state()).map((run) => run.map((s) => s.action))).toEqual([
      ["details", "rename"],
      ["copy", "cut", "duplicate"],
      ["toggle-disabled"],
      ["delete"],
    ]);
  });

  it("drops an emptied run rather than leaving a gap between separators", () => {
    // Only "Paste into" can vanish, and it shares its run — so the shape to
    // guard is that a run's disappearance never leaves an empty one behind.
    for (const run of itemActionSections(multi())) expect(run.length).toBeGreaterThan(0);
  });

  it("has no Open (R7.11)", () => {
    // Open used to LEAD this list, because the v2 pill took the anchor card's
    // chevron and had to give its verb back. v3 keeps the chevron on every
    // non-anchor card and opens with double-click or O, so a menu row for it
    // would be a second dimmed entry at the head of the list.
    expect(actions(state())).not.toContain("open");
  });

  it("has no container-scoped Paste — only Paste into", () => {
    // Every verb here acts ON the selection. Paste needs a destination, and a
    // selection is not one; it lives in the header permanently (R8.5).
    expect(actions(state({ canPaste: true }))).not.toContain("paste");
  });

  it("never removes or reorders an action as the selection grows", () => {
    // R7.5, the muscle-memory guarantee, stated as identity of the action list
    // — labels legitimately gain counts, positions must not move.
    expect(actions(state())).toEqual(actions(multi()));
    expect(actions(state({ hasSelection: false, selectionCount: 0 }))).toEqual(actions(multi()));
  });

  it("keeps every action in place when the clipboard is armed", () => {
    expect(labels(state())).toEqual(labels(state({ canPaste: true })));
  });

  it("says the count out loud once a selection is plural (R7.2)", () => {
    expect(labels(multi())).toEqual([
      // Edit and Rename act on exactly one item, so they stay bare and say
      // "one only" instead — "Edit 3 items" beside a reason explaining it
      // cannot edit 3 items is a label arguing with itself.
      "Edit",
      "Rename",
      "Copy 3 items",
      "Cut 3 items",
      "Duplicate 3 items",
      "Disable 3 items",
      "Delete 3 items",
    ]);
  });

  it("keeps labels bare at exactly one (R7.3)", () => {
    expect(labels(state())).not.toContain("Copy 1 item");
  });

  it("Disable becomes Enable when the whole selection is already skipped", () => {
    const toggle = visibleItemActions(state()).find((s) => s.action === "toggle-disabled")!;
    const off = state({ allDisabled: true });
    expect(toggle.label(state())).toBe("Disable");
    expect(toggle.label(off)).toBe("Enable");
    // The count rides the flipped verb too.
    expect(toggle.label(multi({ allDisabled: true }))).toBe("Enable 3 items");
    // The icon follows the word — one concept, not two.
    expect(toggle.icon(state())).not.toBe(toggle.icon(off));
  });

  it("Edit and Rename are the actions that need a SINGLE selection", () => {
    const blocked = ITEM_ACTION_SPECS.filter(
      (s) => s.disabled(multi()) && !s.disabled(state()),
    );
    expect(blocked.map((s) => s.action)).toEqual(["details", "rename"]);
  });

  it("states a reason for every action it dims on a multi-selection", () => {
    // R7.6/R12.5: a dimmed row that cannot say why is a dead end, and the
    // reason has to exist as DATA to reach a screen reader rather than only as
    // a tooltip.
    for (const spec of visibleItemActions(multi())) {
      if (!spec.disabled(multi())) continue;
      expect(spec.unavailableReason(multi()), spec.action).not.toBeNull();
    }
  });

  it("does not explain a dimmed action when nothing is selected", () => {
    // The board already says so; a reason on every row would be six copies of
    // "select something first".
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
    expect(actions(collection)).toContain("paste-into");
    expect(labels(collection)).toContain("Paste into “Car Chase”");

    // A clip has no inside to paste into, and neither does a multi-selection —
    // hidden rather than dimmed, because the label names a destination that
    // does not exist.
    expect(actions(state({ canPaste: true }))).not.toContain("paste-into");
    expect(
      actions(multi({ allCollections: true, allMedia: false, canPaste: true })),
    ).not.toContain("paste-into");
  });

  it("dims Paste into with an empty clipboard rather than hiding it", () => {
    const collection = state({ allCollections: true, allMedia: false, canPaste: false });
    const spec = visibleItemActions(collection).find((s) => s.action === "paste-into")!;
    expect(spec.disabled(collection)).toBe(true);
    expect(spec.unavailableReason(collection)).toBe("clipboard empty");
  });

  it("keeps Delete alone in the destructive run (R7.9)", () => {
    const runs = itemActionSections(multi());
    expect(runs[runs.length - 1]?.map((s) => s.action)).toEqual(["delete"]);
  });

  it("advertises the shortcuts that carry the real traffic (R7.8)", () => {
    const shortcuts = Object.fromEntries(
      ITEM_ACTION_SPECS.map((s) => [s.action, s.shortcut]),
    );
    expect(shortcuts.copy).toBe("Ctrl/⌘ C");
    expect(shortcuts.cut).toBe("Ctrl/⌘ X");
    expect(shortcuts.duplicate).toBe("Ctrl/⌘ D");
    expect(shortcuts.delete).toBe("Delete");
    expect(shortcuts.rename).toBe("F2");
    // "Paste into" is not Ctrl/V — that key pastes into the collection on
    // screen, which is a different destination. Advertising it here would
    // teach a shortcut that does something else.
    expect(shortcuts["paste-into"]).toBeNull();
  });

  it("resolves the verbs the header promotes out of the menu", () => {
    // The header renders Edit and Delete as inline icon buttons from these
    // specs (§15 phase two, additive). Naming them here is what turns a rename
    // or removal into a failing test rather than two silently empty buttons.
    expect(itemActionSpec("details").label(state())).toBe("Edit");
    expect(itemActionSpec("delete").label(multi())).toBe("Delete 3 items");
    // ...and the promoted button dims on exactly the same rule as its menu row,
    // which is the whole reason it reads from this list.
    expect(itemActionSpec("details").disabled(multi())).toBe(true);
    expect(itemActionSpec("details").unavailableReason(multi())).toBe("one only");
    expect(itemActionSpec("delete").disabled(multi())).toBe(false);
  });

  it("throws for an action that does not exist", () => {
    // Promoted buttons name their action as a literal, so a miss means the
    // action was renamed and the button would render nothing at all.
    expect(() => itemActionSpec("open" as never)).toThrow();
  });

  it("busy disables everything, so nothing double-fires", () => {
    const busy = state({ busy: true, canPaste: true, allCollections: true, allMedia: false });
    expect(visibleItemActions(busy).every((s) => s.disabled(busy))).toBe(true);
  });
});
