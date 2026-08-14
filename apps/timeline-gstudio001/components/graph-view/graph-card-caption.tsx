"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { fittedTagCount } from "@/lib/caption-tag-fit";
import { sortTagsStatusFirst } from "@/lib/tag-facets";

import { TagAccentDot } from "./tag-accent-dot";

/**
 * The caption's two rows, shared by BOTH card kinds.
 *
 * A grid caption is always TWO rows: identity on top (kind glyph, name, and the
 * metadata trailing right), tags underneath, right-justified. The two kinds
 * used to disagree about the shape — a collection put its metadata on row one
 * and its tags in a span of their own, media stacked name over
 * metadata-plus-tags — so a mixed grid showed two different objects.
 *
 * Shared as CONSTANTS rather than as matching literals in two places, because
 * matching literals is exactly what drifted: the alignment work before this had
 * to reconcile four separate numbers that were only ever meant to be equal.
 */
export const CAPTION_ROW_CLASS = "flex min-h-5 min-w-0 items-center gap-1.5";

/**
 * Row two, and it is ALWAYS RENDERED — an untagged card keeps an empty one.
 *
 * That is the whole point: with the row omitted, a tagged card was taller than
 * an untagged one, so a grid of mixed cards had captions of two heights and the
 * artwork above them started at two different places. Reserving the height
 * costs one empty row and buys every card the same box.
 *
 * NO display utility here, deliberately. The collection's copy is grid-gated
 * (`hidden [[data-virtual-grid]_&]:flex`) and a `flex` baked in would collide
 * with that `hidden` — two display utilities on one element, resolved by CSS
 * source order rather than by the order they are written, which is a coin toss
 * dressed up as a class list. Each caller states its own.
 */
export const CAPTION_TAG_ROW_CLASS = "min-w-0 items-center justify-end";

/**
 * The trailing metadata on row one — duration, and a collection's item count.
 *
 * Modelled on the collection card's, which is the one the owner picked: mono,
 * medium, zinc-300, stepping up a size in the grid. `ml-auto` is what puts it
 * at the row's right edge without a `justify-between` that would also fight the
 * name's `flex-1`.
 */
export const CAPTION_META_CLASS =
  "ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px] font-medium text-zinc-300 [[data-virtual-grid]_&]:text-xs";

/**
 * Holds row two open at exactly one chip's height when there are no tags.
 *
 * 14px is a chip's own box (`text-[10px] leading-none` + `py-0.5`); the ring is
 * a box-shadow and costs no layout. Zero WIDTH so it cannot push the chips it
 * stands in for, and `shrink-0` so a crowded row cannot squeeze it back to
 * nothing — which would silently restore the height difference it exists to
 * remove.
 *
 * A SPACER rather than a `min-h` on the row, and that was measured: under
 * `border-box` a min-height includes the element's own padding, so the
 * collection's row — which carries `pt-1 pb-1.5` where the media card's does
 * not — reserved 14px total and got 4px of content, then grew to 24px once real
 * chips arrived. Media was 14px either way; the collection was 14 vs 24, so its
 * artwork moved 10px depending on whether the card happened to be tagged. A
 * spacer reserves CONTENT height, which every padding then adds to equally.
 */
export function CaptionTagRowSpacer() {
  return <span aria-hidden="true" className="block h-[14px] w-0 shrink-0" />;
}

/**
 * The caption's tag chips — in flow, under the artwork, grid only.
 *
 * MEASURED, not counted. It used to show a fixed two and fold the rest, on the
 * reasoning that a grid cell is a known width per item size. That is true of
 * the CELL and false of this row: tags are free text, so two long ones overflow
 * where four short ones would have fitted, and a fixed count both clipped the
 * long case and hid tags there was room for in the short one. The row now fits
 * as many whole chips as the width actually takes and folds the remainder.
 *
 * Same ruler technique as the select row's verbs (`useFittedVerbCount`): an
 * invisible, out-of-flow copy of every chip is what gets measured, because
 * measuring the real row would be circular — hiding a chip changes the width
 * you are measuring from, so the answer would depend on the previous answer.
 */
export function CaptionTagRow({ tags }: Readonly<{ tags: readonly string[] }>) {
  const ordered = useMemo(() => sortTagsStatusFirst(tags), [tags]);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const rulerRef = useRef<HTMLSpanElement | null>(null);
  const counterRef = useRef<HTMLSpanElement | null>(null);
  const [fitted, setFitted] = useState(ordered.length);

  useEffect(() => {
    const container = containerRef.current;
    const ruler = rulerRef.current;
    if (!container || !ruler) return;

    // MEASURE here, DECIDE in lib/caption-tag-fit. The two-pass rule and the
    // at-least-one-chip floor are the interesting part and they are now
    // unit-tested; this side owns only the DOM reads.
    const measure = () => {
      const widths = Array.from(ruler.children).map((child) =>
        Math.ceil((child as HTMLElement).getBoundingClientRect().width),
      );
      const next = fittedTagCount({
        widths,
        budget: container.clientWidth,
        counterWidth: counterRef.current?.getBoundingClientRect().width ?? 0,
      });
      // null = the row is not laid out yet; keep the previous answer rather
      // than folding everything for a frame.
      if (next !== null) setFitted(next);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [ordered]);

  const shown = ordered.slice(0, fitted);
  const extra = ordered.length - shown.length;
  const chipClass =
    "inline-flex max-w-[7rem] shrink-0 items-center gap-1 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] leading-none font-medium text-zinc-300 ring-1 ring-white/10";

  return (
    <span
      ref={containerRef}
      data-clip-caption-tags={tags.length}
      // `flex-1 min-w-0`, NOT `ml-auto shrink`. The budget has to come from the
      // ROW, never from these chips: a content-sized box reports the width its
      // contents already take, so measuring it asks "do the chips fit in the
      // space the chips are using", which is always yes — the fold then never
      // fires, or fires against a box that shrank because of the last answer.
      // Same one-way rule the select row's verb container follows.
      //
      // RIGHT-JUSTIFIED via `justify-end` rather than by letting the box shrink
      // to its contents — the two look identical until the row is measured, and
      // shrinking is the thing that breaks the fold. The container still spans
      // the leftover width; only the chips inside it sit at its right edge.
      className="relative flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden"
    >
      {/* The ruler: every chip, laid out but invisible. `visibility:hidden`
          rather than `display:none` so the boxes still measure, absolute so it
          cannot widen the container it is measured against, and `inert` so a
          hidden copy of the row is not in the tab order or the a11y tree. */}
      <span
        ref={rulerRef}
        aria-hidden="true"
        inert
        data-clip-caption-tags-ruler=""
        className="pointer-events-none invisible absolute top-0 left-0 flex items-center gap-1"
      >
        {ordered.map((tag) => (
          <span key={tag} className={chipClass}>
            <TagAccentDot tag={tag} />
            <span className="min-w-0 truncate">{tag}</span>
          </span>
        ))}
      </span>
      {/* The counter's own width, measured the same way rather than guessed —
          it grows with the digit count ("+9" against "+12"). */}
      <span
        ref={counterRef}
        aria-hidden="true"
        inert
        className="pointer-events-none invisible absolute top-0 left-0 shrink-0 font-mono text-[10px] leading-none"
      >
        +{ordered.length}
      </span>

      {shown.map((tag) => (
        <span key={tag} title={tag} className={chipClass}>
          <TagAccentDot tag={tag} />
          <span className="min-w-0 truncate">{tag}</span>
        </span>
      ))}
      {extra > 0 && (
        <span
          data-clip-caption-tags-overflow={extra}
          // HOVER LISTS THE REST. A `title` rather than a real tooltip, and not
          // for lack of one: this renders inside the card's selection surface,
          // which is a `<button>`, and a Radix tooltip trigger is interactive
          // content — nesting it would auto-close the card's own button and
          // eject the rest of the card out of its box (the same wall the
          // select-mode checkbox hit). A title costs nothing and works.
          title={ordered.slice(fitted).join("\n")}
          className="shrink-0 cursor-help font-mono text-[10px] leading-none text-zinc-500"
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
