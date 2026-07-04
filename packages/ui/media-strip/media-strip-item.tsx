import { Badge } from "../core/badge";
import { ToggleGroupItem } from "../core/toggle-group";
import type { MediaStripItem } from "./media-strip.types";
import { MediaStripThumbnail } from "./media-strip-thumbnail";

type MediaStripItemButtonProps = {
  item: MediaStripItem;
};

export function MediaStripItemButton({ item }: MediaStripItemButtonProps) {
  const ariaLabel = item.subtitle
    ? `${item.title}, ${item.subtitle}`
    : item.title;

  return (
    <ToggleGroupItem
      aria-label={ariaLabel}
      className="h-auto flex-col items-stretch justify-start gap-2 whitespace-normal p-2 text-left data-pressed:border-primary data-pressed:bg-primary/5"
      style={{ width: item.width ?? 144 }}
      value={item.id}
    >
      <MediaStripThumbnail item={item} />

      <span className="min-w-0 truncate text-xs font-medium text-foreground">
        {item.title}
      </span>

      {item.subtitle ? (
        <Badge className="max-w-full self-start truncate" variant="secondary">
          {item.subtitle}
        </Badge>
      ) : null}
    </ToggleGroupItem>
  );
}
