import { type FocusEvent, type CSSProperties, memo, useRef, useEffect } from "react";
import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "../core/badge";
import { ToggleGroupItem } from "../core/toggle-group";
import { type TimelineItem, type MediaStripMove } from "./media-strip.types";
import {
  formatDuration,
  areEqual,
  type MediaStripItemAreEqualProps,
  DATA_VALUE_ATTR,
  VALUE_ATTR,
  DATA_REORDER_HANDLE_ATTR,
  isElementFullyVisibleInScrollArea,
} from "./media-strip.utils";
import { MediaStripThumbnail } from "./media-strip-thumbnail";
import { useReorderKeyboard } from "./use-reorder-keyboard";
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

    // Keyboard-based item reordering logic
    const handleKeyDown = useReorderKeyboard({
      item,
      items,
      stripId,
      onMoveItem,
      isKeyboardReordering,
    });

    // Dnd Kit sortable setup
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: item.id });

    // Focus preservation on the reorder handle.
    // Note: item.id is a necessary dependency because React recycling in virtualized lists
    // reuses DOM button elements/instances for different item IDs when scrolling.
    useEffect(() => {
      if (isKeyboardReordering && handleRef.current) {
        handleRef.current.focus();
      }
    }, [isKeyboardReordering, item.id]);

    const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
      const element = event.currentTarget;

      // Look for the scroll area container to see if the element is already in view
      const scrollArea = element.closest("[data-testid^='media-strip-drag-scroll-']");
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

        {/* Reorder Handle: SIBLING absolutely positioned on top, avoiding invalid HTML button nesting */}
        {/* NOTE: This handle button does not have data-value or value attributes. This is crucial */}
        {/* because media-strip.tsx uses a capture-phase keydown listener for grid arrow navigation. */}
        {/* By omitting data-value/value on the handle, that capture handler safely bails out early */}
        {/* when focus is on the handle, preventing double-handling of arrow keys during keyboard reordering. */}
        <button
          type="button"
          ref={handleRef}
          data-dnd-handle="true"
          {...{ [DATA_REORDER_HANDLE_ATTR]: item.id }}
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

MediaStripItemButton.displayName = "MediaStripItemButton";
