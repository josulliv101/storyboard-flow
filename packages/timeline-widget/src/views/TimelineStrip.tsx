import { useMemo } from "react";
import { clipStripWidths, formatClipDuration } from "@storyboard/timeline-model";

import { Clip } from "../components/Clip";
import type { TimelineClip } from "../types";

// The strip itself: clips laid out left-to-right, sized by duration.
//
// PURE — it takes clips and callbacks, never the app bridge. That keeps it
// renderable in Storybook with fixed fixtures, which is the only way to see the
// width behaviour without an MCP host attached.

export type TimelineStripProps = {
  clips: readonly TimelineClip[];
  selectedClipId?: string | null;
  onSelect?: (clip: TimelineClip) => void;
  onOpen?: (clip: TimelineClip) => void;
};

export function TimelineStrip({
  clips,
  selectedClipId = null,
  onSelect,
  onOpen,
}: TimelineStripProps) {
  const widths = useMemo(() => clipStripWidths(clips), [clips]);
  const total = useMemo(
    () => clips.reduce((sum, clip) => sum + (clip.duration ?? 0), 0),
    [clips],
  );

  if (clips.length === 0) {
    return <p className="muted">This timeline has no clips yet.</p>;
  }

  return (
    <>
      <div className="strip">
        {clips.map((clip, index) => (
          <Clip
            key={clip.id ?? index}
            clip={clip}
            width={widths[index]}
            selected={Boolean(clip.id) && clip.id === selectedClipId}
            onSelect={onSelect}
            onOpen={onOpen}
          />
        ))}
      </div>
      <p className="muted">
        {clips.length} clip{clips.length === 1 ? "" : "s"} · {formatClipDuration(total)} total
      </p>
    </>
  );
}
