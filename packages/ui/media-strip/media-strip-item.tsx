import { type FocusEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, memo, useRef, useEffect } from "react";
import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "../core/badge";
import { ToggleGroupItem } from "../core/toggle-group";
import { type TimelineItem, type TimelineItemId, type MediaStripMove } from "./media-strip.types";
import { formatDuration, areEqual, type MediaStripItemAreEqualProps } from "./media-strip.utils";
import { MediaStripThumbnail } from "./media-strip-thumbnail";
import { useMediaStripBoard } from "./media-strip-board";
import { cn } from "../lib/utils";

type MediaStripItemButtonProps = MediaStripItemAreEqualProps & {
  stripId: string;
  onMoveItem?: (details: MediaStripMove) => void;
};

export const MediaStripItemButton = memo(
  function MediaStripItemButton({
    item,
    style,
    thumbnailVariant,
    stripId,
    onMoveItem,
    items,
    isKeyboardReordering = false,
  }: MediaStripItemButtonProps) {
    const durationLabel = formatDuration(item.durationSeconds);
    const ariaLabel = `${item.name}, ${durationLabel} (Selectable item)`;
    const handleAriaLabel = isKeyboardReordering
      ? "Reorder mode active. Use Arrow Left/Right to reorder, Arrow Up/Down to move between strips, Home/End to skip to edges, Escape or Space to exit."
      : "Reorder handle";

    const handleRef = useRef<HTMLButtonElement>(null);

    const {
      startKeyboardReorder,
      cancelKeyboardReorder,
      confirmKeyboardReorder,
      getAdjacentStripId,
      itemsByStripId,
      announce,
    } = useMediaStripBoard();

    // Dnd Kit sortable setup
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: item.id });

    // Focus preservation on the reorder handle
    useEffect(() => {
      if (isKeyboardReordering && handleRef.current) {
        handleRef.current.focus();
      }
    }, [isKeyboardReordering, item.id]);

    const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
      event.currentTarget.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const index = items.findIndex((i) => i.id === item.id);
      if (index === -1) return;

      const moveTo = (toIndex: number, message: string, boundaryMessage?: string) => {
        if (toIndex < 0 || toIndex >= items.length) {
          if (boundaryMessage) {
            announce(boundaryMessage);
          }
          return;
        }
        if (toIndex === index) return;
        if (onMoveItem) {
          onMoveItem({
            itemId: item.id,
            fromStripId: stripId,
            toStripId: stripId,
            fromIndex: index,
            toIndex,
          });
          announce(message);
        }
      };

      if (isKeyboardReordering) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          moveTo(index - 1, `Moved "${item.name}" to position ${index}.`, `Already first in strip.`);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          moveTo(index + 1, `Moved "${item.name}" to position ${index + 2}.`, `Already last in strip.`);
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();

          // Query the board-scoped strip order registry
          const direction = event.key === "ArrowUp" ? "up" : "down";
          const nextStripId = getAdjacentStripId(stripId, direction);

          if (nextStripId && onMoveItem) {
            const targetList = itemsByStripId[nextStripId] || [];
            // Clamp target index to prevent out-of-bounds array insertions
            const targetIndex = Math.max(0, Math.min(index, targetList.length));

            onMoveItem({
              itemId: item.id,
              fromStripId: stripId,
              toStripId: nextStripId,
              fromIndex: index,
              toIndex: targetIndex,
            });
            announce(`Moved "${item.name}" to adjacent strip.`);
          }
        } else if (event.key === "Home") {
          event.preventDefault();
          event.stopPropagation();
          moveTo(0, `Moved "${item.name}" to start of strip.`);
        } else if (event.key === "End") {
          event.preventDefault();
          event.stopPropagation();
          moveTo(items.length - 1, `Moved "${item.name}" to end of strip.`);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelKeyboardReorder();
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          confirmKeyboardReorder();
          announce(`Dropped "${item.name}" at position ${index + 1}.`);
        }
      } else {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          startKeyboardReorder(item.id, stripId, index);
          announce(
            `Picked up "${item.name}" via keyboard. Use ArrowLeft/Right to reorder, ArrowUp/Down to move between strips, Home/End to skip to edges, Enter or Space to drop, Escape to cancel.`
          );
        }
      }
    };

    // Render a dashed ghost placeholder in the list while dragging is active
    if (isDragging) {
      return (
        <div
          ref={setNodeRef}
          style={style}
          className="absolute bg-muted/20 border border-dashed border-muted-foreground/35 rounded-lg pointer-events-none"
        />
      );
    }

    // Combine absolute positions with sortable CSS translations
    const combinedStyle: CSSProperties = {
      ...style,
      transform: transform ? CSS.Transform.toString(transform) : undefined,
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
          data-value={item.id}
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

        {/* Reorder Handle: SIBLING absolutely positioned on top, avoiding invalid HTML button nesting */}
        {/* NOTE: This handle button does not have data-value or value attributes. This is crucial */}
        {/* because media-strip.tsx uses a capture-phase keydown listener for grid arrow navigation. */}
        {/* By omitting data-value/value on the handle, that capture handler safely bails out early */}
        {/* when focus is on the handle, preventing double-handling of arrow keys during keyboard reordering. */}
        <button
          type="button"
          ref={handleRef}
          data-dnd-handle="true"
          data-reorder-handle={item.id}
          aria-label={handleAriaLabel}
          className={cn(
            "absolute top-1.5 right-1.5 p-0.5 rounded cursor-grab hover:bg-muted text-muted-foreground active:cursor-grabbing z-30 pointer-events-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm border shadow-sm",
            isKeyboardReordering && "opacity-100 bg-primary text-primary-foreground hover:bg-primary"
          )}
          {...attributes}
          {...listeners}
          onKeyDown={handleKeyDown}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  },
  areEqual
);
