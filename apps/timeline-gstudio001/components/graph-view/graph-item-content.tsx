"use client";

import { memo } from "react";

import {
  NodeCard,
  useCollectionsSelector,
  type CollectionItemShellProps,
  type CollectionsComponents,
} from "@storyboard/ui/dnd-collections";

import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";
import { GraphItemContextMenu } from "./graph-item-context-menu";
import { ClipCornerSlot } from "./graph-anchor-menu";
import { useClipDetail } from "./graph-details-context";
import { useCardClipboardState } from "./graph-card-derivations";
import { useElementSize } from "./graph-card-measure";
import { GraphClipContent } from "./graph-clip-card";
import { GraphCollectionItem } from "./graph-collection-card";
import { GraphGhost } from "./graph-card-ghost";
import { GraphTrimHandle, GraphTrimOverviewContent } from "./graph-card-trim";

/**
 * THE GRAPH'S CARD REGISTRY — the dispatcher, and nothing else.
 *
 * This file used to be the whole card system (2,273 lines: two card bodies,
 * the ghost, the trim slots, eight store subscriptions, and every chip and
 * placeholder they share). #281 split it apart; what stays here is the part
 * that could not move — the shell that decides WHICH card kind renders, and
 * the `CollectionsComponents` table the provider is configured with.
 *
 * The pieces, and where to look:
 *
 *   graph-card-model          the pure decisions (unit-tested)
 *   graph-card-derivations    every useSyncExternalStore subscription
 *   graph-card-measure        useElementSize / useSettledFrameCount
 *   graph-card-frame-loading  the eager/lazy look-ahead context
 *   graph-card-dimming        the shared disabled/filter-miss class ladder
 *   graph-card-placeholders   audio glyph, film leader, ghost glyph
 *   graph-card-badges         disabled chip, provenance label, duration pill,
 *                             selection checkbox
 *   graph-card-caption        the grid caption's two rows
 *   graph-clip-card           the MEDIA card's pixels
 *   graph-collection-card     the composed COLLECTION card
 *   graph-card-ghost          the drag ghost
 *   graph-card-trim           the trim handle and overview slots
 */

/**
 * The media card: the stock NodeCard, wrapped so a corner control and a
 * rename editor can sit BESIDE it. The wrapper carries the surface's sizing
 * className and the hover group; NodeCard fills it.
 *
 * The editor is a sibling for the reason everything else here is: NodeCard's
 * shell is a `<button>`, and an `<input>` inside it is invalid interactive
 * content. Naming a run of similar clips is arrow → F2 → type → Enter →
 * arrow, with no modal in the loop (PL11-005) — the same grammar the
 * collection card, breadcrumb and sub-timeline row already share.
 */
const GraphMediaItem = memo(function GraphMediaItem({
  className,
  ...props
}: CollectionItemShellProps) {
  const node = useCollectionsSelector((s) => s.graph.nodesById.get(props.id) ?? null);
  // (A per-card `selectedIds` subscription lived here to drive the amber
  // selected-badge, which was a SIBLING of NodeCard's shell because a span
  // inside the card's `<button>` would still be inside a button. The badge is
  // gone and the marks that replaced it live inside the card, where NodeCard
  // already knows its own selection — so this shell no longer subscribes at
  // all, and a selection change on the board re-renders one card fewer.)
  const detail = useClipDetail(props.id as string);
  // Seeded with the AUTHORED title when there is one, so re-naming edits what
  // the user wrote rather than making them delete a filename first.
  const rename = useInlineRename(props.id, detail?.title ?? "", "card");
  // A clip's width is its DURATION, so this card can be 12px across. The corner
  // control is measured against that (see ClipCornerSlot) — the one place v3
  // still cares how wide a card is, and it answers with "render it or don't"
  // rather than with a fold ladder.
  const [sizeRef, size] = useElementSize();

  return (
    <div ref={sizeRef} className={["group/media-item relative", className ?? ""].join(" ")}>
      <NodeCard {...props} className="h-full w-full" />
      {/* A clip has no chevron to morph, so the `⋮` simply fades in (R5.6).
          No chevron is added here for symmetry. */}
      <ClipCornerSlot nodeId={props.id} width={size.width} />
      {rename.editing && node?.kind === "media" && (
        <InlineNameEditor
          initialValue={detail?.title ?? ""}
          onInput={rename.setDraft}
          onCommit={rename.commit}
          onCancel={rename.cancel}
          ariaLabel="Clip name"
          className="absolute inset-x-1 top-1 z-30 rounded-sm bg-zinc-950/95 px-1 py-0.5 text-[11px] font-semibold text-zinc-100 outline-none ring-1 ring-blue-500/70"
        />
      )}
    </div>
  );
});

/**
 * The graph's per-item renderer (registered as the provider `ItemShell`):
 * media keeps the stock NodeCard shell (its content is presentational, so the
 * single-button card is exactly right); collections get the composed card,
 * which carries real interactive controls and so cannot nest in that button.
 * The kind subscription is a primitive, so the dispatcher re-renders only if a
 * node changes kind — which never happens after creation.
 */
const GraphItemShell = memo(function GraphItemShell(props: CollectionItemShellProps) {
  const isCollection = useCollectionsSelector(
    (s) => s.graph.nodesById.get(props.id)?.kind === "collection",
  );
  const { pendingCut, flashing } = useCardClipboardState(props.id);
  // Merged into the content root's own class rather than painted here: the
  // shell is a transparent interaction layer and all pixels belong to the
  // content, which is also the only element in this chain with a box — the
  // wrapper below is `display: contents` so the strip's width measurements
  // cannot see it.
  const className = [
    props.className ?? "",
    // Cut, not yet pasted: still here, still yours, visibly waiting (R9.9).
    pendingCut ? "opacity-50" : "",
    // Just arrived from a paste. `transition-shadow` is what makes it FADE
    // rather than blink out when the flash store clears — Tailwind's ring is a
    // box-shadow, so the same transition covers both ends.
    "transition-shadow duration-500 motion-reduce:transition-none",
    flashing ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-950" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // The right-click menu wraps at the SHELL (PL14-007), which is the one place
  // both card kinds pass through — so collections and media get it from a
  // single wiring rather than each content component growing its own.
  return (
    <GraphItemContextMenu nodeId={props.id}>
      {/* `display: contents`, for the same reason the context-menu trigger is:
          this sits inside a virtualized strip that measures item widths, and an
          extra layout box would change them. It exists to carry the state as an
          ATTRIBUTE — the classes above say how it looks, this says what it is,
          which is what a test can ask about. */}
      <span
        className="contents"
        data-card-pending-cut={pendingCut ? "true" : undefined}
        data-card-just-pasted={flashing ? "true" : undefined}
      >
        {isCollection ? (
          <GraphCollectionItem {...props} className={className} />
        ) : (
          <GraphMediaItem {...props} className={className} />
        )}
      </span>
    </GraphItemContextMenu>
  );
});

export const GRAPH_VIEW_COMPONENTS: CollectionsComponents = {
  ItemContent: GraphClipContent,
  ItemShell: GraphItemShell,
  TrimHandleContent: GraphTrimHandle,
  OverviewContent: GraphTrimOverviewContent,
  GhostContent: GraphGhost,
};
