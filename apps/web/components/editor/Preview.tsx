'use client';

import React, { useRef, useEffect, useMemo } from 'react';
import { useTimeline, TimelineClip, TimelineTrack, Scene, PreviewMediaLayout } from '@/lib/timeline-context';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import {
  getAnimatedGridLayout,
  getClipVisualState,
  getCssVisualStyle,
} from '@/lib/render-layout';
import { getGraphColor, getGraphDisplayLabel, getGraphShortLabel, type GraphColor } from '@/lib/graph-style';
import { ResponsiveAspectFrame } from './ResponsiveAspectFrame';
import { Activity, Volume2, VolumeX, User } from 'lucide-react';

const syncVideoAudioState = (video: HTMLVideoElement, muted: boolean) => {
  video.muted = muted;
  video.defaultMuted = muted;
  video.volume = muted ? 0 : 1;

  if (muted) {
    video.setAttribute('muted', '');
  } else {
    video.removeAttribute('muted');
  }
};

const INSET_MEDIA_PERCENT = 82;
const INSET_MEDIA_OFFSET_PERCENT = 100 - INSET_MEDIA_PERCENT;
const INSET_GRAPH_RAIL_PERCENT = 24;

const getPreviewMediaStyle = (layout: PreviewMediaLayout): React.CSSProperties => ({
  width: layout === 'inset' ? `${INSET_MEDIA_PERCENT}%` : '100%',
  height: layout === 'inset' ? `${INSET_MEDIA_PERCENT}%` : '100%',
  position: 'absolute',
  bottom: 0,
  right: 0,
  left: 'auto',
  top: 'auto',
  objectFit: 'cover',
  boxSizing: 'border-box',
  backgroundColor: '#070709',
  border: '1px solid rgba(255,255,255,0.22)',
  boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.42), 0 0 0 1px rgba(255,255,255,0.08)',
});

function PreviewMediaBackdrop({ mediaLayout }: { mediaLayout: PreviewMediaLayout }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={getPreviewMediaStyle(mediaLayout)}
    />
  );
}

function PreviewSceneTitle({
  title,
  description,
  mediaLayout,
}: {
  title?: string;
  description?: string;
  mediaLayout: PreviewMediaLayout;
}) {
  const displayTitle = title?.trim();
  const displayDescription = description?.trim();

  if (!displayTitle && !displayDescription) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute left-2 top-2 z-[58] min-w-0 text-left text-white md:left-3 md:top-3",
        mediaLayout === 'inset' ? "max-w-[min(560px,58%)]" : "max-w-[min(420px,48%)]"
      )}
    >
      {displayTitle && (
        <div className="truncate whitespace-nowrap text-sm font-black uppercase leading-tight tracking-[0.14em] text-zinc-50 drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] md:text-base">
          {displayTitle}
        </div>
      )}
      {displayDescription && (
        <p className="mt-1 line-clamp-2 text-pretty text-[10px] font-semibold leading-snug text-zinc-300 drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] md:text-xs">
          {displayDescription}
        </p>
      )}
    </div>
  );
}

function PreviewVideo({
  clip,
  currentFrame,
  isPlaying,
  fps,
  playbackRate,
  muted,
  mediaLayout,
}: {
  clip: TimelineClip;
  currentFrame: number;
  isPlaying: boolean;
  fps: number;
  playbackRate: number;
  muted: boolean;
  mediaLayout: PreviewMediaLayout;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentFrameRef = useRef(currentFrame);
  const [isReady, setIsReady] = React.useState(false);

  const mediaStyle = getPreviewMediaStyle(mediaLayout);

  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  useEffect(() => {
    const handlePlayRequest = () => {
      const video = videoRef.current;
      if (!video || video.readyState < 1) return;

      const targetTime = Math.max(0, (currentFrameRef.current - clip.startFrame) / fps);
      if (video.ended || Math.abs(video.currentTime - targetTime) > 0.1) {
        video.currentTime = targetTime;
      }
      video.playbackRate = playbackRate;
      syncVideoAudioState(video, muted);
      video.play().catch(() => {});
    };

    window.addEventListener('timeline-preview-play-request', handlePlayRequest);
    return () => window.removeEventListener('timeline-preview-play-request', handlePlayRequest);
  }, [clip.startFrame, fps, playbackRate, muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setIsReady(false);

    const handleLoadedMetadata = () => {
      setIsReady(true);
    };

    if (video.readyState >= 1) {
      setIsReady(true);
    } else {
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    }
  }, [clip.src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isReady) return;

    if (isPlaying) {
      const targetTime = Math.max(0, (currentFrameRef.current - clip.startFrame) / fps);
      if (video.ended || Math.abs(video.currentTime - targetTime) > 0.1) {
        video.currentTime = targetTime;
      }
      video.playbackRate = playbackRate;
      syncVideoAudioState(video, muted);
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying, isReady, clip.startFrame, fps, playbackRate, muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    syncVideoAudioState(video, muted);
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isReady) return;
    video.playbackRate = playbackRate;
  }, [playbackRate, isReady]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isReady) return;

    const targetTime = Math.max(0, (currentFrame - clip.startFrame) / fps);
    
    if (!isPlaying) {
      if (Math.abs(video.currentTime - targetTime) > 0.05) {
        video.currentTime = targetTime;
      }
    } else {
      // If the timeline is playing, ensure the video is playing in the browser
      if (video.paused && !video.ended) {
        syncVideoAudioState(video, muted);
        video.playbackRate = playbackRate;
        video.play().catch(() => {});
      }
      
      // Prevent React rendering congestion lag from pulling the playing video backward.
      // Only seek if the user manually jumps the playhead (desync > 4.0s ahead or > 3.0s behind).
      const timeDiff = video.currentTime - targetTime;
      if (timeDiff > 4.0 || timeDiff < -3.0) {
        video.currentTime = targetTime;
      }
    }
  }, [currentFrame, clip.startFrame, isPlaying, fps, isReady, playbackRate, muted]);

  return <video 
    ref={videoRef} 
    src={clip.src} 
    data-preview-clip-id={clip.id}
    className="absolute"
    style={mediaStyle}
    preload="auto"
    playsInline
    muted={muted}
  />;
}

const formatGraphValue = (value: number) => value.toFixed(1);

const getGraphValueAtFrame = (
  graph: { type?: 'line' | 'bar'; min: number; points: Array<{ frame: number; value: number }> },
  frame: number
) => {
  const points = [...graph.points].sort((a, b) => a.frame - b.frame);
  if (graph.type !== 'line') {
    return points.filter(point => point.frame <= frame).at(-1)?.value ?? graph.min;
  }

  const previous = points.filter(point => point.frame <= frame).at(-1);
  const next = points.find(point => point.frame > frame);
  if (!previous) return next?.value ?? graph.min;
  if (!next) return previous.value;

  const span = Math.max(1, next.frame - previous.frame);
  const progress = Math.max(0, Math.min(1, (frame - previous.frame) / span));
  return previous.value + (next.value - previous.value) * progress;
};

const getGraphProgressAtFrame = (
  graph: { min: number; max: number; points: Array<{ frame: number; value: number }> },
  frame: number
) => {
  const value = getGraphValueAtFrame(graph, frame);
  const valueRange = Math.max(1, graph.max - graph.min);
  return Math.max(0, Math.min(1, (value - graph.min) / valueRange));
};

const shouldShowGraphValue = (graph: { label: string; showValue?: boolean }) => (
  graph.showValue ?? /\btension\b/i.test(graph.label)
);

const getGraphDisplayDuration = (graphTracks: TimelineTrack[], fps: number) => {
  const lastGraphFrame = graphTracks.reduce((maxFrame, track) => {
    const graph = track.graph;
    if (!graph) return maxFrame;
    const barIntervalFrames = Math.max(1, Math.round((graph.barIntervalSeconds ?? 0.5) * fps));
    const trackLastFrame = graph.points.reduce((lastFrame, point) => (
      Math.max(lastFrame, point.frame + (graph.type === 'bar' ? barIntervalFrames : 0))
    ), 0);
    return Math.max(maxFrame, trackLastFrame);
  }, 0);

  return Math.max(1, lastGraphFrame);
};

type PreviewGraphValue = {
  id: string;
  label: string;
  value: number;
  progress: number;
  min?: number;
  max?: number;
  points?: Array<{ frame: number; value: number }>;
  color: GraphColor;
};

export type PreviewGraphNote = {
  id: string;
  note: string;
  frame: number;
  tags: string[];
  metricTags: Array<{
    id: string;
    label: string;
    color: string;
    min?: number;
    max?: number;
    points?: Array<{ frame: number; value: number }>;
    progress?: number;
    value?: number;
  }>;
  displayTags: string[];
  linkedGraphs?: Array<{
    id: string;
    label: string;
    color: string;
    min?: number;
    max?: number;
    points?: Array<{ frame: number; value: number }>;
    progress?: number;
    value?: number;
  }>;
};

const normalizeTagKey = (value: string | undefined) => (
  value?.trim().toLowerCase() || ''
);

const getClipTags = (clip: TimelineClip) => (
  Array.from(new Set((clip.tags || []).map(tag => tag.trim()).filter(Boolean)))
);

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

type PreviewGraphNoteLinks = Pick<PreviewGraphNote, 'tags' | 'metricTags' | 'displayTags' | 'linkedGraphs'>;

const getNoteGraphLinks = (clip: TimelineClip, graphTracks: TimelineTrack[], currentFrame: number): PreviewGraphNoteLinks => {
  const clipTags = getClipTags(clip);
  const tagKeySet = new Set(clipTags.map(normalizeTagKey));
  const linkedGraphIdSet = new Set(clip.linkedGraphTrackIds || []);
  const matchedGraphTagKeys = new Set<string>();
  const metricTags: PreviewGraphNote['metricTags'] = [];

  const linkedGraphs = graphTracks
    .map((track, graphIndex) => ({ track, graphIndex, tagKeys: getGraphTagKeys(track) }))
    .filter(({ track, tagKeys }) => {
      const isLinked = linkedGraphIdSet.has(track.id) || tagKeys.some(tagKey => tagKeySet.has(tagKey));
      if (isLinked) {
        tagKeys.forEach(tagKey => {
          if (tagKeySet.has(tagKey)) matchedGraphTagKeys.add(tagKey);
        });
      }
      return isLinked;
    })
    .map(({ track, graphIndex }) => {
      const graphColor = getGraphColor(track.graph, graphIndex);
      const value = track.graph && shouldShowGraphValue(track.graph)
        ? getGraphValueAtFrame(track.graph, currentFrame)
        : undefined;
      const metricTag = {
        id: track.id,
        label: getGraphDisplayLabel(track.graph, track.name),
        color: graphColor.line || graphColor.accent,
        min: track.graph?.min,
        max: track.graph?.max,
        points: track.graph?.points,
        progress: track.graph ? getGraphProgressAtFrame(track.graph, currentFrame) : undefined,
        value,
      };
      metricTags.push(metricTag);
      return {
        id: track.id,
        label: getGraphDisplayLabel(track.graph, track.name),
        color: graphColor.line || graphColor.accent,
        min: track.graph?.min,
        max: track.graph?.max,
        points: track.graph?.points,
        progress: track.graph ? getGraphProgressAtFrame(track.graph, currentFrame) : undefined,
        value,
      };
    });

  const displayTags = clipTags.filter(tag => {
    const tagKey = normalizeTagKey(tag);
    return tagKey !== 'preview' && !matchedGraphTagKeys.has(tagKey);
  });

  return {
    tags: clipTags,
    metricTags,
    displayTags,
    linkedGraphs: linkedGraphs.length > 0 ? linkedGraphs : undefined,
  };
};

const getVisibleNoteGraphLinks = (
  clip: TimelineClip,
  allGraphTracks: TimelineTrack[],
  visibleGraphTrackIds: string[],
  currentFrame: number,
): PreviewGraphNoteLinks | null => {
  const links = getNoteGraphLinks(clip, allGraphTracks, currentFrame);
  if (!links.linkedGraphs?.length) return links;

  const visibleGraphIdSet = new Set(visibleGraphTrackIds);
  const linkedGraphs = links.linkedGraphs.filter(graph => visibleGraphIdSet.has(graph.id));
  if (linkedGraphs.length === 0) return null;

  return {
    ...links,
    metricTags: links.metricTags.filter(tag => visibleGraphIdSet.has(tag.id)),
    linkedGraphs,
  };
};

const getPreviewGraphNotePriority = (note: PreviewGraphNote) => {
  if (note.metricTags.length > 0 || note.linkedGraphs?.length) return 0;
  if (note.tags.some(tag => normalizeTagKey(tag) === 'analysis')) return 1;
  return 2;
};

const comparePreviewGraphNotes = (a: PreviewGraphNote, b: PreviewGraphNote) => (
  getPreviewGraphNotePriority(a) - getPreviewGraphNotePriority(b) ||
  a.frame - b.frame ||
  a.id.localeCompare(b.id)
);

const hasGraphLayerTags = (note: PreviewGraphNote) => (
  note.metricTags.length > 0 || Boolean(note.linkedGraphs?.length)
);

const orderCompactPreviewNotes = (notes: PreviewGraphNote[]) => (
  [...notes].sort((a, b) => (
    Number(hasGraphLayerTags(a)) - Number(hasGraphLayerTags(b)) ||
    comparePreviewGraphNotes(a, b)
  ))
);

const getGraphCardBackground = (color: GraphColor) => (
  `linear-gradient(135deg, ${color.fill}, rgba(0,0,0,0.72) 44%, rgba(0,0,0,0.88))`
);

const graphPanelBackground = '#030712';
const NOTE_TAG_FILTER_NONE = '__NO_NOTE_TAGS_VISIBLE__';

const isNoteVisibleForTagFilter = (note: PreviewGraphNote, noteTagFilter: string[]) => {
  if (noteTagFilter.includes(NOTE_TAG_FILTER_NONE)) return false;
  if (note.metricTags.length > 0 || note.linkedGraphs?.length) return true;
  if (noteTagFilter.length === 0) return true;
  const enabledTagSet = new Set(
    noteTagFilter
      .filter(tag => tag !== NOTE_TAG_FILTER_NONE)
      .map(normalizeTagKey)
  );
  if (enabledTagSet.size === 0) return false;
  return note.tags.some(tag => enabledTagSet.has(normalizeTagKey(tag)));
};

const NOTE_OVERLAY_EASE = [0.16, 1, 0.3, 1] as const;
const NOTE_OVERLAY_EXIT_EASE = [0.7, 0, 0.84, 0] as const;

const getNoteOverlayMotion = (offsetY: number) => ({
  initial: {
    opacity: 0,
    y: Math.round(offsetY * 0.55),
    scale: 0.985,
    filter: 'blur(6px)',
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
  },
  exit: {
    opacity: 0,
    y: Math.round(offsetY * 0.25),
    scale: 0.995,
    filter: 'blur(5px)',
  },
  transition: {
    opacity: { duration: 0.46, ease: NOTE_OVERLAY_EASE },
    y: { duration: 0.52, ease: NOTE_OVERLAY_EASE },
    scale: { duration: 0.52, ease: NOTE_OVERLAY_EASE },
    filter: { duration: 0.44, ease: NOTE_OVERLAY_EASE },
    layout: { duration: 0.5, ease: NOTE_OVERLAY_EASE },
    exit: { duration: 0.36, ease: NOTE_OVERLAY_EXIT_EASE },
  },
});

const getNoteStackSignature = (notes: PreviewGraphNote[]) => (
  notes.map(note => `${note.id}:${note.note}:${note.frame}`).join('|')
);

function NoteOverflowIndicator({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-[80] rounded-md border border-amber-200/20 bg-zinc-950/90 px-2.5 py-1.5 font-mono text-[10px] font-black uppercase tracking-widest text-amber-100 shadow-2xl ring-1 ring-black/60 backdrop-blur-md">
      +{count} notes
    </div>
  );
}

function useFullyVisiblePreviewNotes(
  notes: PreviewGraphNote[],
  { measureOverflow = true }: { measureOverflow?: boolean } = {},
) {
  const stackRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef(new Map<string, HTMLDivElement>());
  const [measuredVisibleNotes, setMeasuredVisibleNotes] = React.useState<{ signature: string; ids: string[] } | null>(null);
  const signature = getNoteStackSignature(notes);

  const setItemRef = React.useCallback((id: string) => (node: HTMLDivElement | null) => {
    if (node) {
      itemRefs.current.set(id, node);
    } else {
      itemRefs.current.delete(id);
    }
  }, []);

  const measure = React.useCallback(() => {
    if (!measureOverflow) {
      setMeasuredVisibleNotes({ signature, ids: notes.map(note => note.id) });
      return;
    }

    const stack = stackRef.current;
    const previewBounds = stack?.parentElement?.getBoundingClientRect();

    if (!stack || !previewBounds) {
      setMeasuredVisibleNotes({ signature, ids: notes.map(note => note.id) });
      return;
    }

    const nextVisibleIds = notes
      .filter(note => {
        const node = itemRefs.current.get(note.id);
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        return (
          rect.top >= previewBounds.top + 6 &&
          rect.bottom <= previewBounds.bottom - 6 &&
          rect.left >= previewBounds.left + 6 &&
          rect.right <= previewBounds.right - 6
        );
      })
      .map(note => note.id);

    setMeasuredVisibleNotes({ signature, ids: nextVisibleIds });
  }, [measureOverflow, notes, signature]);

  React.useLayoutEffect(() => {
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [measure, signature]);

  React.useEffect(() => {
    const stack = stackRef.current;
    const previewElement = stack?.parentElement;
    if (!stack || !previewElement || typeof ResizeObserver === 'undefined') return;

    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(previewElement);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [measure, measureOverflow]);

  const visibleNoteIds = measuredVisibleNotes?.signature === signature ? measuredVisibleNotes.ids : null;
  const renderNotes = visibleNoteIds === null
    ? notes
    : notes.filter(note => visibleNoteIds.includes(note.id));

  return {
    hiddenNoteCount: notes.length - renderNotes.length,
    renderNotes,
    setItemRef,
    stackRef,
  };
}

function ResponsivePreviewFrame({
  aspectRatio,
  children,
  className,
}: {
  aspectRatio: string;
  children: React.ReactNode;
  className: string;
}) {
  return (
    <ResponsiveAspectFrame
      aspectRatio="16:9"
      cellClassName="relative flex h-full min-h-0 w-full min-w-0 items-center justify-center"
      frameClassName={className}
    >
      {children}
    </ResponsiveAspectFrame>
  );
}

function GraphValueBadges({
  values,
  mediaLayout = 'full',
  reserveTitleSpace = false,
}: {
  values: PreviewGraphValue[];
  mediaLayout?: PreviewMediaLayout;
  reserveTitleSpace?: boolean;
}) {
  if (values.length === 0) return null;
  const useInsetRail = mediaLayout === 'inset';

  return (
    <div
      className={cn(
        "pointer-events-none absolute z-50 flex gap-1.5 overflow-hidden md:gap-2",
        useInsetRail
          ? "bottom-2.5 left-2.5 flex-col items-stretch"
          : cn("left-2 max-w-[calc(100%-1rem)] md:left-3 md:max-w-[calc(100%-1.5rem)]", reserveTitleSpace ? "top-24" : "top-2 md:top-3")
      )}
      style={useInsetRail ? { width: `calc(${INSET_GRAPH_RAIL_PERCENT}% - 1.25rem)` } : undefined}
    >
      {values.map(item => (
        <div
          key={item.id}
          className={cn(
            "flex items-center overflow-hidden rounded-md border p-1 shadow-2xl backdrop-blur",
            useInsetRail ? "w-full max-w-full" : "max-w-[min(220px,100%)]"
          )}
          style={{
            background: getGraphCardBackground(item.color),
            borderColor: item.color.border,
            boxShadow: `0 18px 42px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 24px ${item.color.fill}`,
          }}
        >
          <div
            className="flex h-8 min-w-10 items-center justify-center rounded-sm border border-white/20 px-1.5 font-mono text-[11px] font-black text-white tabular-nums md:h-9 md:min-w-11 md:px-2 md:text-sm"
            style={{ background: item.color.badge }}
          >
            {formatGraphValue(item.value)}
          </div>
          <div className="flex min-w-20 flex-col gap-1.5 overflow-hidden px-2">
            <div className="min-w-0 truncate text-[8px] font-black uppercase tracking-widest text-white md:text-[9px]">
              {item.label}
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full border border-white/10 bg-white/10">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                animate={{ width: `${item.progress * 100}%` }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  background: `linear-gradient(90deg, ${item.color.badge}, ${item.color.accent})`,
                  boxShadow: `0 0 10px ${item.color.border}`,
                }}
              />
              <motion.div
                className="absolute top-0 h-1.5 w-1.5 rounded-full bg-white"
                animate={{ left: `calc(${item.progress * 100}% - 3px)`, opacity: item.progress > 0 ? 1 : 0 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                style={{ boxShadow: `0 0 8px ${item.color.accent}` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function GraphTopOverlay({
  graphTracks,
  graphValues,
  currentFrame,
  fps,
  totalDuration,
  graphUiLayout = 'grid',
  mediaLayout = 'full',
  reserveTitleSpace = false,
}: {
  graphTracks: TimelineTrack[];
  graphValues: PreviewGraphValue[];
  currentFrame: number;
  fps: number;
  totalDuration: number;
  graphUiLayout?: TimelineTrack['graphUiLayout'];
  mediaLayout?: PreviewMediaLayout;
  reserveTitleSpace?: boolean;
}) {
  if (graphTracks.length === 0 && graphValues.length === 0) return null;
  const valueTracks = graphTracks.filter(track => shouldShowGraphValue(track.graph!));
  const useInsetRail = mediaLayout === 'inset';
  const useColumnLayout = useInsetRail || graphUiLayout === 'column' || graphUiLayout === 'column-many';

  return (
    <div
      className={cn(
        "pointer-events-none absolute left-0 z-50 p-1.5",
        useInsetRail
          ? "bottom-0 flex items-end overflow-hidden p-2.5"
          : cn(reserveTitleSpace ? "top-24" : "top-0", "pr-1", useColumnLayout ? "bottom-0 w-1/6 overflow-visible" : "w-1/2")
      )}
      style={useInsetRail ? { top: reserveTitleSpace ? `max(${INSET_MEDIA_OFFSET_PERCENT}%, 6.25rem)` : `${INSET_MEDIA_OFFSET_PERCENT}%`, width: `${INSET_GRAPH_RAIL_PERCENT}%` } : undefined}
    >
      <div className={cn(
        "flex min-w-0 gap-2",
        useColumnLayout
          ? cn("h-full flex-col flex-wrap overflow-visible", useInsetRail ? "w-full justify-end content-end items-stretch" : "content-start items-start")
          : "items-start flex-wrap"
      )}>
        {valueTracks.map((track) => {
          const graph = track.graph!;
          const graphIndex = Math.max(0, graphTracks.findIndex(item => item.id === track.id));
          const graphColor = getGraphColor(graph, graphIndex);
          const graphHasValueAxis = shouldShowGraphValue(graph);
          const graphValue = getGraphValueAtFrame(graph, currentFrame);
          const graphDuration = Math.min(Math.max(1, totalDuration), getGraphDisplayDuration([track], fps));
          const currentProgress = Math.min(currentFrame, graphDuration) / graphDuration;
          const valueRange = Math.max(1, graph.max - graph.min);
          const points = [...graph.points].sort((a, b) => a.frame - b.frame);
          const isBarGraph = graph.type === 'bar';
          const barIntervalFrames = Math.max(1, Math.round((graph.barIntervalSeconds ?? 0.5) * fps));
          const segments = (points.length ? points : [{ frame: 0, value: Math.max(graph.min, Math.min(graph.max, 0)) }]).map((point, index, source) => ({
            ...point,
            endFrame: isBarGraph ? point.frame + barIntervalFrames : source[index + 1]?.frame ?? graphDuration,
          }));

          return (
            <div
              key={track.id}
              className={cn(
                "flex min-w-0 overflow-hidden rounded border text-left shadow-2xl backdrop-blur",
                useColumnLayout ? "flex-col gap-2 p-2.5" : "min-h-12 items-stretch p-1"
              )}
              style={{
                background: getGraphCardBackground(graphColor),
                borderColor: graphColor.border,
                boxShadow: `0 14px 34px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 18px ${graphColor.fill}`,
                flex: useColumnLayout ? '0 0 auto' : '0 0 calc(50% - 0.25rem)',
                maxWidth: useColumnLayout ? '100%' : 'calc(50% - 0.25rem)',
                position: useColumnLayout ? 'relative' : undefined,
                width: useColumnLayout ? '100%' : undefined,
              }}
            >
              {useColumnLayout && (
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div
                    className="flex min-w-0 flex-1 items-start gap-1.5 whitespace-normal break-words text-left text-[9px] font-black uppercase leading-tight tracking-widest"
                    style={{ color: graphColor.accent }}
                  >
                    <Activity className="mt-px h-3 w-3 shrink-0" />
                    <span className="min-w-0">{getGraphDisplayLabel(graph)}</span>
                  </div>
                  <div
                    className="shrink-0 pt-px text-right font-mono text-[9px] font-black leading-none text-white tabular-nums"
                  >
                    {formatGraphValue(graphValue)}
                  </div>
                </div>
              )}
              <div className="flex min-w-0 items-stretch gap-1.5">
                {!useColumnLayout && (
                  <div
                    className="flex aspect-square h-10 shrink-0 items-center justify-center rounded-sm border border-white/20 font-mono text-base font-black leading-none text-white tabular-nums shadow-inner"
                    style={{ background: graphColor.badge }}
                  >
                    {formatGraphValue(graphValue)}
                  </div>
                )}
                <div className={cn("flex min-w-0 flex-1 flex-col py-0.5", useColumnLayout ? "gap-0 px-0" : "gap-1 px-1.5")}>
                  {!useColumnLayout && (
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 truncate text-[9px] font-black uppercase tracking-widest" style={{ color: graphColor.accent }}>
                        <Activity className="h-3 w-3 shrink-0" />
                        {getGraphDisplayLabel(graph)}
                      </span>
                    </div>
                  )}
                  <div className={cn("relative overflow-visible rounded bg-white/[0.04]", useColumnLayout ? "h-3.5" : "h-4")}>
                    <div className={cn("absolute inset-y-0 overflow-visible", useColumnLayout ? "left-0 right-0" : "inset-x-1")}>
                    {segments.map((segment, index) => {
                      if (segment.frame >= graphDuration) return null;
                      const segmentEndFrame = Math.min(segment.endFrame, graphDuration);
                      const left = (segment.frame / graphDuration) * 100;
                      const width = ((segmentEndFrame - segment.frame) / graphDuration) * 100;
                      const markerLeft = isBarGraph ? left + width / 2 : left;
                      const top = graphHasValueAxis ? 100 - ((segment.value - graph.min) / valueRange) * 100 : 50;
                      const nextSegment = !isBarGraph ? segments[index + 1] : undefined;
                      const nextLeft = nextSegment ? (nextSegment.frame / graphDuration) * 100 : left;
                      const nextTop = nextSegment && graphHasValueAxis
                        ? 100 - ((nextSegment.value - graph.min) / valueRange) * 100
                        : top;

                      return (
                        <React.Fragment key={`${segment.frame}-${index}`}>
                          {isBarGraph ? (
                            <div
                              className="absolute rounded-t-sm"
                              style={{
                                background: graphColor.fill,
                                left: `${left}%`,
                                width: `calc(${width}% + 1px)`,
                                top: graphHasValueAxis ? `${top}%` : 'calc(50% - 1px)',
                                bottom: graphHasValueAxis ? 0 : undefined,
                                height: graphHasValueAxis ? undefined : 2,
                              }}
                            />
                          ) : nextSegment ? (
                            <svg className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none">
                              <line
                                x1={`${left}%`}
                                y1={`${top}%`}
                                x2={`${nextLeft}%`}
                                y2={`${nextTop}%`}
                                stroke={graphColor.line}
                                strokeWidth="2"
                                vectorEffect="non-scaling-stroke"
                              />
                            </svg>
                          ) : null}
                          <div
                            className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/60 shadow"
                            style={{
                              background: graphColor.line,
                              boxShadow: `0 0 6px ${graphColor.border}`,
                              left: `${markerLeft}%`,
                              top: `${top}%`,
                            }}
                          />
                        </React.Fragment>
                      );
                    })}
                    </div>
                    <div
                      className="absolute top-0 bottom-0 w-px bg-white shadow-[0_0_8px_rgba(255,255,255,0.7)]"
                      style={{
                        left: useColumnLayout
                          ? `${currentProgress * 100}%`
                          : `calc(${currentProgress * 100}% + ${4 - 8 * currentProgress}px)`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AnalysisOverlay({
  graphTracks,
  graphNotes,
  dialogs,
  currentFrame,
  fps,
  totalDuration,
}: {
  graphTracks: TimelineTrack[];
  graphNotes: PreviewGraphNote[];
  dialogs: TimelineClip[];
  currentFrame: number;
  fps: number;
  totalDuration: number;
}) {
  if (graphTracks.length === 0 && graphNotes.length === 0 && dialogs.length === 0) return null;

  const metrics = graphTracks.slice(0, 4).map((track, graphIndex) => {
    const graph = track.graph!;
    return {
      track,
      graph,
      color: getGraphColor(graph, graphIndex),
      value: getGraphValueAtFrame(graph, currentFrame),
      duration: Math.min(Math.max(1, totalDuration), getGraphDisplayDuration([track], fps)),
    };
  });
  const analysisText = graphNotes[0]?.note || dialogs[0]?.description || dialogs[0]?.name || 'Live narrative signals are updating across the active scene.';
  const detectedEvents = dialogs.map(dialog => dialog.description?.trim() || dialog.name).slice(0, 2);
  const storyElements = graphNotes.slice(0, 2).map(note => note.note);
  const metricShifts = metrics.filter(item => shouldShowGraphValue(item.graph)).slice(0, 4);

  return (
    <div className="pointer-events-none absolute inset-0 z-[70] overflow-hidden font-sans text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_45%,transparent_0,rgba(0,0,0,0.04)_30%,rgba(0,0,0,0.7)_100%)]" />
      {metrics.length > 0 && (
        <div className="absolute left-[3%] top-[3%] w-[25%] max-w-[280px] bg-zinc-950/88 px-4 py-4 shadow-2xl ring-1 ring-white/10 backdrop-blur-sm">
          <div className="mb-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Core Narrative Metrics</div>
          <div className="space-y-3">
            {metrics.map(({ track, graph, color, value, duration }) => {
              const points = graph.points.length ? [...graph.points].sort((a, b) => a.frame - b.frame) : [{ frame: 0, value: graph.min }];
              const valueRange = Math.max(1, graph.max - graph.min);

              return (
                <div key={track.id}>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">{graph.label}</span>
                    <span className="font-mono text-sm font-black tabular-nums" style={{ color: color.accent }}>{formatGraphValue(value)}</span>
                  </div>
                  <div className="relative h-10 overflow-hidden rounded border border-white/10 bg-black/58">
                    <div className="absolute inset-x-1 top-1/2 border-t border-dashed border-white/10" />
                    <div className="absolute inset-x-1 top-1/4 border-t border-dashed border-white/10" />
                    <div className="absolute inset-x-1 top-3/4 border-t border-dashed border-white/10" />
                    <svg className="absolute inset-1 h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)] overflow-visible" preserveAspectRatio="none">
                      <polyline
                        fill="none"
                        stroke={color.line}
                        strokeWidth="3"
                        vectorEffect="non-scaling-stroke"
                        points={points.map(point => {
                          const x = Math.max(0, Math.min(100, (point.frame / duration) * 100));
                          const y = 100 - ((point.value - graph.min) / valueRange) * 100;
                          return `${x},${Math.max(0, Math.min(100, y))}`;
                        }).join(' ')}
                      />
                    </svg>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="absolute bottom-[3%] right-[3%] top-[3%] w-[58%] min-w-0 border-l-2 border-amber-500 bg-zinc-950/92 px-5 py-4 shadow-2xl ring-1 ring-white/10 backdrop-blur-sm">
        <div className="text-sm font-black uppercase tracking-[0.18em] text-zinc-100">Vector Analysis</div>
        <p className="mt-3 line-clamp-3 text-xs italic leading-relaxed text-slate-400 md:text-sm">
          &quot;{analysisText}&quot;
        </p>
        <div className="my-4 h-px bg-white/10" />
        <div className="grid h-[calc(100%-7.5rem)] grid-cols-[1.1fr_0.9fr] gap-5 overflow-hidden">
          <div className="min-w-0 overflow-hidden">
            <div className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Metric Shifts & Analysis</div>
            <div className="space-y-3">
              {metricShifts.length > 0 ? metricShifts.map(({ track, graph, color, value }) => (
                <div key={track.id} className="border-l-2 pl-3" style={{ borderColor: color.line }}>
                  <div className="text-xs font-black uppercase tracking-wider" style={{ color: color.accent }}>
                    {graph.label}: {formatGraphValue(value)}
                  </div>
                  <p className="mt-1 line-clamp-3 text-xs font-semibold leading-snug text-slate-300">
                    {graph.points.filter(point => point.frame <= currentFrame).at(-1)?.note || `${graph.label} is currently tracking at ${formatGraphValue(value)} across the active beat.`}
                  </p>
                </div>
              )) : (
                <p className="text-xs font-semibold leading-snug text-slate-400">No active metric shifts at this frame.</p>
              )}
            </div>
          </div>
          <div className="min-w-0 border-l border-white/10 pl-5">
            <div className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Detected Events</div>
            <div className="space-y-2">
              {(detectedEvents.length ? detectedEvents : ['Monitoring active scene events']).map((event, index) => (
                <div key={`${event}-${index}`} className="flex gap-2 text-xs font-semibold leading-snug text-slate-300">
                  <span className="text-amber-500">▶</span>
                  <span className="line-clamp-2">{event}</span>
                </div>
              ))}
            </div>
            <div className="my-4 h-px bg-white/10" />
            <div className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Story Elements</div>
            <div className="space-y-2">
              {(storyElements.length ? storyElements : graphNotes.map(note => note.note).slice(0, 1)).map((item, index) => (
                <div key={`${item}-${index}`} className="text-xs font-semibold leading-snug text-slate-300">
                  <div className="mb-1 font-black uppercase tracking-wider text-amber-500">▲ Analysis</div>
                  <p className="line-clamp-3">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewBottomMessages({
  dialogs,
  graphNotes,
  graphValues = [],
  getCharacterImage,
  getCharacterName,
  getDialogSpeakerKey,
  multilineDialogs = false,
  showNoteOverlayIcons = false,
  compactNoteOverlays = false,
  alignToMediaFrame = false,
}: {
  dialogs: TimelineClip[];
  graphNotes: PreviewGraphNote[];
  graphValues?: PreviewGraphValue[];
  getCharacterImage: (clip: TimelineClip) => string | undefined;
  getCharacterName: (clip: TimelineClip) => string | undefined;
  getDialogSpeakerKey: (clip: TimelineClip) => string;
  multilineDialogs?: boolean;
  showNoteOverlayIcons?: boolean;
  compactNoteOverlays?: boolean;
  alignToMediaFrame?: boolean;
}) {
  const {
    hiddenNoteCount,
    renderNotes,
    setItemRef,
    stackRef,
  } = useFullyVisiblePreviewNotes(graphNotes, { measureOverflow: false });
  const orderedRenderNotes = compactNoteOverlays
    ? orderCompactPreviewNotes(renderNotes)
    : renderNotes;
  const persistentGraphTags = compactNoteOverlays
    ? getCompactGraphValueTags(graphValues)
    : [];
  const mediaFrameStyle = alignToMediaFrame
    ? { left: `${INSET_MEDIA_OFFSET_PERCENT}%`, right: 0 }
    : undefined;

  if (dialogs.length === 0 && graphNotes.length === 0 && persistentGraphTags.length === 0) return null;

  const renderDialog = (dialog: TimelineClip) => {
    const speakerKey = `${getDialogSpeakerKey(dialog)}-${dialog.id}`;
    const characterImage = getCharacterImage(dialog);
    const characterName = getCharacterName(dialog);
    const hasValidHeadshot = characterImage && !characterImage.includes('dicebear.com') && !characterImage.includes('adventurer');
    return (
      <motion.div
        key={speakerKey}
        layout="position"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1], layout: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }}
        className="flex w-[min(560px,94%)] items-stretch gap-3.5 rounded-xl border border-white/15 bg-black/80 overflow-hidden pr-3.5 text-left text-white shadow-2xl backdrop-blur-md"
      >
        <div className="relative shrink-0 aspect-square w-16 md:w-20 overflow-hidden bg-zinc-900 border-r border-white/10 flex items-center justify-center">
          {hasValidHeadshot ? (
            <img
              src={characterImage}
              alt=""
              className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-zinc-400 shadow-inner">
              <User className="h-6 w-6 md:h-8 md:w-8 text-zinc-400" />
            </div>
          )}
          {characterName && (
            <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5 text-center" title={characterName}>
              <span className="block truncate text-[8px] font-black uppercase tracking-[0.10em] text-white">
                {characterName}
              </span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 py-3 pl-0.5 flex flex-col justify-center gap-0.5">
          <div className={cn(
            "text-xs font-semibold leading-tight tracking-tight md:text-sm",
            multilineDialogs ? "whitespace-normal break-words" : "truncate"
          )}>
            {dialog.name}
          </div>
          {dialog.description && (
            <p className={cn(
              "text-[10px] leading-normal text-zinc-300 md:text-xs",
              multilineDialogs ? "whitespace-normal break-words" : "truncate"
            )}>
              {dialog.description}
            </p>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <>
    <div
      ref={stackRef}
      style={!compactNoteOverlays ? mediaFrameStyle : undefined}
      className={cn(
        "pointer-events-none absolute z-[60] gap-2 text-center",
        compactNoteOverlays
          ? "inset-x-1.5 top-1.5 flex flex-col items-stretch gap-1.5"
          : cn("top-3 bottom-3 flex flex-col items-center justify-between", !alignToMediaFrame && "inset-x-3")
      )}
    >
      {compactNoteOverlays ? (
        <CompactNotesTagOverlay items={orderedRenderNotes} leadingGraphTags={persistentGraphTags} />
      ) : (
        <>
          {orderedRenderNotes.length > 0 && (
            <div
              style={{ scrollbarGutter: 'stable' }}
              className="relative flex flex-col items-center gap-2 w-full h-[66.6667%] overflow-y-auto pointer-events-auto pr-1 py-1 scrollbar-thin"
            >
              <AnimatePresence initial={false} mode="popLayout">
                {orderedRenderNotes.map(item => (
                  <motion.div
                    key={`${item.id}-${item.note}`}
                    ref={setItemRef(item.id)}
                    layout="position"
                    {...getNoteOverlayMotion(16)}
                    className={cn(
                      "relative shrink-0 min-h-14 w-[min(640px,94%)] overflow-visible rounded-lg border border-amber-200/20 bg-zinc-950/92 text-left text-white shadow-2xl ring-1 ring-black/60 backdrop-blur-md will-change-[opacity,transform,filter]",
                      showNoteOverlayIcons && item.linkedGraphs?.length ? "py-3 pl-3 pr-4" : "px-4 py-3"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {showNoteOverlayIcons && <GraphNoteBadgeCluster graphs={item.linkedGraphs} />}
                      <div className="flex min-h-8 min-w-0 flex-1 items-center">
                        <div className="whitespace-normal break-words text-lg font-semibold leading-relaxed text-zinc-50 md:text-xl">
                          <span>{item.note}</span>
                          {(item.metricTags.length > 0 || item.displayTags.length > 0) && (
                            <span className="ml-2 inline-flex max-w-full translate-y-[-0.08em] flex-wrap items-baseline gap-1 align-baseline">
                              {item.metricTags.map(tag => (
                                <span
                                  key={tag.id}
                                  className="inline-flex items-center rounded border border-white/15 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wider text-white shadow-sm"
                                  style={{
                                    backgroundColor: tag.color,
                                    boxShadow: `0 0 10px color-mix(in srgb, ${tag.color} 45%, transparent)`,
                                  }}
                                >
                                  {tag.label}
                                </span>
                              ))}
                              {item.displayTags.map(tag => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wider text-zinc-400"
                                >
                                  {tag}
                                </span>
                              ))}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
          {dialogs.length > 0 && (
            <div className="relative flex-1 flex flex-col items-center justify-end gap-2 w-full">
              <AnimatePresence initial={false} mode="popLayout">
                {dialogs.map(renderDialog)}
              </AnimatePresence>
            </div>
          )}
        </>
      )}
    </div>
    {compactNoteOverlays && dialogs.length > 0 && (
      <div
        className={cn(
          "pointer-events-none absolute bottom-3 z-[60] flex flex-col items-center gap-2 text-center",
          !alignToMediaFrame && "inset-x-3"
        )}
        style={mediaFrameStyle}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {dialogs.map(renderDialog)}
        </AnimatePresence>
      </div>
    )}
    <NoteOverflowIndicator count={hiddenNoteCount} />
    </>
  );
}

function GraphNoteBadgeCluster({
  graphs,
  compact = false,
}: {
  graphs?: PreviewGraphNote['linkedGraphs'];
  compact?: boolean;
}) {
  if (!graphs?.length) return null;

  const gridGroups = [];
  for (let index = 0; index + 3 < graphs.length; index += 4) {
    gridGroups.push(graphs.slice(index, index + 4));
  }
  const remainingGraphs = graphs.slice(gridGroups.length * 4);

  return (
    <div className="flex shrink-0 gap-1">
      {gridGroups.map((group, groupIndex) => (
      <div className={cn(
        "grid shrink-0 grid-cols-2 overflow-hidden rounded shadow ring-1 ring-black/70",
        compact ? "h-12 w-12" : "h-12 w-12"
      )} key={`grid-${groupIndex}`}>
        {group.map(graph => (
          <span
            key={graph.id}
            className={cn(
              "flex items-center justify-center truncate font-black uppercase leading-none text-white",
              compact ? "text-[10px]" : "text-[10px]"
            )}
            style={{ background: graph.color }}
          >
            {graph.label}
          </span>
        ))}
      </div>
      ))}
      {remainingGraphs.map(graph => (
        <span
          key={graph.id}
          className={cn(
            "flex items-center justify-center truncate rounded font-black uppercase leading-none text-white shadow ring-1 ring-black/70",
            compact ? "h-12 w-12 text-base" : "h-12 w-12 text-base"
          )}
          style={{ background: graph.color }}
        >
          {graph.label}
        </span>
      ))}
    </div>
  );
}

type CompactPreviewTag =
  | {
      id: string;
      label: string;
      color: string;
      min?: number;
      max?: number;
      points?: Array<{ frame: number; value: number }>;
      progress?: number;
      value?: number;
      count?: number;
      isGraph: true;
    }
  | {
      id: string;
      label: string;
      color?: undefined;
      count?: number;
      isGraph: false;
    };

function getCompactNoteTags(item: PreviewGraphNote): CompactPreviewTag[] {
  const graphTags = item.metricTags.map(tag => ({
    id: `${item.id}-graph-${tag.id}`,
    label: tag.label,
    color: tag.color,
    min: tag.min,
    max: tag.max,
    points: tag.points,
    progress: tag.progress,
    value: tag.value,
    isGraph: true as const,
  }));
  const displayTags = item.displayTags
    .filter(tag => normalizeTagKey(tag) !== 'preview')
    .map(tag => ({
      id: `${item.id}-tag-${tag}`,
      label: tag,
      color: undefined,
      isGraph: false as const,
    }));
  const fallbackTags = graphTags.length === 0 && displayTags.length === 0
    ? [{ id: `${item.id}-note`, label: 'note', color: undefined, isGraph: false as const }]
    : [];

  return [...graphTags, ...displayTags, ...fallbackTags];
}

function getCompactGraphValueTags(
  graphValues: PreviewGraphValue[],
): Extract<CompactPreviewTag, { isGraph: true }>[] {
  return graphValues.map(value => ({
    id: value.id,
    label: value.label,
    color: value.color.line || value.color.accent,
    min: value.min,
    max: value.max,
    points: value.points,
    progress: value.progress,
    value: value.value,
    isGraph: true as const,
  }));
}

function dedupeCompactPreviewTags(tags: CompactPreviewTag[]) {
  const visibleTags = new Map<string, CompactPreviewTag>();

  tags.forEach(tag => {
    const tagKey = normalizeTagKey(tag.label);
    const existingTag = visibleTags.get(tagKey);

    if (!existingTag) {
      visibleTags.set(tagKey, { ...tag, count: tag.count ?? 1 });
      return;
    }

    const count = (existingTag.count ?? 1) + (tag.count ?? 1);
    if (tag.isGraph && !existingTag.isGraph) {
      visibleTags.set(tagKey, { ...tag, count });
      return;
    }

    visibleTags.set(tagKey, { ...existingTag, count });
  });

  return Array.from(visibleTags.values());
}

function getCompactGraphSparklineGeometry(
  points: Array<{ frame: number; value: number }> | undefined,
  min: number | undefined,
  max: number | undefined,
  value: number | undefined,
  progress: number | undefined,
) {
  if (!points?.length) return { path: '', marker: null };

  const sortedPoints = [...points].sort((a, b) => a.frame - b.frame);
  const firstFrame = sortedPoints[0]?.frame ?? 0;
  const lastFrame = sortedPoints.at(-1)?.frame ?? firstFrame;
  const frameSpan = Math.max(1, lastFrame - firstFrame);
  const values = sortedPoints.map(point => point.value);
  const valueMin = min ?? Math.min(...values);
  const valueMax = max ?? Math.max(...values);
  const valueSpan = Math.max(1, valueMax - valueMin);

  const path = sortedPoints
    .map((point, index) => {
      const x = ((point.frame - firstFrame) / frameSpan) * 100;
      const y = 18 - ((point.value - valueMin) / valueSpan) * 16;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
  const marker = value === undefined || progress === undefined
    ? null
    : {
        x: Math.max(0, Math.min(1, progress)) * 100,
        y: 18 - ((value - valueMin) / valueSpan) * 16,
      };

  return { path, marker };
}

function CompactGraphTag({
  tag,
}: {
  tag: Extract<CompactPreviewTag, { isGraph: true }>;
}) {
  const { path, marker } = getCompactGraphSparklineGeometry(tag.points, tag.min, tag.max, tag.value, tag.progress);

  return (
    <span
      data-testid="compact-preview-tag"
      data-tag-label={normalizeTagKey(tag.label)}
      data-tag-count={tag.count ?? 1}
      dir="ltr"
      className="relative inline-flex h-12 w-full min-w-0 overflow-hidden rounded-md border border-white/15 px-2 py-1.5 shadow-lg"
      style={{
        backgroundColor: tag.color,
        boxShadow: `0 0 12px color-mix(in srgb, ${tag.color} 40%, transparent)`,
      }}
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-2 top-1.5 h-5 opacity-80"
        viewBox="0 0 100 20"
        preserveAspectRatio="none"
      >
        {path && (
          <>
            <path
              d={path}
              fill="none"
              stroke="rgba(255,255,255,0.9)"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.25"
              vectorEffect="non-scaling-stroke"
            />
            {marker && (
              <circle
                cx={marker.x}
                cy={marker.y}
                r="2.2"
                fill="white"
                stroke="rgba(0,0,0,0.45)"
                strokeWidth="0.7"
              />
            )}
          </>
        )}
      </svg>
      <span className="relative z-10 mt-auto flex w-full items-end justify-between gap-1.5 overflow-hidden font-mono text-[11px] font-black uppercase leading-none tracking-wide text-white drop-shadow">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate">{tag.label}</span>
          {(tag.count ?? 1) > 1 && (
            <span className="shrink-0 rounded-sm bg-black/25 px-1 py-0.5 text-[9px] tabular-nums text-white">
              {tag.count}
            </span>
          )}
        </span>
        {tag.value !== undefined && (
          <span className="shrink-0 tabular-nums text-white">{formatGraphValue(tag.value)}</span>
        )}
      </span>
    </span>
  );
}

function CompactPreviewTagGrid({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <div
      data-testid="compact-preview-tag-grid"
      dir="rtl"
      className="grid w-full grid-cols-[repeat(auto-fill,minmax(min(9rem,100%),1fr))] gap-1.5"
      title={title}
    >
      {children}
    </div>
  );
}

function renderCompactPreviewTag(tag: CompactPreviewTag) {
  return tag.isGraph ? (
    <CompactGraphTag key={tag.id} tag={tag} />
  ) : (
    <span
      key={tag.id}
      data-testid="compact-preview-tag"
      data-tag-label={normalizeTagKey(tag.label)}
      data-tag-count={tag.count ?? 1}
      dir="ltr"
      className="inline-flex h-12 w-full min-w-0 items-center justify-center gap-1.5 rounded-md border border-amber-200/20 bg-zinc-950/88 px-3 py-2 text-[12px] font-black uppercase leading-none tracking-wider text-amber-100 shadow-lg backdrop-blur-md"
    >
      <span className="truncate">{tag.label}</span>
      {(tag.count ?? 1) > 1 && (
        <span className="shrink-0 rounded-sm bg-amber-100/12 px-1.5 py-1 text-[10px] tabular-nums text-amber-100">
          {tag.count}
        </span>
      )}
    </span>
  );
}

export function CompactNotesTagOverlay({
  items,
  leadingGraphTags = [],
}: {
  items: PreviewGraphNote[];
  leadingGraphTags?: Extract<CompactPreviewTag, { isGraph: true }>[];
}) {
  const tags = dedupeCompactPreviewTags([
    ...leadingGraphTags,
    ...items.flatMap(item => (
      getCompactNoteTags(item).filter(tag => leadingGraphTags.length === 0 || !tag.isGraph)
    )),
  ]);

  if (tags.length === 0) return null;

  return (
    <CompactPreviewTagGrid title={items.map(item => item.note).join('\n')}>
      {tags.map(renderCompactPreviewTag)}
    </CompactPreviewTagGrid>
  );
}

export function CompactNoteTagOverlay({
  item,
  includeGraphTags = true,
  leadingGraphTags = [],
}: {
  item: PreviewGraphNote;
  includeGraphTags?: boolean;
  leadingGraphTags?: Extract<CompactPreviewTag, { isGraph: true }>[];
}) {
  const tags = dedupeCompactPreviewTags([
    ...leadingGraphTags,
    ...getCompactNoteTags(item).filter(tag => includeGraphTags || !tag.isGraph),
  ]);

  return (
    <CompactPreviewTagGrid title={item.note}>
      {tags.map(renderCompactPreviewTag)}
    </CompactPreviewTagGrid>
  );
}

function PreviewTopNotes({
  graphNotes,
  graphValues = [],
  topClassName = "top-14 md:top-16",
  align = 'center',
  showNoteOverlayIcons = false,
  compactNoteOverlays = false,
}: {
  graphNotes: PreviewGraphNote[];
  graphValues?: PreviewGraphValue[];
  topClassName?: string;
  align?: 'center' | 'right';
  showNoteOverlayIcons?: boolean;
  compactNoteOverlays?: boolean;
}) {
  const {
    hiddenNoteCount,
    renderNotes,
    setItemRef,
    stackRef,
  } = useFullyVisiblePreviewNotes(graphNotes, { measureOverflow: false });
  const orderedRenderNotes = compactNoteOverlays
    ? orderCompactPreviewNotes(renderNotes)
    : renderNotes;
  const persistentGraphTags = compactNoteOverlays
    ? getCompactGraphValueTags(graphValues)
    : [];

  if (graphNotes.length === 0 && persistentGraphTags.length === 0) return null;

  return (
    <>
    <div className={cn(
      "pointer-events-none absolute z-[55] gap-2 text-center",
      compactNoteOverlays
        ? "inset-x-1.5 top-1.5 flex flex-col items-stretch gap-1.5"
        : cn(
            "flex flex-col h-[66.6667%]",
            align === 'right'
              ? "right-1.5 w-[calc(50%-0.625rem)] items-stretch"
              : "inset-x-3 items-center"
          ),
      topClassName
    )} ref={stackRef}>
      {compactNoteOverlays ? (
        <CompactNotesTagOverlay items={orderedRenderNotes} leadingGraphTags={persistentGraphTags} />
      ) : (
        <div
          style={{ scrollbarGutter: 'stable' }}
          className={cn(
            "relative flex flex-col gap-2 w-full h-full overflow-y-auto pointer-events-auto pr-1 py-1 scrollbar-thin",
            align === 'right' ? "items-stretch" : "items-center"
          )}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {orderedRenderNotes.map(item => (
              <motion.div
                key={`${item.id}-${item.note}`}
                ref={setItemRef(item.id)}
                layout="position"
                {...getNoteOverlayMotion(align === 'right' ? -8 : -14)}
                className={cn(
                  "relative shrink-0 overflow-visible rounded-lg border border-amber-200/20 bg-zinc-950/92 text-left text-white shadow-2xl ring-1 ring-black/60 backdrop-blur-md will-change-[opacity,transform,filter]",
                  align === 'right'
                    ? "min-h-12 w-full px-3 py-2.5"
                    : showNoteOverlayIcons && item.linkedGraphs?.length
                      ? "min-h-14 w-[min(640px,94%)] py-3 pl-3 pr-4"
                      : "min-h-14 w-[min(640px,94%)] px-4 py-3"
                )}
              >
                <div className={cn("flex items-start gap-3", align === 'right' ? "min-h-8" : '')}>
                  {showNoteOverlayIcons && <GraphNoteBadgeCluster graphs={item.linkedGraphs} compact={align === 'right'} />}
                  <div className={cn(
                    "flex min-w-0 flex-1 items-center",
                    align === 'right' ? "min-h-8" : "min-h-8"
                  )}>
                    <div className={cn(
                      "whitespace-normal break-words font-semibold text-zinc-50",
                      align === 'right' ? "text-sm leading-relaxed md:text-base" : "text-lg leading-relaxed md:text-xl"
                    )}>
                      <span>{item.note}</span>
                      {(item.metricTags.length > 0 || item.displayTags.length > 0) && (
                        <span className="ml-2 inline-flex max-w-full translate-y-[-0.08em] flex-wrap items-baseline gap-1 align-baseline">
                          {item.metricTags.map(tag => (
                            <span
                              key={tag.id}
                              className="inline-flex items-center rounded border border-white/15 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wider text-white shadow-sm"
                              style={{
                                backgroundColor: tag.color,
                                boxShadow: `0 0 8px color-mix(in srgb, ${tag.color} 45%, transparent)`,
                              }}
                            >
                              {tag.label}
                            </span>
                          ))}
                          {item.displayTags.map(tag => (
                            <span
                              key={tag}
                              className="inline-flex items-center rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wider text-zinc-400"
                            >
                              {tag}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
    <NoteOverflowIndicator count={hiddenNoteCount} />
    </>
  );
}
function getInitialAnimation(clip: TimelineClip) {
  if (clip.animationMode !== 'all' && clip.animationMode !== 'entrance' && clip.animationMode) {
    return { opacity: 1, x: 0, y: 0, filter: 'blur(0px)' };
  }
  
  if (clip.animationDirection === 'left') return { opacity: 0, x: '-20%', y: 0, filter: 'blur(5px)' };
  if (clip.animationDirection === 'right') return { opacity: 0, x: '20%', y: 0, filter: 'blur(5px)' };
  if (clip.animationDirection === 'top') return { opacity: 0, x: 0, y: '-20%', filter: 'blur(5px)' };
  if (clip.animationDirection === 'bottom') return { opacity: 0, x: 0, y: '20%', filter: 'blur(5px)' };
  
  return { opacity: 0, x: 0, y: 0, filter: 'blur(5px)' };
}

function getExitAnimation(clip: TimelineClip) {
  if (clip.animationMode !== 'all' && clip.animationMode !== 'exit' && clip.animationMode) {
    return { opacity: 1, x: 0, y: 0, filter: 'blur(0px)', transition: { duration: 0 } };
  }
  
  if (clip.animationDirection === 'left') return { opacity: 0, x: '-20%', y: 0, filter: 'blur(5px)' };
  if (clip.animationDirection === 'right') return { opacity: 0, x: '20%', y: 0, filter: 'blur(5px)' };
  if (clip.animationDirection === 'top') return { opacity: 0, x: 0, y: '-20%', filter: 'blur(5px)' };
  if (clip.animationDirection === 'bottom') return { opacity: 0, x: 0, y: '20%', filter: 'blur(5px)' };

  return { opacity: 0, x: 0, y: 0, filter: 'blur(5px)' };
}

function getPreviewGridStyle(count: number, viewportWidth: number, previewGroupLayout: 'row' | 'grid'): React.CSSProperties {
  if (count <= 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };

  const hasHugeViewport = viewportWidth >= 1536;

  if (previewGroupLayout === 'row' && (count < 4 || hasHugeViewport)) {
    return {
      gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
      gridTemplateRows: '1fr',
    };
  }

  if (count === 2) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
  if (count === 3) return { gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr' };
  return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
}

function getAnchorClasses(anchor?: string) {
  switch (anchor) {
    case 'top-left': return "top-2 left-2";
    case 'top-right': return "top-2 right-2";
    case 'bottom-left': return "bottom-2 left-2";
    case 'bottom-right': return "bottom-2 right-2";
    case 'top': return "top-2 left-1/2 -translate-x-1/2";
    case 'bottom': return "bottom-2 left-1/2 -translate-x-1/2";
    case 'left': return "top-1/2 left-2 -translate-y-1/2";
    case 'right': return "top-1/2 right-2 -translate-y-1/2";
    case 'center':
    default: return "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2";
  }
}

function AnalysisModelBadge({ model }: { model?: string }) {
  if (!model) return null;

  const displayModel = model.split(' (')[0]?.trim() || model;

  return (
    <div
      title={`Initial scene analysis by ${model}`}
      data-testid="analysis-model-badge"
      className="pointer-events-none absolute right-2 top-2 z-[54] max-w-[calc(100%-1rem)] text-right text-[10px] font-semibold uppercase leading-none tracking-[0.16em] text-zinc-400/75 drop-shadow-[0_1px_5px_rgba(0,0,0,0.8)] md:right-3 md:top-3"
    >
      <span className="inline-block max-w-full truncate">Initial scene analysis by {displayModel}</span>
    </div>
  );
}

function MultiScenePreview({
  scenes,
  activeSceneId,
  currentFrame,
  aspectRatio,
  disabledTrackIds,
  mutedTrackIds,
  isPlaying,
  fps,
  playbackRate,
  characters,
  previewGroupLayout,
  previewMediaLayout,
  analyticsOverlayStyle,
  showNoteOverlayIcons,
  compactNoteOverlays,
  showDialogPreviewUi,
  showSceneTitleUi,
  noteTagFilter,
  viewportWidth,
  showSceneMuteControls,
  showPreviewTagUi,
  toggleTrackMute,
}: {
  scenes: Scene[];
  activeSceneId: string;
  currentFrame: number;
  aspectRatio: string;
  disabledTrackIds: string[];
  mutedTrackIds: string[];
  isPlaying: boolean;
  fps: number;
  playbackRate: number;
  characters: ReturnType<typeof useTimeline>['characters'];
  previewGroupLayout: 'row' | 'grid';
  previewMediaLayout: PreviewMediaLayout;
  analyticsOverlayStyle: 'compact' | 'analysis';
  showNoteOverlayIcons: boolean;
  compactNoteOverlays: boolean;
  showDialogPreviewUi: boolean;
  showSceneTitleUi: boolean;
  noteTagFilter: string[];
  viewportWidth: number;
  showSceneMuteControls: boolean;
  showPreviewTagUi: boolean;
  toggleTrackMute: (id: string) => void;
}) {
  const getCharacterName = (clip: TimelineClip) => {
    if (clip.characterId) {
      const char = characters.find(c => c.id === clip.characterId);
      return char?.name || clip.character;
    }
    return clip.character;
  };

  const getCharacterImage = (clip: TimelineClip) => {
    if (!clip.characterId) return undefined;
    return characters.find(c => c.id === clip.characterId)?.image;
  };

  const getDialogSpeakerKey = (clip: TimelineClip) => (
    clip.characterId || clip.character || 'dialog-speaker'
  );

  const scenePanels = scenes.map(scene => {
    const activeClips = scene.clips.filter(
      clip => currentFrame >= clip.startFrame && currentFrame < clip.startFrame + clip.duration
    );
    const parentGroups = scene.tracks
      .filter(track => !track.parentId && !disabledTrackIds.includes(track.id))
      .map(parent => {
        const allChildTracks = scene.tracks.filter(track => track.parentId === parent.id);
        const childTracks = scene.tracks.filter(track => track.parentId === parent.id && !disabledTrackIds.includes(track.id));
        const childTrackIds = childTracks.map(track => track.id);
        const clipsInGroup = activeClips.filter(clip => childTrackIds.includes(clip.trackId));
        const activeGridClips = clipsInGroup
          .filter(clip => clip.layoutType !== 'overlay')
          .sort((a, b) => (a.layoutOrder || 0) - (b.layoutOrder || 0));
        const overlayClips = clipsInGroup.filter(clip => clip.layoutType === 'overlay');
        const graphTracks = childTracks.filter(track => track.type === 'graph' && track.graph);
        const allGraphTracks = allChildTracks.filter(track => track.type === 'graph' && track.graph);
        const visibleGraphTrackIds = graphTracks.map(track => track.id);
        const dialogs = overlayClips
          .filter(clip => clip.type === 'dialog')
          .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
        const graphNotes = overlayClips
          .filter(clip => clip.type === 'note')
          .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id))
          .map(clip => {
            const links = getVisibleNoteGraphLinks(clip, allGraphTracks, visibleGraphTrackIds, currentFrame);
            if (!links) return null;
            return {
              id: clip.id,
              note: clip.description?.trim() || clip.name,
              frame: clip.startFrame,
              ...links,
            };
          })
          .filter((note): note is PreviewGraphNote => Boolean(note))
          .filter(note => isNoteVisibleForTagFilter(note, noteTagFilter))
          .sort(comparePreviewGraphNotes);
        const graphDuration = getGraphDisplayDuration(graphTracks, fps);
        const graphValues = graphTracks
          .map((track) => {
            const graphIndex = Math.max(0, allGraphTracks.findIndex(item => item.id === track.id));
            return {
              id: track.id,
              label: getGraphDisplayLabel(track.graph!),
              value: getGraphValueAtFrame(track.graph!, currentFrame),
              progress: getGraphProgressAtFrame(track.graph!, currentFrame),
              min: track.graph!.min,
              max: track.graph!.max,
              points: track.graph!.points,
              color: getGraphColor(track.graph!, graphIndex),
            };
          });

        return {
          ...parent,
          activeGridClips,
          dialogs,
          graphDuration,
          graphNotes,
          graphTracks,
          graphValues,
          gridClips: getAnimatedGridLayout(clipsInGroup, currentFrame, childTrackIds),
          overlayClips: overlayClips.filter(clip => clip.type !== 'dialog' && clip.type !== 'note'),
          notePlacement: parent.notePlacement === 'graph' ? 'graph' : 'dialog',
          graphUiLayout: (parent.graphUiLayout === 'column' || parent.graphUiLayout === 'column-many' ? 'column' : 'grid') as TimelineTrack['graphUiLayout'],
        };
      });

    return { scene, parentGroups };
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#050505] p-4">
      <div
        className="grid min-h-0 flex-1 w-full gap-2"
        style={getPreviewGridStyle(scenePanels.length, viewportWidth, previewGroupLayout)}
      >
        {scenePanels.map(({ scene, parentGroups }, sceneIndex) => {
          const isSceneMuted = mutedTrackIds.includes(scene.id);
          const hasSceneTitleOverlay = showSceneTitleUi && Boolean(scene.name.trim() || scene.description?.trim());

          return (
            <ResponsivePreviewFrame
              key={scene.id}
              aspectRatio={aspectRatio}
              className={cn(
                "relative flex flex-col overflow-hidden rounded border bg-white/[0.02] shadow-2xl",
                scene.id === activeSceneId ? "border-indigo-500/45" : "border-white/5"
              )}
            >
              {showSceneMuteControls && (
                <button
                  type="button"
                  data-testid="review-preview-mute"
                  aria-label={`${isSceneMuted ? 'Unmute' : 'Mute'} preview ${sceneIndex + 1}: ${scene.name}`}
                  aria-pressed={isSceneMuted}
                  title={`${isSceneMuted ? 'Unmute' : 'Mute'} preview ${sceneIndex + 1}: ${scene.name}`}
                  onClick={() => toggleTrackMute(scene.id)}
                  className={cn(
                    "absolute right-2 top-2 z-[90] inline-flex h-8 w-8 items-center justify-center rounded-md border bg-black/65 text-zinc-200 shadow-lg backdrop-blur transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/80",
                    isSceneMuted
                      ? "border-zinc-400/60 text-white hover:bg-zinc-800"
                      : "border-white/15 hover:border-white/30 hover:bg-black/80"
                  )}
                >
                  {isSceneMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
              )}
            <div
              className="grid h-full w-full gap-1 p-1"
              style={getPreviewGridStyle(parentGroups.length, viewportWidth, previewGroupLayout)}
            >
              {parentGroups.length === 0 ? (
                <div className="col-span-full row-span-full flex items-center justify-center text-[10px] font-mono uppercase tracking-widest text-zinc-800">
                  No Output
                </div>
              ) : parentGroups.map(group => (
                <div key={group.id} className="relative min-h-0 min-w-0 overflow-hidden rounded-sm border border-white/10 bg-black">
                  <AnalysisModelBadge model={scene.analysisModel} />
                  {showSceneTitleUi && (
                    <PreviewSceneTitle
                      title={scene.name}
                      description={scene.description}
                      mediaLayout={previewMediaLayout}
                    />
                  )}
                  <AnimatePresence mode="popLayout" initial={false}>
                    {group.gridClips.length === 0 ? (
                      <motion.div
                        key={`${group.id}-empty`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center"
                      >
                        <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-800">No Input</span>
                      </motion.div>
                    ) : group.gridClips.map(({ clip, rect }) => {
                      const visualStyle = getCssVisualStyle(getClipVisualState(clip, currentFrame - clip.startFrame));
                      const mediaStyle = getPreviewMediaStyle(previewMediaLayout);
                      return (
                        <div
                          key={clip.id}
                          className="absolute min-h-0 min-w-0 p-0"
                          style={{
                            left: `${rect.left}%`,
                            top: `${rect.top}%`,
                            width: `${rect.width}%`,
                            height: `${rect.height}%`,
                          }}
                        >
                          <motion.div
                            style={visualStyle}
                            className="group relative flex h-full w-full items-center justify-center overflow-hidden rounded-sm border border-white/10 bg-black shadow-inner"
                          >
                            <motion.div layout="position" className={cn("absolute inset-0 opacity-40 mix-blend-color", clip.color || "bg-black")} />
                            {(clip.type === 'video' || clip.type === 'image') && (
                              <PreviewMediaBackdrop mediaLayout={previewMediaLayout} />
                            )}
                            {clip.type === 'video' && clip.src && (
                              <PreviewVideo key={`${clip.id}-${clip.src || 'missing-src'}`} clip={clip} currentFrame={currentFrame} isPlaying={isPlaying} fps={fps} playbackRate={playbackRate} muted={isSceneMuted || mutedTrackIds.includes(clip.trackId) || mutedTrackIds.includes(group.id)} mediaLayout={previewMediaLayout} />
                            )}
                            {clip.type === 'image' && clip.src && (
                              <img src={clip.src} alt={clip.name} className="absolute" style={mediaStyle} />
                            )}
                            {!clip.src && (
                              <motion.div layout className="z-10 flex flex-col items-center p-3 text-center text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
                                <motion.span layout className="text-sm font-black uppercase leading-none tracking-tighter">
                                  {clip.name}
                                </motion.span>
                                {clip.description && (
                                  <motion.p layout className="mt-1 max-w-[180px] text-[9px] leading-tight text-zinc-400 line-clamp-2">
                                    {clip.description}
                                  </motion.p>
                                )}
                              </motion.div>
                            )}
                          </motion.div>
                        </div>
                      );
                    })}
                  </AnimatePresence>

                  {showPreviewTagUi && (analyticsOverlayStyle === 'analysis' ? (
                    <AnalysisOverlay
                      graphTracks={group.graphTracks}
                      graphNotes={group.graphNotes}
                      dialogs={showDialogPreviewUi ? group.dialogs : []}
                      currentFrame={currentFrame}
                      fps={fps}
                      totalDuration={group.graphDuration}
                    />
                  ) : !(compactNoteOverlays && group.graphValues.length > 0) && (
                    <GraphTopOverlay
                      graphTracks={group.graphTracks}
                      graphValues={[]}
                      currentFrame={currentFrame}
                      fps={fps}
                      totalDuration={group.graphDuration}
                      mediaLayout={previewMediaLayout}
                      reserveTitleSpace={hasSceneTitleOverlay}
                      graphUiLayout={group.graphUiLayout}
                    />
                  ))}
                  {showPreviewTagUi && analyticsOverlayStyle !== 'analysis' && group.notePlacement === 'graph' && (
                    <PreviewTopNotes
                      graphNotes={group.graphNotes}
                      graphValues={group.graphValues}
                      topClassName="top-1.5"
                      align="right"
                      showNoteOverlayIcons={showNoteOverlayIcons}
                      compactNoteOverlays={compactNoteOverlays}
                    />
                  )}
                  {(!showPreviewTagUi || analyticsOverlayStyle !== 'analysis') && (
                    <PreviewBottomMessages
                      dialogs={showDialogPreviewUi ? group.dialogs : []}
                      graphNotes={showPreviewTagUi && group.notePlacement !== 'graph' ? group.graphNotes : []}
                      graphValues={showPreviewTagUi && group.notePlacement !== 'graph' ? group.graphValues : []}
                      getCharacterImage={getCharacterImage}
                      getCharacterName={getCharacterName}
                      getDialogSpeakerKey={getDialogSpeakerKey}
                      multilineDialogs
                      showNoteOverlayIcons={showNoteOverlayIcons}
                      compactNoteOverlays={compactNoteOverlays}
                      alignToMediaFrame={previewMediaLayout === 'inset'}
                    />
                  )}
                  {group.overlayClips.map(clip => (
                    <motion.div
                      key={clip.id}
                      className={cn(
                        "absolute z-30",
                        getAnchorClasses(clip.anchorPoint),
                        clip.type !== 'dialog' && "min-w-[110px] max-w-[80%] max-h-[80%]",
                        clip.type === 'video' && "aspect-video overflow-hidden rounded-sm bg-black shadow-2xl ring-2 ring-white/10",
                        clip.type === 'image' && "overflow-hidden rounded-sm shadow-2xl ring-2 ring-white/10",
                      )}
                    >
                      {clip.type === 'image' && clip.src && <img src={clip.src} alt={clip.name} className="max-h-full max-w-full object-contain" />}
                      {clip.type === 'video' && clip.src && <PreviewVideo key={`${clip.id}-${clip.src || 'missing-src'}`} clip={clip} currentFrame={currentFrame} isPlaying={isPlaying} fps={fps} playbackRate={playbackRate} muted={isSceneMuted || mutedTrackIds.includes(clip.trackId) || mutedTrackIds.includes(group.id)} mediaLayout={previewMediaLayout} />}
                    </motion.div>
                  ))}
                </div>
              ))}
            </div>
            </ResponsivePreviewFrame>
          );
        })}
      </div>
    </div>
  );
}

export function Preview({
  showSceneMuteControls = false,
  showPreviewTagUi = true,
  useTagOverlayPresentation = false,
}: {
  showSceneMuteControls?: boolean;
  showPreviewTagUi?: boolean;
  useTagOverlayPresentation?: boolean;
} = {}) {
  const {
    currentFrame,
    scenes,
    activeSceneId,
    clips,
    tracks,
    aspectRatio,
    disabledTrackIds,
    mutedTrackIds,
    isPlaying,
    fps,
    playbackRate,
    characters,
    previewGroupLayout,
    previewMediaLayout,
    previewSceneMode,
    previewSceneIds,
    analyticsOverlayStyle,
    showNoteOverlayIcons,
    compactNoteOverlays,
    showDialogPreviewUi,
    showSceneTitleUi,
    noteTagFilter,
    toggleTrackMute,
  } = useTimeline();
  const renderedAnalyticsOverlayStyle = useTagOverlayPresentation ? 'compact' : analyticsOverlayStyle;
  const renderedCompactNoteOverlays = useTagOverlayPresentation ? true : compactNoteOverlays;
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = React.useState(0);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);

    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  const activeClips = clips.filter(
    (clip) => currentFrame >= clip.startFrame && currentFrame < clip.startFrame + clip.duration
  );

  const getCharacterName = (clip: TimelineClip) => {
    if (clip.characterId) {
      const char = characters.find(c => c.id === clip.characterId);
      return char?.name || clip.character;
    }
    return clip.character;
  };

  const getCharacterImage = (clip: TimelineClip) => {
    if (!clip.characterId) return undefined;
    return characters.find(c => c.id === clip.characterId)?.image;
  };

  const getDialogSpeakerKey = (clip: TimelineClip) => (
    clip.characterId || clip.character || 'dialog-speaker'
  );
  const parentGroups = useMemo(() => {
    const parents = tracks.filter(t => !t.parentId && !disabledTrackIds.includes(t.id));
    return parents.map(p => {
      const allChildTracks = tracks.filter(t => t.parentId === p.id);
      const childTracks = tracks.filter(t => t.parentId === p.id && !disabledTrackIds.includes(t.id));
      const childTrackIds = childTracks.map(t => t.id);
      const clipsInGroup = activeClips.filter(c => childTrackIds.includes(c.trackId));
      const activeGridClips = clipsInGroup
        .filter(c => c.layoutType !== 'overlay')
        .sort((a, b) => (a.layoutOrder || 0) - (b.layoutOrder || 0));
      const overlayClips = clipsInGroup.filter(c => c.layoutType === 'overlay');
      const graphTracks = childTracks.filter(track => track.type === 'graph' && track.graph);
      const allGraphTracks = allChildTracks.filter(track => track.type === 'graph' && track.graph);
      const visibleGraphTrackIds = graphTracks.map(track => track.id);
      const dialogs = overlayClips
        .filter(clip => clip.type === 'dialog')
        .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
      const notes = overlayClips
        .filter(clip => clip.type === 'note')
        .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id))
        .map(clip => {
          const links = getVisibleNoteGraphLinks(clip, allGraphTracks, visibleGraphTrackIds, currentFrame);
          if (!links) return null;
          return {
            id: clip.id,
            note: clip.description?.trim() || clip.name,
            frame: clip.startFrame,
            ...links,
          };
        })
        .filter((note): note is PreviewGraphNote => Boolean(note))
        .filter(note => isNoteVisibleForTagFilter(note, noteTagFilter))
        .sort(comparePreviewGraphNotes);
      const graphDuration = getGraphDisplayDuration(graphTracks, fps);
      const graphValues = graphTracks
        .map((track) => {
          const graphIndex = Math.max(0, allGraphTracks.findIndex(item => item.id === track.id));
          return {
            id: track.id,
            label: getGraphDisplayLabel(track.graph!),
            value: getGraphValueAtFrame(track.graph!, currentFrame),
            progress: getGraphProgressAtFrame(track.graph!, currentFrame),
            min: track.graph!.min,
            max: track.graph!.max,
            points: track.graph!.points,
            color: getGraphColor(track.graph!, graphIndex),
          };
        });
      return {
        ...p,
        gridClips: getAnimatedGridLayout(clipsInGroup, currentFrame, childTrackIds),
        activeGridClips,
        graphNotes: notes,
        graphDuration,
        graphTracks,
        graphValues,
        overlayClips: overlayClips.filter(clip => clip.type !== 'dialog' && clip.type !== 'note'),
        dialogs,
        notePlacement: p.notePlacement === 'graph' ? 'graph' : 'dialog',
        graphUiLayout: (p.graphUiLayout === 'column' || p.graphUiLayout === 'column-many' ? 'column' : 'grid') as TimelineTrack['graphUiLayout'],
      };
    });
  }, [activeClips, currentFrame, fps, tracks, disabledTrackIds, noteTagFilter]);

  const gridClipIds = parentGroups.flatMap(g => g.activeGridClips.map(c => c.id)).join(',');
  const [gridState, setGridState] = React.useState({ prevCount: 0, currentCount: 0, currentIds: '' });

  if (gridClipIds !== gridState.currentIds) {
    setGridState({ 
      prevCount: gridState.currentCount, 
      currentCount: parentGroups.reduce((acc, g) => acc + g.activeGridClips.length, 0),
      currentIds: gridClipIds 
    });
  }

  const isOneToOneTransition = gridState.currentCount === 1 && gridState.prevCount === 1;

  const getAnchorClasses = (anchor?: string) => {
    switch (anchor) {
      case 'top-left': return "top-2 left-2";
      case 'top-right': return "top-2 right-2";
      case 'bottom-left': return "bottom-2 left-2";
      case 'bottom-right': return "bottom-2 right-2";
      case 'top': return "top-2 left-1/2 -translate-x-1/2";
      case 'bottom': return "bottom-2 left-1/2 -translate-x-1/2";
      case 'left': return "top-1/2 left-2 -translate-y-1/2";
      case 'right': return "top-1/2 right-2 -translate-y-1/2";
      case 'center':
      default: return "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2";
    }
  };

  const getPreviewGridStyle = (count: number): React.CSSProperties => {
    if (count <= 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };

    const hasHugeViewport = viewportWidth >= 1536;

    if (previewGroupLayout === 'row' && (count < 4 || hasHugeViewport)) {
      return {
        gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
        gridTemplateRows: '1fr',
      };
    }

    if (count === 2) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
    if (count === 3) return { gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr' };
    return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
  };

  const enabledPreviewSceneIds = previewSceneIds.length > 0 ? new Set(previewSceneIds) : undefined;
  const enabledPreviewScenes = enabledPreviewSceneIds
    ? scenes.filter(scene => enabledPreviewSceneIds.has(scene.id))
    : scenes;
  const previewScenes = enabledPreviewScenes.length > 0
    ? enabledPreviewScenes
    : scenes.filter(scene => scene.id === activeSceneId);
  const activePreviewScene = scenes.find(scene => scene.id === activeSceneId);
  const shouldShowMultiScenePreview = previewScenes.length > 1 || previewSceneMode === 'all';
  const hasSceneTitleOverlay = showSceneTitleUi && Boolean(activePreviewScene?.name.trim() || activePreviewScene?.description?.trim());

  if (shouldShowMultiScenePreview) {
    return (
      <MultiScenePreview
        scenes={previewScenes}
        activeSceneId={activeSceneId}
        currentFrame={currentFrame}
        aspectRatio={aspectRatio}
        disabledTrackIds={disabledTrackIds}
        mutedTrackIds={mutedTrackIds}
        isPlaying={isPlaying}
        fps={fps}
        playbackRate={playbackRate}
        characters={characters}
        previewGroupLayout={previewGroupLayout}
        previewMediaLayout={previewMediaLayout}
        analyticsOverlayStyle={renderedAnalyticsOverlayStyle}
        showNoteOverlayIcons={showNoteOverlayIcons}
        compactNoteOverlays={renderedCompactNoteOverlays}
        showDialogPreviewUi={showDialogPreviewUi}
        showSceneTitleUi={showSceneTitleUi}
        noteTagFilter={noteTagFilter}
        viewportWidth={viewportWidth}
        showSceneMuteControls={showSceneMuteControls}
        showPreviewTagUi={showPreviewTagUi}
        toggleTrackMute={toggleTrackMute}
      />
    );
  }

  const dialogPanelSplit = {
    detail: { bottom: 0, boxSizing: 'border-box' as const, left: '66.6667%', overflow: 'hidden' as const, position: 'absolute' as const, top: 0, width: '33.3333%' },
    visual: { bottom: 0, left: 0, position: 'absolute' as const, top: 0, width: '66.6667%' },
  };
  const fullPanelVisual = { bottom: 0, left: 0, position: 'absolute' as const, top: 0, width: '100%' };
  const hasDialogGridItemGroups = parentGroups.some(group => group.showDialogGridItem);

  if (hasDialogGridItemGroups) {
    const enabledParents = tracks.filter(t => !t.parentId && !disabledTrackIds.includes(t.id));
    const getVisualTrackIdsForParent = (parentId: string) => tracks
      .filter(t => (
        t.parentId === parentId &&
        t.type !== 'graph' &&
        !disabledTrackIds.includes(t.id)
      ))
      .map(t => t.id);
    const parentHasVisualContent = (parentId: string) => {
      const visualTrackIds = getVisualTrackIdsForParent(parentId);
      return clips.some(clip => (
        clip.type !== 'dialog' &&
        clip.type !== 'note' &&
        visualTrackIds.includes(clip.trackId)
      ));
    };
    const visualParents = enabledParents.filter(parent => parentHasVisualContent(parent.id));
    const firstDialogGridParentIndex = visualParents.findIndex(parent => parent.showDialogGridItem);
    const graphOnlyParentIds = enabledParents
      .filter(parent => !parentHasVisualContent(parent.id))
      .map(parent => parent.id);
    const detachedGraphTrackIds = tracks
      .filter(t => (
        t.type === 'graph' &&
        t.graph &&
        t.parentId &&
        graphOnlyParentIds.includes(t.parentId) &&
        !disabledTrackIds.includes(t.id)
      ))
      .map(t => t.id);
    const allDetachedGraphTrackIds = tracks
      .filter(t => (
        t.type === 'graph' &&
        t.graph &&
        t.parentId &&
        graphOnlyParentIds.includes(t.parentId)
      ))
      .map(t => t.id);
    const visualGroups = visualParents.map((parent, parentIndex) => {
      const allGroupTrackIds = tracks
        .filter(t => t.parentId === parent.id)
        .map(t => t.id);
      const groupTrackIds = tracks
        .filter(t => t.parentId === parent.id && !disabledTrackIds.includes(t.id))
        .map(t => t.id);
      const graphTrackIds = parent.showDialogGridItem && parentIndex === firstDialogGridParentIndex
        ? [...groupTrackIds, ...detachedGraphTrackIds]
        : groupTrackIds;
      const allGraphTrackIds = parent.showDialogGridItem && parentIndex === firstDialogGridParentIndex
        ? [...allGroupTrackIds, ...allDetachedGraphTrackIds]
        : allGroupTrackIds;
      const groupVisualTrackIds = getVisualTrackIdsForParent(parent.id);
      const groupVisualClips = clips.filter(clip => clip.type !== 'dialog' && clip.type !== 'note' && groupVisualTrackIds.includes(clip.trackId));
      const groupGraphTracks = tracks.filter(track => (
        track.type === 'graph' &&
        track.graph &&
        graphTrackIds.includes(track.id)
      ));
      const allGroupGraphTracks = tracks.filter(track => (
        track.type === 'graph' &&
        track.graph &&
        allGraphTrackIds.includes(track.id)
      ));
      const visibleGraphTrackIds = groupGraphTracks.map(track => track.id);
      const groupDialogs = activeClips
        .filter(clip => clip.type === 'dialog' && groupVisualTrackIds.includes(clip.trackId))
        .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
      const groupNotes = activeClips
        .filter(clip => clip.type === 'note' && groupVisualTrackIds.includes(clip.trackId))
        .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id))
        .map(clip => {
          const links = getVisibleNoteGraphLinks(clip, allGroupGraphTracks, visibleGraphTrackIds, currentFrame);
          if (!links) return null;
          return {
            id: clip.id,
            note: clip.description?.trim() || clip.name,
            frame: clip.startFrame,
            ...links,
          };
        })
        .filter((note): note is PreviewGraphNote => Boolean(note))
        .filter(note => isNoteVisibleForTagFilter(note, noteTagFilter))
        .sort(comparePreviewGraphNotes);
      const groupGraphDuration = getGraphDisplayDuration(groupGraphTracks, fps);
      const groupGraphValues = groupGraphTracks
        .map((track) => {
          const graphIndex = Math.max(0, allGroupGraphTracks.findIndex(item => item.id === track.id));
          return {
            id: track.id,
            label: getGraphDisplayLabel(track.graph!),
            value: getGraphValueAtFrame(track.graph!, currentFrame),
            progress: getGraphProgressAtFrame(track.graph!, currentFrame),
            min: track.graph!.min,
            max: track.graph!.max,
            points: track.graph!.points,
            color: getGraphColor(track.graph!, graphIndex),
          };
        });
      return {
        id: parent.id,
        name: parent.name,
        dialogs: groupDialogs,
        graphNotes: groupNotes,
        graphNoteIds: new Set<string>(),
        graphDuration: groupGraphDuration,
        graphTracks: groupGraphTracks,
        graphValues: groupGraphValues,
        gridClips: getAnimatedGridLayout(groupVisualClips, currentFrame, groupVisualTrackIds),
        notePlacement: parent.notePlacement === 'graph' ? 'graph' : 'dialog',
        graphUiLayout: (parent.graphUiLayout === 'column' || parent.graphUiLayout === 'column-many' ? 'column' : 'grid') as TimelineTrack['graphUiLayout'],
        showDialogGridItem: !!parent.showDialogGridItem,
      };
    });
    return (
      <div ref={containerRef} className="flex-1 bg-[#050505] flex items-center justify-center relative overflow-hidden group p-4">
        <div
          className="grid h-full w-full gap-1 p-1 xl:gap-2 xl:p-2"
          style={getPreviewGridStyle(visualGroups.length)}
        >
          {visualGroups.length === 0 ? (
            <div className="col-span-full row-span-full flex items-center justify-center text-zinc-800 font-mono text-sm uppercase tracking-[0.2em]">
              No Output
            </div>
          ) : visualGroups.map((group) => {
            const useAnalysisOverlay = showPreviewTagUi && renderedAnalyticsOverlayStyle === 'analysis';
            const useCompactGraphTags = showPreviewTagUi && renderedCompactNoteOverlays && group.graphValues.length > 0;
            const visualPanelStyle = showPreviewTagUi && group.showDialogGridItem && !useAnalysisOverlay && !useCompactGraphTags
              ? dialogPanelSplit.visual
              : fullPanelVisual;

            return (
          <ResponsivePreviewFrame
            key={group.id}
            aspectRatio={aspectRatio}
            className="relative overflow-hidden shadow-2xl rounded border border-white/5 bg-white/[0.02]"
          >
            <AnalysisModelBadge model={activePreviewScene?.analysisModel} />
            <div className="absolute inset-0">
            <div style={visualPanelStyle}>
              <div className="relative h-full w-full overflow-hidden rounded-sm border border-white/5 bg-white/[0.01]">
                    {showSceneTitleUi && (
                      <PreviewSceneTitle
                        title={activePreviewScene?.name}
                        description={activePreviewScene?.description}
                        mediaLayout={previewMediaLayout}
                      />
                    )}
                    <AnimatePresence mode="popLayout" initial={false} custom={isOneToOneTransition}>
                      {group.gridClips.length === 0 ? (
                        <motion.div
                          key={`${group.id}-no-input`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 flex items-center justify-center"
                        >
                          <span className="text-[10px] font-mono text-zinc-800 uppercase tracking-widest">No Input</span>
                        </motion.div>
                      ) : group.gridClips.map(({ clip, rect }) => {
                        const visualStyle = getCssVisualStyle(getClipVisualState(clip, currentFrame - clip.startFrame));
                        return (
                          <div
                            key={clip.id}
                            className="absolute min-h-0 min-w-0 p-0"
                            style={{
                              left: `${rect.left}%`,
                              top: `${rect.top}%`,
                              width: `${rect.width}%`,
                              height: `${rect.height}%`,
                            }}
                          >
                            <motion.div
                              style={visualStyle}
                              className="group relative flex h-full w-full items-center justify-center overflow-hidden rounded-sm border border-white/10 bg-black shadow-inner"
                            >
                              <motion.div layout="position" className={cn("absolute inset-0 opacity-40 mix-blend-color", clip.color || "bg-black")} />
                              <motion.div layout="position" className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
                                <motion.div layout="position" className="absolute top-1/2 left-1/2 h-[150%] w-[150%] -translate-x-1/2 -translate-y-1/2 rotate-12 bg-gradient-to-br from-white/20 to-transparent blur-3xl" />
                              </motion.div>

                              {(clip.type === 'video' || clip.type === 'image') && (
                                <PreviewMediaBackdrop mediaLayout={previewMediaLayout} />
                              )}
                              {clip.type === 'video' && clip.src && (
                                <PreviewVideo key={`${clip.id}-${clip.src || 'missing-src'}`} clip={clip} currentFrame={currentFrame} isPlaying={isPlaying} fps={fps} playbackRate={playbackRate} muted={mutedTrackIds.includes(clip.trackId) || mutedTrackIds.includes(group.id)} mediaLayout={previewMediaLayout} />
                              )}
                              {clip.type === 'image' && clip.src && (
                                <img src={clip.src} alt={clip.name} className="absolute" style={getPreviewMediaStyle(previewMediaLayout)} />
                              )}
                              {!clip.src && (
                                <motion.div layout className="z-10 flex flex-col items-center p-4 text-center text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
                                  <motion.span layout className="text-xl font-black uppercase leading-none tracking-tighter">
                                    {clip.name}
                                  </motion.span>
                                  {clip.description && (
                                    <motion.p layout className="mt-2 max-w-[200px] text-[10px] leading-tight text-zinc-400 line-clamp-3">
                                      {clip.description}
                                    </motion.p>
                                  )}
                                </motion.div>
                              )}
                            </motion.div>
                          </div>
                        );
                      })}
                    </AnimatePresence>
                    {useAnalysisOverlay ? (
                      <AnalysisOverlay
                        graphTracks={group.graphTracks}
                        graphNotes={group.graphNotes}
                        dialogs={showDialogPreviewUi ? group.dialogs : []}
                        currentFrame={currentFrame}
                        fps={fps}
                        totalDuration={group.graphDuration}
                      />
                    ) : !showPreviewTagUi || useCompactGraphTags ? null : group.showDialogGridItem ? (
                      <GraphValueBadges values={group.graphValues} mediaLayout={previewMediaLayout} reserveTitleSpace={hasSceneTitleOverlay} />
                    ) : (
                      <GraphTopOverlay
                        graphTracks={group.graphTracks}
                        graphValues={group.graphValues}
                        currentFrame={currentFrame}
                        fps={fps}
                        totalDuration={group.graphDuration}
                        mediaLayout={previewMediaLayout}
                        reserveTitleSpace={hasSceneTitleOverlay}
                        graphUiLayout={group.graphUiLayout}
                      />
                    )}
                    {showPreviewTagUi && !useAnalysisOverlay && group.notePlacement === 'graph' && (
                      <PreviewTopNotes
                        graphNotes={group.graphNotes}
                        graphValues={group.graphValues}
                        topClassName="top-1.5"
                        align="right"
                        showNoteOverlayIcons={showNoteOverlayIcons}
                        compactNoteOverlays={renderedCompactNoteOverlays}
                      />
                    )}
                    {!useAnalysisOverlay && <PreviewBottomMessages
                      dialogs={showDialogPreviewUi ? group.dialogs : []}
                      graphNotes={showPreviewTagUi && group.notePlacement !== 'graph' ? group.graphNotes : []}
                      graphValues={showPreviewTagUi && group.notePlacement !== 'graph' ? group.graphValues : []}
                      getCharacterImage={getCharacterImage}
                      getCharacterName={getCharacterName}
                      getDialogSpeakerKey={getDialogSpeakerKey}
                      multilineDialogs={!group.showDialogGridItem}
                      showNoteOverlayIcons={showNoteOverlayIcons}
                      compactNoteOverlays={renderedCompactNoteOverlays}
                      alignToMediaFrame={previewMediaLayout === 'inset'}
                    />}
                  </div>
              </div>
            {showPreviewTagUi && group.showDialogGridItem && !useAnalysisOverlay && !useCompactGraphTags && (
            <div style={dialogPanelSplit.detail}>
              <div
                className="relative h-full w-full min-w-0 overflow-hidden rounded-sm border p-1.5 text-center shadow-inner"
                style={{
                  background: graphPanelBackground,
                  borderColor: 'rgba(255,255,255,0.12)',
                  boxSizing: 'border-box',
                  maxWidth: '100%',
                }}
              >
                {group.graphTracks.length > 0 && (
                  <div className="absolute inset-x-1.5 bottom-1.5 z-10 w-auto min-w-0 max-w-full space-y-2 overflow-hidden">
                    {group.graphTracks.map((track, graphIndex) => {
                      const graph = track.graph!;
                      const graphColor = group.graphValues.find(item => item.id === track.id)?.color ?? getGraphColor(graph, graphIndex);
                      const isBarGraph = graph.type === 'bar';
                      const graphHasValueAxis = shouldShowGraphValue(graph);
                      const points = [...graph.points].sort((a, b) => a.frame - b.frame);
                      const barIntervalFrames = Math.max(1, Math.round((graph.barIntervalSeconds ?? 0.5) * fps));
                      const graphDuration = getGraphDisplayDuration([track], fps);
                      const valueRange = Math.max(1, graph.max - graph.min);
                      const segments = (points.length ? points : [{ frame: 0, value: Math.max(graph.min, Math.min(graph.max, 0)) }]).map((point, index, source) => ({
                        ...point,
                        endFrame: isBarGraph ? point.frame + barIntervalFrames : source[index + 1]?.frame ?? graphDuration,
                      }));

                      return (
                        <div key={track.id} className={cn(
                          "relative w-full min-w-0 max-w-full overflow-hidden rounded border px-1.5 py-1.5 text-left shadow-2xl",
                          graphHasValueAxis ? "h-24" : "h-12"
                        )} style={{
                          background: getGraphCardBackground(graphColor),
                          borderColor: graphColor.border,
                          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 24px rgba(0,0,0,0.28), 0 0 20px ${graphColor.fill}`,
                          boxSizing: 'border-box',
                        }}>
                          <div className={cn(
                            "mb-1 flex min-w-0 items-baseline gap-1.5 overflow-hidden font-black uppercase tracking-widest",
                            graphHasValueAxis ? "text-[10px]" : "text-[9px]"
                          )} style={{ color: graphColor.accent }}>
                            <span className="flex min-w-0 items-center gap-1.5 truncate">
                              <Activity className="h-3 w-3 shrink-0" />
                              <span className="min-w-0 truncate">{getGraphDisplayLabel(graph)}</span>
                            </span>
                            {graphHasValueAxis && (
                              <span className="font-mono text-[8px] tracking-normal text-zinc-500">
                                ({graph.min}-{graph.max})
                              </span>
                            )}
                          </div>
                          <div className={cn("relative overflow-visible rounded bg-white/[0.03]", graphHasValueAxis ? "h-14" : "h-5")}>
                            <div className="absolute inset-x-1 inset-y-0 overflow-visible">
                            {segments.map((segment, index) => {
                              if (segment.frame >= graphDuration) return null;
                              const segmentEndFrame = Math.min(segment.endFrame, graphDuration);
                              const left = (segment.frame / graphDuration) * 100;
                              const width = ((segmentEndFrame - segment.frame) / graphDuration) * 100;
                              const markerLeft = isBarGraph ? left + width / 2 : left;
                              const top = graphHasValueAxis ? 100 - ((segment.value - graph.min) / valueRange) * 100 : 50;
                              const nextSegment = !isBarGraph ? segments[index + 1] : undefined;
                              const nextLeft = nextSegment ? (nextSegment.frame / graphDuration) * 100 : left;
                              const nextTop = nextSegment && graphHasValueAxis
                                ? 100 - ((nextSegment.value - graph.min) / valueRange) * 100
                                : top;
                              return (
                                <React.Fragment key={`${segment.frame}-${index}`}>
                                  {isBarGraph ? (
                                    <div
                                      className="absolute rounded-t-sm"
                                      style={{
                                        background: graphColor.fill,
                                        left: `${markerLeft}%`,
                                        width: `calc(${width}% + 1px)`,
                                        top: graphHasValueAxis ? `${top}%` : 'calc(50% - 1px)',
                                        bottom: graphHasValueAxis ? 0 : undefined,
                                        height: graphHasValueAxis ? undefined : 2,
                                      }}
                                    />
                                  ) : nextSegment ? (
                                    <svg className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none">
                                      <line
                                        x1={`${left}%`}
                                        y1={`${top}%`}
                                        x2={`${nextLeft}%`}
                                        y2={`${nextTop}%`}
                                        stroke={graphColor.line}
                                        strokeWidth="2"
                                        vectorEffect="non-scaling-stroke"
                                      />
                                    </svg>
                                  ) : null}
                                  <div
                                    className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/60 shadow"
                                    style={{
                                      background: graphColor.line,
                                      boxShadow: `0 0 8px ${graphColor.border}`,
                                      left: `${markerLeft}%`,
                                      top: `${top}%`,
                                    }}
                                  />
                                </React.Fragment>
                              );
                            })}
                            </div>
                            <div
                              className="absolute top-0 bottom-0 w-px bg-white shadow-[0_0_8px_rgba(255,255,255,0.7)]"
                              style={{
                                left: `calc(${(Math.min(currentFrame, graphDuration) / graphDuration) * 100}% + ${4 - 8 * (Math.min(currentFrame, graphDuration) / graphDuration)}px)`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            )}
            </div>
          </ResponsivePreviewFrame>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 bg-[#050505] flex items-center justify-center relative overflow-hidden group p-4">
      <div
        className="grid h-full w-full gap-1 p-1 xl:gap-2 xl:p-2"
        style={getPreviewGridStyle(parentGroups.length)}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {parentGroups.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="col-span-full row-span-full flex items-center justify-center text-zinc-800 font-mono text-sm uppercase tracking-[0.2em]"
            >
              No Output
            </motion.div>
          ) : (
            parentGroups.map((group) => (
              <ResponsivePreviewFrame
                key={group.id}
                aspectRatio={aspectRatio}
                className="relative flex flex-col overflow-hidden shadow-2xl rounded border border-white/5 bg-white/[0.02]"
              >
                  <AnalysisModelBadge model={activePreviewScene?.analysisModel} />
                  <div className="relative h-full w-full flex-1 min-h-0 min-w-0">
                    {showSceneTitleUi && (
                      <PreviewSceneTitle
                        title={activePreviewScene?.name}
                        description={activePreviewScene?.description}
                        mediaLayout={previewMediaLayout}
                      />
                    )}
                    <AnimatePresence mode="popLayout" initial={false} custom={isOneToOneTransition}>
                      {group.activeGridClips.length === 0 && group.gridClips.length === 0 ? (
                        <motion.div 
                          key="no-input"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 flex items-center justify-center border border-white/5 bg-white/[0.01] rounded-sm"
                        >
                          <span className="text-[10px] font-mono text-zinc-800 uppercase tracking-widest">No Input</span>
                        </motion.div>
                      ) : group.gridClips.map(({ clip, rect }) => {
                        const isSingleInGrid = parentGroups.length === 1 && group.activeGridClips.length === 1;
                        const visualStyle = getCssVisualStyle(getClipVisualState(clip, currentFrame - clip.startFrame));
                        return (
                          <div
                            key={clip.id}
                            className="absolute min-h-0 min-w-0 p-0"
                            style={{
                              left: `${rect.left}%`,
                              top: `${rect.top}%`,
                              width: `${rect.width}%`,
                              height: `${rect.height}%`,
                            }}
                          >
                            <motion.div
                            style={visualStyle}
                            className={cn(
                              "group relative flex items-center justify-center rounded-sm overflow-hidden border border-white/10 shadow-inner w-full h-full bg-black",
                            )}
                          >
                             <motion.div layout="position" className={cn("absolute inset-0 opacity-40 mix-blend-color", clip.color || "bg-black")} />
                             
                             <motion.div layout="position" className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
                                <motion.div layout="position" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] bg-gradient-to-br from-white/20 to-transparent blur-3xl rotate-12" />
                             </motion.div>
                             {(clip.type === 'video' || clip.type === 'image') && (
                               <PreviewMediaBackdrop mediaLayout={previewMediaLayout} />
                             )}
                      
                             {clip.src ? (
                               <>
                                 {clip.type === 'video' && (
                                   <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                                      <div className="relative h-full w-full flex-shrink-0">
                                        <PreviewVideo key={`${clip.id}-${clip.src || 'missing-src'}`} clip={clip} currentFrame={currentFrame} isPlaying={isPlaying} fps={fps} playbackRate={playbackRate} muted={mutedTrackIds.includes(clip.trackId) || mutedTrackIds.includes(group.id)} mediaLayout={previewMediaLayout} />
                                      </div>
                                   </div>
                                 )}
                                 {clip.type === 'image' && (
                                   <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                                     <img 
                                       src={clip.src} 
                                       alt={clip.name} 
                                       className="absolute"
                                       style={getPreviewMediaStyle(previewMediaLayout)}
                                     />
                                   </div>
                                 )}
                                 {clip.type !== 'image' && (
                                   <motion.div layout="position" className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent z-10 flex flex-col items-center group-hover:from-black transition-all">
                                    {clip.type === 'dialog' && getCharacterName(clip) && (
                                       <motion.span layout="position" className="text-[8px] font-black bg-white text-black px-1.5 py-0.5 rounded shadow-xl tracking-[0.1em] mb-1 uppercase">
                                         {getCharacterName(clip)}
                                       </motion.span>
                                    )}
                                    <motion.span layout="position" className="font-black uppercase tracking-tighter leading-none text-white text-sm">
                                      {clip.name}
                                    </motion.span>
                                    {clip.description && (
                                      <motion.p layout="position" className="text-[10px] text-zinc-300 mt-1 line-clamp-2 leading-tight max-w-[80%] text-center">
                                        {clip.description}
                                      </motion.p>
                                    )}
                                   </motion.div>
                                 )}
                               </>
                             ) : (
                               <motion.div layout className="text-white text-center drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)] z-10 flex flex-col items-center p-4">
                                 {clip.type === 'dialog' && getCharacterName(clip) && (
                                   <motion.span layout className="text-[8px] font-black bg-white text-black px-1.5 py-0.5 rounded shadow-xl tracking-[0.1em] mb-1 uppercase">
                                     {getCharacterName(clip)}
                                   </motion.span>
                                 )}
                                 <motion.span layout className={cn(
                                   "font-black uppercase tracking-tighter leading-none",
                                   isSingleInGrid ? "text-6xl" : "text-xl"
                                 )}>
                                   {clip.name}
                                 </motion.span>
                                 {clip.description && (
                                   <motion.p layout className={cn(
                                     "text-zinc-400 mt-2 line-clamp-3 max-w-[200px] leading-tight",
                                     isSingleInGrid ? "text-sm" : "text-[10px]"
                                   )}>
                                     {clip.description}
                                   </motion.p>
                                 )}
                               </motion.div>
                             )}
                          </motion.div>
                          </div>
                        );
                      })}
                    </AnimatePresence>
                    {showPreviewTagUi && (renderedAnalyticsOverlayStyle === 'analysis' ? (
                      <AnalysisOverlay
                        graphTracks={group.graphTracks}
                        graphNotes={group.graphNotes}
                        dialogs={showDialogPreviewUi ? group.dialogs : []}
                        currentFrame={currentFrame}
                        fps={fps}
                        totalDuration={group.graphDuration}
                      />
                    ) : !(renderedCompactNoteOverlays && group.graphValues.length > 0) && !group.showDialogGridItem && (
                      <GraphTopOverlay
                        graphTracks={group.graphTracks}
                        graphValues={group.graphValues}
                        currentFrame={currentFrame}
                        fps={fps}
                        totalDuration={group.graphDuration}
                        mediaLayout={previewMediaLayout}
                        reserveTitleSpace={hasSceneTitleOverlay}
                        graphUiLayout={group.graphUiLayout}
                      />
                    ))}
                    {showPreviewTagUi && renderedAnalyticsOverlayStyle !== 'analysis' && group.notePlacement === 'graph' && (
                      <PreviewTopNotes
                        graphNotes={group.graphNotes}
                        graphValues={group.graphValues}
                        topClassName="top-1.5"
                        align="right"
                        showNoteOverlayIcons={showNoteOverlayIcons}
                        compactNoteOverlays={renderedCompactNoteOverlays}
                      />
                    )}
                    {(!showPreviewTagUi || renderedAnalyticsOverlayStyle !== 'analysis') && <PreviewBottomMessages
                      dialogs={showDialogPreviewUi ? group.dialogs : []}
                      graphNotes={showPreviewTagUi && group.notePlacement !== 'graph' ? group.graphNotes : []}
                      graphValues={showPreviewTagUi && group.notePlacement !== 'graph' ? group.graphValues : []}
                      getCharacterImage={getCharacterImage}
                      getCharacterName={getCharacterName}
                      getDialogSpeakerKey={getDialogSpeakerKey}
                      multilineDialogs
                      showNoteOverlayIcons={showNoteOverlayIcons}
                      compactNoteOverlays={renderedCompactNoteOverlays}
                      alignToMediaFrame={previewMediaLayout === 'inset'}
                    />}
                  </div>

                  {/* Overlays */}
                  <AnimatePresence mode="popLayout">
                    {group.overlayClips.map((clip) => (
                      <motion.div 
                        key={clip.id} 
                        layout="position"
                        layoutId={`overlay-${clip.id}`}
                        initial={getInitialAnimation(clip)}
                        animate={{ opacity: 1, x: 0, y: 0, filter: 'blur(0px)' }}
                        exit={getExitAnimation(clip)}
                        transition={{ 
                          layout: { type: 'spring', damping: 30, stiffness: 300, restDelta: 0.001 },
                          default: clip.animationMode === 'none' ? { duration: 0.1 } : { type: 'spring', damping: 25, stiffness: 300 }
                        }}
                        className={cn(
                          "absolute z-30",
                          getAnchorClasses(clip.anchorPoint),
                          clip.type !== 'dialog' && "min-w-[140px] max-w-[80%] max-h-[80%]",
                          clip.type === 'video' && "bg-black aspect-video shadow-2xl ring-2 ring-white/10 rounded-sm overflow-hidden",
                          clip.type === 'image' && "bg-black aspect-video shadow-2xl ring-2 ring-white/10 rounded-sm overflow-hidden",
                          clip.type === 'dialog' && "w-[min(520px,94%)]"
                        )}
                      >
                          {clip.type !== 'dialog' && (
                            <>
                              <motion.div layout="position" className={cn("absolute inset-0 opacity-40 mix-blend-color", clip.color || "bg-black")} />
                              <motion.div layout="position" className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
                                 <motion.div layout="position" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] bg-gradient-to-br from-white/20 to-transparent blur-3xl rotate-12" />
                              </motion.div>
                            </>
                          )}
                  
                         {clip.src ? (
                           <>
                             {clip.type === 'video' && (
                               <PreviewVideo key={`${clip.id}-${clip.src || 'missing-src'}`} clip={clip} currentFrame={currentFrame} isPlaying={isPlaying} fps={fps} playbackRate={playbackRate} muted={mutedTrackIds.includes(clip.trackId) || mutedTrackIds.includes(group.id)} mediaLayout={previewMediaLayout} />
                             )}
                             {clip.type === 'image' && (
                               <motion.img 
                                 layout
                                 src={clip.src} 
                                 alt={clip.name} 
                                 className="absolute inset-0 w-full h-full object-cover" 
                               />
                             )}
                              {clip.type !== 'dialog' && clip.type !== 'image' && (
                                <motion.div layout="position" className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent z-10 flex flex-col items-center group-hover:from-black transition-all">
                                   {getCharacterName(clip) && (
                                     <motion.span layout="position" className="text-[8px] font-black bg-white text-black px-1.5 py-0.5 rounded shadow-xl tracking-[0.1em] mb-1 uppercase">
                                       {getCharacterName(clip)}
                                     </motion.span>
                                   )}
                                   <motion.span layout="position" className="font-black uppercase tracking-tighter leading-none text-white text-sm">
                                     {clip.name}
                                   </motion.span>
                                   {clip.description && (
                                     <motion.p layout="position" className="text-[10px] text-zinc-300 mt-1 line-clamp-2 leading-tight max-w-[80%] text-center">
                                       {clip.description}
                                     </motion.p>
                                   )}
                                </motion.div>
                              )}
                              {clip.type === 'dialog' && (() => {
                                const characterImage = getCharacterImage(clip);
                                const characterName = getCharacterName(clip);
                                const hasValidHeadshot = characterImage && !characterImage.includes('dicebear.com') && !characterImage.includes('adventurer');
                                return (
                                  <motion.div layout="position" className="flex w-full items-stretch gap-3.5 rounded-xl border border-white/15 bg-black/80 overflow-hidden pr-3.5 text-left text-white shadow-2xl backdrop-blur-md">
                                    <div className="relative shrink-0 aspect-square w-16 md:w-20 overflow-hidden bg-zinc-900 border-r border-white/10 flex items-center justify-center">
                                      {hasValidHeadshot ? (
                                        <motion.img
                                          layout="position"
                                          src={characterImage}
                                          alt=""
                                          className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                                        />
                                      ) : (
                                        <div className="h-full w-full flex items-center justify-center text-zinc-400 shadow-inner">
                                          <User className="h-6 w-6 md:h-8 md:w-8 text-zinc-400" />
                                        </div>
                                      )}
                                      {characterName && (
                                        <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5 text-center" title={characterName}>
                                          <span className="block truncate text-[8px] font-black uppercase tracking-[0.10em] text-white">
                                            {characterName}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1 py-3 pl-0.5 flex flex-col justify-center gap-0.5">
                                      <motion.div layout="position" className="text-xs font-semibold leading-tight tracking-tight md:text-sm">
                                        {clip.name}
                                      </motion.div>
                                      {clip.description && (
                                        <motion.p layout="position" className="text-[10px] leading-normal text-zinc-300 md:text-xs">
                                          {clip.description}
                                        </motion.p>
                                      )}
                                    </div>
                                  </motion.div>
                                );
                              })()}
                           </>
                         ) : (
                          <motion.div layout className={cn(
                            "z-10",
                            clip.type === 'dialog'
                              ? "w-full"
                              : "flex flex-col items-center p-2 text-center text-white"
                          )}>
                             {clip.type === 'dialog' && (() => {
                                const characterImage = getCharacterImage(clip);
                                const characterName = getCharacterName(clip);
                                const hasValidHeadshot = characterImage && !characterImage.includes('dicebear.com') && !characterImage.includes('adventurer');
                                return (
                                  <motion.div layout="position" className="flex w-full items-stretch gap-3.5 rounded-xl border border-white/15 bg-black/80 overflow-hidden pr-3.5 text-left text-white shadow-2xl backdrop-blur-md">
                                    <div className="relative shrink-0 aspect-square w-16 md:w-20 overflow-hidden bg-zinc-900 border-r border-white/10 flex items-center justify-center">
                                      {hasValidHeadshot ? (
                                        <motion.img
                                          layout
                                          src={characterImage}
                                          alt=""
                                          className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                                        />
                                      ) : (
                                        <div className="h-full w-full flex items-center justify-center text-zinc-400 shadow-inner">
                                          <User className="h-6 w-6 md:h-8 md:w-8 text-zinc-400" />
                                        </div>
                                      )}
                                      {characterName && (
                                        <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5 text-center" title={characterName}>
                                          <span className="block truncate text-[8px] font-black uppercase tracking-[0.10em] text-white">
                                            {characterName}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1 py-3 pl-0.5 flex flex-col justify-center gap-0.5">
                                      <motion.div layout className="text-xs font-semibold leading-tight tracking-tight md:text-sm">
                                        {clip.name}
                                      </motion.div>
                                      {clip.description && (
                                        <motion.p layout className="text-[10px] leading-normal text-zinc-300 md:text-xs">
                                          {clip.description}
                                        </motion.p>
                                      )}
                                    </div>
                                  </motion.div>
                                );
                              })()}
                             {clip.type !== 'dialog' && (
                               <>
                                 <motion.span layout className="font-black uppercase tracking-tighter leading-none text-xl">
                                   {clip.name}
                                 </motion.span>
                                 {clip.description && (
                                   <motion.p layout className="text-zinc-400 mt-2 line-clamp-3 max-w-[200px] leading-tight text-[10px]">
                                     {clip.description}
                                   </motion.p>
                                 )}
                               </>
                             )}
                           </motion.div>
                         )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
              </ResponsivePreviewFrame>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
