import { type FocusEvent, type CSSProperties } from "react";
import { Badge } from "../core/badge";
import { ToggleGroupItem } from "../core/toggle-group";
import type { TimelineItem } from "./media-strip.types";
import { MediaStripThumbnail } from "./media-strip-thumbnail";

type MediaStripItemButtonProps = {
  item: TimelineItem;
  pxPerSecond?: number;
  style?: CSSProperties;
};

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function MediaStripItemButton({
  item,
  pxPerSecond = 32,
  style,
}: MediaStripItemButtonProps) {
  const durationLabel = formatDuration(item.durationSeconds);
  const ariaLabel = `${item.name}, ${durationLabel}`;
  
  // Calculate width dynamically from duration, default/min 96, max 320.
  const width = Math.max(96, Math.min(item.durationSeconds * pxPerSecond, 320));

  const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
    event.currentTarget.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  };

  return (
    <ToggleGroupItem
      aria-label={ariaLabel}
      className="h-auto flex-col items-stretch justify-start gap-2 whitespace-normal p-2 text-left data-pressed:border-primary data-pressed:bg-primary/5"
      style={{ width, ...style }}
      value={item.id}
      onFocus={handleFocus}
    >
      <MediaStripThumbnail item={item} />

      <span className="min-w-0 truncate text-xs font-medium text-foreground">
        {item.name}
      </span>

      <Badge className="max-w-full self-start truncate" variant="secondary">
        {durationLabel}
      </Badge>
    </ToggleGroupItem>
  );
}
