"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Filter, X } from "lucide-react";

import { tagCounts, tagKey } from "@/lib/tag-facets";

import { useGraphDetailsSnapshot } from "./graph-details-context";
import { useTagFilter } from "./graph-tag-filter";
import { TagAccentDot } from "./tag-accent-dot";

/**
 * The board's tag filter: pick tags, non-matching cards dim.
 *
 * Leads the header's right cluster paired with Select — the two controls that
 * change how you WORK with the board rather than what it contains. It used to
 * sit in the view group beside the ruler and waveform toggles, on the reasoning
 * that it qualifies what the board shows; true, but among those it read as one
 * more display switch, and this is the control the row most needed to make
 * findable.
 *
 * The menu is built from the tags actually IN USE, not a fixed list. Tag
 * vocabulary here is emergent — a new checkpoint is a new tag — so anything
 * curated would be stale within a week.
 */
export function TagFilterControl() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const details = useGraphDetailsSnapshot();
  const { activeTags, toggleTag, clear } = useTagFilter();
  const counts = tagCounts(details);
  const active = activeTags.size;

  // Dismissal, both ways round. Escape is captured so it closes THIS before it
  // reaches the board — where the same key would drop the selection or leave
  // select mode, which is not what someone with a menu open means by it.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  // Nothing tagged yet means nothing to filter by, and an empty menu is worse
  // than no control at all.
  if (counts.length === 0) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        data-tag-filter-trigger
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        title="Filter the board by tag — non-matching cards dim"
        aria-label={active > 0 ? `Filter by tag, ${active} active` : "Filter by tag"}
        className={[
          "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
          "[@media(pointer:coarse)]:h-11",
          active > 0
            ? "bg-sky-500/20 text-sky-100 ring-1 ring-sky-400/40"
            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
        ].join(" ")}
      >
        <Filter aria-hidden="true" className="size-3.5" strokeWidth={1.7} />
        Filter
        {active > 0 ? (
          <span
            data-tag-filter-count
            className="grid h-4 min-w-4 place-items-center rounded-full bg-sky-500 px-1 font-mono text-[10px] text-white tabular-nums"
          >
            {active}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          data-tag-filter-menu
          className="absolute top-full right-0 z-50 mt-1.5 flex max-h-80 w-60 flex-col overflow-y-auto rounded-md bg-zinc-900 p-1.5 shadow-lg ring-1 ring-white/15"
        >
          <div className="flex items-center px-1.5 pt-0.5 pb-1.5 text-[11px] text-zinc-500">
            Filter by tag
            {active > 0 ? (
              <button
                type="button"
                data-tag-filter-clear
                onClick={clear}
                className="ml-auto rounded px-1 hover:text-zinc-100"
              >
                Clear all
              </button>
            ) : null}
          </div>

          {counts.map(({ tag, count }) => {
            const on = activeTags.has(tagKey(tag));
            return (
              <button
                key={tag}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                data-tag-filter-option={tag}
                onClick={() => toggleTag(tag)}
                className={[
                  "flex h-8 w-full items-center gap-2 rounded px-1.5 text-left text-[11px] transition-colors",
                  on ? "bg-sky-500/20 text-sky-100" : "text-zinc-300 hover:bg-zinc-800",
                ].join(" ")}
              >
                <TagAccentDot tag={tag} className="size-[7px]" />
                <span className="min-w-0 flex-1 truncate">{tag}</span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums">
                  {count}
                </span>
                {/* Always rendered, opacity-toggled: a check that appeared and
                    disappeared would shift the count beside it on every tap. */}
                <Check
                  aria-hidden="true"
                  strokeWidth={3}
                  className={["size-3 shrink-0 text-sky-300", on ? "opacity-100" : "opacity-0"].join(
                    " ",
                  )}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * What the filter is currently doing, as removable chips under the header.
 *
 * The trigger's count says HOW MANY tags are running; this says WHICH — and
 * that difference matters more here than it would in most apps, because the
 * filter DIMS rather than hides. A hiding filter announces itself: the board
 * empties out. A dimming one leaves every card in place, so a filter left on by
 * accident looks almost exactly like a board where most things happen not to
 * match, and the only tell is a small badge in the corner of the toolbar.
 *
 * Each chip is its own OFF switch, which is the common correction — narrowing
 * by three tags and wanting the second one back. "Clear all" is separate and
 * last, so removing one tag can never be a misclick away from removing them all.
 *
 * Renders nothing at rest, so it costs no vertical space until it is true.
 */
export function ActiveTagFilters() {
  const { activeTags, toggleTag, clear } = useTagFilter();
  const details = useGraphDetailsSnapshot();

  if (activeTags.size === 0) return null;

  // The active set stores COMPARISON keys (lowercased); the counts carry the
  // spelling the user actually typed. Show the spelling — a chip reading
  // "scail-2" for a tag written "SCAIL-2" is the filter appearing to have
  // changed the data.
  const spelling = new Map(tagCounts(details).map(({ tag }) => [tagKey(tag), tag]));

  return (
    <div
      data-active-tag-filters={activeTags.size}
      className="flex flex-wrap items-center gap-1.5 px-0.5 pt-2"
    >
      <span className="text-[11px] text-zinc-500">Filtered by</span>
      {[...activeTags].map((key) => {
        const label = spelling.get(key) ?? key;
        return (
          <button
            key={key}
            type="button"
            data-active-tag-filter={label}
            onClick={() => toggleTag(label)}
            title={`Stop filtering by “${label}”`}
            aria-label={`Stop filtering by ${label}`}
            className="group inline-flex h-6 max-w-[12rem] items-center gap-1.5 rounded-full bg-sky-500/10 py-0 pr-1 pl-2 text-[11px] text-sky-100 ring-1 ring-sky-400/40 transition-colors hover:bg-sky-500/20"
          >
            <TagAccentDot tag={label} />
            <span className="min-w-0 truncate">{label}</span>
            <span className="grid size-3.5 shrink-0 place-items-center rounded-full text-sky-300/70 group-hover:bg-white/10 group-hover:text-sky-100">
              <X aria-hidden="true" className="size-2.5" strokeWidth={2.5} />
            </span>
          </button>
        );
      })}
      <button
        type="button"
        data-active-tag-filters-clear
        onClick={clear}
        className="rounded px-1 py-1 text-[11px] text-zinc-500 hover:text-zinc-100"
      >
        Clear all
      </button>
    </div>
  );
}
