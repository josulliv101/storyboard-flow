"use client";

import { memo, useContext } from "react";
import { Layers } from "lucide-react";

import {
  CollectionItem,
  useCollectionItemState,
  useCollectionsSelector,
  type CollectionItemShellProps,
  type NodeCardDragActivation,
} from "@storyboard/ui/dnd-collections";

import { disabledVisualState, disabledVisualsAttr } from "@/lib/disabled-visuals";
import { formatDuration } from "@/lib/format-duration";
import { collectionPreviewFrameUrl } from "@/lib/video-frame-url";

import { useClipDetail, useTimelineTitle } from "./graph-details-context";
import { useTagFilterMiss } from "./graph-tag-filter";
import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";
import { useCollectionHoverTarget } from "./graph-collection-hover";
import { GraphViewNavContext } from "./graph-navigation";
import { CardCornerSlot } from "./graph-anchor-menu";
import {
  AudioPlaceholder,
  EmptyCollectionPlaceholder,
} from "./graph-card-placeholders";
import {
  DisabledChip,
  LaneChip,
  SelectionIndicator,
} from "./graph-card-badges";
import {
  CAPTION_META_CLASS,
  CAPTION_TAG_ROW_CLASS,
  CaptionTagRow,
  CaptionTagRowSpacer,
} from "./graph-card-caption";
import { cardDimmingClass } from "./graph-card-dimming";
import { collectionCardItemCount, collectionCardSeconds, laneOf } from "./graph-card-model";
import {
  useCollectionPreviewFrames,
  useDisabledByAncestor,
  useEnabledChildCount,
  useFirstChildIsAudio,
  useCollectionSubtreeHydrated,
  useHydratedCollectionSeconds,
} from "./graph-card-derivations";
import { LANE_TRACKS_ENABLED } from "@/lib/lane-tracks-flag";

/**
 * The composed collection ITEM, rendered through the package's item-shell
 * seam instead of NodeCard (review finding 1). This card carries INTERACTIVE
 * controls — the folder drill-in and the inline rename editor — and inside
 * NodeCard they had to fake their semantics (`role="button"` span, a
 * contentEditable "textbox") because real ones can't nest in the card
 * <button>. Here the CollectionItem primitives keep the package behavior
 * (drag, selection, keyboard grab, drop indicators, FLIP identity) and the
 * controls compose as SIBLINGS of the selection surface: a real <button> and
 * a real <input>, legally.
 */
const GraphCollectionItemParts = memo(function GraphCollectionItemParts({
  dragActivation,
}: {
  dragActivation: NodeCardDragActivation;
}) {
  const { id, node, selected, rejected, isDragSource } = useCollectionItemState();
  const detail = useClipDetail(id as string);
  // Same source of truth as the tree/breadcrumb, so a rename shows here too.
  const title = useTimelineTitle(id as string);
  const rename = useInlineRename(id, title ?? node.name, "card");
  const nav = useContext(GraphViewNavContext);
  const calledOut = useCollectionHoverTarget(id as string);
  // Hydrated collections derive their preview frames and total duration from
  // live children (like the count), so editing a loaded child refreshes this
  // card without a reload; placeholders fall back to their stored summary.
  const hydrated = detail?.hydrated === true;
  const enabledChildCount = useEnabledChildCount(id);
  // Audio has no frame, so a collection leading with it has no thumbnail to
  // show — see firstChildIsAudio.
  const leadsWithAudio = useFirstChildIsAudio(id);
  const liveSeconds = useHydratedCollectionSeconds(id as string, hydrated);

  // Both readouts are decided in graph-card-model, where they are unit-tested.
  const count = collectionCardItemCount({
    hydrated,
    enabledChildCount,
    storedItemCount: detail?.itemCount,
  });
  // VOUCHED, not merely hydrated — see `collectionSubtreeHydrated`. A card
  // whose branch is only partly loaded shows its item count and no time,
  // rather than a plausible number derived from stale stored summaries.
  const vouched = useCollectionSubtreeHydrated(id as string);
  const totalSeconds = collectionCardSeconds({ vouched, liveSeconds });
  const previews = useCollectionPreviewFrames(id as string, hydrated, detail?.previewItems);
  const displayName = title ?? node.name;
  const inheritedDisabled = useDisabledByAncestor(id);
  const filterMiss = useTagFilterMiss(id as string);
  const selectMode = useCollectionsSelector((s) => s.interaction.multiSelectMode);
  const muted = node.disabled === true || inheritedDisabled;
  // `muted` stays the "will not play" predicate — it drives the chip, the
  // hidden title, and the caption padding, none of which care WHY. Only the
  // dimming distinguishes the two reasons.
  const disabledVisuals = disabledVisualState({
    selfDisabled: node.disabled === true,
    inheritedDisabled,
  });
  // Anchor state is not read here any more: `CardCornerSlot` subscribes to it
  // itself, narrowed to this node, so an anchor moving between two OTHER cards
  // no longer re-renders this whole card body.

  return (
    <>
      {/* Interaction split: the surface (card body) SELECTS — like any clip —
          and drags; only the folder button below drills in. Selected cards
          can then be trashed with Delete alongside media. */}
      <CollectionItem.SelectionSurface
        dragActivation={dragActivation === "hold" ? "hold" : "body"}
        // STARTS WITH THE NAME, so a speech-input user saying what they see
        // ("Scenes") matches — the substance of WCAG 2.5.3 "Label in Name".
        //
        // Lighthouse's `label-content-name-mismatch` still flags this, and
        // deliberately not chased: the caption's spans carry no whitespace
        // between them, so axe compares against the concatenation
        // "Scenes1:29/1 item". Satisfying that literally means an accessible
        // name no one would want spoken. Two other routes were tried and are
        // worse — folding the duration in makes the name CHANGE when a branch
        // finishes loading (announced mid-read), and hiding the readouts from
        // assistive tech changes nothing, because an `aria-label` on a button
        // already replaces its content for AT.
        //
        // Announce the count the card actually SHOWS — the stored summary for a
        // placeholder, the live children once hydrated. The primitive's default
        // reads live childCount alone, which speaks "0 items" over a card
        // displaying "9" until its clips load.
        ariaLabel={`${displayName}, collection, ${count} ${count === 1 ? "item" : "items"}`}
        className={[
          // `relative` so the disabled chip below can pin to this card's own
          // top-right corner rather than some ancestor's.
          "relative flex h-full w-full flex-col justify-between overflow-hidden rounded-md border border-dashed border-sky-500/40 bg-sky-500/[0.08] p-1.5",
          selected ? "ring-2 ring-inset ring-blue-500" : "",
          rejected ? "ring-2 ring-red-500 motion-safe:animate-pulse" : "",
          // No `data-disabled` twin here: SelectionSurface takes an explicit
          // prop list with no rest spread, so a hyphenated attribute passed to
          // it is silently dropped — and TS does not flag it, because excess
          // property checks skip hyphenated JSX names. The marker classes below
          // are what tests and e2e can query on a collection card; the
          // inherited one gets its own so the two causes stay separable, the
          // way `data-disabled`'s values do on a media card.
          muted ? "is-disabled-card" : "",
          muted && node.disabled !== true ? "is-parent-disabled-card" : "",
          // PL10-001: the call-out lives ON the card because it SCALES the
          // card — a transform on the inset overlay this used to be would
          // animate nothing anyone can see. Same marker-class trick as the
          // disabled states above, and for the same reason.
          //
          // Toggling the class is also what restarts the one-shot. Moving
          // between folders drops it off one card and adds it to the next, so
          // the animation re-fires without a counter or a manual restart, and
          // re-entering the same folder replays it.
          calledOut ? "is-called-out-card" : "",
        ].join(" ")}
      >
        {muted && <DisabledChip inherited={node.disabled !== true} />}
        {/* A whole collection can sit under the picture too — every leaf
            inside it then plays underneath, however its own children are
            arranged. */}
        {/* The chip names the ROW a clip sits on, so it says nothing once the
            rows are off — and worse than nothing, since the number would point
            at a lane the board no longer draws. */}
        {LANE_TRACKS_ENABLED && laneOf(node) > 0 && <LaneChip lane={laneOf(node)} />}
        {/* Collections are taggable too — `tags` sits on TimelineItemBase, not
            on the media members — and they route through THIS component rather
            than GraphClipContent (which returns null for them at its guard).
            Skipping it here would ship a half-feature where a tagged
            collection silently shows nothing.

            NO tag row in the strip — see the note on the media card's, which
            this used to mirror. Collections keep theirs in the GRID caption
            (further down), so the two card kinds still file tags in the same
            place as each other. */}
        <span
          data-disabled-visuals={disabledVisualsAttr(disabledVisuals)}
          data-filter-miss={filterMiss ? "true" : undefined}
          // The SAME artwork marker the media card carries, so the grid's play
          // button lands on the picture here too. Without it the button fell
          // back to the cell's bottom, which on a collection is under the
          // name-and-count row — a play control sitting below the card it
          // belongs to.
          data-clip-artwork
          // `relative`, so the checkbox below anchors to the PREVIEW FRAMES
          // rather than to the whole card. Anchored to the card it landed on
          // the name-and-count row underneath and truncated it ("51.8s / 5
          // it…"), because that row is inside the selection surface too.
          className={[
            "relative flex min-h-0 flex-1 gap-0.5 overflow-hidden",
            // Same mapping as the media card — shared so the two kinds cannot
            // drift apart on the one rule this exists to distinguish.
            cardDimmingClass({ isDragSource, disabledVisuals, filterMiss }),
          ].join(" ")}
        >
          {/* Collections get the same checkbox as media, and they are the cards
              that need it most: a plain click drills INTO a collection now, so
              select mode is the only pointer route to picking one at all — and
              on hover this is the only thing that says so. */}
          <SelectionIndicator
            id={id}
            selected={selected}
            armed={selectMode}
          />
          {/* THE COLLECTION MARK, dead centre over the frames.
              A collection's frames are its children's pictures, so at a glance
              the card looks like the media inside it — the dashed border and
              the caption glyph both say "collection" at the EDGES, where the
              eye is not. This says it over the picture itself.

              Half-opacity on purpose: it has to be legible without hiding the
              frame it sits on, since the frame is how you recognise WHICH
              collection this is. `pointer-events-none` keeps the card's own
              click, drag and checkbox untouched, and it is `aria-hidden`
              because the surface's label already announces "collection".

              ON EVERY COLLECTION CARD, empty or not. It used to be gated on
              there being real frames, because the empty state drew an academy
              leader and two glyphs stacked in one centre read as a bug. That
              placeholder is a plain gradient now precisely so this mark can be
              the one thing saying "collection" — said once, and the same way,
              whether the card has frames behind it or nothing at all. */}
          <span
            data-collection-mark
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
          >
              {/* A disc behind the glyph, so the mark reads on ANY frame.
                  The glyph alone is white-on-whatever-the-children-are: over a
                  pale or busy frame the strokes break up, and the drop-shadow
                  under it only outlines them rather than giving them a ground.
                  The disc is that ground.

                  `bg-black/45`, up from the 0.25 it shipped at. The original
                  was tuned to darken the frame as little as possible, and it
                  went too far the other way: on a mid-tone frame the disc
                  barely registered, so the glyph was back to floating on the
                  picture with no ground. It is still an alpha well short of
                  opaque — the frame is how you recognise WHICH collection this
                  is, so it must read through.

                  A background-colour alpha, NOT `opacity` on the wrapper,
                  which would take the glyph down along with it (0.45 × its own
                  0.5). */}
            <span
              data-collection-badge
              // HALF STRENGTH WHILE SELECT MODE IS ON (PL16-012), back to full
              // when it ends.
              //
              // The badge names what the card IS, which is worth saying while
              // you are browsing and beside the point while you are picking —
              // then the question is which cards, and the badge is the loudest
              // thing on a collection sitting right where the eye is counting.
              //
              // ON THE WRAPPER, which the note above warns against — and the
              // warning is about doing it by ACCIDENT. It says an opacity here
              // "would take the glyph down along with it (0.45 x its own 0.5)",
              // and taking the whole badge down together is exactly the intent:
              // the disc is the glyph's ground, so fading one without the other
              // leaves strokes floating on a ring or a ring around nothing.
              // Compounding is the mechanism, not a side effect.
              className={[
                "rounded-full bg-black/45 p-2 motion-safe:transition-opacity motion-safe:duration-200",
                selectMode ? "opacity-50" : "opacity-100",
              ].join(" ")}
            >
              <Layers
                className="h-10 w-10 text-white opacity-50 drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]"
                strokeWidth={1.5}
              />
            </span>
          </span>
          {previews.length === 0 ? (
            <span
              data-empty-collection-preview
              data-collection-preview-kind={leadsWithAudio ? "audio" : "empty"}
              aria-hidden="true"
              className="flex flex-1 items-center justify-center overflow-hidden rounded-sm"
            >
              {/* A collection of voice takes gets the audio card's own glyph:
                  "this is sound" is a truer sentence there than "this is
                  empty", and it is the same mark an audio clip wears. */}
              {leadsWithAudio ? <AudioPlaceholder /> : <EmptyCollectionPlaceholder />}
            </span>
          ) : (
            previews.map((preview, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                // Key by the SLOT, not the content. `previews` is a
                // fixed-length, order-stable list; keying by `preview.id` both
                // collides (the same asset can be both the first and last
                // frame) AND remounts the <img> whenever a child edit changes
                // which clip is first — flashing an already-loaded frame. The
                // slot is the stable identity, so the element persists and only
                // its `src` swaps.
                key={index}
                src={collectionPreviewFrameUrl(preview)}
                alt=""
                draggable={false}
                // EAGER, because the grid is virtualized. `VirtualGrid` renders
                // only the rows at or near the viewport, so a card that exists
                // in the DOM has already been judged on-screen — `loading=lazy`
                // then defers a request the browser could have started, and
                // waits for layout to re-decide what virtualization just
                // decided. Below-the-fold cards are not lazy, they are absent.
                //
                // Measured: this element was the LCP on a board open, and its
                // request was queued at 1,495ms having taken 0.4ms to download.
                // The delay was discovery, not transfer.
                loading="eager"
                // Only the FIRST frame. All three are visible, but a hint that
                // marks everything high marks nothing — the leading frame is
                // the one that carries the card, and on the measured board it
                // was the LCP element.
                {...(index === 0 ? { fetchPriority: "high" as const } : {})}
                // INTRINSIC SIZE, so the browser can reserve the box before the
                // bytes arrive. CSS already fixes the rendered size (`h-full`,
                // `flex-1`), but with no width/height the element has no aspect
                // ratio until decode, and the trace attributed two layout
                // shifts to exactly that ("An unsized image"). 16:9 is what the
                // Cloudinary transform emits (w_640,h_360) — see
                // `collectionPreviewFrameUrl`.
                width={640}
                height={360}
                className="h-full min-w-0 flex-1 rounded-sm object-cover"
              />
            ))
          )}
        </span>
        <span
          data-collection-metadata
          // Whether this card's numbers come from LIVE children or from the
          // stored summary. The two look identical now that the placeholder's
          // "Open to load" text is gone (PL6-001 made the empty preview
          // icon-only), and hydration decides whether a drop into this
          // collection is legal at all — so the state needs to stay
          // observable to the drop-policy e2e that asserts on it.
          data-collection-hydrated={hydrated ? "true" : "false"}
          // The grid-scoped variants are what make the two surfaces read as
          // different objects rather than the same card wrapped. A grid cell is
          // boxy and tall (see ITEM_SIZE_DIMENSIONS) precisely so this row can
          // be a real caption; in the strip it stays a tight one-line footer,
          // because height there is pure overhead on every clip.
          className={[
            "mt-1.5 flex items-center justify-between gap-1.5 pl-1 pb-0.5",
            // GRID: no bottom padding, because this is no longer the caption's
            // last row — the tag row below carries the caption's bottom edge and
            // the 4px between the two. Left as-is in the STRIP, where this row
            // IS the footer and there is nothing under it.
            // `min-h-5` in the grid, matching CAPTION_ROW_CLASS on the media
            // card: row one is a text line tall whether or not it holds text,
            // so a nameless card is not shorter than a named one.
            "[[data-virtual-grid]_&]:mt-2.5 [[data-virtual-grid]_&]:min-h-5 [[data-virtual-grid]_&]:pl-1.5 [[data-virtual-grid]_&]:pb-0",
            muted ? "pr-[4.75rem]" : "pr-1 [[data-virtual-grid]_&]:pr-1.5",
          ].join(" ")}
        >
          {/* The KIND, as an icon leading the name — the same shape the media
              caption has ([icon] name), so the two card kinds read as one
              family instead of two. Grid only: the strip's footer is a tight
              one-liner where this would cost more than it says.

              A LABEL, not a control. The same Layers glyph used to sit in the
              card's top-right corner as a drill button; that button is gone
              (a plain click opens the collection now), and the glyph earns its
              place here by naming the card kind instead of duplicating the
              card's own gesture. Nothing about it should ever become clickable
              — the story below pins that. */}
          <Layers
            data-collection-kind
            aria-hidden="true"
            className="hidden size-4 shrink-0 text-zinc-400 [[data-virtual-grid]_&]:block"
          />
          <span
            // ONE CLICK RENAMES. The name already swallowed the click — it had
            // to, because a plain click on the card DRILLS IN, which unmounts
            // this card before a second click can land, and that is what broke
            // double-click-to-rename in the first place. So the click was being
            // caught and thrown away: the label's advertised gesture cost two
            // presses while one press did nothing at all. It now does the thing
            // the label is for.
            //
            // `stopPropagation` is still what makes it work — without it the
            // drill-in fires underneath and navigates away from the field that
            // just opened. React's synthetic bubbling never reaches the
            // surface's handler.
            onClick={(event) => {
              event.stopPropagation();
              rename.begin();
              // (keyboard: F2 on the focused card — see OpenKeyBoundary)
            }}
            title="Click or press F2 to rename"
            className={[
              "min-w-0 flex-1 cursor-text truncate text-xs font-semibold text-zinc-100",
              "[[data-virtual-grid]_&]:text-sm",
              // HOVER SAYS IT IS A FIELD. A one-click target that looks exactly
              // like static text is a trap in both directions: nobody discovers
              // the rename, and anyone aiming at the card is surprised by an
              // editor. The tint is the same shape the field itself takes, so
              // the hover reads as a preview of what the click opens.
              //
              // Negative margin against the padding, so the hit area grows
              // without the name shifting sideways on hover — and without it
              // taking width from the count beside it at rest.
              "-mx-1 rounded-sm px-1 transition-colors hover:bg-white/10",
            ].join(" ")}
          >
            {displayName}
          </span>
          <span className={CAPTION_META_CLASS}>
            {typeof totalSeconds === "number" && totalSeconds > 0 ? (
              <>
                <span className="text-sky-300/90" title="Total duration of contents">
                  {formatDuration(totalSeconds)}
                </span>
                <span aria-hidden="true" className="text-zinc-500">
                  /
                </span>
              </>
            ) : null}
            <span>
              {count} {count === 1 ? "item" : "items"}
            </span>
          </span>
        </span>
        {/* ROW TWO: the collection's tags, right-justified — the media card's
            second row exactly, from the same two constants.

            ALWAYS RENDERED in the grid, empty or not. It used to appear only
            when there were tags, which made a tagged collection taller than an
            untagged one sitting beside it. `data-collection-caption-tags` still
            carries the count, so a test can tell "no tags" from "no row".

            Grid-only, like everything else in this caption: the strip's footer
            is a tight one-liner with no room for a second row. */}
        <span
          aria-hidden="true"
          data-collection-caption-tags={detail?.tags?.length ?? 0}
          // `pt-1` is the media caption's `gap-1` written as padding: these two
          // rows are siblings on the selection surface rather than children of
          // one flex column (row one is the STRIP's footer too, so it cannot be
          // moved into a grid-only wrapper), and a gap needs a shared parent.
          // Same 4px either way — the stories measure the two captions against
          // each other rather than trusting that.
          className={[
            "hidden pt-1 pr-1.5 pb-1.5 pl-1.5",
            "[[data-virtual-grid]_&]:flex",
            CAPTION_TAG_ROW_CLASS,
          ].join(" ")}
        >
          {detail?.tags?.length ? (
            <CaptionTagRow tags={detail.tags} />
          ) : (
            <CaptionTagRowSpacer />
          )}
        </span>
      </CollectionItem.SelectionSurface>

      {/* The card's controls, in the top-right. Real buttons composed as
          SIBLINGS of the selection surface — a button inside the surface's
          button would be invalid HTML, which is why this is positioned rather
          than placed. Pointer-only: tabIndex -1 keeps roving views at one tab
          stop per item, keyboard drill-in stays on the O key (OpenKeyBoundary),
          and data-collections-keyboard-ignore excludes them from the strip's
          pan surface (isPannableStripSurface), so a press here never scrolls
          the strip out from under it.

          THE DRILL CONTROL IS GONE; the slot hosts only the anchor's `⋮`. It
          was the one pointer route into a collection back when a plain click
          SELECTED the card. The click opens it now — the whole card, not a
          28px corner — so the button was a second way to do the easy thing,
          sitting permanently over the artwork of every collection card. */}
      <CardCornerSlot nodeId={id} />

      {/* The rename editor — a REAL input, overlaying the label row while
          editing. A sibling of the surface, so it nests in no button. */}
      {rename.editing && (
        <InlineNameEditor
          initialValue={displayName}
          onInput={rename.setDraft}
          onCommit={rename.commit}
          onCancel={rename.cancel}
          className="absolute inset-x-2.5 bottom-2 z-20 rounded-sm bg-zinc-950/95 px-1 py-0.5 text-xs font-semibold text-zinc-100 outline-none ring-1 ring-blue-500/70"
        />
      )}

      <CollectionItem.DropIndicators />
    </>
  );
});

export const GraphCollectionItem = memo(function GraphCollectionItem({
  id,
  className,
  dragActivation = "body",
  rovingTabIndex,
}: CollectionItemShellProps) {
  return (
    <CollectionItem.Root
      id={id}
      rovingTabIndex={rovingTabIndex}
      className={[
        "group/collection-item h-full w-full",
        // PL10-003: the call-out's scale pushes the card ~7px past this
        // wrapper, and a transform that spills counts as SCROLLABLE overflow —
        // so calling out the last card in a strip or a grid row grew the
        // scroller and flashed a scrollbar for the length of the animation.
        //
        // `clip` (not `hidden`) makes this box swallow that overflow without
        // becoming a scroll container itself, and the clip margin is what keeps
        // it from being a cure worse than the disease: the card's own growth
        // (~7px) stays visible, and so do the drop-indicator bars, which sit
        // half a gap OUTSIDE the card by design.
        "overflow-clip [overflow-clip-margin:12px]",
        className ?? "",
      ].join(" ")}
    >
      <GraphCollectionItemParts dragActivation={dragActivation} />
    </CollectionItem.Root>
  );
});
