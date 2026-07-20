"use client";

/**
 * The sidebar's hover/focus tooltip. Shared by every sidebar affordance —
 * nav links, the tool palette, and the utility row — so the three cannot
 * drift apart visually. Referenced by `aria-describedby`, which is why it
 * carries an id and `role="tooltip"` rather than being decorative.
 */
export function SidebarTooltipLabel({
  id,
  label,
  description,
}: Readonly<{ id: string; label: string; description?: string }>) {
  return (
    <span
      id={id}
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 min-w-max -translate-y-1/2 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-left opacity-0 shadow-xl shadow-black/30 transition-opacity duration-150 group-hover/sidebar-item:opacity-100 group-focus-visible/sidebar-item:opacity-100"
    >
      <span className="block whitespace-nowrap text-xs font-semibold text-zinc-100">{label}</span>
      {description ? (
        <span className="mt-0.5 block whitespace-nowrap text-[10px] font-medium text-zinc-500">
          {description}
        </span>
      ) : null}
    </span>
  );
}
