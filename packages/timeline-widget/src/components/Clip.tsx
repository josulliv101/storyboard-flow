import { clipLabel, clipPosterUrl, formatClipDuration } from "@storyboard/timeline-model";

import type { TimelineClip } from "../types";

// A single card in the strip. PURE and prop-driven: no bridge, no fetching, no
// view state — which is what makes it renderable in Storybook against fixed
// fixtures, and what keeps the interaction logic in one reducer instead of
// spread across the cards.

export type ClipProps = {
  clip: TimelineClip;
  /** Pixel width from `clipStripWidths`. Absolute, not a percentage — see the
   *  note in that function for why proportional flex bases collapse. */
  width: number;
  selected?: boolean;
  onSelect?: (clip: TimelineClip) => void;
  onOpen?: (clip: TimelineClip) => void;
};

export function Clip({ clip, width, selected = false, onSelect, onOpen }: ClipProps) {
  const isCollection = clip.kind === "collection";
  const canOpen = isCollection && Boolean(clip.childTimelineId);
  const poster = clipPosterUrl(clip);
  const label = clipLabel(clip);
  const duration = formatClipDuration(clip.duration ?? 0);

  const className = [
    "clip",
    isCollection ? "clip--collection" : "",
    selected ? "clip--selected" : "",
    canOpen ? "clip--openable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <figure
      className={className}
      // flex-basis rather than width: the card must not be shrunk by the row.
      style={{ flexBasis: `${width}px` }}
      title={`${label} — ${duration}`}
    >
      <button
        type="button"
        className="clip__hit"
        // Without this the accessible name is whatever the card's text happens
        // to concatenate to ("collection 6 Bank Heist 40.9s"). Naming it
        // explicitly gives screen readers the clip and its length, in order.
        aria-label={`${label}, ${duration}`}
        aria-pressed={selected}
        onClick={() => onSelect?.(clip)}
        // A collection opens on double-click, which leaves single-click free
        // for selection. The Open affordance below is the discoverable path.
        onDoubleClick={canOpen ? () => onOpen?.(clip) : undefined}
      >
        <span className="clip__art">
          {poster ? (
            <img src={poster} alt="" loading="lazy" />
          ) : (
            <span className="clip__art--empty" aria-hidden="true" />
          )}
          <span className="clip__kind">{isCollection ? "collection" : clip.kind}</span>
          {isCollection && clip.itemCount !== undefined && (
            <span className="clip__count">{clip.itemCount}</span>
          )}
        </span>
        <span className="clip__meta">
          {/* Two lines before truncating: a single ellipsised line rendered most
              names as "Youn…" / "FBI I…", which identifies nothing. */}
          <span className="clip__name">{label}</span>
          <span className="clip__time">{duration}</span>
        </span>
      </button>

      {canOpen && (
        <button
          type="button"
          className="clip__open"
          onClick={() => onOpen?.(clip)}
          aria-label={`Open ${label}`}
        >
          Open
        </button>
      )}
    </figure>
  );
}
