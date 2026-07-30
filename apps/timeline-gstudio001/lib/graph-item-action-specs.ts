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

export type ItemActionSpec = Readonly<{
  action: GraphItemAction;
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
 * Not identical to the rail's visual order, and it cannot be: the rail hides
 * Duplicate and Disable behind a "More" overflow, which is an affordance
 * rather than an action, so its Delete sits before that button. A flat menu
 * has no overflow to hide behind and inlines both. Same actions, same relative
 * grouping; the one difference is where Delete falls, and last is the safer
 * answer for the surface that has no overflow.
 *
 * NOTE: the rail does not render from this list yet — it still has its own
 * JSX. Folding it in means teaching this list about the primary/overflow split
 * and is its own change; until then "one definition" is true of the menu and
 * aspirational of the pair.
 */
export const ITEM_ACTION_SPECS: readonly ItemActionSpec[] = [
  {
    action: "details",
    label: () => "Edit",
    description: () => "Open the selected item's details",
    icon: () => Pencil,
    visible: always,
    disabled: (s) => s.busy || !s.isSingleSelection,
  },
  {
    action: "copy",
    label: () => "Copy",
    description: () => "Copy the selected item",
    icon: () => Copy,
    visible: (s) => !s.canPaste,
    disabled: (s) => s.busy || !s.hasSelection,
  },
  {
    action: "cut",
    label: () => "Cut",
    description: () => "Cut the selected item — paste to move it",
    icon: () => Scissors,
    visible: (s) => !s.canPaste,
    disabled: (s) => s.busy || !s.hasSelection,
  },
  {
    action: "paste",
    label: () => "Paste",
    description: () => "Paste into this timeline",
    icon: () => ClipboardPaste,
    visible: (s) => s.canPaste,
    disabled: (s) => s.busy,
  },
  {
    action: "duplicate",
    label: () => "Duplicate",
    description: () => "Duplicate the selected item",
    icon: () => CopyPlus,
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
  },
  {
    action: "toggle-disabled",
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
    label: () => "Delete",
    description: () => "Move the selected item to trash",
    icon: () => Trash2,
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
  },
];

/** What a surface should actually render, in order. */
export function visibleItemActions(state: ItemActionState): readonly ItemActionSpec[] {
  return ITEM_ACTION_SPECS.filter((spec) => spec.visible(state));
}
