"use client";

import { useContext, useSyncExternalStore } from "react";
import { Layers } from "lucide-react";

import {
  collectionShortcuts,
  type CollectionShortcut,
} from "@/lib/collection-shortcuts";
import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { requestGraphOpenItem } from "@/lib/graph-view-events";
import { cn } from "@/lib/utils";

import {
  SIDEBAR_AVATAR_INSET,
  SIDEBAR_ICON_BASE,
  SIDEBAR_ICON_IDLE,
} from "./sidebar-icon-styles";
import {
  SidebarLabelsInlineContext,
  SidebarTooltipLabel,
} from "./sidebar-tooltip-label";

// SHORTCUTS INTO A PROJECT'S TOP-LEVEL COLLECTIONS.
//
// The rail otherwise answers "where am I". These answer "where else" — the
// handful of places a project is divided into, one click away from anywhere
// inside it. They are shortcuts, not a tree: nothing here descends, because a
// full tree would be a second navigator competing with the board.
//
// The document comes from `graphDocumentsGateway`, not from props. The rail is
// rendered by the root layout, so it is a SIBLING of the graph route tree and
// cannot be handed anything the board knows — the gateway is a module
// singleton, which is the same seam `GraphRenderFormat` uses for the same
// reason. Drilling in goes back out through the window-event bus for the
// mirror-image reason: navigation lives inside that tree.

/**
 * 32px, so it wears the AVATAR's inset rather than the glyph's — the two are
 * different sizes and each needs its own number to land on the icon column.
 * Rounded, not circular: it is a frame from a film, not a person.
 *
 * `relative` IS LOAD-BEARING, for the reason `SIDEBAR_GLYPH` documents and
 * this missed: the tile's pill is an absolutely-positioned `::before`, and a
 * positioned element paints over a static one. Left static, every thumbnail
 * sat under `bg-zinc-900/40` — a 40% black veil, which is survivable on a
 * line-art glyph and ruinous on a photograph. Dark frames went nearly black.
 *
 * The ring is the other half of making these read: a photograph needs an EDGE
 * against a dark rail or it bleeds into it, where a glyph is its own outline.
 * Brightness is left alone — these are the frames the project actually
 * contains, and a thumbnail that lies about its exposure is worse than a dim
 * one.
 */
// `block` IS LOAD-BEARING now that this dresses a <span> rather than the <img>.
// An <img> is replaced content and takes a width and height as given; a span is
// `display: inline` by default, where `h-8 w-8` are simply ignored — the frame
// then sized to the image and a 32px tile painted at 640px, pushing the rail's
// whole column aside. (The empty-state variant escaped it by adding `grid`.)
const THUMBNAIL_CLASS =
  "relative block h-8 w-8 shrink-0 overflow-hidden rounded-md ring-1 ring-white/15";

/**
 * The frame is PUNCHED IN, and the crop is the point.
 *
 * `object-cover` alone already fills the square — a 16:9 still loses 44% of its
 * width to the sides before anything here happens. What it does not do is make
 * the SUBJECT any bigger: a face that sits small in a wide frame is still small
 * once the frame is square, and at 32px small means unrecognisable. The rail's
 * whole job is telling three collections apart at a glance, and a shrunken
 * establishing shot cannot do that.
 *
 * So the image is scaled past cover and the overflow is thrown away. The tile
 * does not grow — only the picture inside it does, which is the difference
 * between "make the thumbnails bigger" (they would stop fitting the icon
 * column) and "show me more of what is in them".
 *
 * THE ORIGIN SITS ABOVE CENTRE, and that is not a taste call — a centred zoom
 * decapitated one of these. Subjects in this project's frames sit high (a
 * character plate is a head and shoulders with air above), so scaling about the
 * middle throws away the face and keeps the chest: the punch-in made the tile
 * LESS identifiable, which is the opposite of the point. Pulling the origin to
 * 32% keeps roughly a third more of the top for the same zoom.
 *
 * It is still a compromise, not a solution. The right answer for a frame whose
 * subject sits somewhere unusual is a per-collection crop stored beside the
 * frame; a rail-wide constant can only be right on average, and this is the
 * average that suits heads.
 *
 * The number is the dial. 1.4 is a visible punch-in that still leaves a
 * recognisable amount of frame; much past 1.6 and a wide shot becomes an
 * abstract patch of colour, which is worse than small.
 */
const THUMBNAIL_IMAGE_CLASS =
  "h-full w-full origin-[50%_32%] scale-[1.4] object-cover";

/**
 * The section's heading and its divider are ONE ELEMENT that changes shape.
 *
 * Wide it is "COLLECTION SHORTCUTS"; narrow it is the hairline those words
 * cannot fit into. Because it is a single element the whole way through, the
 * change between them is an ordinary CSS transition on height, colour and
 * background — a real morph, not two things swapped and animated to look like
 * one.
 *
 * IT WAS A VIEW TRANSITION, briefly, and this replaced it. Sharing one
 * `view-transition-name` between a separate heading and rule did morph them,
 * but a view transition snapshots the WHOLE PAGE, and the thing moving here is
 * the container the rest of the layout is measured against. Suppressing the
 * root cross-fade leaves both root snapshots painted at once, so the board
 * behind the rail rendered twice — every card, the breadcrumb and the counts
 * doubled and offset by the width the rail was giving up. The visible symptom
 * was the divider flashing to full width; the cause was the whole page being
 * animated to move one rule.
 *
 * One element also gets the accessibility right for free: the heading is real
 * text in both states, so it names the group below it always, rather than
 * being swapped for an `aria-hidden` rule half the time.
 *
 * `overflow-hidden` at 1px is what hides the word without hiding it from a
 * screen reader, and `mx-4` makes both states follow the rail — 40px closed
 * (what the old `mx-auto w-10` drew), 200px open.
 */
function ShortcutsHeading({
  id,
  inline,
}: Readonly<{ id: string; inline: boolean }>) {
  return (
    <h2
      id={id}
      data-sidebar-section="collections"
      data-sidebar-section-state={inline ? "heading" : "rule"}
      className={cn(
        // THE RULE IS AS LONG AS THE WORDS, and `w-fit` alone does not get
        // there. The rail is a column flex with `items-stretch`, so it was
        // stretching this box to the full 207px gutter while the lettering is
        // 125px — and the rule state paints the BOX, not the text. Collapsing
        // therefore drew a bar 82px longer than the label it replaces, which
        // is the "divider starts at the full width of the sidebar" it kept
        // looking like. It was not starting wide and shrinking; it was always
        // that long, and only the collapse made it obvious.
        //
        // `self-start` is the half that matters — measured: 207px stretched,
        // 125px once the stretch is off, which is exactly `max-content`.
        //
        // The max-width is the OTHER half, and `w-fit` cannot do it alone.
        // `fit-content` never goes below `min-content`, and `truncate` sets
        // `white-space: nowrap`, so min-content IS max-content here: the rule
        // stayed 125px all the way down and hung 85px out of a 40px gutter.
        // Capping at the gutter (100% less the 2rem of `mx-4`) gives the two
        // ends the behaviour they each need — the words decide the length
        // while there is room for them, the gutter decides once there is not.
        "mx-4 my-2 w-fit max-w-[calc(100%-2rem)] shrink-0 self-start overflow-hidden truncate text-[10px] font-semibold uppercase tracking-wider",
        // Height, colour and background are the morph. Not `transition-all`:
        // that would also animate the margins, and a divider whose gaps grow
        // as it becomes a word reads as the rail breathing rather than as a
        // label arriving.
        "transition-[height,background-color,color] duration-200 motion-reduce:transition-none",
        inline
          ? // zinc-400, not zinc-500. At 10px this is small text, so it needs
            // 4.5:1 and zinc-500 on the rail's #111113 measures 3.9 — Lighthouse
            // failed it. zinc-400 measures 7.2. The rule state below keeps
            // zinc-500 because there it is a BACKGROUND band, not text.
            "h-4 bg-transparent text-zinc-400"
          : // The rule state: a 1px band of the divider's own colour, with the
            // text still present and simply too short to show.
            "h-px bg-zinc-500 text-transparent",
      )}
    >
      Collection shortcuts
    </h2>
  );
}

export function CollectionShortcutsGroup({
  shortcuts,
  onOpen,
}: Readonly<{
  shortcuts: readonly CollectionShortcut[];
  onOpen: (nodeId: string) => void;
}>) {
  // The same signal the labels use — "is the rail wide enough for words".
  const inline = useContext(SidebarLabelsInlineContext);
  const headingId = "sidebar-section-collections";
  // NOTHING AT ALL when there are no top-level collections — not an empty group,
  // and the caller draws no separator either. A new project has none, and a
  // rule with nothing under it reads as something that failed to load.
  if (shortcuts.length === 0) return null;

  return (
    <>
      <ShortcutsHeading id={headingId} inline={inline} />
      <div
        role="group"
        aria-labelledby={headingId}
        data-sidebar-collection-shortcuts={shortcuts.length}
        className="flex w-full flex-col items-stretch gap-0"
      >
        {shortcuts.map((shortcut) => {
          const tooltipId = `sidebar-tooltip-collection-${shortcut.nodeId}`;
          return (
            <button
              key={shortcut.nodeId}
              type="button"
              data-sidebar-collection={shortcut.nodeId}
              aria-label={`Open ${shortcut.title}`}
              aria-describedby={tooltipId}
              onClick={() => onOpen(shortcut.nodeId)}
              className={cn(SIDEBAR_ICON_BASE, SIDEBAR_ICON_IDLE)}
            >
              {/* The frame, MARKED as a collection.
                  A badge rather than the card's centred mark: that one is a
                  40px glyph on a disc over a card-sized frame, and shrunk onto
                  32px it would cover the very picture that says WHICH
                  collection this is. The corner badge is this rail's own idiom
                  for "what kind of thing is this" — `TrashAreaIcon` and
                  `MediaFolderIcon` both wear one — and it carries the same
                  `Layers` glyph the card's mark and the board's Collections
                  toggle use, so all three say collection with one sign. */}
              <span
                aria-hidden="true"
                className={cn("relative shrink-0", SIDEBAR_AVATAR_INSET)}
              >
                {shortcut.thumbnail ? (
                  // The frame CLIPS and the picture fills it, rather than the
                  // <img> being the frame. Two elements because the scale has
                  // to be thrown away by something, and it cannot be the parent
                  // here: the badge hangs outside the box on purpose, so an
                  // `overflow-hidden` up there would cut the corner off it.
                  <span className={THUMBNAIL_CLASS}>
                    {/* A plain <img>, warned about by @next/next/no-img-element
                        and left that way on purpose: these are remote provider
                        URLs the app does not own, and the avatar two groups
                        down is an <img> for the same reason. */}
                    <img
                      src={shortcut.thumbnail}
                      // Decorative: the button already says "Open <title>", and
                      // a second reading of the same collection would be noise.
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className={THUMBNAIL_IMAGE_CLASS}
                    />
                  </span>
                ) : (
                  // A collection with nothing in it yet still needs a target
                  // the same size as its neighbours, or the column develops a
                  // gap that reads as a missing item rather than an empty one.
                  <span
                    className={cn(
                      THUMBNAIL_CLASS,
                      "grid place-items-center bg-zinc-800/70",
                    )}
                  >
                    <Layers
                      className="h-4 w-4 text-zinc-500"
                      strokeWidth={1.6}
                    />
                  </span>
                )}
                {/* Solid, not translucent: it sits on whatever frame the
                    collection happens to lead with, and a see-through badge
                    over a busy shot is the one case where this would stop
                    reading. The ring is what keeps it off a pale frame. */}
                <span className="absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-full bg-zinc-950 ring-1 ring-zinc-600">
                  <Layers className="h-3 w-3 text-zinc-100" strokeWidth={2} />
                </span>
              </span>
              <SidebarTooltipLabel
                id={tooltipId}
                label={shortcut.title}
                description={`${shortcut.itemCount} ${shortcut.itemCount === 1 ? "item" : "items"}`}
              />
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Reads this project's own collections, so the rail only has to place it —
 *  the same shape as `GraphRenderFormat`, which owns its own source too. */
export function SidebarCollectionShortcuts({
  projectId,
}: Readonly<{ projectId: string }>) {
  const documents = useSyncExternalStore(
    graphDocumentsGateway.subscribe,
    graphDocumentsGateway.read,
    graphDocumentsGateway.read,
  );
  return (
    <CollectionShortcutsGroup
      shortcuts={collectionShortcuts(documents[projectId])}
      onOpen={requestGraphOpenItem}
    />
  );
}
