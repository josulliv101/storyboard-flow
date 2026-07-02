import React from "react";

export type ClipKindBadgeProps = {
  kind: "video" | "collection";
};

export function ClipKindBadge({ kind }: ClipKindBadgeProps) {
  if (kind === "video") {
    return (
      <span className="absolute left-1 top-1 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
        VIDEO
      </span>
    );
  }

  return (
    <span className="absolute left-1 top-1 z-20 rounded bg-sky-950/80 px-1.5 py-0.5 text-[10px] font-medium text-sky-200">
      COLLECTION
    </span>
  );
}
