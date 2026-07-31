import {
  Ban,
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

// What an item's actions ARE, in one place.
//
// Three surfaces render this list now — the anchor card's `⋮`, a card's
// right-click menu, and the header's `⋮` — and all three render it the SAME
// way, as one flat menu. That is new in v3: the surfaces used to disagree in
// shape (a row of icon tiles vs. a list of rows), which is why this module
// carried a `group` splitting the actions into a promoted few and an overflow.
// There is no icon row any more, so there is no split.
//
// Deliberately NOT a component. What the surfaces share is the DATA — which
// actions exist, in what order, with what labels and icons, and when each is
// available; what differs is only where the menu is anchored.

/** Everything an action needs to decide whether it applies right now. */
export type ItemActionState = Readonly<{
  hasSelection: boolean;
  /** How many items are selected. Labels say it out loud (R7.2): a bare
   *  "Duplicate" reads as acting on the one card the menu emerged from, which
   *  is exactly wrong when six are selected. */
  selectionCount: number;
  /** Exactly ONE item selected. */
  isSingleSelection: boolean;
  /** The clipboard is armed. */
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
}>;

/**
 * Which run of the menu an action belongs to. Separators are drawn BETWEEN
 * sections, so this is the only thing that decides where they fall.
 *
 * Grouped by KIND rather than by guessed frequency: the clipboard verbs sit
 * together, and Rename joins Edit as the other action about an item's identity.
 * The alternative order (the spec's provisional table) split Duplicate from
 * Paste with Rename, which put two clipboard operations on opposite sides of an
 * unrelated row.
 *
 * R7.5 makes this order PERMANENT — items are dimmed in place, never removed or
 * reordered — so changing it later moves rows under established muscle memory.
 */
export type ItemActionSection = "identity" | "clipboard" | "state" | "destructive";

/** Section order, and therefore menu order. */
export const ITEM_ACTION_SECTIONS: readonly ItemActionSection[] = [
  "identity",
  "clipboard",
  "state",
  "destructive",
];

export type ItemActionSpec = Readonly<{
  action: GraphItemAction;
  section: ItemActionSection;
  /** Resolved against state, because several change wording: Disable becomes
   *  Enable, and counts appear once a selection is plural. */
  label: (state: ItemActionState) => string;
  description: (state: ItemActionState) => string;
  icon: (state: ItemActionState) => LucideIcon;
  /** Shown right-aligned in the row (R7.8). These carry the majority of real
   *  clipboard traffic, so the menu is also where they are taught.
   *
   *  Spelled `Ctrl/⌘` rather than resolved per platform, matching the shortcuts
   *  sheet. Detecting the platform would mean reading `navigator` during render
   *  for a string two characters shorter. */
  shortcut: string | null;
  /** Present at all. Reserved for actions that are not merely unavailable but
   *  MEANINGLESS in this state — "Paste into" with no collection selected names
   *  a destination that does not exist. Everything else stays and dims (R7.5). */
  visible: (state: ItemActionState) => boolean;
  /** Present but unavailable. Preferred over hiding wherever the action is
   *  always CONCEPTUALLY available: a row that vanishes teaches nothing, while
   *  a dimmed one says "wrong shape of selection for that". */
  disabled: (state: ItemActionState) => boolean;
  /** WHY it is dimmed, in the user's terms, rendered INLINE in the row's
   *  trailing slot (R7.6) and folded into the row's accessible name (R12.5) —
   *  never a tooltip, which is unreachable by touch and by screen reader alike.
   *  Null when the action is available. */
  unavailableReason: (state: ItemActionState) => string | null;
}>;

const always = () => true;
const noReason = () => null;

/** The reason a row that acts on exactly one item gives when several are
 *  selected. Terse because it renders in a trailing slot beside the label. */
const ONE_ONLY = "one only";

/** "item" / "3 items" — the phrase every count-bearing label ends with. */
export function itemCountPhrase(count: number): string {
  return count === 1 ? "item" : `${count} items`;
}

/**
 * Counted at 2+, bare at 1 (R7.2/R7.3).
 *
 * Only for actions that can ACT on a set. Edit and Rename cannot, so they stay
 * bare at every count and say "one only" instead — "Edit 3 items" beside a
 * reason explaining that it cannot edit 3 items is a label arguing with itself.
 */
function counted(verb: string) {
  return (state: ItemActionState) =>
    state.selectionCount > 1 ? `${verb} ${itemCountPhrase(state.selectionCount)}` : verb;
}

/**
 * The ordered list.
 *
 * OPEN IS NOT HERE (R7.11). The chevron sits on the card before selection, so a
 * user who wanted to drill in would have clicked it; selecting instead is a
 * positive signal of disinterest in opening. Double-click and the O key remain,
 * and removing it also spares the menu a second dimmed row at its head.
 *
 * PASTE (the container-scoped one) IS NOT HERE EITHER. Every verb in this list
 * acts ON the selection; paste needs a destination, and a selection is not a
 * destination. It lives in the header permanently (R8.5). The one entry here is
 * "Paste into", which is a different operation with a different target (R7.12).
 */
export const ITEM_ACTION_SPECS: readonly ItemActionSpec[] = [
  {
    action: "details",
    section: "identity",
    label: () => "Edit",
    description: () => "Open the selected item's details",
    icon: () => Pencil,
    shortcut: null,
    visible: always,
    disabled: (s) => s.busy || !s.isSingleSelection,
    unavailableReason: (s) => (s.hasSelection && !s.isSingleSelection ? ONE_ONLY : null),
  },
  {
    action: "rename",
    section: "identity",
    label: () => "Rename",
    description: () => "Rename the selected item",
    icon: () => TextCursorInput,
    shortcut: "F2",
    visible: always,
    disabled: (s) => s.busy || !s.isSingleSelection,
    unavailableReason: (s) => (s.hasSelection && !s.isSingleSelection ? ONE_ONLY : null),
  },
  {
    action: "copy",
    section: "clipboard",
    label: counted("Copy"),
    description: () => "Copy the selection",
    icon: () => Copy,
    shortcut: "Ctrl/⌘ C",
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
    unavailableReason: noReason,
  },
  {
    action: "cut",
    section: "clipboard",
    label: counted("Cut"),
    description: () => "Cut the selection — paste to move it",
    icon: () => Scissors,
    shortcut: "Ctrl/⌘ X",
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
    unavailableReason: noReason,
  },
  {
    action: "duplicate",
    section: "clipboard",
    label: counted("Duplicate"),
    description: () => "Duplicate the selection",
    icon: () => CopyPlus,
    shortcut: "Ctrl/⌘ D",
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
    unavailableReason: noReason,
  },
  {
    // The collection-scoped paste: INTO the selected collection rather than
    // beside it (R7.12). Hidden rather than dimmed when no single collection is
    // selected — its label NAMES a destination, and a row reading "Paste into
    // ''" is worse than no row. The header's paste, which always targets the
    // collection on screen, is the one that is always present.
    action: "paste-into",
    section: "clipboard",
    label: (s) => `Paste into “${s.singleName ?? ""}”`,
    description: () => "Paste the clipboard inside the selected collection",
    icon: () => ClipboardPaste,
    shortcut: null,
    visible: (s) => s.isSingleSelection && s.allCollections,
    disabled: (s) => s.busy || !s.canPaste,
    unavailableReason: (s) => (!s.canPaste ? "clipboard empty" : null),
  },
  {
    action: "toggle-disabled",
    section: "state",
    label: (s) => counted(s.allDisabled ? "Enable" : "Disable")(s),
    description: (s) =>
      s.allDisabled ? "Play the selection again" : "Keep the slot, skip it on playback",
    icon: (s) => (s.allDisabled ? CircleCheck : Ban),
    shortcut: null,
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
    unavailableReason: noReason,
  },
  {
    // Alone below a separator (R7.9), so it is harder to hit on the way to
    // something else.
    action: "delete",
    section: "destructive",
    label: counted("Delete"),
    description: () => "Move the selection to trash",
    icon: () => Trash2,
    shortcut: "Delete",
    visible: always,
    disabled: (s) => s.busy || !s.hasSelection,
    unavailableReason: noReason,
  },
];

/** What a surface should actually render, in order. */
export function visibleItemActions(state: ItemActionState): readonly ItemActionSpec[] {
  return ITEM_ACTION_SPECS.filter((spec) => spec.visible(state));
}

/**
 * One spec by name, for the surfaces that PROMOTE a verb out of the menu — the
 * header's inline Edit and Delete.
 *
 * Throws rather than returning undefined. Every call site names an action as a
 * literal, so a miss means the action was renamed or removed and the promoted
 * button is about to render nothing at all; failing at module scope is how that
 * gets noticed, and the test below pins it.
 */
export function itemActionSpec(action: GraphItemAction): ItemActionSpec {
  const spec = ITEM_ACTION_SPECS.find((candidate) => candidate.action === action);
  if (spec === undefined) throw new Error(`No item action spec for "${action}"`);
  return spec;
}

/**
 * The visible actions grouped into their sections, empty sections dropped.
 *
 * Returned as an array of runs rather than a flat list with separator markers
 * so the renderer cannot emit a leading, trailing, or doubled separator — the
 * three ways a hand-rolled separator loop goes wrong when a row is hidden.
 */
export function itemActionSections(
  state: ItemActionState,
): readonly (readonly ItemActionSpec[])[] {
  const visible = visibleItemActions(state);
  return ITEM_ACTION_SECTIONS.map((section) =>
    visible.filter((spec) => spec.section === section),
  ).filter((run) => run.length > 0);
}
