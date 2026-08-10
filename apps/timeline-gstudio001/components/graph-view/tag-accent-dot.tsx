"use client";

import { tagAccent, type TagAccent } from "@/lib/tag-facets";

/**
 * The colour a tag family paints, as WHOLE literal class names.
 *
 * Never built at runtime (`bg-${accent}-400`): Tailwind scans source text for
 * complete class names, so an interpolated one is simply absent from the built
 * CSS — and the failure is silent, a dot that renders with no colour at all.
 */
const TAG_ACCENT_DOT: Record<TagAccent, string> = {
  place: "bg-blue-400",
  role: "bg-violet-400",
  source: "bg-teal-400",
  ok: "bg-emerald-400",
  progress: "bg-amber-400",
  blocked: "bg-red-400",
};

/**
 * A tag's colour, as a dot.
 *
 * Shared by the three places tags are shown — the card caption, the filter
 * menu, and the active-filter summary — because a tag that changed colour
 * between where you FILTER by it and where you SEE it would defeat the only
 * thing the colour is for. One module, one answer.
 *
 * Decorative everywhere it is used: the label sits right beside it in all
 * three, so the colour is a scanning aid rather than information of its own.
 */
export function TagAccentDot({
  tag,
  className = "size-1.5",
}: Readonly<{ tag: string; className?: string }>) {
  return (
    <span
      aria-hidden="true"
      data-tag-accent={tagAccent(tag)}
      className={["shrink-0 rounded-full", className, TAG_ACCENT_DOT[tagAccent(tag)]].join(" ")}
    />
  );
}
