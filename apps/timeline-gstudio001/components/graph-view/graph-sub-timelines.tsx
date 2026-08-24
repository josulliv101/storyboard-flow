"use client";

import { useMemo, useRef, useState } from "react";
import { Folder, FolderOpen, Layers, ListTree } from "lucide-react";

import {
  VirtualGrid,
  VirtualStrip,
  getChildren,
  parseNodeId,
  useCollectionsSelector,
  useCollectionsStore,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";

import { AddCollectionSlot } from "./graph-add-collection-slot";
import { useCollectionHoverSource } from "./graph-collection-hover";
import { useClipDetail, useGraphDetailsStore, useTimelineTitle } from "./graph-details-context";
import { VideoFrameLookAhead } from "./graph-card-frame-loading";
import {
  useCollectionPreviewFrames,
  useEnabledChildCount,
  useFirstChildIsAudio,
} from "./graph-card-derivations";
import { AudioPlaceholder, EmptyCollectionPlaceholder } from "./graph-card-placeholders";
import { collectionPreviewFrameUrl } from "@/lib/video-frame-url";
import { hydrateTimeline } from "./graph-hydration";
import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";
import { NativeDropGrid } from "./graph-native-drop-grid";
import { NativeDropStrip } from "./graph-native-drop-strip";
import {
  subTimelineRowStatus,
  subTimelineRowStatusLabel,
} from "./graph-sub-timeline-status";
import {
  GraphGridPlayhead,
  GraphPlayhead,
  GraphRuler,
  GraphWaveformBand,
  GraphSeekRails,
  GraphStripSeekRail,
  collectionCardWidth,
  usePreviewCardSpans,
  type PreviewTimeChannel,
} from "./graph-preview";
import { usePreviewSettled } from "@storyboard/ui/timeline/viewport/workbench-display-surface";
import {
  GRID_GAP,
  GRID_UNCAPPED_HEIGHT,
  GRAPH_STRIP_OVERSCAN_ITEMS,
  GRAPH_STRIP_TRACK_CLASS,
  ITEM_SIZE_DIMENSIONS,
  MAX_SUBTREE_DEPTH,
  SUBTIMELINE_INDENT_PX,
  SUBTIMELINE_PANEL_RIGHT_INSET_PX,
  type FocusSurface,
  type ItemSize,
} from "./graph-view-config";

/**
 * The focused collection's direct COLLECTION child ids.
 *
 * The subscription is the raw children array, which the reducer shares
 * structurally: its identity survives every change that doesn't touch THIS
 * collection's children, so the selector returns a stable reference (what
 * `useCollectionsSelector` requires) without allocating.
 *
 * This used to subscribe to `ids.join(",")` and rebuild the list with
 * `split(",")`. That worked only for ids containing no comma — but the core
 * explicitly allows ANY non-whitespace string as a `NodeId` (see graph.ts),
 * so an id like `client,a` would have been torn into two ids that address
 * nothing. Nothing in the app mints such an id today, which is precisely why
 * it would have failed the first time some other id source did.
 *
 * The kind filter reads the store WITHOUT subscribing to it, which is sound
 * because a node's `kind` is fixed for its lifetime — no command changes it
 * (`update-media` only rewrites media fields), so this derivation is a pure
 * function of the children array it is keyed on.
 */
function useCollectionChildIds(collectionId: NodeId): readonly NodeId[] {
  const store = useCollectionsStore();
  const children = useCollectionsSelector((snapshot) =>
    getChildren(snapshot.graph, collectionId),
  );
  return useMemo(
    () =>
      children.filter(
        (childId) => store.getSnapshot().graph.nodesById.get(childId)?.kind === "collection",
      ),
    [children, store],
  );
}

/** One collection row in the sub-graph tree: collapsed by default, expands to
 *  lazy-hydrate its clips then reveal its strip AND its own collection children
 *  as further-indented rows (recursively). */
function SubTimelineNode({
  projectId,
  collectionId,
  depth,
  surface,
  itemSize,
  pixelsPerSecond,
  previewOn,
  rulerOn,
  waveformOn,
  timeChannel,
}: Readonly<{
  projectId: string;
  collectionId: NodeId;
  depth: number;
  surface: FocusSurface;
  itemSize: ItemSize;
  pixelsPerSecond: number;
  previewOn: boolean;
  rulerOn: boolean;
  waveformOn: boolean;
  timeChannel: PreviewTimeChannel;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const spans = usePreviewCardSpans();
  const id = collectionId as string;

  // This row shows a playhead only when the pane is on the manifest (spans
  // present) AND the clock actually visits this collection (it has a window).
  // On the projection fallback a sub-row's local times don't line up with the
  // global clock, so the marker would lie — better absent for that ~2.5s.
  const clockWindow = spans?.get(id);
  // GATED ON SETTLED, NOT ON ASKED-FOR (PL15-023).
  //
  // `previewOn` flips the instant the toggle is pressed, and the pane then
  // takes the reveal to slide open — so this drew the playhead over a preview
  // that was not on screen yet, a readout of something you cannot see.
  //
  // `usePreviewSettled` ALREADY EXISTED and is already published to the board
  // by context (`settled = mounted && revealed && !sliding`) — the pane's own
  // chrome waits on the same flag, for the same reason: "controls for a thing
  // that is not there yet while the pane is still opening". Nothing needed to
  // be plumbed; this was one condition looking at the wrong flag.
  //
  // It is false through a CLOSE as well, which is right here even though the
  // pane's chrome deliberately rides the close down: a playhead is a position
  // in a picture, and there is no picture to be a position in once it is on
  // its way out.
  const previewSettled = usePreviewSettled();
  const showPlayhead = previewOn && previewSettled && clockWindow !== undefined;
  const dims = ITEM_SIZE_DIMENSIONS[itemSize];

  const [expanded, setExpanded] = useState(false);
  // "Attempted and failed" flag: hydration has several paths that leave the
  // details store un-hydrated permanently (document fetch failed, spec build
  // refused, store rejected). Those report to the global banner but left THIS
  // row stuck on "loading…". `attemptRef` fences stale resolutions so a slow
  // failed attempt can't flip a newer, still-in-flight expand back to failed.
  const [failed, setFailed] = useState(false);
  const attemptRef = useRef(0);

  // Primitive subscriptions only (see useCollectionChildIds). The display
  // name is the gateway document title (source of truth), with the graph node
  // name as a fallback until the document is cached.
  const nodeName = useCollectionsSelector(
    (snapshot) => snapshot.graph.nodesById.get(collectionId)?.name ?? id,
  );
  const name = useTimelineTitle(id) ?? nodeName;
  const rename = useInlineRename(collectionId, name, "sub-row");
  const hoverSource = useCollectionHoverSource(collectionId as string);
  const detail = useClipDetail(id);
  const hydrated = detail?.hydrated === true;
  // ENABLED children only — this row says what the timeline contributes, so
  // it has to agree with the time totals and the served summary rather than
  // counting clips that are skipped.
  const liveCount = useEnabledChildCount(collectionId);
  // The same frame the card shows; empty until an un-hydrated row loads.
  const previewFrames = useCollectionPreviewFrames(id, hydrated, detail?.previewItems);
  // A collection of voice takes gets the audio glyph rather than the empty
  // gradient, exactly as its card does — see the thumbnail below.
  const leadsWithAudio = useFirstChildIsAudio(collectionId);
  const childIds = useCollectionChildIds(collectionId);
  const status = subTimelineRowStatus({ expanded, hydrated, failed });

  const toggle = () => {
    if (!expanded && !hydrated) {
      // Clear any prior failure for this fresh attempt, then hydrate. The store
      // subscription re-renders this node once the children land; the body is
      // gated on `hydrated` until then. If the attempt finishes WITHOUT
      // hydrating (see graph-hydration's failure paths), flip the row to a
      // "failed" badge instead of leaving it on "loading…" forever. Setting
      // state from the resolved promise (not an effect) keeps clear of the
      // repo's react-hooks/set-state-in-effect rule.
      setFailed(false);
      const attempt = ++attemptRef.current;
      void hydrateTimeline(store, detailsStore, id)
        .catch(() => undefined)
        .then(() => {
          if (attempt !== attemptRef.current) return; // superseded by a newer expand
          if (detailsStore.get(id)?.hydrated !== true) setFailed(true);
        });
    }
    setExpanded((current) => !current);
  };

  return (
    // Each timeline is its OWN gray panel (header + surface in one box) —
    // the storyboard view's idiom, adopted so every strip reads as one
    // distinct area; nested rows nest panels, echoing the hierarchy.
    <section
      aria-label={`Sub-timeline: ${name}`}
      className="min-w-0 rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3"
    >
      {/* THE WHOLE BAR OPENS IT (PL15-010), not just the folder.
          A 20px folder button was the only way to expand a row whose header is
          most of the width of the board.

          NOT A `<button>` AROUND THE ROW. It contains a button, and while
          renaming it contains an `<input>` — nested interactive elements are
          invalid and take the keyboard behaviour of both with them. So the
          click lives on the container and the FOLDER stays the one accessible
          control, with `aria-expanded` on it. This adds a pointer target, not
          a second tab stop.

          THE NAME IS EXCLUDED, and it is the one exception worth arguing.
          Double-clicking it renames, so a row that toggled on single click
          would fire on the first click of every rename — expanding the row,
          which HYDRATES it (a fetch), then collapsing it again on the second.
          The end state would be right and the flash and the request would not.
          Everything else in the header is fair game.

          Hover moves here with the click. The call-out that lights this
          collection's card lived on the folder alone; a bar that opens from
          anywhere should light the card from anywhere, or it answers "which
          card is this" in a smaller region than it answers "press me". */}
      <div
        className="mb-1.5 flex cursor-pointer items-center gap-2 rounded transition-colors hover:bg-zinc-800/40"
        onClick={toggle}
        onPointerEnter={hoverSource.onPointerEnter}
        onPointerLeave={hoverSource.onPointerLeave}
      >
        {/* Tree elbow. Nesting is otherwise carried only by the panels'
            indentation, which reads as "inset boxes" rather than "branches";
            the corner in front of the folder names the relationship. Drawn
            with borders on an empty box rather than as a glyph so it lines up
            with the folder's optical centre at any font size, and given a
            fixed width so the header's other columns — name, badges, and the
            preview frames' shared right-hand column — do not move. */}
        <span
          aria-hidden="true"
          data-subtimeline-elbow
          className="-mr-0.5 -mt-2 h-2.5 w-2 shrink-0 rounded-bl-[3px] border-b border-l border-zinc-700"
        />
        <button
          type="button"
          aria-label={expanded ? "Collapse" : "Expand"}
          aria-expanded={expanded}
          // STOPS PROPAGATING, or the row's own handler toggles it straight
          // back: this button is inside the clickable header now, so one press
          // would run `toggle` twice and the row would appear inert.
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-sky-400 transition-colors hover:bg-zinc-800 hover:text-sky-300"
        >
          {expanded ? (
            <FolderOpen aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Folder aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
        {rename.editing ? (
          // Wrapped so a click inside the editor cannot reach the row's
          // toggle. Clicking to place a caret while renaming must not collapse
          // the thing being renamed.
          <div className="min-w-0 flex-1" onClick={(event) => event.stopPropagation()}>
            <InlineNameEditor
              initialValue={name}
              onInput={rename.setDraft}
              onCommit={rename.commit}
              onCancel={rename.cancel}
              className="w-full rounded border border-sky-500/60 bg-zinc-900 px-1.5 py-0.5 text-sm font-semibold text-zinc-100 outline-none"
            />
          </div>
        ) : (
          <h3
            onDoubleClick={rename.begin}
            // The exception to the clickable row — see the header's note. A
            // single click here must not toggle, because the first click of a
            // rename double-click is a single click.
            onClick={(event) => event.stopPropagation()}
            title="Double-click to rename"
            className="cursor-text truncate text-sm font-semibold text-zinc-100"
          >
            {name}
          </h3>
        )}
        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
          {hydrated ? liveCount : (detail?.itemCount ?? 0)} clips
        </span>
        {status !== "idle" && (
          <span
            className={
              status === "failed"
                ? "shrink-0 rounded border border-red-700/60 px-1.5 py-0.5 text-[11px] text-red-400"
                : "shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-500"
            }
          >
            {subTimelineRowStatusLabel(status)}
          </span>
        )}
        <span className="grow" />
        {/* DECORATIVE only — no drill-in. This row's affordance is the folder
            toggle, which opens the timeline in place; a second control that
            navigated away was answering a question the row does not ask. These
            frames just say WHICH timeline the row is, which a name alone does
            not when you are scanning a nested tree.
            
            aria-hidden and not focusable, so the row's accessible surface is
            still exactly its toggle and its name.

            The frames butt directly together and fill the box — no gap, no
            backing colour showing through as a gutter — and the box is sized
            to the row's full header height rather than sitting inside it.

            Same first/last pair the card shows, from one shared hook: the row
            is the tree view of the very cards beside it, so two derivations of
            "what this timeline looks like" would drift in plain sight. */}
        <span
          aria-hidden="true"
          data-subtimeline-thumbs
          // A RING, NOT A BORDER (PL15-011). A border would add to the box and
          // shift this thumbnail off the vertical column the negative margin
          // below exists to hold it on; a ring paints outside and takes no part
          // in layout. Same reason the drop zones wear one.
          className="relative flex h-10 w-[72px] shrink-0 overflow-hidden rounded-sm bg-zinc-950/60 ring-1 ring-white/15"
          // Cancel the right inset this row's ANCESTOR panels impose, so every
          // preview in the tree lands on one vertical line however deeply the
          // row is nested. Without it each level shifted the frames 13px left
          // and the column read as ragged. The frames deliberately overhang
          // the nested panels' right edges to get there — that is the point:
          // they belong to the column, not to the panel they sit in.
          style={{ marginRight: -(depth * SUBTIMELINE_PANEL_RIGHT_INSET_PX) }}
        >
          {previewFrames.length === 0 ? (
            /* THE CARD'S OWN EMPTY STATES, not a flat tint (PL15-011).
               This box's `bg-zinc-950/60` used to be all you saw when a
               collection had no frame — a flat wash that reads at 40px like
               the card's gradient and is not it. Mirroring the card means
               using the card's placeholders, so the two cannot drift.

               INCLUDING THE AUDIO ONE. A collection of voice takes draws the
               audio glyph on its card because "this is sound" is truer there
               than "this is empty"; drawing the gradient here would make the
               same collection read as empty in the tree and as audio on the
               board, which is the exact disagreement this item exists to
               close. */
            <span
              data-subtimeline-thumb-kind={leadsWithAudio ? "audio" : "empty"}
              className="flex h-full w-full"
            >
              {leadsWithAudio ? <AudioPlaceholder /> : <EmptyCollectionPlaceholder />}
            </span>
          ) : (
            previewFrames.map((frame, index) => (
              // Keyed by SLOT, not content: the same asset can appear more than
              // once, so a content key would collide AND remount an
              // already-loaded frame on every child edit.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={index}
                src={collectionPreviewFrameUrl(frame)}
                alt=""
                draggable={false}
                loading="lazy"
                className="h-full min-w-0 flex-1 object-cover"
              />
            ))
          )}
          {/* THE COLLECTION MARK, as the card wears it (PL15-011).
              On the card this says "container, not clip" over the artwork, and
              it is drawn whether or not there are frames behind it — said once,
              the same way, either way. The row is the tree view of those very
              cards, so it says it too.

              ITS OWN SCALE. The card's mark is a 40px glyph in a `p-2` disc,
              which is the whole height of this 40px box. A 16px glyph in a
              `p-1` disc is the same object one size down.

              THE DISC IS NOT DECORATION. A bare glyph is white on whatever the
              children happen to be, and over a pale or busy frame the strokes
              break up; the disc is its ground. `bg-black/45` as a BACKGROUND
              alpha rather than `opacity` on the wrapper, which would take the
              glyph down with it — and the glyph keeps its own half opacity so
              the frame still reads through, because the frame is how you
              recognise WHICH collection this is. */}
          <span
            data-subtimeline-collection-mark
            className="pointer-events-none absolute inset-0 grid place-items-center"
          >
            <span className="rounded-full bg-black/45 p-1">
              <Layers
                className="size-4 text-white opacity-50 drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]"
                strokeWidth={1.5}
              />
            </span>
          </span>
        </span>
      </div>

      {expanded && hydrated && (
        // Indent the body so the strip's left edge lines up with the LABEL
        // (past the folder icon), and nested rows nest structurally under it.
        // The indent sits here, NOT on the NativeDropStrip wrapper (its drop
        // math is clientX-vs-own-rect; padding there would drift the indicator).
        <div
          className="flex min-w-0 flex-col gap-3"
          style={{ paddingLeft: SUBTIMELINE_INDENT_PX }}
        >
          {surface === "grid" ? (
            // Grid mode now accepts native drops too (a NativeDropGrid),
            // matching the strip. Scrubbing is this timeline's per-row SEEK
            // RAILS layer — its windows sit inside the shared clock, so
            // pressing a rail SUMMONS the playhead into this timeline;
            // cards keep every pointerdown and the in-grid line is a
            // passive indicator.
            <div className="relative min-w-0">
              <NativeDropGrid collectionId={id} projectId={projectId}>
                <VirtualGrid
                  collectionId={collectionId}
                  cellWidth={dims.gridWidth}
                  cellHeight={dims.gridHeight}
                  gap={GRID_GAP}
                  height={GRID_UNCAPPED_HEIGHT}
                  trailingSlot={<AddCollectionSlot collectionId={id} />}
                  overlay={
                    showPlayhead ? (
                      <GraphGridPlayhead
                        focusedId={id}
                        channel={timeChannel}
                        cellHeight={dims.gridHeight}
                        pixelsPerSecond={pixelsPerSecond}
                        activeWindow={clockWindow}
                      />
                    ) : undefined
                  }
                  // pt-4 = GRID_GAP: row 0's rail band matches the row gaps.
                  className="bg-black/20 pt-4"
                />
              </NativeDropGrid>
              {showPlayhead && (
                <GraphSeekRails
                  focusedId={id}
                  channel={timeChannel}
                  cellHeight={dims.gridHeight}
                  pixelsPerSecond={pixelsPerSecond}
                  ariaLabel={`Seek preview in ${name}`}
                />
              )}
            </div>
          ) : (
            <VideoFrameLookAhead>
              <NativeDropStrip collectionId={id} projectId={projectId}>
              <VirtualStrip
                collectionId={collectionId}
                pixelsPerSecond={pixelsPerSecond}
                overscan={GRAPH_STRIP_OVERSCAN_ITEMS}
                itemWidth={collectionCardWidth(pixelsPerSecond, dims.strip)}
                itemHeight={dims.strip}
                trailingSlot={<AddCollectionSlot collectionId={id} />}
                itemDragActivation="hold"
                overlay={
                  showPlayhead || rulerOn || waveformOn ? (
                    <>
                      {rulerOn ? (
                        <GraphRuler
                          focusedId={id}
                          pixelsPerSecond={pixelsPerSecond}
                          cardHeight={dims.strip}
                        />
                      ) : null}
                      {waveformOn ? (
                        <GraphWaveformBand
                          focusedId={id}
                          pixelsPerSecond={pixelsPerSecond}
                          cardHeight={dims.strip}
                        />
                      ) : null}
                      {showPlayhead ? (
                        <GraphPlayhead
                          focusedId={id}
                          channel={timeChannel}
                          pixelsPerSecond={pixelsPerSecond}
                          cardHeight={dims.strip}
                          activeWindow={clockWindow}
                        />
                      ) : null}
                    </>
                  ) : undefined
                }
                // pt-4: the 16px top band the seek rail centres in.
                //
                // The same TRACK the focused strip uses (PL13-010), replacing a
                // `bg-black/20` wash that went the wrong way — a sub-row read as
                // a DARKER hole in the board rather than as a surface holding
                // clips. A strip is a strip wherever it appears.
                className={`${GRAPH_STRIP_TRACK_CLASS} pt-4`}
              />
              {showPlayhead && (
                <GraphStripSeekRail
                  focusedId={id}
                  channel={timeChannel}
                  pixelsPerSecond={pixelsPerSecond}
                  cardHeight={dims.strip}
                  ariaLabel={`Seek preview in ${name}`}
                />
              )}
              </NativeDropStrip>
            </VideoFrameLookAhead>
          )}

          {depth + 1 < MAX_SUBTREE_DEPTH &&
            childIds.map((childId) => (
              <SubTimelineNode
                projectId={projectId}
                key={childId as string}
                collectionId={childId}
                depth={depth + 1}
                surface={surface}
                itemSize={itemSize}
                pixelsPerSecond={pixelsPerSecond}
                previewOn={previewOn}
                rulerOn={rulerOn}
                waveformOn={waveformOn}
                timeChannel={timeChannel}
              />
            ))}
        </div>
      )}
    </section>
  );
}

export function SubTimelines({
  projectId,
  focusedId,
  surface,
  itemSize,
  pixelsPerSecond,
  previewOn,
  rulerOn,
  waveformOn,
  timeChannel,
}: Readonly<{
  projectId: string;
  focusedId: string;
  surface: FocusSurface;
  itemSize: ItemSize;
  pixelsPerSecond: number;
  previewOn: boolean;
  rulerOn: boolean;
  waveformOn: boolean;
  timeChannel: PreviewTimeChannel;
}>) {
  const childIds = useCollectionChildIds(parseNodeId(focusedId));
  // Rendering nothing here made the sidebar's children toggle look broken:
  // "the feature is on and this timeline has none" was indistinguishable from
  // "the button did nothing". Only the TOP-LEVEL surface says so — repeating
  // it under every childless nested row would be noise, and nested rows go
  // through SubTimelineNode, which never reaches this branch.
  if (childIds.length === 0) {
    return (
      <div
        data-subtimelines-empty
        className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 px-3 py-3"
      >
        {/* The same mark the sub-timeline rows would be hanging off, so the
            empty state reads as the tree itself rather than a notice. */}
        <ListTree aria-hidden="true" className="h-4 w-4 shrink-0 text-zinc-500" />
        <p className="text-sm font-medium text-zinc-300">No child timelines</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {childIds.map((collectionId) => (
        <SubTimelineNode
          projectId={projectId}
          key={collectionId as string}
          collectionId={collectionId}
          depth={0}
          surface={surface}
          itemSize={itemSize}
          pixelsPerSecond={pixelsPerSecond}
          previewOn={previewOn}
          rulerOn={rulerOn}
          waveformOn={waveformOn}
          timeChannel={timeChannel}
        />
      ))}
    </div>
  );
}
