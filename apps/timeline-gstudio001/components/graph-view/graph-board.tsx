"use client";

import { useContext, useDeferredValue, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { FolderPlus, Redo2, Settings, Undo2 } from "lucide-react";

import {
  CollectionsContainerContext,
  VirtualGrid,
  VirtualStrip,
  parseNodeId,
  useCollectionsSelector,
  useCollectionsStore,
} from "@storyboard/ui/dnd-collections";

import { flattenMediaOrder } from "@storyboard/timeline-domain";

import { formatDuration } from "@/lib/format-duration";
import { requestGraphToolInsert } from "@/lib/graph-view-events";
import { Button } from "@/components/core/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/core/dropdown-menu";
import { Slider } from "@/components/core/slider";

import { NativeDropGrid, NativeDropStrip, SidebarToolInsertBridge } from "./graph-native-drop";
import { VideoFrameLookAhead } from "./graph-item-content";
import { BreadcrumbDropZones, DragChromeFade } from "./graph-breadcrumb-drop";
import { OpenKeyBoundary } from "./graph-navigation";
import { SyncPanel, type SyncEntry } from "./graph-persistence";
import {
  GraphGridPlayhead,
  GraphPlayhead,
  GraphRuler,
  GraphSeekRails,
  FlatItemsProvider,
  GraphStripSeekRail,
  PreviewShell,
  collectionCardWidth,
  useFocusedTimelineAggregate,
  useSelectionAggregate,
  type PreviewTimeChannel,
} from "./graph-preview";
import { AddCollectionSlot } from "./graph-add-collection-slot";
import { CollectionHoverProvider } from "./graph-collection-hover";
import { ItemDetailsProvider } from "./graph-item-details-context";
import { GraphSaveStatus } from "./graph-save-status";
import { GraphShortcuts, requestGraphShortcuts } from "./graph-shortcuts";
import { GraphItemDetailsModal } from "./graph-item-details-modal";
import { SubTimelines } from "./graph-sub-timelines";
import {
  GRID_GAP,
  GRID_UNCAPPED_HEIGHT,
  GRAPH_STRIP_OVERSCAN_ITEMS,
  ITEM_SIZE_DIMENSIONS,
  ITEM_SIZES,
  MAX_SUBTREE_DEPTH,
  MAX_TIMELINE_PPS,
  MIN_TIMELINE_PPS,
  isItemSize,
  stepDownItemSize,
  type FocusSurface,
  type ItemSize,
} from "./graph-view-config";

export type { FocusSurface, ItemSize };

/**
 * The board's overflow menu. Deliberately a LIST OF LABELLED SECTIONS rather
 * than a size picker that happens to live in a popover: unrelated controls
 * land here next, so the size radio group is one section among future ones
 * and the menu itself knows nothing about sizing.
 */
function BoardMenu({
  itemSize,
  onItemSizeChange,
}: Readonly<{
  itemSize: ItemSize;
  onItemSizeChange: (size: ItemSize) => void;
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Board options"
          title="Board options"
          className="h-8 w-8 text-zinc-500 hover:text-zinc-200"
        >
          <Settings aria-hidden="true" className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => requestGraphShortcuts()}>
            Keyboard shortcuts
            <span className="ml-auto pl-6 font-mono text-[11px] text-zinc-500">?</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Thumbnail size</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={itemSize}
            onValueChange={(value) => {
              if (isItemSize(value)) onItemSizeChange(value);
            }}
          >
            {ITEM_SIZES.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {option.toUpperCase()}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The centre readout of the header row: normally the focused timeline's
 * aggregate, and — while anything is selected — what the SELECTION adds up
 * to instead. One slot, two answers: the selection is the more specific fact
 * about the same timeline, so it takes the same pixels rather than opening a
 * second readout the eye has to choose between. Clearing the selection puts
 * the timeline total straight back.
 *
 * The header's two wings (breadcrumb / controls) carry equal `flex-1`, so
 * this piece sits dead-centre and stays there; a long breadcrumb truncates
 * inside its own wing instead of pushing the centre around. Passive DATA on
 * purpose (the per-card badges show the same numbers), so hiding it on small
 * screens costs nothing.
 */
function FocusedAggregate({
  focusedId,
  pixelsPerSecond,
}: Readonly<{ focusedId: string; pixelsPerSecond: number }>) {
  const selection = useSelectionAggregate();
  const { count, seconds } = useFocusedTimelineAggregate(focusedId, pixelsPerSecond);

  if (selection.count > 0) {
    return (
      <span
        data-selection-summary
        className="hidden shrink-0 px-3 text-center font-mono text-[11px] tabular-nums text-amber-300/90 sm:block"
        title="Selected items"
      >
        {selection.count} selected · {formatDuration(selection.seconds)}
      </span>
    );
  }
  if (count === 0) return null;
  return (
    <span
      data-focused-aggregate
      className="hidden shrink-0 px-3 text-center font-mono text-[11px] tabular-nums text-zinc-400 sm:block"
      title="Focused timeline total"
    >
      {count} {count === 1 ? "clip" : "clips"} · {formatDuration(seconds)}
    </span>
  );
}

/**
 * Horizontal zoom. Lives in the header rather than the overflow menu because
 * it is an exploration tool, not a setting — you reach for it WHILE reading
 * the strip, to pull a sub-second clip open or squeeze a minute-long one into
 * view. Burying it behind a menu would cost a click per adjustment.
 */
function ScaleSlider({
  pixelsPerSecond,
  onChange,
}: Readonly<{
  pixelsPerSecond: number;
  onChange: (pixelsPerSecond: number) => void;
}>) {
  return (
    // Compact, label-less: the tooltip carries what it does AND the live
    // value (the slider's own aria-valuenow has it too) — the header row
    // earns back the label's width.
    <div
      className="flex w-24 shrink-0 items-center"
      title={`Timeline zoom — stretch or squeeze the strip's time scale (${Math.round(pixelsPerSecond)} px/s)`}
    >
      <Slider
        aria-label="Timeline scale"
        min={MIN_TIMELINE_PPS}
        max={MAX_TIMELINE_PPS}
        step={1}
        value={[pixelsPerSecond]}
        onValueChange={([next]) => onChange(next)}
      />
    </div>
  );
}

/**
 * Undo/redo as ICON buttons, matching the toolbar's other ghost icon controls
 * (preview, children) rather than the package's generic text-label
 * `UndoRedoControls`. App-local on purpose: the icon styling is this toolbar's
 * design, so it stays out of the framework-agnostic package — but the store
 * wiring (and best-effort announce) is exactly the package control's.
 */
function GraphUndoRedo() {
  const store = useCollectionsStore();
  const canUndo = useCollectionsSelector((s) => s.canUndo);
  const canRedo = useCollectionsSelector((s) => s.canRedo);
  const announce = useContext(CollectionsContainerContext)?.announce;

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo"
        onClick={() => {
          if (store.undo()) announce?.("Change undone.");
        }}
        className="h-8 w-8 text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
      >
        <Undo2 aria-hidden="true" className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo"
        onClick={() => {
          if (store.redo()) announce?.("Change redone.");
        }}
        className="h-8 w-8 text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
      >
        <Redo2 aria-hidden="true" className="h-4 w-4" />
      </Button>
    </div>
  );
}

/**
 * The Collection tool, relocated from the icon sidebar into the board header
 * (right cluster). Same two affordances it always had: CLICK (or keyboard)
 * appends a nested timeline to the open collection through the insert bridge,
 * and native DRAG carries it onto a strip to pick a POSITION. The default
 * browser drag image is suppressed (1×1 transparent gif) so only the strip's
 * own drop indicator shows where it will land.
 */
function GraphAddCollectionButton() {
  const handleDragStart = (event: React.DragEvent) => {
    // Same MIME the sidebar tool used, which NativeDropStrip/Grid accept.
    event.dataTransfer.setData("application/x-gstudio-type", "collection");
    event.dataTransfer.effectAllowed = "copy";
    const img = new window.Image();
    img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    event.dataTransfer.setDragImage(img, 0, 0);

    // The browser shows a "no-drop" cursor wherever a dragover handler doesn't
    // preventDefault — i.e. everywhere except directly over a strip/grid — so
    // the cursor flickers to no-drop as the pointer crosses the gaps between
    // them (and at the very start, up in the header). Claim EVERY dragover at
    // the document level for the drag's lifetime so the cursor stays a valid
    // "copy" throughout; the strips/grids still own the drop position and the
    // actual add. A matching document drop swallows a stray drop that misses
    // every strip so the browser takes no default action.
    const onDocDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDocDrop = (e: DragEvent) => {
      e.preventDefault();
    };
    const cleanup = () => {
      document.removeEventListener("dragover", onDocDragOver, true);
      document.removeEventListener("drop", onDocDrop, true);
      document.removeEventListener("dragend", cleanup);
    };
    // Capture before nested surfaces. Chromium can briefly expose an empty
    // `types` list while crossing DOM boundaries, so the drag-lifetime guard
    // must not depend on reading our MIME type back from each event.
    document.addEventListener("dragover", onDocDragOver, true);
    document.addEventListener("drop", onDocDrop, true);
    document.addEventListener("dragend", cleanup, { once: true });
  };

  return (
    <button
      type="button"
      draggable
      aria-label="Add Collection to the open timeline"
      title="New collection — click to append, drag onto a strip to place"
      onDragStart={handleDragStart}
      onClick={() => requestGraphToolInsert("collection")}
      className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/40 text-zinc-400 transition-colors hover:border-sky-500 hover:bg-sky-950/20 hover:text-sky-400 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      <FolderPlus aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

export function GraphBoard({
  projectId,
  focusedId,
  breadcrumb,
  surface,
  itemSize,
  onItemSizeChange,
  pixelsPerSecond,
  onPixelsPerSecondChange,
  previewOn,
  rulerOn,
  flatOn,
  childrenShown,
  timeChannel,
  trashRootId,
  syncEntries,
}: Readonly<{
  projectId: string;
  focusedId: string;
  /** Slot, not routing props: the board renders where you are without
   *  knowing how a route is shaped. */
  breadcrumb: React.ReactNode;
  /** Chosen in the SIDEBAR now (its grid/strip icons), not in this header. */
  surface: FocusSurface;
  itemSize: ItemSize;
  onItemSizeChange: (size: ItemSize) => void;
  pixelsPerSecond: number;
  onPixelsPerSecondChange: (pixelsPerSecond: number) => void;
  /** Toggled from the SIDEBAR's preview icon; the board only renders it. */
  previewOn: boolean;
  /** Toggled from the SIDEBAR's ruler icon (strip mode only). */
  rulerOn: boolean;
  /** Strip's flat mode: render the whole closure in order, not this
   *  collection's direct children. */
  flatOn: boolean;
  /** Toggled from the SIDEBAR's children icon; the board only renders it. */
  childrenShown: boolean;
  timeChannel: PreviewTimeChannel;
  trashRootId: string | null;
  syncEntries: readonly SyncEntry[];
}>) {
  const dims = ITEM_SIZE_DIMENSIONS[itemSize];
  // Developer telemetry (the SyncPanel below) is opt-in via a truthy `dev`
  // query param — `?dev=1`, `?dev=true`, … — so regular use never shows it
  // (R7 #1). Read here, not threaded from the page: the graph tree mounts
  // client-only (`ssr: false` in client-graph-view), so useSearchParams has
  // no prerender/Suspense implications.
  const devParam = useSearchParams().get("dev");
  const devPanelsOn = devParam !== null && !["", "0", "false"].includes(devParam);
  // Zoom splits urgency (round-4 polish item 8): the slider thumb must track
  // the pointer, so its value stays URGENT — while the expensive work a zoom
  // step triggers (strip relayout, ruler rebuild, per-card resize fan-out)
  // renders at this DEFERRED value, interruptible by the next slider step.
  // (Not startTransition on the onChange: that would defer the controlled
  // thumb itself, making the handle lag the pointer.) Every time→x consumer
  // below — strip, ruler, playheads, scrub bands, sub-rows — shares this ONE
  // deferred value, so their geometry can never disagree mid-drag.
  const deferredPixelsPerSecond = useDeferredValue(pixelsPerSecond);
  // FLAT mode's item source: every media node in the focused closure, in
  // playback order. Memoized on the committed graph's IDENTITY — the store
  // notifies for interaction too, and VirtualStrip keys its measurements off
  // this array, so a fresh one per notification would re-measure the whole
  // strip mid-drag. `undefined` when flat is off, which is what makes the
  // strip fall back to the focused collection's own children.
  const graph = useCollectionsSelector((s) => s.graph);
  // The ITEMS, not just their ids: the strip needs the ids, and every time
  // overlay needs each item's parent chain to look up its manifest span.
  const flatItems = useMemo(
    () =>
      flatOn ? flattenMediaOrder(graph, parseNodeId(focusedId), MAX_SUBTREE_DEPTH) : null,
    [flatOn, graph, focusedId],
  );
  const flatItemIds = useMemo(
    () => flatItems?.map((item) => item.nodeId),
    [flatItems],
  );

  return (
    <OpenKeyBoundary trashId={trashRootId}>
      {/* Spans the header AND the surfaces: the toolbar toggle sets the mode,
          the selected card's panel reads it. */}
      <ItemDetailsProvider>
      {/* Spans the surfaces AND the child rows below them, because the pairing
          it carries joins the two: a collection's card up here and its row
          down there light each other up on hover. Inert unless the children
          tree is actually shown — with it off there is no row to pair with. */}
      <CollectionHoverProvider enabled={childrenShown}>
      {/* Published ABOVE the preview shell so the header aggregate and every
          time overlay inside it measure the run actually on screen. */}
      <FlatItemsProvider items={flatItems}>
      <PreviewShell enabled={previewOn} focusedId={focusedId} channel={timeChannel}>
        {/* Outside the surface branch on purpose: the sidebar's tool buttons
            must insert in grid mode too, where no NativeDropStrip exists. */}
        <SidebarToolInsertBridge collectionId={focusedId} />
        {/* Also outside it (PL10-012): details are not a strip idea. A grid
            card has no trim handles, but it has a name, a duration, and
            whatever an item grows next — so it opens the same view. The modal
            portals to the body, so where it mounts only decides which
            providers it can see. */}
        <GraphItemDetailsModal />
        {/* The "?" sheet. Every gesture in this view is invisible otherwise —
            hold-to-drag, O, F2, the whole Alt layer (PL11-007). */}
        <GraphShortcuts />
        <div className="flex flex-col gap-2">
          {/* Pinned so the controls stay reachable while scrolling the
              surfaces. It sticks just BELOW the sticky preview via the offset
              the split pane publishes (0 when the preview is closed). The
              opaque background is load-bearing twice over: it reads as a
              toolbar, and it OCCLUDES the strip/grid scrolling underneath —
              which is what stops a playhead marker from bleeding up into the
              breadcrumb row. z-40 to sit ABOVE the strip's z-30 playhead
              overlay (z-20 was below it, so the marker bled through the
              header); it matches the sticky preview's z-40. The negative
              margins let that background span the card's full width past its
              p-4 padding. */}
          <div
            data-graph-board-header=""
            className="sticky z-40 grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 border-b border-zinc-800/70 bg-zinc-950/95 py-3 backdrop-blur-sm"
            style={{ top: "var(--workbench-preview-offset, 0px)" }}
          >
            {/* Seek thumbs are centered on the timeline edge and intentionally
                extend six pixels beyond it. Mask that overhang only while it
                passes behind this sticky row; clipping the board would also
                truncate the thumb once it is normally visible below. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-full w-2 bg-zinc-950"
              data-board-header-edge-occluder="start"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-full w-2 bg-zinc-950"
              data-board-header-edge-occluder="end"
            />
            {/* Equal-flex wings keep the aggregate at the row's true centre
                (under the transport's play cluster). min-w-0 lets a long
                breadcrumb truncate inside its wing. */}
            <div className="flex min-w-0 flex-1 items-center">{breadcrumb}</div>
            {/* Middle summary and the right-hand controls fade out under the
                drag readout that overlays this row, and fade back on drop. The
                breadcrumb stays — it IS the drop target. */}
            <DragChromeFade className="flex items-center">
              {/* One centre slot, two possible occupants. The save state takes
                  it while it has something to say and hands it back after —
                  the clip/duration total is a fact you can re-read at any
                  time, "not saved yet" is not. */}
              <GraphSaveStatus>
                <FocusedAggregate
                  focusedId={focusedId}
                  pixelsPerSecond={deferredPixelsPerSecond}
                />
              </GraphSaveStatus>
            </DragChromeFade>
            {/* flex-wrap + wrap-capable controls so a narrow viewport folds the
                toolbar onto a second line instead of pushing controls
                off-screen. No effect when it fits. */}
            <DragChromeFade className="flex min-w-0 items-center justify-end gap-2">
              {/* The Collection tool (moved here from the icon sidebar): the
                  view's one "add structure" action leads the cluster, fenced
                  off from the surface/history controls to its right. */}
              <GraphAddCollectionButton />
              <div aria-hidden="true" className="h-5 w-px shrink-0 bg-zinc-700" />
              {/* px/s is a strip-only axis: grid cells are sized by thumbnail
                  size, and the grid playhead ignores clip width, so the slider
                  is a no-op in grid mode. Hidden there (state is preserved, so
                  returning to strip restores the last zoom). */}
              {surface === "strip" ? (
                <>
                  <ScaleSlider
                    pixelsPerSecond={pixelsPerSecond}
                    onChange={onPixelsPerSecondChange}
                  />
                  <div aria-hidden="true" className="h-5 w-px shrink-0 bg-zinc-700" />
                </>
              ) : null}
              <GraphUndoRedo />
              <BoardMenu
                itemSize={itemSize}
                onItemSizeChange={onItemSizeChange}
              />
            </DragChromeFade>

            {/* The trash drop target (right side), shown only while a card is
                being dragged. The "move up a level" targets are the ancestor
                breadcrumb crumbs themselves (see GraphBreadcrumb). Inside the
                header so its absolute layer positions against it; inside the
                provider so its droppable joins the DndContext. */}
            <BreadcrumbDropZones trashId={trashRootId} />
          </div>

          {surface === "strip" ? (
            // The focused surface spans the card's FULL width (-mx-4 cancels
            // the card's p-4), so its edges line up with the full-bleed
            // breadcrumb bar above instead of sitting inset like a panel
            // nested under it. The focused surface is intentionally
            // edge-to-edge; padding here adds dead space around every side.
            <div
              data-focused-surface-shell="strip"
              className=""
            >
              <VideoFrameLookAhead>
                <NativeDropStrip collectionId={focusedId} projectId={projectId}>
              <VirtualStrip
                collectionId={parseNodeId(focusedId)}
                itemIds={flatItemIds}
                pixelsPerSecond={deferredPixelsPerSecond}
                overscan={GRAPH_STRIP_OVERSCAN_ITEMS}
                itemWidth={collectionCardWidth(deferredPixelsPerSecond, dims.strip)}
                itemHeight={dims.strip}
                // "One more, at the end of THIS timeline" — the sidebar tool
                // lands next to the selection, which is a different intent.
                // Flat mode has no single parent to append to, so no slot.
                trailingSlot={flatOn ? undefined : <AddCollectionSlot collectionId={focusedId} />}
                itemDragActivation="hold"
                // The package's floating overview draws the source at TIMELINE
                // scale, so its width grows with source duration — an 80s clip
                // ran three screens wide. This view shows a FITTED source map
                // inside the trim panel instead (PL10-004), composed with the
                // frame preview it used to only coincidentally line up with.
                trimOverview="off"
                overlay={
                  previewOn || rulerOn ? (
                    <>
                      {rulerOn ? (
                        <GraphRuler
                          focusedId={focusedId}
                          pixelsPerSecond={deferredPixelsPerSecond}
                          cardHeight={dims.strip}
                        />
                      ) : null}
                      {previewOn ? (
                        <GraphPlayhead
                          focusedId={focusedId}
                          channel={timeChannel}
                          pixelsPerSecond={deferredPixelsPerSecond}
                          cardHeight={dims.strip}
                        />
                      ) : null}
                    </>
                  ) : undefined
                }
                // pt-4: the 16px top band the seek rail centres in — same
                // clearance system as the grid's GRID_GAP row bands.
                className={[
                  "rounded-none border-0 bg-transparent p-0",
                  previewOn || rulerOn ? "pt-4" : "",
                ].join(" ")}
              />
              {/* The strip's scrub control — the same rail treatment as the
                  grid's, riding the strip's top padding band and scrolling
                  with the content; a drag held at the scroller's edge
                  auto-pans to reveal more items mid-scrub. Replaces the old
                  invisible PlayheadScrubBand. */}
              {previewOn && (
                <GraphStripSeekRail
                  focusedId={focusedId}
                  channel={timeChannel}
                  pixelsPerSecond={deferredPixelsPerSecond}
                  cardHeight={dims.strip}
                />
              )}
                </NativeDropStrip>
              </VideoFrameLookAhead>
            </div>
          ) : (
            // Grid scrubbing is the per-row SEEK RAILS layer — one slim
            // slider in the gap above each row (the video-player idiom, in
            // lockstep with the playhead line on every row), so cards keep
            // every pointerdown (the old full-cover surface ate them all —
            // R7 #5/#6/#7) and the in-grid playhead line stays a passive
            // indicator. The layer overlays the grid as a SIBLING (outside
            // NativeDropGrid, whose drop math measures its own wrapper, and
            // outside the aria-hidden overlay — rails are focusable). Same
            // gray panel as the strip branch, with no extra shell padding.
            <div
              data-focused-surface-shell="grid"
              className="relative"
            >
              <NativeDropGrid collectionId={focusedId} projectId={projectId}>
                <VirtualGrid
                  collectionId={parseNodeId(focusedId)}
                  cellWidth={dims.gridWidth}
                  cellHeight={dims.gridHeight}
                  gap={GRID_GAP}
                  height={GRID_UNCAPPED_HEIGHT}
                  // Mirror the strip: a quick tap is a CLICK (so the in-card
                  // drill button works) and a press-and-hold starts the reorder
                  // drag. "body" (the default) drags instantly, which ate the
                  // drill click and made drags ambiguous.
                  itemDragActivation="hold"
                  trailingSlot={<AddCollectionSlot collectionId={focusedId} />}
                  overlay={
                    previewOn ? (
                      <GraphGridPlayhead
                        focusedId={focusedId}
                        channel={timeChannel}
                        cellHeight={dims.gridHeight}
                        pixelsPerSecond={deferredPixelsPerSecond}
                      />
                    ) : undefined
                  }
                  // pt-4 = GRID_GAP: row 0's rail band matches the row gaps.
                  className={[
                    "rounded-none border-0 bg-transparent p-0",
                    previewOn ? "pt-4" : "",
                  ].join(" ")}
                />
              </NativeDropGrid>
              {previewOn && (
                <GraphSeekRails
                  focusedId={focusedId}
                  channel={timeChannel}
                  cellHeight={dims.gridHeight}
                  pixelsPerSecond={deferredPixelsPerSecond}
                />
              )}
            </div>
          )}

          {/* Children render one size step below the focused timeline (flat —
              every descendant is this one size, see stepDownItemSize). The
              FolderTree toggle unmounts them entirely rather than hiding with
              CSS, so their strips/grids and sub-row playheads leave the DOM.
              Flat mode belongs only to the FOCUSED surface above: child rows
              remain structured and must map their own cards onto the shared
              preview clock. Reset the outer flat run here so its item list
              cannot leak into every nested rail/playhead. */}
          {childrenShown && (
            <FlatItemsProvider items={null}>
              <SubTimelines
                projectId={projectId}
                focusedId={focusedId}
                surface={surface}
                itemSize={stepDownItemSize(itemSize)}
                pixelsPerSecond={deferredPixelsPerSecond}
                previewOn={previewOn}
                rulerOn={rulerOn}
                timeChannel={timeChannel}
              />
            </FlatItemsProvider>
          )}

          {/* Card-drag drop targets (trash + move-to-parent) live in the
              breadcrumb row now (see BreadcrumbDropZones in the header above),
              not a portal into the sidebar. */}
          {devPanelsOn && <SyncPanel entries={syncEntries} />}
        </div>
      </PreviewShell>
      </FlatItemsProvider>
      </CollectionHoverProvider>
      </ItemDetailsProvider>
    </OpenKeyBoundary>
  );
}
