import React from "react";

import type { TimelineClip } from "../types";
import { formatSeconds } from "../utils";

export type ClipDurationLabelProps = {
  clip: TimelineClip;
};

export function ClipDurationLabel({ clip }: ClipDurationLabelProps) {
  if (clip.kind === "collection") return null;

  const label =
    clip.kind === "video"
      ? `${formatSeconds(clip.duration)} / ${formatSeconds(clip.sourceDuration)}`
      : formatSeconds(clip.duration);

  return (
    <span className="absolute bottom-1 right-1 z-20 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-100">
      {label}
    </span>
  );
}
