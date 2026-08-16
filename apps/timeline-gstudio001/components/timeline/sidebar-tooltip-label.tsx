"use client";

import { createContext, useContext } from "react";

import { cn } from "@/lib/utils";

/**
 * Whether the rail is showing its labels inline.
 *
 * Geometry elsewhere is done with descendant variants off `RAIL_CLASS`, which
 * keeps seven tile call sites untouched — but this one thing CSS cannot do. A
 * floating tooltip and a permanent label are different things to a screen
 * reader (`role="tooltip"` vs a plain label), and the description line is
 * dropped rather than hidden, so the choice has to be made in React.
 *
 * Defaults to false, which is the collapsed rail — the shape every consumer
 * outside the sidebar gets, and the one that was here before.
 */
export const SidebarLabelsInlineContext = createContext(false);

/**
 * The sidebar's affordance label. Shared by every sidebar affordance — nav
 * links, the tool palette, and the utility row — so the three cannot drift
 * apart visually.
 *
 * COLLAPSED it is a hover/focus tooltip flying out to the right of the rail,
 * referenced by `aria-describedby`, which is why it carries an id and
 * `role="tooltip"` rather than being decorative.
 *
 * EXPANDED it stops flying and simply sits beside the glyph: the same text,
 * always visible, which is the whole point of widening the rail. It sheds the
 * tooltip's chrome (border, panel background, shadow) because a permanent
 * label inside its own tile does not need to look like a thing that appeared.
 */
export function SidebarTooltipLabel({
  id,
  label,
  description,
}: Readonly<{ id: string; label: string; description?: string }>) {
  const inline = useContext(SidebarLabelsInlineContext);

  if (inline) {
    return (
      // KEYED APART from the tooltip below so React REPLACES the node rather
      // than patching it. Patched, the same element kept the tooltip's
      // `transition-opacity` and faded from the visible label down to hidden
      // over 150ms — every label ghosting across the rail as it collapsed. A
      // fresh node mounts already hidden, with nothing to transition from.
      //
      // No `role="tooltip"`: it is not one any more. It keeps the id so the
      // buttons' `aria-describedby` still resolves rather than dangling.
      //
      // The DESCRIPTION is dropped, not hidden. Two lines per row would make
      // the rail a settings list; the second line exists to explain a glyph
      // with no words next to it, and expanded there is no such glyph.
      <span
        key="inline"
        id={id}
        className="pointer-events-none relative ml-4 min-w-0 flex-1 truncate text-left text-xs font-semibold text-current"
      >
        {label}
      </span>
    );
  }

  return (
    <span
      key="tooltip"
      id={id}
      role="tooltip"
      className={cn(
        "pointer-events-none absolute left-full top-1/2 z-50 ml-3 min-w-max -translate-y-1/2",
        "rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-left opacity-0",
        "shadow-xl shadow-black/30 transition-opacity duration-150",
        "group-hover/sidebar-item:opacity-100 group-focus-visible/sidebar-item:opacity-100",
        // SILENT AFTER A CLICK, until the pointer leaves and comes back.
        //
        // Pressing a rail tile leaves the pointer sitting on it, so the tooltip
        // faded up the instant the thing you pressed finished happening —
        // loudest on the rail's own collapse toggle, where it captions a
        // control you are still touching and have just used. You know what you
        // pressed; the tooltip is answering a question nobody has.
        //
        // `invisible`, not another opacity: visibility is a DIFFERENT property
        // from the one `group-hover` sets, so this cannot lose a specificity
        // race with it whatever order the utilities land in. The attribute is
        // stamped by the rail on pointer clicks and cleared on pointerleave.
        "group-data-[tip-suppressed]/sidebar-item:invisible",
      )}
    >
      <span className="block whitespace-nowrap text-xs font-semibold text-zinc-100">
        {label}
      </span>
      {description ? (
        <span className="mt-0.5 block whitespace-nowrap text-[10px] font-medium text-zinc-500">
          {description}
        </span>
      ) : null}
    </span>
  );
}
