import { type FocusEvent, type CSSProperties, memo } from "react";
import { useReducedMotion } from "motion/react";
import { Badge } from "../core/badge";
import { ToggleGroupItem } from "../core/toggle-group";
import { type TimelineItem } from "./media-strip.types";
import { formatDuration, areEqual } from "./media-strip.utils";
import { MediaStripThumbnail } from "./media-strip-thumbnail";

type MediaStripItemButtonProps = {
  item: TimelineItem;
  /** Custom styles forwarded for absolute virtualization positioning coordinates. */
  style?: CSSProperties;
  thumbnailVariant?: "single" | "sequence";
};

export const MediaStripItemButton = memo(
  function MediaStripItemButton({
    item,
    style,
    thumbnailVariant,
  }: MediaStripItemButtonProps) {
    const durationLabel = formatDuration(item.durationSeconds);
    const ariaLabel = `${item.name}, ${durationLabel}`;
    const shouldReduceMotion = useReducedMotion();

    const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
      event.currentTarget.scrollIntoView({
        behavior: shouldReduceMotion ? "auto" : "smooth",
        block: "nearest",
        inline: "nearest",
      });
    };

    return (
      <ToggleGroupItem
        aria-label={ariaLabel}
        className="h-auto flex-col items-stretch justify-start gap-2 whitespace-normal p-2 text-left data-pressed:border-primary data-pressed:bg-primary/5"
        style={style}
        value={item.id}
        data-value={item.id}
        onFocus={handleFocus}
      >
        <MediaStripThumbnail item={item} variant={thumbnailVariant} />

        <span className="min-w-0 truncate text-xs font-medium text-foreground">
          {item.name}
        </span>

        <Badge className="max-w-full self-start truncate" variant="secondary">
          {durationLabel}
        </Badge>
      </ToggleGroupItem>
    );
  },
  areEqual
);
