import React from "react";
import { cva } from "class-variance-authority";
import { Folder, FolderOpen } from "lucide-react";

import type { CollectionTimelineClip } from "./types";
import { cn } from "../lib/utils";

// ---------------------------------------------------------------------------
// Breadcrumb shape palette (up to 4 nesting levels)
// ---------------------------------------------------------------------------

const collectionBreadcrumbShapes = [
  { fill: "bg-amber-400", shape: "rounded-full" },
  { fill: "bg-sky-400", shape: "rounded-[2px]" },
  { fill: "bg-emerald-400", shape: "rotate-45 rounded-[2px]" },
  { fill: "bg-violet-400", shape: "rounded-sm" },
] as const;

const collectionExpandToggle = cva(
  "absolute right-1 top-1 z-30 flex h-7 w-7 items-center justify-center rounded border text-sky-100 shadow transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 focus-visible:outline-offset-2",
  {
    variants: {
      expanded: {
        true: "border-sky-300/50 bg-sky-500/35 hover:bg-sky-500/45",
        false: "border-sky-300/35 bg-black/75 hover:bg-sky-950/85",
      },
    },
    defaultVariants: {
      expanded: false,
    },
  },
);

const collectionOpenTimelineLink = cva(
  "absolute left-1 z-20 rounded border border-sky-300/40 bg-black/75 px-2 py-1 text-[10px] font-semibold text-sky-100 shadow",
  {
    variants: {
      withBreadcrumb: {
        true: "bottom-6",
        false: "bottom-1",
      },
    },
    defaultVariants: {
      withBreadcrumb: false,
    },
  },
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type ClipCollectionControlsProps = {
  clip: CollectionTimelineClip;
  collectionHref?: string | null;
  hasCollectionBreadcrumb?: boolean;
  breadcrumbLevels?: number[];
  isCollectionExpanded?: boolean;
  onToggleCollectionExpanded?: (clip: CollectionTimelineClip) => void;
  onOpenCollection?: (timelineId: string, href: string) => void;
};

export function ClipCollectionControls({
  clip,
  collectionHref,
  hasCollectionBreadcrumb = false,
  breadcrumbLevels = [],
  isCollectionExpanded = false,
  onToggleCollectionExpanded,
  onOpenCollection,
}: ClipCollectionControlsProps) {
  return (
    <>
      {onToggleCollectionExpanded ? (
        <button
          type="button"
          data-testid="timeline-collection-expand-toggle"
          aria-expanded={isCollectionExpanded}
          aria-label={`${clip.title} children`}
          title={isCollectionExpanded ? "Collapse collection" : "Expand collection"}
          className={collectionExpandToggle({ expanded: isCollectionExpanded })}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleCollectionExpanded(clip);
          }}
        >
          {isCollectionExpanded ? (
            <Folder className="h-4 w-4" aria-hidden="true" />
          ) : (
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      ) : null}

      {collectionHref ? (
        <a
          href={collectionHref}
          className={collectionOpenTimelineLink({ withBreadcrumb: hasCollectionBreadcrumb })}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (
              !onOpenCollection ||
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return;
            }
            event.preventDefault();
            onOpenCollection(clip.childTimelineId, collectionHref);
          }}
        >
          Open timeline
        </a>
      ) : null}

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
