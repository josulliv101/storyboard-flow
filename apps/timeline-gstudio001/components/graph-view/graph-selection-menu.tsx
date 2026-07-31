"use client";

import { createElement, Fragment, type ComponentType } from "react";
import { Check } from "lucide-react";

import { useCollectionsSelector, useCollectionsStore } from "@storyboard/ui/dnd-collections";

import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@/components/core/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/core/dropdown-menu";
import { cn } from "@/lib/utils";
import { itemActionSections, type ItemActionState } from "@/lib/graph-item-action-specs";
import { requestGraphItemAction } from "@/lib/graph-view-events";

// THE selection menu. One definition, three triggers: the anchor card's `⋮`,
// any card's right-click, and the header's `⋮`.
//
// v2 had two renderings of this list — a row of icon tiles inside the card and
// an overflow menu for whatever the row could not fit — and keeping them
// lossless was a standing bug source, because an action in neither place is
// simply gone. There is one rendering now, so there is nothing to fold and
// nothing to lose.
//
// The two menu primitives (dropdown / context) are styled identically but come
// from different Radix packages, so the parts are injected rather than the
// markup duplicated. Anything structural — the header row, the counted labels,
// the inline reasons, where the separators fall — lives here once.

/**
 * The primitive components this menu renders into.
 *
 * `Item` must accept `onSelect`, `aria-disabled` and `className`; both packages'
 * items do. Note what is deliberately NOT in this contract: a `disabled` prop.
 * See `SelectionMenuRow`.
 */
type MenuParts = Readonly<{
  Item: ComponentType<{
    children?: React.ReactNode;
    className?: string;
    onSelect?: (event: Event) => void;
    "aria-disabled"?: boolean;
    "aria-label"?: string;
    "data-menu-action"?: string;
  }>;
  Label: ComponentType<{ children?: React.ReactNode; className?: string }>;
  Separator: ComponentType<Record<string, never>>;
}>;

/**
 * The selection menu's own skin.
 *
 * Applied at the CALL SITES rather than in `dropdown-menu.tsx` /
 * `context-menu.tsx`: those primitives dress the board menu, the breadcrumb
 * overflow and the size picker too, and this is a bigger, roomier treatment
 * than a settings popover wants. Scoping it here keeps one menu restyled
 * instead of every menu in the app.
 *
 * Roomier than the default on purpose. This is the menu a pointer lands in
 * mid-gesture — often on touch, where R11.4 asks for 44px rows — so the rows
 * are tall, the text is readable at a glance rather than at a squint, and the
 * icons are big enough to be recognised without being read.
 */
export const SELECTION_MENU_CONTENT_CLASS =
  "min-w-[15rem] rounded-xl border-white/10 bg-zinc-800 p-1.5 shadow-2xl shadow-black/50";

/** One row. `focus:` is what Radix sets for BOTH hover and keyboard focus. */
const ROW_CLASS =
  "gap-3 rounded-lg px-2.5 py-2 text-[15px] leading-none " +
  "[@media(pointer:coarse)]:min-h-11 " +
  // Darker than the menu, not lighter: the surface is already raised out of a
  // near-black page, so the highlight reads as a well rather than a glow.
  "focus:bg-zinc-900/80 focus:text-white";

/** Destructive rows carry the warning in the text and the glyph, not just in
 *  their position below a separator. */
const DESTRUCTIVE_ROW_CLASS = "text-red-400 focus:bg-red-500/10 focus:text-red-300";

const ICON_CLASS = "h-[18px] w-[18px] shrink-0";

/** Inset, so the rule stops short of the menu's rounded edge instead of
 *  running into it. */
const SEPARATOR_CLASS = "mx-2 my-1.5 bg-white/10";

export const DROPDOWN_MENU_PARTS: MenuParts = {
  Item: DropdownMenuItem as MenuParts["Item"],
  Label: DropdownMenuLabel as MenuParts["Label"],
  Separator: () => <DropdownMenuSeparator className={SEPARATOR_CLASS} />,
};

export const CONTEXT_MENU_PARTS: MenuParts = {
  Item: ContextMenuItem as MenuParts["Item"],
  Label: ContextMenuLabel as MenuParts["Label"],
  Separator: () => <ContextMenuSeparator className={SEPARATOR_CLASS} />,
};

/**
 * One row.
 *
 * IT NEVER USES THE PRIMITIVE'S `disabled` PROP (R7.7/R12.4). Radix's `disabled`
 * sets `pointer-events: none` and drops the item out of the menu's roving
 * focus, which makes an unavailable row unreachable — and an unreachable row
 * cannot deliver the one thing it exists to deliver, which is the REASON it is
 * unavailable. A keyboard user would arrow straight past "Edit — one only" and
 * never learn why edit is missing.
 *
 * So the row stays a full menu item, focusable and announced, marked
 * `aria-disabled` and dimmed by that attribute; `onSelect` swallows the
 * activation with `preventDefault()`, which also holds the menu open so the
 * reason stays on screen rather than the menu closing on a press that did
 * nothing.
 */
function SelectionMenuRow({
  parts,
  state,
  spec,
}: Readonly<{
  parts: MenuParts;
  state: ItemActionState;
  spec: ReturnType<typeof itemActionSections>[number][number];
}>) {
  const { Item } = parts;
  // `createElement` rather than `const Icon = spec.icon(state)`. The lookup
  // returns a stable module-level lucide component, but a capitalized local
  // assigned during render trips `react-hooks/static-components`, which cannot
  // tell that apart from a component defined inline (the case where React
  // remounts the subtree every render).
  const destructive = spec.section === "destructive";
  const icon = createElement(spec.icon(state), {
    "aria-hidden": "true",
    // Muted against the label — the glyph is for recognition, the word is what
    // is read. Destructive keeps its colour, because that is the one row where
    // the glyph should register before the word does.
    className: cn(ICON_CLASS, destructive ? undefined : "text-zinc-400"),
  });
  const label = spec.label(state);
  const reason = spec.unavailableReason(state);
  const disabled = spec.disabled(state);
  const shortcut = spec.shortcut;

  return (
    <Item
      data-menu-action={spec.action}
      aria-disabled={disabled || undefined}
      // The reason is part of the NAME, not a separate description (R12.5):
      // a description is announced late or not at all depending on the screen
      // reader's verbosity, and this is the half of the row that explains it.
      aria-label={reason === null ? undefined : `${label}, ${reason}`}
      onSelect={(event: Event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        requestGraphItemAction(spec.action);
      }}
      className={cn(
        ROW_CLASS,
        destructive && DESTRUCTIVE_ROW_CLASS,
        disabled && "opacity-40 focus:bg-transparent",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      {/* The trailing slot carries EITHER the reason (dimmed rows) or the
          shortcut (available ones) — never both, because a dimmed row's
          shortcut does not work either and printing it would be a lie. */}
      {reason !== null ? (
        <span aria-hidden="true" className="ml-auto pl-6 text-[13px] text-zinc-500">
          {reason}
        </span>
      ) : shortcut === null ? null : (
        <span aria-hidden="true" className="ml-auto pl-6 text-[13px] text-zinc-500">
          {shortcut}
        </span>
      )}
    </Item>
  );
}

/**
 * Additive-tap mode (§11).
 *
 * Touch has no modifier key, so this is the only way a finger can build a
 * multi-selection. It is NOT an item action — it changes how the next tap is
 * interpreted rather than doing anything to the selection — so it is not in
 * `ITEM_ACTION_SPECS` and sits in its own run at the foot of the menu.
 *
 * It has to be HERE. Its only control used to be the pill's overflow, and the
 * mode cannot outlive the selection (the store enforces that), so deleting the
 * pill without rehoming this would have left an armed mode with no way to
 * disarm it and a touch user with no way to arm it.
 *
 * An ordinary row with its state in the label and a check, rather than a
 * checkbox item: the context-menu wrapper has no checkbox primitive, and
 * overriding Radix's `role="menuitem"` would take its keyboard handling too.
 */
function MultiSelectToggleRow({
  parts,
  enabled,
  onToggle,
}: Readonly<{ parts: MenuParts; enabled: boolean; onToggle: () => void }>) {
  const { Item } = parts;
  return (
    <Item data-multi-select-toggle="" className={ROW_CLASS} onSelect={onToggle}>
      <Check
        aria-hidden="true"
        className={cn(ICON_CLASS, "text-zinc-400", enabled ? "opacity-100" : "opacity-0")}
      />
      <span className="truncate">
        {enabled ? "Stop adding to selection" : "Add to selection by tapping"}
      </span>
    </Item>
  );
}

/**
 * The menu's contents, without the trigger or the content wrapper.
 *
 * Callers supply those, because that is the only thing the three surfaces
 * genuinely differ in.
 */
export function SelectionMenuItems({
  parts,
  state,
}: Readonly<{ parts: MenuParts; state: ItemActionState }>) {
  const store = useCollectionsStore();
  const multiSelectMode = useCollectionsSelector((s) => s.interaction.multiSelectMode);
  const { Label, Separator } = parts;
  const sections = itemActionSections(state);
  // At 2+, the menu opens by saying what it is about to act on (R7.1). At
  // exactly one there is no scope ambiguity to resolve and the row would be
  // noise, so it is absent (R7.3) — the counted labels are absent then too.
  const showScopeHeader = state.selectionCount > 1;

  return (
    <>
      {showScopeHeader ? (
        <>
          <Label
            data-selection-scope-header=""
            className="px-2.5 pb-1.5 pt-1 text-[11px] tracking-[0.12em] text-zinc-500"
          >
            {state.selectionCount} items selected
          </Label>
          <Separator />
        </>
      ) : null}
      {/* Separators BETWEEN runs, emitted by the runs after the first. Deriving
          them from the section list (rather than hand-placing them) is what
          makes a leading, trailing, or doubled separator impossible when a row
          is hidden — "Paste into" comes and goes on its own, and it is the
          last row of its run. */}
      {sections.map((run, index) => (
        <Fragment key={run[0]?.action ?? index}>
          {index > 0 ? <Separator /> : null}
          <div role="group">
            {run.map((spec) => (
              <SelectionMenuRow key={spec.action} parts={parts} state={state} spec={spec} />
            ))}
          </div>
        </Fragment>
      ))}
      <Separator />
      <MultiSelectToggleRow
        parts={parts}
        enabled={multiSelectMode}
        onToggle={() => store.setMultiSelectMode(!multiSelectMode)}
      />
    </>
  );
}
