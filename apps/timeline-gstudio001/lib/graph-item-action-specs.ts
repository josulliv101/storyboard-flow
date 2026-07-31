import {
  Ban,
  ChevronRight,
  CircleCheck,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Pencil,
  Scissors,
  TextCursorInput,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import type { GraphItemAction } from "./graph-view-events";

// What an item's actions ARE, in one place (PL14-007).
//
// Three surfaces offer them now — the floating selection toolbar, its overflow
// menu, and a card's right-click menu — and a second definition is how two
// menus drift into disagreeing about what an item can do. This module is the
// definition; every surface renders it.
//
// Deliberately NOT a component. The surfaces present the same actions very
// differently (the toolbar is a row of icon tiles; the menu is a list of rows),
// so what they share is the DATA — which actions exist, in what order, with
// what labels and icons, and when each is available. Sharing markup would have
// forced one of them to look wrong.

/** Everything an action needs to decide whether it applies right now. */
export type ItemActionState = Readonly<{
  hasSelection: boolean;
  /** How many items are selected. Labels say it out loud where scope would
   *  otherwise be ambiguous — "Duplicate" reads as "this card". */
  selectionCount: number;
  /** Exactly ONE item selected. The details view is the only action that
   *  cares — there is no honest way to render one clip's frames for six. */
  isSingleSelection: boolean;
  /** The clipboard is armed. No longer swaps anything out: paste lives in the
   *  header now (it needs a DESTINATION, and a selection is not one), and the
   *  only entry here is the collection-scoped "Paste into". */
  canPaste: boolean;
  /** An async action is in flight; everything disables so nothing double-fires. */
  busy: boolean;
  /** Every selected item is already skipped — flips Disable to Enable. */
  allDisabled: boolean;
  /** Every selected item is a collection. Both of these are false for a MIXED
   *  selection, which is what dims the type-specific actions (E10). */
  allCollections: boolean;
  allMedia: boolean;
  /** The single selected item's name, for "Paste into 'Scene A'". Null unless
   *  exactly one is selected. */
  singleName: string | null;
  /** Whether the selection can be drilled into. Not the same as "is a
   *  collection": a media card that REFERENCES a timeline (a duplicate) opens
   *  too, which is the rule `openOnClick` already uses for the card body. */
  openable: boolean;
}>;

/**
 * Where the TOOLBAR puts an action. The toolbar is a short row, so it shows the
 * common few and folds the rest behind `⋮`; the right-click menu is flat and
 * shows everything.
 *
 * Modelled here rather than in the surfaces because it is the last thing they
 * disagreed about — with it, all of them render the same ordered list and
 * differ only in whether they respect the grouping.
 */
export type ItemActionGroup = "primary" | "overflow";

export type ItemActionSpec = Readonly<{
  action: GraphItemAction;
  group: ItemActionGroup;
  /** Resolved against state, because several change wording: Disable becomes
   *  Enable, and counts appear once a selection is plural. */
  label: (state: ItemActionState) => string;
  description: (state: ItemActionState) => string;
  icon: (state: ItemActionState) => LucideIcon;
  /** Present at all. Reserved for actions that are not merely unavailable but
   *  MEANINGLESS in this state — "Paste into" with no collection selected
   *  names a destination that does not exist. Everything else stays and dims;
   *  a control that comes and goes shifts the ones after it, and selection
   *  count changes constantly during a multi-select. */
  visible: (state: ItemActionState) => boolean;
  /** Present but unavailable. Preferred over hiding wherever the action is
   *  always CONCEPTUALLY available: a control that vanishes teaches nothing,
   *  while a dimmed one says "wrong shape of selection for that". */
  disabled: (state: ItemActionState) => boolean;
  /** WHY it is dimmed, in the user's terms. Rendered as a tooltip and as the
   *  control's accessible description — never tooltip-only, because a tooltip
   *  is unreachable by touch and by screen reader alike. Null when the action
   *  is available, or when the reason is simply "nothing is selected" and the
   *  empty board already says so. */
  unavailableReason: (state: ItemActionState) => string | null;
}>;

const always = () => true;
const noReason = () => null;

/** "item" / "3 items" — the phrase every count-bearing label ends with. */
export function itemCountPhrase(count: number): string {
  return count === 1 ? "item" : `${count} items`;
}

/**
 * The ordered list.
 *
 * Details first because it is the action that tells you WHAT you have selected
 * before you act on it — and because it lost its per-card trigger to get here
 * (PL13-009). Delete LAST of the primaries, because a destructive action at the
 * end is harder to hit on the way to something else; the toolbar additionally
 * fences it off with a separator.
 *
 * ONE order serves every surface, which is what `group` buys. Walking it and
 * respecting the grouping gives the toolbar its row and its overflow; walking
 * it and ignoring the grouping gives the right-click menu the same run with the
 * overflow actions inlined and Delete still last.
 */
export const ITEM_ACTION_SPECS: readonly ItemActionSpec[] = [
  {
    // Leads the row because it took the drill chevron's place: the anchor card
    // gives up its corner controls to host the pill, so the chevron's verb has
    // to live here or stop existing on that card.
    action: "open",
    group: "primary",
    label: () => "Open",
    description: () => "Open the selected timeline",
    icon: () => ChevronRight,
    visible: always,
    disabled: (s) => s.busy || !s.isSingleSelection || !s.openable,
    unavailableReason: (s) => {
      if (!s.hasSelection) return null;
      if (!s.isSingleSelection) return "Open one item at a time";
      return s.openable ? null : "Only timelines can be opened";
    },
  },
  {
    action: "details",
    group: "primary",
    label: () => "Edit",
    description: () => "Open the selected item's details",
    icon: () => Pencil,
    visible: always,
    disabled: (s) => s.busy || !s.isSingleSelection,
    unavailableReason: (s) =>
      s.hasSelection && !s.isSingleSelection ? "Edit one item at a time" : null,
  },
  {
    action: "copy",
    group: "primary",
    label: (s) => (s.selectionCount > 1 ? `Copy ${itemCountPhrase(s.selectionCount)}` : "Copy"),
    description: () => "Copy the selection",
    icon: () => Copy,
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
    unavailableReason: noReason,
  },
  {
    action: "cut",
    group: "primary",
    label: (s) => (s.selectionCount > 1 ? `Cut ${itemCountPhrase(s.selectionCount)}` : "Cut"),
    description: () => "Cut the selection — paste to move it",
    icon: () => Scissors,
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
    unavailableReason: noReason,
  },
  {
    action: "delete",
    group: "primary",
    label: (s) => (s.selectionCount > 1 ? `Delete ${itemCountPhrase(s.selectionCount)}` : "Delete"),
    description: () => "Move the selection to trash",
    icon: () => Trash2,
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
    unavailableReason: noReason,
  },
  {
    action: "duplicate",
    group: "overflow",
    label: (s) =>
      s.selectionCount > 1 ? `Duplicate ${itemCountPhrase(s.selectionCount)}` : "Duplicate",
    description: () => "Duplicate the selection",
    icon: () => CopyPlus,
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
    unavailableReason: noReason,
  },
  {
    action: "rename",
    group: "overflow",
    label: () => "Rename",
    description: () => "Rename the selected item",
    icon: () => TextCursorInput,
    visible: always,
    disabled: (s) => s.busy || !s.isSingleSelection,
    unavailableReason: (s) =>
      s.hasSelection && !s.isSingleSelection ? "Rename one item at a time" : null,
  },
  {
    action: "toggle-disabled",
    group: "overflow",
    label: (s) => (s.allDisabled ? "Enable" : "Disable"),
    description: (s) =>
      s.allDisabled
        ? "Play the selection again"
        : "Keep the slot, skip it on playback",
    icon: (s) => (s.allDisabled ? CircleCheck : Ban),
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
    unavailableReason: noReason,
  },
  {
    // The collection-scoped paste: INTO the selected collection rather than
    // beside it. Hidden rather than dimmed when no single collection is
    // selected — its label names a destination, and a row reading "Paste
    // into ''" is worse than no row. The header's paste (which always targets
    // the collection on screen) is the one that is always present.
    action: "paste-into",
    group: "overflow",
    label: (s) => `Paste into “${s.singleName ?? ""}”`,
    description: () => "Paste the clipboard inside the selected collection",
    icon: () => ClipboardPaste,
    visible: (s) => s.isSingleSelection && s.allCollections,
    disabled: (s) => s.busy || !s.canPaste,
    unavailableReason: (s) => (!s.canPaste ? "Nothing on the clipboard" : null),
  },
];

/**
 * What a surface should actually render, in order.
 *
 * `group` omitted = everything, which is the flat right-click menu. Pass one
 * and you get the toolbar's row or its overflow.
 */
export function visibleItemActions(
  state: ItemActionState,
  group?: ItemActionGroup,
): readonly ItemActionSpec[] {
  return ITEM_ACTION_SPECS.filter(
    (spec) => spec.visible(state) && (group === undefined || spec.group === group),
  );
}
