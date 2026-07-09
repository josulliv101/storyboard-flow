import { type FocusEvent, type CSSProperties, memo, useId, useRef, useEffect } from "react";
import { GripHorizontal } from "lucide-react";
import { Badge } from "../core/badge";
import { ToggleGroupItem } from "../core/toggle-group";
import {
  type TimelineItem,
  type CollectionId,
} from "./core/media-strip.types";
import {
  formatDuration,
  KEYBOARD_REORDER_INSTRUCTIONS,
} from "./core/media-strip.utils";
import {
  areEqual,
  type MediaStripItemAreEqualProps,
  DATA_VALUE_ATTR,
  DATA_REORDER_HANDLE_ATTR,
  isElementFullyVisibleInScrollArea,
} from "./media-strip.dom-utils";
import { encodeDndTarget } from "./core/media-strip.dnd";
import { MediaStripThumbnail } from "./media-strip-thumbnail";
import { useReorderKeyboard } from "./use-reorder-keyboard";
import {
  useMediaStripItemDropSide,
  useMediaStripItemNestState,
  useMediaStripItemRejected,
  useMediaStripItemIsActiveDragSource,
} from "./media-strip-drag-store";
import { MediaStripSortableItem } from "./media-strip-dnd-provider";
import { cn } from "../lib/utils";

// Stacking order of the overlays layered on top of an item card, lowest to
// highest. The reorder handle must stay above every visual cue so it's
// always clickable; the "drop here" indicator bars sit above the full-card
// nest overlay (they're mutually exclusive via `!isOverNest`, but the
// ordering documents intent). These are separate z-tiers, not adjacent
// values, to leave room to slot something between them later.
const Z_NEST_OVERLAY = "z-10";
const Z_DROP_INDICATOR = "z-20";
const Z_REORDER_HANDLE = "z-30";

type MediaStripItemButtonProps = MediaStripItemAreEqualProps & {
  collectionId: CollectionId;
};

export const MediaStripItemButton = memo(
  function MediaStripItemButton({
    item,
    style,
    thumbnailVariant,
    collectionId,
    index,
    isKeyboardReordering = false,
  }: MediaStripItemButtonProps) {
    const durationLabel = formatDuration(item.durationSeconds);
    const ariaLabel = `${item.name}, ${durationLabel} (Selectable item)`;
    // The handle's accessible NAME stays short; the item identity and the
    // long keyboard grammar go in an aria-describedby DESCRIPTION, announced
    // after the name and skippable. This distinguishes handles for a screen
    // reader user (they hear "Reorder … Beach Day. Use ArrowLeft/Right …"
    // rather than a wall of identical "Reorder handle") without duplicating
    // the item name into a second button *name* per item — which would both
    // read the name twice and make role-name queries ambiguous between the
    // card and its handle.
    const handleAriaLabel = isKeyboardReordering ? "Reorder, reorder mode active" : "Reorder";
    // aria-describedby points at the card's EXISTING name element plus a
    // shared instructions element — reusing the name node rather than
    // rendering the item name into a second text node, which would both
    // duplicate it in the a11y tree and make test text/role queries match
    // two elements.
    const nameId = useId();
    const instructionsId = useId();

    const handleRef = useRef<HTMLButtonElement>(null);

    // Per-item drag visuals come from selector subscriptions to the drag
    // store, NOT the whole drag state — so this card only re-renders when
    // ITS drop-indicator / nest-overlay / rejection slice changes on a drag
    // move, rather than on every move of any drag anywhere on the board.
    const dropSide = useMediaStripItemDropSide(item.id);
    const nestState = useMediaStripItemNestState(item);
    const isRejected = useMediaStripItemRejected(item.id);
    // Only ever true here for adapters that keep the drag source mounted
    // (native-html5); dnd-kit/pragmatic report isDragging and hit the
    // placeholder branch below before this is read.
    const isActiveDragSource = useMediaStripItemIsActiveDragSource(item.id);

    // "Drop here" line indicators — the selector already rules out the
    // dragged item itself and non-referenced items, so this is just the side.
    // "inside" (nesting) is conveyed by the nest overlay below instead.
    const isDropBeforeTarget = dropSide === "before";
    const isDropAfterTarget = dropSide === "after";

    const handleKeyDown = useReorderKeyboard({
      item,
      index,
      collectionId,
      isKeyboardReordering,
    });

    // Dnd Kit sortable setup
    const encodedId = encodeDndTarget({ type: "item", itemId: item.id });
    // nestState is "none" unless this collection card is the active nest
    // target (the selector bakes in the is-collection / not-self / hovered
    // guards), so it collapses the old showNestOverlay + isOverNest +
    // isInvalidCycle derivation — and only the hovered card re-renders.
    const isOverNest = nestState !== "none";
    const isInvalidCycle = nestState === "invalid";

    // Focus preservation on the reorder handle.
    useEffect(() => {
      if (isKeyboardReordering && handleRef.current) {
        handleRef.current.focus();
      }
    }, [isKeyboardReordering, item.id]);

    const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
      const element = event.currentTarget;

      // Look for the scroll area container to see if the element is already in view
      const scrollArea = element.closest("[data-scroll-area]");
      if (scrollArea instanceof HTMLElement) {
        if (isElementFullyVisibleInScrollArea(element, scrollArea)) {
          return;
        }
      }

      element.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    };

    return (
      <MediaStripSortableItem id={encodedId}>
        {({
          attributes,
          isDragging,
          listeners,
          setActivatorNodeRef,
          setNodeRef,
          transformStyle,
          transition,
        }) => {
          if (isDragging) {
            return (
              <div
                ref={setNodeRef}
                style={style}
                className="absolute bg-muted/20 border border-dashed border-muted-foreground/35 rounded-lg pointer-events-none"
              />
            );
          }

          // Combine absolute positions with sortable CSS translations.
          // When hovering over the nesting hotspot (isOverNest === true), we bypass
          // the sortable transform to keep the collection card at its original, stable visual position.
          const combinedStyle: CSSProperties = {
            ...style,
            transform: !isOverNest ? transformStyle : undefined,
            transition: transition || undefined,
          };

          // dnd-kit's `attributes` carries its own `aria-describedby` (its
          // generic "press space to pick up" DnD instructions). aria-describedby
          // is a space-separated id list, so merge rather than clobber: keep
          // the adapter's instructions AND add our item-identifying,
          // keyboard-grammar description. Native/pragmatic supply no such
          // attribute, so it's just ours there.
          const adapterDescribedBy = attributes["aria-describedby"];
          const mergedDescribedBy = [adapterDescribedBy, nameId, instructionsId]
            .filter(Boolean)
            .join(" ");

          const setHandleRefs = (element: HTMLButtonElement | null) => {
            handleRef.current = element;
            if (typeof setActivatorNodeRef === "function") {
              setActivatorNodeRef(element);
            }
          };

          return (
            <div
              ref={setNodeRef}
              style={combinedStyle}
              className="absolute group"
            >
              {/* Main selectable card */}
              <ToggleGroupItem
                aria-label={ariaLabel}
                className={cn(
                  // h-full (not h-auto): the card fills the absolutely-sized
                  // wrapper div, whose height comes from the virtualizer.
                  "flex-col items-stretch justify-start gap-2 whitespace-normal p-2 text-left w-full h-full data-pressed:border-primary data-pressed:bg-primary/5 transition-all border relative",
                  isKeyboardReordering && "ring-2 ring-primary border-primary bg-primary/5 shadow-md",
                  // Placeholder cue for the drag source when the adapter keeps
                  // it mounted (native-html5): dim it in place so it reads as
                  // "being moved", parallel to the empty-slot placeholder
                  // dnd-kit/pragmatic show. Dashed to echo that placeholder.
                  isActiveDragSource && "opacity-40 border-dashed",
                  // Brief visual cue for a rejected drop (e.g. an invalid
                  // nesting cycle) — the aria-live announcement already
                  // covers screen readers, this covers sighted users who
                  // would otherwise see the drag silently snap back.
                  isRejected && "ring-2 ring-destructive border-destructive animate-pulse"
                )}
                value={item.id}
                {...{ [DATA_VALUE_ATTR]: item.id }}
                {...(isActiveDragSource ? { "data-drag-source": "true" } : {})}
                {...(isRejected ? { "data-rejected": "true" } : {})}
                onFocus={handleFocus}
              >
                <MediaStripThumbnail item={item} variant={thumbnailVariant} />

                <span id={nameId} className="min-w-0 truncate text-xs font-medium text-foreground pr-4">
                  {item.name}
                </span>

                <Badge className="max-w-full self-start truncate" variant="secondary">
                  {durationLabel}
                </Badge>
              </ToggleGroupItem>


              {/* Visual Nest Feedback: covers the entire card, rendered only when dragging over the hotspot */}
              {isOverNest && (
                <div
                  className={cn(
                    "absolute inset-0 rounded-lg border-2 pointer-events-none flex items-center justify-center font-bold text-xs select-none",
                    Z_NEST_OVERLAY,
                    isInvalidCycle ? "border-destructive bg-destructive/15 text-destructive" : "border-primary bg-primary/15 text-primary"
                  )}
                >
                  <span className="bg-background/95 backdrop-blur-sm px-2 py-1 rounded shadow-md border text-[10px]">
                    {isInvalidCycle ? "Cannot drop (cycle)" : "Drop to Nest"}
                  </span>
                </div>
              )}

              {/* "Drop here" indicators: a thin bar on the side of the card the
                  dragged item would land on. Suppressed while the nest
                  overlay is showing, since "inside" always wins over
                  "before"/"after" (see resolveDropTargetInfo). */}
              {!isOverNest && isDropBeforeTarget && (
                <div
                  aria-hidden="true"
                  data-drop-indicator="before"
                  className={cn("absolute inset-y-1 -left-1.5 w-1 rounded-full bg-primary pointer-events-none", Z_DROP_INDICATOR)}
                />
              )}
              {!isOverNest && isDropAfterTarget && (
                <div
                  aria-hidden="true"
                  data-drop-indicator="after"
                  className={cn("absolute inset-y-1 -right-1.5 w-1 rounded-full bg-primary pointer-events-none", Z_DROP_INDICATOR)}
                />
              )}

              {/* Reorder Handle: SIBLING absolutely positioned on top, avoiding invalid HTML button nesting */}
              <button
                type="button"
                ref={setHandleRefs}
                data-dnd-handle="true"
                {...{ [DATA_REORDER_HANDLE_ATTR]: item.id }}
                aria-label={handleAriaLabel}
                className={cn(
                  "absolute top-1.5 left-1/2 -translate-x-1/2 p-0.5 rounded cursor-grab hover:bg-muted text-muted-foreground active:cursor-grabbing pointer-events-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm border shadow-sm",
                  Z_REORDER_HANDLE,
                  isKeyboardReordering && "opacity-100 bg-primary text-primary-foreground hover:bg-primary"
                )}
                {...attributes}
                {...listeners}
                // After the attribute spread so the merged value wins over
                // the adapter's own aria-describedby.
                aria-describedby={mergedDescribedBy}
                onKeyDown={handleKeyDown}
              >
                <GripHorizontal className="h-3.5 w-3.5" />
              </button>
              {/* Keyboard grammar as a description, referenced (together with
                  the card's name span above) from the handle's
                  aria-describedby — so the grammar isn't crammed into every
                  handle's accessible name. */}
              <span id={instructionsId} className="sr-only">
                {KEYBOARD_REORDER_INSTRUCTIONS}
              </span>
            </div>
          );
        }}
      </MediaStripSortableItem>
    );
  },
  areEqual
);

MediaStripItemButton.displayName = "MediaStripItemButton";
