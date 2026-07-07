import { type FocusEvent, type CSSProperties, memo, useRef, useEffect, useMemo } from "react";
import { GripHorizontal } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "../core/badge";
import { ToggleGroupItem } from "../core/toggle-group";
import {
  type TimelineItem,
  type CollectionId,
  isCollectionItem,
} from "./media-strip.types";
import {
  formatDuration,
  areEqual,
  type MediaStripItemAreEqualProps,
  DATA_VALUE_ATTR,
  DATA_REORDER_HANDLE_ATTR,
  isElementFullyVisibleInScrollArea,
  KEYBOARD_REORDER_INSTRUCTIONS,
} from "./media-strip.utils";
import { encodeDndTarget } from "./media-strip.dnd";
import { wouldCreateCollectionCycle } from "./media-strip.validation";
import { MediaStripThumbnail } from "./media-strip-thumbnail";
import { useReorderKeyboard } from "./use-reorder-keyboard";
import { useMediaStripBoardDrag, useMediaStripBoardStable } from "./media-strip-board";
import { cn } from "../lib/utils";

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
    const handleAriaLabel = isKeyboardReordering
      ? `Reorder mode active. ${KEYBOARD_REORDER_INSTRUCTIONS}`
      : "Reorder handle";

    const handleRef = useRef<HTMLButtonElement>(null);
    const { activeDragId, activeNestTargetId } = useMediaStripBoardDrag();
    const { collectionsById, itemLookup } = useMediaStripBoardStable();

    const handleKeyDown = useReorderKeyboard({
      item,
      index,
      collectionId,
      isKeyboardReordering,
    });

    // Dnd Kit sortable setup
    const encodedId = encodeDndTarget({ type: "item", itemId: item.id });
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: encodedId });

    const isCollection = item.kind === "collection";
    const isOverNest = isCollectionItem(item) && activeNestTargetId === item.collectionId;
    const showNestOverlay = isCollection && !!activeDragId && activeDragId !== item.id;

    const isInvalidCycle = useMemo(() => {
      if (!showNestOverlay || !activeDragId || !isCollectionItem(item)) return false;

      const foundSource = itemLookup?.get(activeDragId);
      const activeItem = foundSource?.item;
      if (activeItem && isCollectionItem(activeItem)) {
        return wouldCreateCollectionCycle({
          movingCollectionId: activeItem.collectionId,
          targetCollectionId: item.collectionId,
          collectionsById,
        });
      }
      return false;
    }, [showNestOverlay, activeDragId, item, collectionsById, itemLookup]);

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
      transform: (transform && !isOverNest) ? CSS.Transform.toString(transform) : undefined,
      transition: transition || undefined,
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
            "h-auto flex-col items-stretch justify-start gap-2 whitespace-normal p-2 text-left w-full h-full data-pressed:border-primary data-pressed:bg-primary/5 transition-all border relative",
            isKeyboardReordering && "ring-2 ring-primary border-primary bg-primary/5 shadow-md"
          )}
          value={item.id}
          {...{ [DATA_VALUE_ATTR]: item.id }}
          onFocus={handleFocus}
        >
          <MediaStripThumbnail item={item} variant={thumbnailVariant} />

          <span className="min-w-0 truncate text-xs font-medium text-foreground pr-4">
            {item.name}
          </span>

          <Badge className="max-w-full self-start truncate" variant="secondary">
            {durationLabel}
          </Badge>
        </ToggleGroupItem>


        {/* Visual Nest Feedback: covers the entire card, rendered only when dragging over the hotspot */}
        {showNestOverlay && isOverNest && (
          <div
            className={cn(
              "absolute inset-0 z-10 rounded-lg border-2 pointer-events-none flex items-center justify-center font-bold text-xs select-none",
              isInvalidCycle ? "border-destructive bg-destructive/15 text-destructive" : "border-primary bg-primary/15 text-primary"
            )}
          >
            <span className="bg-background/95 backdrop-blur-sm px-2 py-1 rounded shadow-md border text-[10px]">
              {isInvalidCycle ? "Cannot drop (cycle)" : "Drop to Nest"}
            </span>
          </div>
        )}

        {/* Reorder Handle: SIBLING absolutely positioned on top, avoiding invalid HTML button nesting */}
        <button
          type="button"
          ref={handleRef}
          data-dnd-handle="true"
          {...{ [DATA_REORDER_HANDLE_ATTR]: item.id }}
          aria-label={handleAriaLabel}
          className={cn(
            "absolute top-1.5 left-1/2 -translate-x-1/2 p-0.5 rounded cursor-grab hover:bg-muted text-muted-foreground active:cursor-grabbing z-30 pointer-events-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm border shadow-sm",
            isKeyboardReordering && "opacity-100 bg-primary text-primary-foreground hover:bg-primary"
          )}
          {...attributes}
          {...listeners}
          onKeyDown={handleKeyDown}
        >
          <GripHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  },
  areEqual
);

MediaStripItemButton.displayName = "MediaStripItemButton";
