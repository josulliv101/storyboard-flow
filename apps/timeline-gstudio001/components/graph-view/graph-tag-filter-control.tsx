"use client";

import { useState } from "react";
import { Tag } from "lucide-react";

import { tagCounts } from "@/lib/tag-facets";

import { useGraphDetailsSnapshot } from "./graph-details-context";
import { useTagFilter } from "./graph-tag-filter";

/**
 * The board's tag filter: pick tags, non-matching cards dim.
 *
 * Lives in the header's VIEW group because it QUALIFIES what the board shows
 * rather than changing the document — the same class of control as the ruler
 * and waveform toggles beside it.
 *
 * The menu is built from the tags actually in use, not from a fixed list.
 * Tag vocabulary here is emergent (a new checkpoint is a new tag), so anything
 * curated would be stale within a week.
 */
export function TagFilterControl() {
  const [open, setOpen] = useState(false);
  const details = useGraphDetailsSnapshot();
  const { activeTags, toggleTag, clear } = useTagFilter();
  const counts = tagCounts(details);
  const active = activeTags.size;

  // Nothing tagged yet means nothing to filter by, and an empty menu is worse
  // than no control at all.
  if (counts.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        data-tag-filter-trigger
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        title="Filter the board by tag — non-matching cards dim"
        aria-label={active > 0 ? `Tag filter, ${active} active` : "Filter by tag"}
        className={[
          "flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium transition-colors",
          active > 0
            ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40"
            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
        ].join(" ")}
      >
        <Tag aria-hidden="true" className="size-3.5" />
        {active > 0 ? <span data-tag-filter-count>{active}</span> : null}
      </button>

      {open ? (
        <div
          role="menu"
          data-tag-filter-menu
          className="absolute top-full right-0 z-50 mt-1 flex max-h-72 w-56 flex-col gap-0.5 overflow-y-auto rounded-md bg-zinc-900 p-1 shadow-lg ring-1 ring-white/15"
        >
          {counts.map(({ tag, count }) => {
            const on = activeTags.has(tag.toLowerCase());
            return (
              <button
                key={tag}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                data-tag-filter-option={tag}
                onClick={() => toggleTag(tag)}
                className={[
                  "flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px]",
                  on ? "bg-sky-500/20 text-sky-100" : "text-zinc-300 hover:bg-zinc-800",
                ].join(" ")}
              >
                <span className="truncate">{tag}</span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums">
                  {count}
                </span>
              </button>
            );
          })}
          {active > 0 ? (
            <button
              type="button"
              data-tag-filter-clear
              onClick={clear}
              className="mt-0.5 rounded border-t border-white/10 px-2 py-1 text-left text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              Clear filter
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
