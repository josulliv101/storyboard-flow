import {
  Ban,
  CircleCheck,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Pencil,
  Scissors,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import type { GraphItemAction } from "./graph-view-events";

// What an item's actions ARE, in one place (PL14-007).
//
// Two surfaces offer them now — the sidebar's contextual cluster and a card's
// right-click menu — and a second definition is how two menus drift into
// disagreeing about what an item can do. This module is the definition; both
// surfaces render it.
//
// Deliberately NOT a component. The two present the same actions very
// differently (the rail is a column of icon tiles with tooltips and an amber
// wash; the menu is a list of rows), so what they share is the DATA — which
// actions exist, in what order, with what labels and icons, and when each is
// available. Sharing markup would have forced one of them to look wrong.

/** Everything an action needs to decide whether it applies right now. */
export type ItemActionState = Readonly<{
  hasSelection: boolean;
  /** Exactly ONE item selected. The details view is the only action that
   *  cares — there is no honest way to render one clip's frames for six. */
  isSingleSelection: boolean;
  /** The clipboard is armed, which SWAPS Copy/Cut for Paste. */
  canPaste: boolean;
  /** An async action is in flight; everything disables so nothing double-fires. */
  busy: boolean;
  /** Every selected item is already skipped — flips Disable to Enable. */
  allDisabled: boolean;
}>;

/**
 * Where the RAIL puts an action. The rail is a narrow column, so it shows the
 * common few and folds the rest behind a "More" overflow; a flat menu has
 * nowhere to fold and shows everything.
 *
 * Modelled here rather than in the rail because it is the last thing the two
 * surfaces disagreed about — with it, both render the same ordered list and
 * differ only in whether they respect the grouping.
 */
export type ItemActionGroup = "primary" | "overflow";

export type ItemActionSpec = Readonly<{
  action: GraphItemAction;
  group: ItemActionGroup;
  /** Resolved against state, because two of them change wording: Disable
   *  becomes Enable, and the icon follows. */
  label: (state: ItemActionState) => string;
  description: (state: ItemActionState) => string;
  icon: (state: ItemActionState) => LucideIcon;
  /** Present at all. Copy/Cut and Paste are mutually exclusive — a menu row
   *  for an action that cannot exist in this state is worse than its absence. */
  visible: (state: ItemActionState) => boolean;
  /** Present but unavailable. Preferred over hiding wherever the action is
   *  always CONCEPTUALLY available: a control that vanishes teaches nothing,
   *  while a disabled one says "wrong shape of selection for that". */
  disabled: (state: ItemActionState) => boolean;
}>;

const always = () => true;

/**
 * The ordered list.
 *
 * Details first because it is the action that tells you WHAT you have selected
 * before you act on it — and because it lost its per-card trigger to get here
 * (PL13-009). Delete LAST, because a destructive action at the end of a menu
 * is harder to hit on the way to something else.
 *
 * ONE order serves both surfaces, which is what `group` buys. Walking it and
 * respecting the grouping gives the rail exactly what it had — Edit, Copy,
 * Cut (or Paste), Delete, then More(Duplicate, Disable). Walking it and
 * ignoring the grouping gives the menu exactly what it had — the same run with
 * both overflow actions inlined and Delete still last. Neither surface needed
 * its order bent to share the list.
 */
export const ITEM_ACTION_SPECS: readonly ItemActionSpec[] = [
  {
    action: "details",
    group: "primary",
    label: () => "Edit",
    description: () => "Open the selected item's details",
    icon: () => Pencil,
    visible: always,
    disabled: (s) => s.busy || !s.isSingleSelection,
  },
  {
    action: "copy",
    group: "primary",
    label: () => "Copy",
    description: () => "Copy the selected item",
    icon: () => Copy,
    visible: (s) => !s.canPaste,
    disabled: (s) => s.busy || !s.hasSelection,
  },
  {
    action: "cut",
    group: "primary",
    label: () => "Cut",
    description: () => "Cut the selected item — paste to move it",
    icon: () => Scissors,
    visible: (s) => !s.canPaste,
    disabled: (s) => s.busy || !s.hasSelection,
  },
  {
    action: "paste",
    group: "primary",
    label: () => "Paste",
    description: () => "Paste into this timeline",
    icon: () => ClipboardPaste,
    visible: (s) => s.canPaste,
    disabled: (s) => s.busy,
  },
  {
    action: "duplicate",
    group: "overflow",
    label: () => "Duplicate",
    description: () => "Duplicate the selected item",
    icon: () => CopyPlus,
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
  },
  {
    action: "toggle-disabled",
    group: "overflow",
    label: (s) => (s.allDisabled ? "Enable" : "Disable"),
    description: (s) =>
      s.allDisabled
        ? "Play the selected item again"
        : "Keep the slot, skip it on playback",
    icon: (s) => (s.allDisabled ? CircleCheck : Ban),
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
  },
  {
    action: "delete",
    group: "primary",
    label: () => "Delete",
    description: () => "Move the selected item to trash",
    icon: () => Trash2,
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
  },
];

/**
 * What a surface should actually render, in order.
 *
 * `group` omitted = everything, which is the flat menu. Pass one and you get
 * the rail's halves.
 */
export function visibleItemActions(
  state: ItemActionState,
  group?: ItemActionGroup,
): readonly ItemActionSpec[] {
  return ITEM_ACTION_SPECS.filter(
    (spec) => spec.visible(state) && (group === undefined || spec.group === group),
  );
}
