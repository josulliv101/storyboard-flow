"use client";

import { memo, useCallback, useState } from "react";
import { Image as ImageIcon, Music, Video } from "lucide-react";

import {
  mediaDurationSeconds,
  useCollectionsSelector,
  videoFrameCount,
  type CollectionItemContentProps,
} from "@storyboard/ui/dnd-collections";

import { disabledVisualState, disabledVisualsAttr } from "@/lib/disabled-visuals";
import { formatDuration } from "@/lib/format-duration";
import { videoFrameUrls } from "@/lib/video-frame-url";

import { useClipDetail } from "./graph-details-context";
import { useTagFilterMiss } from "./graph-tag-filter";
import { TrimPanel } from "./graph-trim-panel";
import { AudioPlaceholder } from "./graph-card-placeholders";
import {
  DisabledChip,
  LaneChip,
  LiveDurationPill,
  ProvenanceLabel,
  SELECT_HOVER_REVEAL_MEDIA,
  SelectionIndicator,
} from "./graph-card-badges";
import {
  CAPTION_META_CLASS,
  CAPTION_ROW_CLASS,
  CAPTION_TAG_ROW_CLASS,
  CaptionTagRow,
  CaptionTagRowSpacer,
} from "./graph-card-caption";
import { cardDimmingClass } from "./graph-card-dimming";
import { cardVideoFrameCount, laneOf } from "./graph-card-model";
import { useElementSize, useSettledFrameCount } from "./graph-card-measure";
import { useVideoFrameLoading } from "./graph-card-frame-loading";
import { useCardProvenance, useDisabledByAncestor } from "./graph-card-derivations";

/** Never sample more than this many frames for one card, however wide. */
const VIDEO_FRAME_CAP = 16;

/**
 * The MEDIA card's pixels, registered as the provider's `ItemContent`.
 *
 * Collections don't render through this seam: their card carries interactive
 * controls (drill-in, inline rename) which cannot legally nest inside
 * NodeCard's `<button>`, so the registered ItemShell routes them to the
 * composed `GraphCollectionItem` instead.
 */
export const GraphClipContent = memo(function GraphClipContent({
  id,
  node,
  selected,
  rejected,
  isDragSource,
  trimEnabled,
}: CollectionItemContentProps) {
  // Card geometry for the video filmstrip's frame count. Frame count follows
  // the card's WIDTH (roughly one ~square frame per card height), SETTLED so
  // a continuous zoom drag doesn't re-sample the whole filmstrip at every
  // integer-ratio crossing — computed above the early return because the
  // settle hook must run unconditionally.
  const [cardSizeRef, cardSize] = useElementSize();
  // Which SURFACE this card is being drawn in, read from the container's own
  // `[data-virtual-grid]` marker rather than passed down.
  //
  // Deliberately the same mechanism the CSS uses (`[[data-virtual-grid]_&]:…`
  // all over this file). The card renderer is shared by both surfaces and has
  // no idea which one it is in; threading a prop just to change a frame count
  // would put a layout concern into the item contract, and the two surfaces
  // would then have two different ways of answering the same question.
  const [inGrid, setInGrid] = useState(false);
  const surfaceRef = useCallback((element: HTMLElement | null) => {
    setInGrid(element !== null && element.closest("[data-virtual-grid]") !== null);
  }, []);
  // One element, two callback refs — React takes a single ref per element, so
  // they are composed here rather than by giving the node two attributes.
  const cardRef = useCallback(
    (element: HTMLElement | null) => {
      cardSizeRef(element);
      surfaceRef(element);
    },
    [cardSizeRef, surfaceRef],
  );
  const measuredFrames =
    cardSize.height > 0 ? Math.round(cardSize.width / cardSize.height) : 0;
  const settledFrames = useSettledFrameCount(measuredFrames);
  // Above the collection early-return below — hooks may not be conditional.
  const inheritedDisabled = useDisabledByAncestor(id);
  // A filter MISS is a SEPARATE state from disabled, so it gets its own signal
  // and its own treatment (opacity only): `opacity-45 grayscale` is already
  // disabled's language, and a card that is both must still read as both.
  const filterMiss = useTagFilterMiss(id as string);
  // Select mode, for the checkbox below.
  const selectMode = useCollectionsSelector((s) => s.interaction.multiSelectMode);
  const provenance = useCardProvenance(id);
  const frameLoading = useVideoFrameLoading();
  // The AUTHORED name, read straight from the side table rather than from
  // `node.name`: the node's name falls back to the derived alt, so it can't
  // tell "named by someone" from "named by the file system".
  const detail = useClipDetail(id as string);
  // Which lane this plays in. Read from the NODE: lane and placement moved
  // there when they became a command, which is what makes them undoable.
  const lane = laneOf(node);

  // MEDIA pixels only. This guard is defensive: nothing in the graph view
  // reaches it with a collection node.
  if (node.kind === "collection") return null;

  const isVideo = node.mediaKind === "video";
  const isAudio = node.mediaKind === "audio";
  const muted = node.disabled === true || inheritedDisabled;
  // `muted` stays the "will not play" predicate — it drives the chip, the
  // hidden title, and the caption padding, none of which care WHY. Only the
  // dimming distinguishes the two reasons.
  const disabledVisuals = disabledVisualState({
    selfDisabled: node.disabled === true,
    inheritedDisabled,
  });
  // A wider STRIP clip shows MORE distinct frames rather than the same still
  // tiled — falling back to a duration-based count until first measured. The
  // rule is in graph-card-model, where it is unit-tested.
  const frames = cardVideoFrameCount({
    isVideo,
    inGrid,
    settledFrames,
    fallbackFrames: videoFrameCount(mediaDurationSeconds(node), 6),
    cap: VIDEO_FRAME_CAP,
  });
  // Each video frame is sampled at its own time across the visible clip (R6
  // #6); an image is just its one src.
  const frameSrcs =
    node.mediaKind === "video"
      ? videoFrameUrls(node.posterSrcs ?? [], frames, {
          trimInSeconds: node.trimInSeconds,
          effectiveSeconds: mediaDurationSeconds(node),
        })
      : // Audio yields NO frame srcs. Its `src` is a media file, and the
        // fallthrough below would hand it to an <img> — a broken-image icon on
        // every audio card. It renders a drawn placeholder instead.
        isAudio || !node.src
        ? []
        : [node.src];
  // CAPTION values (grid only — see the caption span at the end of the card).
  const KindIcon = isVideo ? Video : isAudio ? Music : ImageIcon;
  // ONLY a real, authored name — no fallback.
  //
  // This used to fall back to the KIND ("Image", "Video", "Audio") on the
  // reasoning that a caption whose first line can be empty reads as broken.
  // That was the wrong trade: it put a word on every unnamed card, in the
  // name's own typography, that said nothing the leading kind icon was not
  // already saying — so an unnamed card read as though it had been named
  // "Image". PL11-004 keeps `detail.title` absent until someone actually names
  // a clip, precisely so a library of filenames does not look like a rename
  // backlog, and inventing a name here undid that.
  //
  // The row does NOT collapse when this is null: the kind icon still holds the
  // line, so an unnamed card's caption stays on the same grid as a named one's
  // and as a collection's.
  const captionName = detail?.title ?? null;
  const captionSeconds = Number(mediaDurationSeconds(node)) || 0;
  return (
    <span
      ref={cardRef}
      className={[
        // p-1.5 on BOTH surfaces: the artwork is inset like the collection
        // card's (its frame + label row keep its pixels off the card edges),
        // so media and collections read as the SAME height and the artwork
        // stays clear of the seek rail riding above — the strip's rail has
        // the identical adjacency, so full-bleed pressed into it there too.
        // The card's outer box (and so width = duration) is unchanged.
        "relative flex h-full w-full overflow-hidden rounded-md bg-zinc-900 p-1.5",
        // GRID STACKS: artwork on top, a real caption underneath — the shape
        // the grid cell was already sized for (see ITEM_SIZE_DIMENSIONS, which
        // made grid cells tall and boxy for exactly this) and the shape the
        // collection card has always had. The strip stays one artwork box: a
        // caption row there is fixed overhead on every clip, and clip width is
        // duration, so a narrow clip has no room for one anyway.
        "[[data-virtual-grid]_&]:flex-col",
        selected ? "ring-2 ring-inset ring-blue-500" : "ring-1 ring-white/15",
        rejected ? "ring-2 ring-red-500 motion-safe:animate-pulse" : "",
        // Disabled reads as MUTED, never as missing: the card keeps its slot
        // and its full width (its duration still shapes the board), it just
        // stops looking like content that plays.
        //
        // Inherited disabling looks IDENTICAL — a viewer sees neither — and
        // only the chip distinguishes them.
      ].join(" ")}
      // Distinct VALUES so e2e can assert which cause is in play; both are
      // truthy for "this card is muted".
      data-disabled={node.disabled ? "true" : inheritedDisabled ? "inherited" : undefined}
    >
      {/* THE ARTWORK BOX — the frame, plus anything that belongs ON the frame
          rather than on the card.

          It exists to be a positioning context that is not also the dimmed one.
          In the grid this box stops filling the card (the caption below takes
          the rest), so anything anchored to the CARD's bottom would sit over
          the caption; anchored here it stays on the picture, which is what it
          means. And keeping the dimming on the inner span means the selection
          checkbox does not fade with the artwork — a filter miss drops the
          frame to opacity-30, and a checkbox that went with it would make the
          selection unreadable exactly while someone is picking through a
          filtered board. */}
      <span className="relative flex h-full min-h-0 w-full overflow-hidden rounded-sm [[data-virtual-grid]_&]:flex-1">
        <span
          data-disabled-visuals={disabledVisualsAttr(disabledVisuals)}
          data-filter-miss={filterMiss ? "true" : undefined}
          className={[
            "flex h-full w-full overflow-hidden rounded-sm",
            // The precedence chain — shared with the collection card, so the
            // two kinds cannot drift apart on the one rule that distinguishes
            // them. See graph-card-dimming.
            cardDimmingClass({ isDragSource, disabledVisuals, filterMiss }),
          ].join(" ")}
        >
          {frameSrcs.length === 0 ? (
            isAudio ? (
              <AudioPlaceholder />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[11px] text-zinc-500">
                No preview
              </span>
            )
          ) : (
            <span className="flex h-full w-full overflow-hidden rounded-sm">
              {frameSrcs.map((src, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={index}
                  src={src}
                  alt=""
                  draggable={false}
                  // The virtual strip itself is the loading boundary: only the
                  // visible cards plus its bounded look-ahead are mounted. Start
                  // those frames immediately so a fast horizontal pan cannot
                  // outrun the browser's native lazy-load distance.
                  loading={frameLoading}
                  decoding="async"
                  className="h-full min-w-0 flex-1 border-r border-black/60 object-cover last:border-r-0"
                />
              ))}
            </span>
          )}
        </span>
        {/* Bottom-RIGHT of the ARTWORK, opposite the duration, so the two never
            contend for a corner. Shown on muted cards too: a disabled clip is
            still something you might be gathering up to delete.

            ALWAYS RENDERED. Select mode pins it on; otherwise it is revealed
            by hover, on hover-capable devices only. Rendering it unconditionally
            is what lets CSS own that, so no pointer state has to reach React —
            a hover that re-rendered every card would land on the drag/INP hot
            path. */}
        <SelectionIndicator
          id={id}
          selected={selected}
          armed={selectMode}
          revealOnHover={SELECT_HOVER_REVEAL_MEDIA}
        />
      </span>
      {/* Kind tag (R6 #7): a WORD, bottom-left. The glyph version (a 4px film
          or picture icon in the top corner) was ambiguous at small item sizes
          — the two lucide marks read as the same smudge — so it says which it
          is. Bottom-left pairs it with the duration pill on the right without
          either covering the artwork's centre. Decorative for AT (the card's
          own label names the clip). */}
      <span
        aria-hidden="true"
        data-media-kind={isVideo ? "video" : isAudio ? "audio" : "image"}
        // Hidden in the GRID, where the kind is the caption's leading icon
        // instead. A word stamped on the artwork and an icon under it would say
        // the same thing twice, and the word is the one that costs picture.
        className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] leading-none font-semibold tracking-[0.08em] text-zinc-100 [[data-virtual-grid]_&]:hidden"
      >
        {isVideo ? "VIDEO" : isAudio ? "AUDIO" : "IMAGE"}
      </span>
      {/* NO tag row in the strip. Tags are a GRID idea: they live in the
          caption, under the artwork, on both card kinds.

          They used to be stamped over the picture here, folded by a pair of
          card-width thresholds. A strip clip's width IS its duration, so which
          tags a clip showed depended on how long it was — two cards with the
          same tags disagreed about them, and a short clip covered most of its
          own frame to say so. */}
      {/* The clip's NAME, shown only when someone gave it one (PL11-004).
          Every clip has an `alt` — a filename, usually — so a card that
          rendered "the name" would render something on all of them, and a
          library of two thousand machine-named clips reads as a rename
          backlog. Decorative for AT: the card's own aria-label already names it. */}
      {detail?.title && !muted && (
        <span
          aria-hidden="true"
          data-clip-title
          // Hidden in the GRID: the caption below carries the name there, which
          // is the whole point of giving the cell room for one. Stamping it on
          // the artwork as well would cover the picture to repeat the line
          // directly beneath it.
          className="pointer-events-none absolute inset-x-2 top-2 z-10 truncate rounded bg-black/75 px-1.5 py-0.5 text-[11px] leading-tight font-semibold text-zinc-100 [[data-virtual-grid]_&]:hidden"
        >
          {detail.title}
        </span>
      )}
      {muted && <DisabledChip inherited={node.disabled !== true} />}
      {/* Lane 0 is the picture and says nothing; anything above it is a
          placement worth announcing on the card. */}
      {lane > 0 && <LaneChip lane={lane} />}
      {provenance && (
        <ProvenanceLabel
          parentId={provenance.parentId}
          name={provenance.name}
          shifted={lane > 0}
        />
      )}
      {trimEnabled && !muted && <LiveDurationPill id={id} node={node} />}
      {/* The live trim frame (video only): the source at the edge being
          dragged, floated into the header band for the length of the gesture.
          Rides the same per-node live-trim channel as the pill. Its other
          half, the source map, is docked under the strip by the board. */}
      {trimEnabled && <TrimPanel id={id} node={node} />}
      {/* THE CAPTION — grid only, and the point of the whole restructure.
          Everything here used to be stamped ON the artwork: the name across the
          top, the kind bottom-left, the tags stacked above it. That is right in
          the strip, where a card is as wide as its clip is long and every pixel
          of height is charged to every row. In the grid the cell is already
          tall and boxy for this, so the picture gets to be a picture and the
          words get a line of their own.

          Two rows, following the design: identity first (what is this), then
          data (how long, how filed). Decorative for AT — NodeCard's button
          already names the card. */}
      <span
        aria-hidden="true"
        data-clip-caption
        // Metrics MATCH the collection caption's grid values — 6px right, 6px
        // bottom, 10px above (`pt-2.5` against its `mt-2.5`). They were
        // 4px/2px/2px/8px here, so a grid mixing the two card kinds showed two
        // different left edges and two name positions.
        //
        // The left is `7px`, NOT 6, and the odd pixel is the point. A
        // collection card's surface carries a real 1px dashed border, and a
        // border consumes layout under `border-box` where this card's `ring`
        // does not — so an identical 6px padding still lands a pixel to the
        // left of a collection's. This makes up the difference at the caption,
        // which is where the alignment is visible.
        //
        // Deliberately NOT solved by giving this card a matching transparent
        // border: that aligns the caption by moving the card's whole content
        // box, which shifts the artwork and everything positioned off it — it
        // moved the floating trim frame a pixel and the e2e caught it.
        //
        // If either side is retuned, retune both. The alignment is the
        // contract, not the individual numbers, and the stories measure it.
        className="hidden min-w-0 flex-col gap-1 pt-2.5 pr-1.5 pb-1.5 pl-[7px] [[data-virtual-grid]_&]:flex"
      >
        {/* ROW ONE: kind, name, metadata — the collection card's shape. */}
        <span className={CAPTION_ROW_CLASS}>
          {/* `size-4` AND lucide's default stroke, both matching the collection
              caption's Layers glyph.

              The size was the visible half: at `size-3.5` the two icon boxes
              differed by 2px, so every name in a mixed grid started at one of
              two x positions. The WEIGHT was the quieter half — this carried
              `strokeWidth={1.7}` against Layers' default 2, so at identical
              size the media glyph still drew a lighter line than the collection
              beside it. Same size, same weight, same colour: the two card kinds
              lead their captions with one glyph style. */}
          <KindIcon aria-hidden="true" className="size-4 shrink-0 text-zinc-400" />
          {/* Omitted, not blanked, when the clip has no authored name — see
              `captionName`. The icon holds the row's height and left edge, and
              the metadata's `ml-auto` holds its right edge, so the row keeps
              its shape whether or not there is a name between them. */}
          {captionName === null ? null : (
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100">
              {captionName}
            </span>
          )}
          {/* The duration, trailing right — where a collection's count sits. It
              used to head row two, which put a number under the name on media
              and beside it on collections. */}
          <span className={CAPTION_META_CLASS}>
            {captionSeconds > 0 ? (
              <span className="text-sky-300/90" title="Duration">
                {formatDuration(captionSeconds)}
              </span>
            ) : null}
          </span>
        </span>
        {/* ROW TWO: tags, right-justified — and PRESENT even when empty, so a
            tagged card and an untagged one are the same height. See
            CAPTION_TAG_ROW_CLASS. */}
        <span data-clip-caption-tag-row className={`flex ${CAPTION_TAG_ROW_CLASS}`}>
          {detail?.tags?.length ? (
            <CaptionTagRow tags={detail.tags} />
          ) : (
            <CaptionTagRowSpacer />
          )}
        </span>
      </span>
    </span>
  );
});
