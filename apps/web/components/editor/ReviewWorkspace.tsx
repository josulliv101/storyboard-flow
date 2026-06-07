'use client';

import React from 'react';
import { Preview } from './Preview';
import { useTimeline, Scene, TimelineClip, TimelineTrack } from '@/lib/timeline-context';
import { cn } from '@/lib/utils';
import { getGraphColor, getGraphDisplayLabel, getGraphShortLabel } from '@/lib/graph-style';
import {
  Badge,
  Slider,
  Button,
  buttonVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@storyboard/ui";
import { MessageSquare, Pause, PencilLine, Play, SkipBack, StickyNote, Tags } from 'lucide-react';
import { scheduleReviewMomentExpansions, type ReviewMomentExpansion } from './review-note-layout';

const NOTE_TAG_FILTER_NONE = '__NO_NOTE_TAGS_VISIBLE__';
const PX_PER_FRAME = 3;
const DEFAULT_VERTICAL_TIME_SCALE = 1;
const MIN_VERTICAL_TIME_SCALE = 0.5;
const MAX_VERTICAL_TIME_SCALE = 4;
const VERTICAL_TIME_SCALE_STEP = 0.25;
const SCROLL_PAD_FRAMES = 24;
const NOTE_CARD_HEIGHT = 96;
const NOTE_CARD_COLUMN_GAP = 10;
const NOTE_CARD_ROW_GAP = 0;
const NOTE_ROW_SCROLL_DISTANCE = NOTE_CARD_HEIGHT + NOTE_CARD_ROW_GAP;
const NOTE_READING_INSET = 12;
const REVIEW_BODY_MAX_CHARS = 144;
const REVIEW_CARD_MIN_WIDTH = 320;
const TIMELINE_MARKER_SIZE = 32;
const TIMELINE_BADGE_SIZE = 24;
const TIMELINE_MARKER_GAP = 4;
const TIMELINE_STACK_PEEK = 5;
const TIMELINE_MARKER_RAIL_OFFSET = 32;
const REVIEW_TIME_RULER_WIDTH = 52;
const REVIEW_TIME_RULER_STEP_SECONDS = 1;
const DEFAULT_PREVIEW_PANEL_PERCENT = 56;
const MIN_PREVIEW_PANEL_PERCENT = 28;
const MAX_PREVIEW_PANEL_PERCENT = 78;

type ReviewContentMode = 'notes' | 'dialog';

type ReviewGraphTag = {
  id: string;
  label: string;
  color: string;
};

type ReviewDisplayTag = (
  | (ReviewGraphTag & { isGraph: true })
  | { label: string; isGraph: false }
) & { count: number };

type ReviewItem = {
  id: string;
  sceneId: string;
  startFrame: number;
  duration: number;
  title: string;
  body: string;
  tags: string[];
  graphTags: ReviewGraphTag[];
};

type ReviewLane = {
  id: string;
  label: string;
  sceneName?: string;
  items: ReviewItem[];
};

type ReviewTimelineLane = Omit<ReviewLane, 'items'> & {
  notes: ReviewItem[];
  dialogs: ReviewItem[];
};

type ReviewTimelineMoment = {
  type: ReviewContentMode;
  startFrame: number;
  count: number;
};

type ReviewTimelineMarker = ReviewTimelineMoment & {
  isVisibleNoteGroup: boolean;
  momentCount: number;
};

type ReviewPositionedItem = ReviewItem & {
  clusterTop: number;
  top: number;
  column: number;
  columnCount: number;
  clusterSize: number;
  row: number;
  rowCount: number;
};

type ReviewPositionedLane = Omit<ReviewLane, 'items'> & {
  items: ReviewPositionedItem[];
};

const normalizeTagKey = (value: string | undefined) => value?.trim().toLowerCase() || '';

const getGraphTagKeys = (track: TimelineTrack) => (
  [
    track.name,
    track.graph?.label,
    track.graph?.shortLabel,
    getGraphDisplayLabel(track.graph, track.name),
    getGraphShortLabel(track.graph, track.name),
  ]
    .map(normalizeTagKey)
    .filter(Boolean)
);

const clipMatchesTagFilter = (
  clip: TimelineClip,
  graphTagKeySet: Set<string>,
  noteTagFilter: string[],
) => {
  if (noteTagFilter.includes(NOTE_TAG_FILTER_NONE)) return false;
  if ((clip.tags || []).some(tag => graphTagKeySet.has(normalizeTagKey(tag)))) return true;
  if ((clip.linkedGraphTrackIds || []).length > 0) return true;
  if (noteTagFilter.length === 0) return true;

  const enabledTagSet = new Set(
    noteTagFilter
      .filter(tag => tag !== NOTE_TAG_FILTER_NONE)
      .map(normalizeTagKey)
  );

  if (enabledTagSet.size === 0) return false;
  return (clip.tags || []).some(tag => enabledTagSet.has(normalizeTagKey(tag)));
};

const getReviewNote = (
  scene: Scene,
  clip: TimelineClip,
  graphTracks: TimelineTrack[],
): ReviewItem => {
  const clipTagKeys = new Set((clip.tags || []).map(normalizeTagKey));
  const linkedGraphIdSet = new Set(clip.linkedGraphTrackIds || []);
  const graphTags = graphTracks
    .map((track, graphIndex) => ({ track, graphIndex, tagKeys: getGraphTagKeys(track) }))
    .filter(({ track, tagKeys }) => {
      const matchesTag = tagKeys.some(tag => clipTagKeys.has(tag));
      return linkedGraphIdSet.has(track.id) || matchesTag;
    })
    .map(({ track, graphIndex }) => {
      const graphColor = getGraphColor(track.graph, graphIndex);

      return {
        id: track.id,
        label: getGraphDisplayLabel(track.graph, track.name),
        color: graphColor.line || graphColor.accent,
      };
    });
  const tags = (clip.tags || [])
    .map(tag => tag.trim())
    .filter(tag => tag && normalizeTagKey(tag) !== 'preview');

  return {
    id: clip.id,
    sceneId: scene.id,
    startFrame: clip.startFrame,
    duration: clip.duration,
    title: clip.name || 'Note',
    body: clip.description?.trim() || clip.name || 'Note',
    tags,
    graphTags,
  };
};

const getReviewDialog = (
  scene: Scene,
  clip: TimelineClip,
): ReviewItem => ({
  id: clip.id,
  sceneId: scene.id,
  startFrame: clip.startFrame,
  duration: clip.duration,
  title: clip.character || clip.name || 'Dialog',
  body: [clip.name, clip.description].filter(Boolean).join('\n') || 'Dialog',
  tags: [],
  graphTags: [],
});

const getLaneNotes = (
  scene: Scene,
  trackIds: string[],
  allGraphTracks: TimelineTrack[],
  noteTagFilter: string[],
) => {
  const graphTagKeySet = new Set(allGraphTracks.flatMap(getGraphTagKeys));

  return scene.clips
    .filter(clip => clip.type === 'note' && trackIds.includes(clip.trackId))
    .filter(clip => clipMatchesTagFilter(clip, graphTagKeySet, noteTagFilter))
    .map(clip => getReviewNote(scene, clip, allGraphTracks))
    .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
};

const getLaneDialogs = (
  scene: Scene,
  trackIds: string[],
) => (
  scene.clips
    .filter(clip => clip.type === 'dialog' && trackIds.includes(clip.trackId))
    .map(clip => getReviewDialog(scene, clip))
    .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id))
);

const getReviewDisplayTags = (item: ReviewItem) => {
  const visibleTags = new Map<string, ReviewDisplayTag>();
  const tags = [
    ...item.graphTags.map(tag => ({ ...tag, isGraph: true as const })),
    ...item.tags.map(label => ({ label, isGraph: false as const })),
  ];

  tags.forEach(tag => {
    const key = normalizeTagKey(tag.label);
    if (!key) return;

    const existingTag = visibleTags.get(key);
    if (!existingTag) {
      visibleTags.set(key, { ...tag, count: 1 });
      return;
    }

    visibleTags.set(key, { ...existingTag, count: existingTag.count + 1 });
  });

  return Array.from(visibleTags.values());
};

const getReviewTimelineMoments = (lane: ReviewTimelineLane) => {
  const momentByKey = new Map<string, ReviewTimelineMoment>();

  ([
    ['notes', lane.notes],
    ['dialog', lane.dialogs],
  ] as const).forEach(([type, items]) => {
    items.forEach(item => {
      const key = `${type}-${item.startFrame}`;
      const existing = momentByKey.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        momentByKey.set(key, { type, startFrame: item.startFrame, count: 1 });
      }
    });
  });

  return Array.from(momentByKey.values())
    .sort((a, b) => a.startFrame - b.startFrame || a.type.localeCompare(b.type));
};

const getReviewTimelineMarkers = (
  lane: ReviewTimelineLane,
  contentMode: ReviewContentMode,
  totalDuration: number,
  laneWidth: number,
  visibleNoteGroupKeys: ReadonlySet<string>,
) => {
  const moments = getReviewTimelineMoments(lane)
    .filter(moment => moment.type === contentMode)
    .map<ReviewTimelineMarker>(moment => ({
      ...moment,
      isVisibleNoteGroup: moment.type === 'notes'
        && moment.count > 1
        && visibleNoteGroupKeys.has(getReviewNoteGroupKey(lane.id, moment.startFrame)),
      momentCount: 1,
    }));
  const markers: ReviewTimelineMarker[] = [];
  let mergedRight = Number.NEGATIVE_INFINITY;

  moments.forEach(moment => {
    const bounds = getTimelineMarkerBounds(moment.startFrame, totalDuration, laneWidth);
    const previous = markers.at(-1);

    if (previous && bounds.left < mergedRight + TIMELINE_STACK_PEEK + TIMELINE_MARKER_GAP) {
      previous.count += moment.count;
      previous.momentCount += 1;
      previous.isVisibleNoteGroup ||= moment.isVisibleNoteGroup;
      mergedRight = Math.max(mergedRight, bounds.right);
      return;
    }

    markers.push({ ...moment });
    mergedRight = bounds.right;
  });

  return markers;
};

const getPreviewScenes = (
  scenes: Scene[],
  activeSceneId: string,
  previewSceneMode: 'active' | 'all',
  previewSceneIds: string[],
) => {
  const previewSceneIdSet = previewSceneIds.length > 0 ? new Set(previewSceneIds) : undefined;
  const enabledScenes = previewSceneIdSet
    ? scenes.filter(scene => previewSceneIdSet.has(scene.id))
    : scenes;
  const previewScenes = enabledScenes.length > 0
    ? enabledScenes
    : scenes.filter(scene => scene.id === activeSceneId);

  if (previewScenes.length > 1 || previewSceneMode === 'all') {
    return previewScenes;
  }

  return scenes.filter(scene => scene.id === activeSceneId);
};

const getScrollProgressFrame = (
  scrollTop: number,
  totalDuration: number,
  momentExpansions: ReviewMomentExpansion[],
  pixelsPerFrame: number,
) => (
  Math.max(0, Math.min(totalDuration, Math.round((scrollTop - getMomentExpansionOffset(scrollTop, momentExpansions)) / pixelsPerFrame)))
);

const getFrameScrollTop = (
  frame: number,
  maxScrollTop: number,
  momentExpansions: ReviewMomentExpansion[],
  pixelsPerFrame: number,
) => (
  Math.max(0, Math.min(
    maxScrollTop,
    (frame * pixelsPerFrame) + getMomentExpansionOffsetForFrame(frame, momentExpansions)
  ))
);

const getContinuousPlaybackScrollTop = (
  startTop: number,
  startFrame: number,
  frame: number,
  maxScrollTop: number,
  pixelsPerFrame: number,
) => (
  Math.max(0, Math.min(maxScrollTop, startTop + ((frame - startFrame) * pixelsPerFrame)))
);

const getLaneColumnCount = (laneWidth: number) => (
  Math.max(1, Math.min(3, Math.floor(laneWidth / REVIEW_CARD_MIN_WIDTH)))
);

const getReviewBodyLimit = (containerWidth: number, columnCount: number) => {
  if (columnCount >= 3) return 88;
  if (columnCount === 2) return 112;
  if (containerWidth > 0 && containerWidth < 640) return 96;
  return REVIEW_BODY_MAX_CHARS;
};

const truncateReviewText = (text: string, limit: number) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
};

const formatReviewTime = (frame: number, fps: number) => {
  const seconds = frame / fps;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const clamp = (value: number, min: number, max: number) => (
  Math.max(min, Math.min(max, value))
);

const getTimelineMomentStyle = (
  frame: number,
  totalDuration: number,
): React.CSSProperties => {
  const progress = clamp(frame / Math.max(1, totalDuration), 0, 1);

  return {
    left: `${progress * 100}%`,
    transform: progress === 0
      ? 'translateX(0)'
      : progress === 1
        ? 'translateX(-100%)'
        : 'translateX(-50%)',
  };
};

const getTimelineMarkerBounds = (
  frame: number,
  totalDuration: number,
  laneWidth: number,
) => {
  const progress = clamp(frame / Math.max(1, totalDuration), 0, 1);
  const edgePadding = (TIMELINE_MARKER_SIZE - TIMELINE_BADGE_SIZE) / 2;

  if (progress === 0) {
    return { left: edgePadding, right: edgePadding + TIMELINE_BADGE_SIZE };
  }
  if (progress === 1) {
    return { left: laneWidth - edgePadding - TIMELINE_BADGE_SIZE, right: laneWidth - edgePadding };
  }

  const anchor = progress * laneWidth;
  return { left: anchor - (TIMELINE_BADGE_SIZE / 2), right: anchor + (TIMELINE_BADGE_SIZE / 2) };
};

const getMomentExpansionOffset = (scrollTop: number, momentExpansions: ReviewMomentExpansion[]) => (
  momentExpansions.reduce((offset, expansion) => {
    if (scrollTop <= expansion.scrollStart) return offset;
    return offset + clamp(scrollTop - expansion.scrollStart, 0, expansion.duration);
  }, 0)
);

const getMomentExpansionOffsetForFrame = (frame: number, momentExpansions: ReviewMomentExpansion[]) => (
  momentExpansions.reduce((offset, expansion) => (
    expansion.startFrame < frame ? offset + expansion.duration : offset
  ), 0)
);

const getItemMomentExpansionOffset = (
  item: ReviewPositionedItem,
  momentExpansions: ReviewMomentExpansion[],
) => (
  momentExpansions.reduce((offset, expansion) => (
    expansion.startFrame < item.startFrame ? offset + expansion.duration : offset
  ), 0)
);

const getReviewItemTop = (
  item: ReviewPositionedItem,
  momentExpansions: ReviewMomentExpansion[],
) => (
  NOTE_READING_INSET + item.top + (item.row * NOTE_ROW_SCROLL_DISTANCE) + getItemMomentExpansionOffset(item, momentExpansions)
);

const getReviewTimeRulerTicks = (totalDuration: number, fps: number) => (
  Array.from(
    { length: Math.floor(totalDuration / (fps * REVIEW_TIME_RULER_STEP_SECONDS)) + 1 },
    (_, index) => index * fps * REVIEW_TIME_RULER_STEP_SECONDS,
  )
);

const getReviewTimeRulerTop = (
  frame: number,
  pixelsPerFrame: number,
  momentExpansions: ReviewMomentExpansion[],
) => (
  (frame * pixelsPerFrame) + getMomentExpansionOffsetForFrame(frame, momentExpansions)
);

const getReviewGroupStyle = (
  item: ReviewPositionedItem,
  momentExpansions: ReviewMomentExpansion[],
): React.CSSProperties => ({
  top: `${getReviewItemTop(item, momentExpansions) - 5}px`,
  height: `${NOTE_CARD_HEIGHT + ((item.rowCount - 1) * NOTE_ROW_SCROLL_DISTANCE) + 10}px`,
  left: '6px',
  right: '0px',
});

const getCardColumnStyle = (column: number, columnCount: number): React.CSSProperties => {
  const columnWidth = 100 / columnCount;
  const leftOffset = columnCount === 1
    ? 12
    : column === 0
      ? 12
      : NOTE_CARD_COLUMN_GAP / 2;
  const widthOffset = columnCount === 1
    ? 12
    : column === 0
      ? 12 + NOTE_CARD_COLUMN_GAP / 2
      : NOTE_CARD_COLUMN_GAP;

  return {
    left: `calc(${column * columnWidth}% + ${leftOffset}px)`,
    width: `calc(${columnWidth}% - ${widthOffset}px)`,
  };
};

const clampPreviewPanelPercent = (value: number) => (
  Math.max(MIN_PREVIEW_PANEL_PERCENT, Math.min(MAX_PREVIEW_PANEL_PERCENT, value))
);

const getReviewNoteGroupKey = (laneId: string, startFrame: number) => `${laneId}:${startFrame}`;

const haveSameReviewGroupKeys = (left: ReadonlySet<string>, right: ReadonlySet<string>) => (
  left.size === right.size && Array.from(left).every(key => right.has(key))
);

const ReviewTimelineContent = React.memo(function ReviewTimelineContent({
  contentLabel,
  contentMode,
  fps,
  momentExpansions,
  onOpenScriptEditor,
  positionedLanes,
  pixelsPerFrame,
  reviewWidth,
  scrollHeight,
  setCurrentFrame,
  totalDuration,
}: {
  contentLabel: string;
  contentMode: ReviewContentMode;
  fps: number;
  momentExpansions: ReviewMomentExpansion[];
  onOpenScriptEditor?: (clipId: string, sceneId: string) => void;
  positionedLanes: ReviewPositionedLane[];
  pixelsPerFrame: number;
  reviewWidth: number;
  scrollHeight: number;
  setCurrentFrame: React.Dispatch<React.SetStateAction<number>>;
  totalDuration: number;
}) {
  const timeRulerTicks = getReviewTimeRulerTicks(totalDuration, fps);

  return (
    <div
      className="relative grid min-w-full gap-3 px-4 pb-4"
      style={{
        minHeight: `${scrollHeight}px`,
        gridTemplateColumns: `${REVIEW_TIME_RULER_WIDTH}px repeat(${Math.max(1, positionedLanes.length)}, minmax(0, 1fr))`,
      }}
    >
      <aside
        data-testid="review-time-ruler"
        aria-label="Timeline seconds"
        className="relative min-h-full border-r border-zinc-900/80 pr-2"
      >
        {timeRulerTicks.map(frame => (
          <div
            key={frame}
            data-testid="review-time-ruler-tick"
            className="absolute inset-x-0 flex -translate-y-1/2 items-center justify-end gap-1"
            style={{ top: `${getReviewTimeRulerTop(frame, pixelsPerFrame, momentExpansions)}px` }}
          >
            <span className="font-mono text-xs font-bold tabular-nums text-white">
              {formatReviewTime(frame, fps)}
            </span>
            <span className="h-px w-2 shrink-0 bg-zinc-700" aria-hidden="true" />
          </div>
        ))}
      </aside>
      {positionedLanes.length === 0 ? (
        <div className="col-span-full flex h-48 items-center justify-center rounded border border-zinc-900 bg-zinc-950/40 text-[10px] font-bold uppercase tracking-widest text-zinc-700">
          No visible previews
        </div>
      ) : positionedLanes.map(lane => (
        <section key={lane.id} className="relative min-w-0 border-l border-zinc-900/80 pl-3">
          {lane.items.length === 0 ? (
            <div className="mt-12 rounded border border-dashed border-zinc-800 px-3 py-8 text-center text-[10px] font-bold uppercase tracking-widest text-zinc-700">
              No {contentMode}
            </div>
          ) : (
            <>
              {(() => {
                const momentClustersMap = new Map<number, ReviewPositionedItem[]>();
                lane.items.forEach(item => {
                  const existing = momentClustersMap.get(item.startFrame) || [];
                  existing.push(item);
                  momentClustersMap.set(item.startFrame, existing);
                });

                return Array.from(momentClustersMap.entries()).map(([startFrame, clusterItems]) => {
                  const firstItem = clusterItems[0];
                  if (!firstItem) return null;

                  const groupTop = getReviewItemTop(firstItem, momentExpansions) - 5;
                  const groupHeight = NOTE_CARD_HEIGHT + ((firstItem.rowCount - 1) * NOTE_ROW_SCROLL_DISTANCE) + 10;
                  const groupMaxWidth = firstItem.columnCount * 340 + (firstItem.columnCount - 1) * 12;

                  return (
                    <div
                      key={`group-container-${startFrame}`}
                      className="absolute left-1/2 -translate-x-1/2 z-20 w-[calc(100%-24px)]"
                      style={{
                        top: `${groupTop}px`,
                        height: `${groupHeight}px`,
                        maxWidth: `${groupMaxWidth}px`,
                      }}
                    >
                      {/* Note Group Highlight Highlight Background (Always present even for single notes!) */}
                      {contentMode === 'notes' && (
                        <div
                          data-testid="review-note-group"
                          data-review-note-group-key={getReviewNoteGroupKey(lane.id, startFrame)}
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 rounded-md border border-zinc-600/40 bg-zinc-500/[0.025] shadow-[inset_0_0_0_1px_rgba(161,161,170,0.035),0_0_18px_rgba(161,161,170,0.04)]"
                        >
                          <span className="absolute bottom-3 left-0 top-3 w-0.5 bg-zinc-500/65 shadow-[0_0_8px_rgba(161,161,170,0.22)]" />
                        </div>
                      )}

                      {/* Cards inside the centered group container positioned in their respective columns */}
                      {clusterItems.map(item => {
                        const reviewTags = contentMode === 'notes' ? getReviewDisplayTags(item) : [];
                        return (
                          <button
                            key={item.id}
                            type="button"
                            title={item.body}
                            className={cn(
                              "absolute h-24 overflow-hidden rounded-md bg-zinc-900/86 px-3 py-1.5 text-left text-zinc-300 shadow-xl transition-colors hover:bg-zinc-800/90",
                              contentMode === 'dialog' && "border border-zinc-800 hover:border-zinc-700"
                            )}
                            style={{
                              top: `${5 + item.row * NOTE_ROW_SCROLL_DISTANCE}px`,
                              ...getCardColumnStyle(item.column, item.columnCount),
                            }}
                            onClick={() => setCurrentFrame(item.startFrame)}
                          >
                            <div className="mb-1 flex h-6 items-center gap-3 overflow-hidden">
                              {contentMode === 'dialog' && (
                                <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                                  <span className="max-w-24 shrink-0 truncate font-mono text-[8px] font-bold uppercase tracking-widest text-indigo-300/80">
                                    {lane.sceneName ? `${lane.sceneName} / ${lane.label}` : lane.label}
                                  </span>
                                  <span className="truncate text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{item.title}</span>
                                </span>
                              )}
                              {reviewTags.length > 0 && (
                                <div
                                  data-testid="review-note-tags"
                                  className="flex h-4 min-w-0 flex-1 items-center gap-1 overflow-hidden"
                                >
                                  {reviewTags.map(tag => (
                                    tag.isGraph ? (
                                      <span
                                        key={`graph-${tag.id}`}
                                        data-testid="review-note-tag"
                                        data-tag-type="graph"
                                        data-tag-count={tag.count}
                                        className="inline-flex h-4 max-w-24 shrink-0 items-center gap-1 rounded border border-white/15 px-1.5 font-mono text-[7px] font-black uppercase tracking-wide text-white shadow-sm"
                                        style={{ backgroundColor: tag.color }}
                                      >
                                        <span className="truncate">{tag.label}</span>
                                        {tag.count > 1 && (
                                          <span className="shrink-0 rounded-sm bg-black/25 px-1 text-[7px] tabular-nums">
                                            {tag.count}
                                          </span>
                                        )}
                                      </span>
                                    ) : (
                                      <span
                                        key={`tag-${normalizeTagKey(tag.label)}`}
                                        data-testid="review-note-tag"
                                        data-tag-type="plain"
                                        data-tag-count={tag.count}
                                        className="inline-flex h-4 max-w-24 shrink-0 items-center gap-1 rounded border border-amber-200/20 bg-zinc-950/90 px-1.5 text-[7px] font-black uppercase tracking-wide text-amber-100 shadow-sm"
                                      >
                                        <span className="truncate">{tag.label}</span>
                                        {tag.count > 1 && (
                                          <span className="shrink-0 rounded-sm bg-amber-100/12 px-1 text-[7px] tabular-nums">
                                            {tag.count}
                                          </span>
                                        )}
                                      </span>
                                    )
                                  ))}
                                </div>
                              )}
                              <span className="ml-auto flex shrink-0 items-center gap-2">
                                {contentMode === 'dialog' && (
                                  <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-zinc-600">{formatReviewTime(item.startFrame, fps)}</span>
                                )}
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onOpenScriptEditor?.(item.id, item.sceneId);
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key !== 'Enter' && event.key !== ' ') return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onOpenScriptEditor?.(item.id, item.sceneId);
                                  }}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-zinc-700 bg-black/30 text-zinc-500 transition-colors hover:border-indigo-400/50 hover:text-indigo-200"
                                  aria-label={`Open ${contentLabel.toLowerCase()} script editor`}
                                  title={`Open ${contentLabel} Script`}
                                >
                                  <PencilLine className="h-3 w-3" />
                                </span>
                              </span>
                            </div>
                            <div className="line-clamp-3 whitespace-pre-line text-sm font-semibold leading-snug">
                              {truncateReviewText(item.body, getReviewBodyLimit(reviewWidth, item.columnCount))}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </>
          )}
        </section>
      ))}
    </div>
  );
});

export function ReviewWorkspace({
  onOpenScriptEditor,
  showPreviewTagUi,
  setShowPreviewTagUi,
  contentMode = 'notes',
  setContentMode,
  verticalTimeScale = 1,
  setVerticalTimeScale,
}: {
  onOpenScriptEditor?: (clipId: string, sceneId: string) => void;
  showPreviewTagUi: boolean;
  setShowPreviewTagUi: (show: boolean) => void;
  contentMode?: 'notes' | 'dialog';
  setContentMode: (mode: 'notes' | 'dialog') => void;
  verticalTimeScale?: number;
  setVerticalTimeScale: (scale: number) => void;
}) {
  const {
    activeSceneId,
    currentFrame,
    disabledTrackIds,
    fps,
    isPlaying,
    noteTagFilter,
    playbackRate,
    setPlaybackRate,
    previewSceneIds,
    previewSceneMode,
    scenes,
    setCurrentFrame,
    setPlaying,
    setShowDialogPreviewUi,
    showDialogPreviewUi,
    totalDuration,
  } = useTimeline();
  const [reviewWidth, setReviewWidth] = React.useState(0);
  const [reviewHeight, setReviewHeight] = React.useState(0);
  const [visibleNoteGroupKeys, setVisibleNoteGroupKeys] = React.useState<ReadonlySet<string>>(() => new Set());
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const isScrollSyncingRef = React.useRef(false);
  const isUserScrollingRef = React.useRef(false);
  const scrollFrameRef = React.useRef<number | null>(null);
  const playbackScrollFrameRef = React.useRef<number | null>(null);
  const currentFrameRef = React.useRef(currentFrame);
  const wasPlayingRef = React.useRef(isPlaying);
  const userScrollTimeoutRef = React.useRef<number | null>(null);
  const previewScenes = React.useMemo(() => (
    getPreviewScenes(scenes, activeSceneId, previewSceneMode, previewSceneIds)
  ), [activeSceneId, previewSceneIds, previewSceneMode, scenes]);
  const showSceneLanes = previewSceneMode === 'all' || previewScenes.length > 1;
  const pixelsPerFrame = PX_PER_FRAME * verticalTimeScale;

  const timelineLanes = React.useMemo<ReviewTimelineLane[]>(() => {
    if (showSceneLanes) {
      return previewScenes.map(scene => {
        const enabledTracks = scene.tracks.filter(track => !disabledTrackIds.includes(track.id));
        const enabledTrackIds = enabledTracks.map(track => track.id);
        const graphTracks = enabledTracks.filter(track => track.type === 'graph' && track.graph);
        return {
          id: scene.id,
          label: scene.name,
          notes: getLaneNotes(scene, enabledTrackIds, graphTracks, noteTagFilter),
          dialogs: getLaneDialogs(scene, enabledTrackIds),
        };
      });
    }

    const scene = previewScenes[0];
    if (!scene) return [];

    return scene.tracks
      .filter(track => !track.parentId && !disabledTrackIds.includes(track.id))
      .map(parent => {
        const childTracks = scene.tracks.filter(track => track.parentId === parent.id);
        const enabledChildTracks = childTracks.filter(track => !disabledTrackIds.includes(track.id));
        const enabledTrackIds = enabledChildTracks.map(track => track.id);
        const graphTracks = childTracks.filter(track => track.type === 'graph' && track.graph);
        return {
          id: parent.id,
          label: parent.name,
          sceneName: scene.name,
          notes: getLaneNotes(scene, enabledTrackIds, graphTracks, noteTagFilter),
          dialogs: getLaneDialogs(scene, enabledTrackIds),
        };
      });
  }, [disabledTrackIds, noteTagFilter, previewScenes, showSceneLanes]);
  const lanes = React.useMemo<ReviewLane[]>(() => (
    timelineLanes.map(lane => ({
      id: lane.id,
      label: lane.label,
      sceneName: lane.sceneName,
      items: contentMode === 'notes' ? lane.notes : lane.dialogs,
    }))
  ), [contentMode, timelineLanes]);
  const timelineLaneWidth = timelineLanes.length > 0
    ? Math.max(0, (reviewWidth - 32 - REVIEW_TIME_RULER_WIDTH - (timelineLanes.length * 12)) / timelineLanes.length)
    : reviewWidth;

  const positionedLanes = React.useMemo<ReviewPositionedLane[]>(() => {
    const columnCount = getLaneColumnCount(timelineLaneWidth);

    return lanes.map(lane => {
      const positionedItems: ReviewPositionedItem[] = [];

      for (let index = 0; index < lane.items.length;) {
        const startFrame = lane.items[index].startFrame;
        const clusterItems: ReviewItem[] = [];
        while (index + clusterItems.length < lane.items.length) {
          const item = lane.items[index + clusterItems.length];
          if (item.startFrame !== startFrame) break;
          clusterItems.push(item);
        }
        const clusterTop = startFrame * pixelsPerFrame;
        const rowCount = Math.ceil(clusterItems.length / columnCount);

        clusterItems.forEach((item, clusterIndex) => {
          const row = Math.floor(clusterIndex / columnCount);
          positionedItems.push({
            ...item,
            clusterTop,
            top: clusterTop,
            column: clusterIndex % columnCount,
            columnCount,
            clusterSize: clusterItems.length,
            row,
            rowCount,
          });
        });

        index += clusterItems.length;
      }

      return {
        ...lane,
        items: positionedItems,
      };
    })
  }, [lanes, pixelsPerFrame, timelineLaneWidth]);
  const momentExpansions = React.useMemo<ReviewMomentExpansion[]>(() => {
    const expansionByFrame = new Map<number, ReviewMomentExpansion>();

    positionedLanes.forEach(lane => {
      lane.items.forEach(item => {
        if (item.row !== 0 || item.rowCount <= 1) return;

        const duration = Math.max(0, item.rowCount - 1) * NOTE_ROW_SCROLL_DISTANCE;
        const scrollStart = item.clusterTop;
        const existing = expansionByFrame.get(item.startFrame);

        if (!existing) {
          expansionByFrame.set(item.startFrame, {
            startFrame: item.startFrame,
            scrollStart,
            duration,
          });
          return;
        }

        existing.scrollStart = Math.min(existing.scrollStart, scrollStart);
        existing.duration = Math.max(existing.duration, duration);
      });
    });

    return scheduleReviewMomentExpansions(Array.from(expansionByFrame.values()));
  }, [positionedLanes]);
  const momentExpansionHeight = momentExpansions.reduce((total, expansion) => total + expansion.duration, 0);
  const maxNoteBottom = positionedLanes.reduce((max, lane) => (
    Math.max(max, ...lane.items.map(item => getReviewItemTop(item, momentExpansions) + NOTE_CARD_HEIGHT + NOTE_CARD_ROW_GAP))
  ), 0);
  const maxNoteTop = positionedLanes.reduce((max, lane) => (
    Math.max(max, ...lane.items.map(item => getReviewItemTop(item, momentExpansions)))
  ), 0);
  const scrollHeight = Math.max(
    900,
    ((totalDuration + SCROLL_PAD_FRAMES) * pixelsPerFrame) + momentExpansionHeight,
    maxNoteBottom + 48,
    maxNoteTop + reviewHeight,
  );

  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver === 'undefined') return;

    const updateScrollerMetrics = () => {
      setReviewWidth(scroller.clientWidth);
      setReviewHeight(scroller.clientHeight);
    };
    updateScrollerMetrics();

    const observer = new ResizeObserver(updateScrollerMetrics);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    const clearVisibleGroups = () => {
      setVisibleNoteGroupKeys(previous => previous.size === 0 ? previous : new Set());
    };

    if (contentMode !== 'notes' || !scroller || typeof IntersectionObserver === 'undefined') {
      clearVisibleGroups();
      return;
    }

    const groupElements = Array.from(scroller.querySelectorAll<HTMLElement>('[data-review-note-group-key]'));
    if (groupElements.length === 0) {
      clearVisibleGroups();
      return;
    }

    const visibleKeys = new Set<string>();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const key = (entry.target as HTMLElement).dataset.reviewNoteGroupKey;
        if (!key) return;

        if (entry.isIntersecting && entry.intersectionRect.height > 0) {
          visibleKeys.add(key);
        } else {
          visibleKeys.delete(key);
        }
      });

      setVisibleNoteGroupKeys(previous => (
        haveSameReviewGroupKeys(previous, visibleKeys) ? previous : new Set(visibleKeys)
      ));
    }, {
      root: scroller,
      threshold: 0,
    });

    groupElements.forEach(group => observer.observe(group));
    return () => observer.disconnect();
  }, [contentMode, momentExpansions, positionedLanes, reviewHeight]);

  React.useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  const updateFrameFromScroll = React.useCallback((scroller: HTMLDivElement) => {
    const nextFrame = getScrollProgressFrame(scroller.scrollTop, totalDuration, momentExpansions, pixelsPerFrame);

    if (nextFrame !== currentFrameRef.current) {
      currentFrameRef.current = nextFrame;
      setCurrentFrame(nextFrame);
    }
  }, [momentExpansions, pixelsPerFrame, setCurrentFrame, totalDuration]);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (isPlaying) {
      wasPlayingRef.current = true;
      return;
    }
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false;
      return;
    }
    if (isUserScrollingRef.current) return;

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const targetTop = getFrameScrollTop(currentFrame, maxScrollTop, momentExpansions, pixelsPerFrame);
    if (Math.abs(scroller.scrollTop - targetTop) < 0.25) return;

    isScrollSyncingRef.current = true;
    scroller.scrollTop = targetTop;
    window.requestAnimationFrame(() => {
      isScrollSyncingRef.current = false;
    });
  }, [currentFrame, isPlaying, momentExpansions, pixelsPerFrame, reviewHeight]);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !isPlaying) return;

    let previousTime: number | null = null;
    let interpolatedFrame = currentFrameRef.current;
    const playbackStartFrame = currentFrameRef.current;
    const playbackStartTop = scroller.scrollTop;

    const scrollWithPlayback = (currentTime: number) => {
      if (previousTime !== null) {
        interpolatedFrame += ((currentTime - previousTime) * fps * playbackRate) / 1000;
      }
      previousTime = currentTime;

      const committedFrame = currentFrameRef.current;
      const correctionThreshold = Math.max(2, fps * playbackRate * 0.12);
      if (Math.abs(committedFrame - interpolatedFrame) > correctionThreshold) {
        interpolatedFrame = committedFrame;
      } else {
        interpolatedFrame = Math.max(interpolatedFrame, committedFrame);
      }

      if (!isUserScrollingRef.current) {
        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const targetTop = getContinuousPlaybackScrollTop(
          playbackStartTop,
          playbackStartFrame,
          interpolatedFrame,
          maxScrollTop,
          pixelsPerFrame,
        );

        if (Math.abs(scroller.scrollTop - targetTop) >= 0.1) {
          isScrollSyncingRef.current = true;
          scroller.scrollTop = targetTop;
          window.requestAnimationFrame(() => {
            isScrollSyncingRef.current = false;
          });
        }
      }

      playbackScrollFrameRef.current = window.requestAnimationFrame(scrollWithPlayback);
    };

    playbackScrollFrameRef.current = window.requestAnimationFrame(scrollWithPlayback);
    return () => {
      if (playbackScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(playbackScrollFrameRef.current);
        playbackScrollFrameRef.current = null;
      }
    };
  }, [fps, isPlaying, momentExpansions, pixelsPerFrame, playbackRate, reviewHeight]);

  React.useEffect(() => () => {
    if (userScrollTimeoutRef.current) {
      window.clearTimeout(userScrollTimeoutRef.current);
    }
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
    if (playbackScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(playbackScrollFrameRef.current);
    }
  }, []);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (isScrollSyncingRef.current || isPlaying) return;
    const scroller = event.currentTarget;

    isUserScrollingRef.current = true;
    if (userScrollTimeoutRef.current) {
      window.clearTimeout(userScrollTimeoutRef.current);
    }
    userScrollTimeoutRef.current = window.setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 420);

    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      updateFrameFromScroll(scroller);
    });
  };

  const handleManualScrollIntent = () => {
    if (isPlaying) {
      setPlaying(false);
    }
  };

  const handleVerticalTimeScaleChange = (value: number | readonly number[]) => {
    const nextScale = Array.isArray(value) ? value[0] : value;
    if (nextScale === undefined) return;

    isUserScrollingRef.current = false;
    if (userScrollTimeoutRef.current) {
      window.clearTimeout(userScrollTimeoutRef.current);
      userScrollTimeoutRef.current = null;
    }
    setVerticalTimeScale(nextScale);
  };

  const handleTogglePlayback = () => {
    if (!isPlaying) {
      window.dispatchEvent(new Event('timeline-preview-play-request'));
    }
    setPlaying(!isPlaying);
  };

  const contentLabel = contentMode === 'notes' ? 'Notes' : 'Dialog';
  const playheadProgress = clamp(currentFrame / Math.max(1, totalDuration), 0, 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#080809]">

        {timelineLanes.length > 0 && (
          <div
            className="grid shrink-0 gap-3 border-b border-zinc-900 bg-zinc-950/40 px-4 py-2"
            style={{
              gridTemplateColumns: `${REVIEW_TIME_RULER_WIDTH}px repeat(${timelineLanes.length}, minmax(0, 1fr))`,
            }}
          >
            <div className="flex items-end justify-end pr-2 text-[8px] font-black uppercase tracking-widest text-zinc-600">
              Time
            </div>
            {timelineLanes.map((lane, laneIndex) => {
              const timelineMarkers = getReviewTimelineMarkers(
                lane,
                contentMode,
                totalDuration,
                timelineLaneWidth,
                visibleNoteGroupKeys,
              );

              return (
                <div
                  key={lane.id}
                  data-testid="review-preview-progress"
                  className="min-w-0"
                  role="group"
                  aria-label={`Preview ${laneIndex + 1}: ${lane.sceneName ? `${lane.sceneName} / ` : ''}${lane.label} timeline`}
                >
                  <div className="truncate text-[8px] font-black uppercase tracking-widest text-zinc-600">
                    Preview {laneIndex + 1} / {lane.sceneName ? `${lane.sceneName} / ${lane.label}` : lane.label}
                  </div>
                  <div
                    className="relative mt-2 h-10"
                  >
                    <div
                      className="absolute inset-x-0 h-px bg-zinc-800"
                      style={{ top: `${TIMELINE_MARKER_RAIL_OFFSET}px` }}
                      aria-hidden="true"
                    >
                    <div
                      className="h-full origin-left bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.4)]"
                      style={{ transform: `scaleX(${playheadProgress})` }}
                    />
                    <span
                      className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-300 shadow-[0_0_8px_rgba(165,180,252,0.7)]"
                      style={{ left: `${playheadProgress * 100}%` }}
                    />
                    </div>
                    {timelineMarkers.map(moment => {
                    const isNote = moment.type === 'notes';
                    const markerLabel = moment.momentCount > 1
                      ? `${moment.count} ${isNote ? 'notes' : 'dialog items'} across ${moment.momentCount} nearby moments starting at ${formatReviewTime(moment.startFrame, fps)}`
                      : `${moment.count} ${isNote ? 'note' : 'dialog item'}${moment.count === 1 ? '' : 's'} at ${formatReviewTime(moment.startFrame, fps)}`;

                    return (
                      <button
                        key={`${moment.type}-${moment.startFrame}`}
                        data-testid="review-timeline-marker"
                        data-merged-moments={moment.momentCount > 1 ? moment.momentCount : undefined}
                        data-visible-note-group={moment.isVisibleNoteGroup ? 'true' : undefined}
                        type="button"
                        title={markerLabel}
                        aria-label={markerLabel}
                        className={cn(
                          "absolute inline-flex size-8 items-start justify-center rounded-md transition-colors hover:text-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70",
                          isNote
                            ? "text-zinc-400"
                            : "text-purple-300"
                        )}
                        style={getTimelineMomentStyle(moment.startFrame, totalDuration)}
                        onClick={() => {
                          setContentMode(moment.type);
                          setCurrentFrame(moment.startFrame);
                        }}
                      >
                        {moment.momentCount > 1 && (
                          <span
                            data-testid="review-timeline-marker-stack"
                            className={cn(
                              "absolute left-[9px] top-0 size-6 rounded-md border",
                              moment.isVisibleNoteGroup
                                ? "border-zinc-300/70 bg-zinc-300/70"
                                : "border-zinc-500/40 bg-secondary/75"
                            )}
                            aria-hidden="true"
                          />
                        )}
                        <Badge
                          variant="secondary"
                          className={cn(
                            "relative size-6 rounded-md px-0 font-mono text-[11px] font-black leading-none tabular-nums",
                            moment.isVisibleNoteGroup && "bg-zinc-200 text-zinc-950 shadow-[0_0_9px_rgba(228,228,231,0.25)]"
                          )}
                        >
                          {moment.count}
                        </Badge>
                        {moment.isVisibleNoteGroup && (
                          <>
                            {moment.momentCount > 1 && (
                              <span
                                data-testid="review-timeline-marker-stack-tail"
                                className="absolute left-[17px] top-6 h-0 w-0 border-x-[4px] border-t-[7px] border-x-transparent border-t-zinc-300/70"
                                aria-hidden="true"
                              />
                            )}
                            <span
                              data-testid="review-timeline-marker-tail"
                              className="absolute top-6 h-0 w-0 border-x-[5px] border-t-[8px] border-x-transparent border-t-zinc-200 drop-shadow-[0_4px_4px_rgba(228,228,231,0.22)]"
                              aria-hidden="true"
                            />
                          </>
                        )}
                      </button>
                    );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div
          ref={scrollerRef}
          className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          onScroll={handleScroll}
          onWheel={handleManualScrollIntent}
          onPointerDown={handleManualScrollIntent}
          onTouchStart={handleManualScrollIntent}
        >
          <div className="pointer-events-none sticky top-0 z-40 h-0" aria-hidden="true">
            <div className="mx-4 h-px bg-indigo-300/70 shadow-[0_0_12px_rgba(165,180,252,0.35)]" />
          </div>
          <ReviewTimelineContent
            contentLabel={contentLabel}
            contentMode={contentMode}
            fps={fps}
            momentExpansions={momentExpansions}
            onOpenScriptEditor={onOpenScriptEditor}
            positionedLanes={positionedLanes}
            pixelsPerFrame={pixelsPerFrame}
            reviewWidth={reviewWidth}
            scrollHeight={scrollHeight}
            setCurrentFrame={setCurrentFrame}
            totalDuration={totalDuration}
          />
        </div>
      </div>
  );
}
