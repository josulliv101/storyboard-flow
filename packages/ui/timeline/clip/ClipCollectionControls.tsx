import React from "react";

import type { CollectionTimelineClip } from "../types";
import { cn } from "../../lib/utils";

// ---------------------------------------------------------------------------
// Breadcrumb shape palette (up to 4 nesting levels)
// ---------------------------------------------------------------------------

const collectionBreadcrumbShapes = [
  { fill: "bg-amber-400", shape: "rounded-full" },
  { fill: "bg-sky-400", shape: "rounded-[2px]" },
  { fill: "bg-emerald-400", shape: "rotate-45 rounded-[2px]" },
  { fill: "bg-violet-400", shape: "rounded-sm" },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type ClipCollectionControlsProps = {
  clip: CollectionTimelineClip;
  hasCollectionBreadcrumb?: boolean;
  breadcrumbLevels?: number[];
};

export function ClipCollectionControls({
  clip,
  hasCollectionBreadcrumb = false,
  breadcrumbLevels = [],
}: ClipCollectionControlsProps) {
  return (
    <>
      {hasCollectionBreadcrumb ? (
        <div
          data-testid="timeline-expanded-collection-breadcrumb"
          data-depth={breadcrumbLevels.length}
          className="pointer-events-none absolute bottom-1 left-1 z-30 flex items-center gap-1 rounded border border-zinc-600 bg-zinc-950 px-1.5 py-0.5 shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
          aria-label={`Expanded collection depth ${breadcrumbLevels.length}`}
        >
          {breadcrumbLevels.map((level, index) => {
            const levelShape = collectionBreadcrumbShapes[level];
            return (
              <React.Fragment key={`${clip.id}-breadcrumb-${level}`}>
                {index > 0 ? (
                  <span
                    className="font-mono text-[9px] leading-none text-zinc-400"
                    aria-hidden="true"
                  >
                    &gt;
                  </span>
                ) : null}
                <span
                  data-testid="timeline-expanded-collection-breadcrumb-shape"
                  data-depth-level={level}
                  className={cn("h-2 w-2 shrink-0", levelShape.fill, levelShape.shape)}
                  aria-hidden="true"
                />
              </React.Fragment>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
