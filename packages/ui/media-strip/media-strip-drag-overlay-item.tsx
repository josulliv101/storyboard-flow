import { type TimelineItem } from "./core/media-strip.types";
import { formatDuration, TOGGLE_GROUP_PADDING_PX } from "./core/media-strip.utils";
import { MediaStripThumbnail } from "./media-strip-thumbnail";

export function DragOverlayItem({
  item,
  width,
}: {
  item: TimelineItem;
  width: number;
}) {
  return (
    <div
      data-testid="drag-overlay-item"
      className="bg-card border-primary border p-2 rounded-lg opacity-85 shadow-2xl flex flex-col items-stretch justify-start gap-2 text-left pointer-events-none select-none"
      style={{
        width: `${width}px`,
        height: `calc(9.5rem - ${2 * TOGGLE_GROUP_PADDING_PX}px)`,
      }}
    >
      <MediaStripThumbnail item={item} variant="sequence" />
      <span className="truncate text-xs font-medium text-foreground pr-4">
        {item.name}
      </span>
      <div className="self-start text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded font-mono">
        {formatDuration(item.durationSeconds)}
      </div>
    </div>
  );
}
