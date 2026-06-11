'use client';

import React, { useRef, useEffect, useMemo, useState } from 'react';
import { motion, useMotionValue } from 'motion/react';
import { useTimeline, TimelineClip, TimelineTrack } from '@/lib/timeline-context';
import { getDefaultGraphShortLabel, isHexColor } from '@/lib/graph-style';
import { TrackRow } from './TrackRow';
import { Ruler } from './Ruler';
import { Playhead } from './Playhead';
import { 
  Layers, 
  ChevronDown, 
  ChevronRight, 
  Volume2, 
  VolumeX, 
  Plus, 
  Trash2, 
  Edit2, 
  SquarePlus,
  MoreVertical,
  Type,
  Activity,
  Check,
  X,
  Copy,
  ClipboardPaste,
  MessageSquare
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  Button,
} from "@storyboard/ui";
import { cn } from '@/lib/utils';
import { toast } from "sonner";

type GraphEditorState = {
  mode: 'create' | 'edit';
  parentId?: string;
  track?: TimelineTrack;
  graphType: 'line' | 'bar';
  label: string;
  shortLabel: string;
  min: string;
  max: string;
  increment: string;
  barIntervalSeconds: string;
  showValue: boolean;
  noteDurationSeconds: string;
  color: string;
  error?: string;
};

type CopiedLayer = {
  name: string;
  type?: TimelineTrack['type'];
  graph?: NonNullable<TimelineTrack['graph']>;
  clips: TimelineClip[];
};

type LayerSectionId = 'media' | 'dialog' | 'notes' | 'graph';

type LayerSection = {
  id: LayerSectionId;
  label: string;
  tracks: TimelineTrack[];
};

const shouldDefaultGraphShowValue = (label?: string) => (
  /\btension\b/i.test(label || '')
);

const LAYER_SECTIONS: Array<Omit<LayerSection, 'tracks'>> = [
  { id: 'media', label: 'Media' },
  { id: 'dialog', label: 'Dialog' },
  { id: 'notes', label: 'Notes' },
  { id: 'graph', label: 'Graph Layers' },
];

const cloneGraph = (graph: TimelineTrack['graph']): TimelineTrack['graph'] => (
  graph
    ? {
      ...graph,
      points: graph.points.map(point => ({ ...point })),
    }
    : undefined
);

export function TimelineRoot() {
  const { 
    scenes,
    activeSceneId,
    setActiveScene,
    previewSceneIds,
    tracks, 
    clips,
    totalDuration, 
    zoom, 
    setZoom,
    currentFrame, 
    setCurrentFrame, 
    collapsedTrackIds, 
    toggleTrackCollapse, 
    disabledTrackIds, 
    toggleTrackDisable, 
    mutedTrackIds,
    toggleTrackMute,
    snapLineFrame,
    addTrack,
    addGraphTrack,
    addTrackGroup,
    duplicateTrackGroup,
    updateTrack,
    deleteTrack,
    addClip,
    selectClip,
    setSelectedClipIds
  } = useTimeline();
  const headerRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const hasFittedRef = useRef(false);
  const prevActiveSceneIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeSceneId !== prevActiveSceneIdRef.current) {
      prevActiveSceneIdRef.current = activeSceneId;
      hasFittedRef.current = false;
    }
  }, [activeSceneId]);

  useEffect(() => {
    if (!contentRef.current || hasFittedRef.current) return;

    if (clips.length === 0) return;

    const timer = setTimeout(() => {
      if (!contentRef.current || hasFittedRef.current) return;
      const containerWidth = contentRef.current.clientWidth;
      if (containerWidth <= 0) return;

      if (totalDuration > 0) {
        const targetZoom = (containerWidth - 48) / totalDuration;
        const clampedZoom = Math.max(1, Math.min(20, Number(targetZoom.toFixed(2))));
        setZoom(clampedZoom);
        hasFittedRef.current = true;
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [activeSceneId, clips, setZoom]);

  const [lassoStart, setLassoStart] = useState<{ x: number, y: number } | null>(null);
  const [lassoEnd, setLassoEnd] = useState<{ x: number, y: number } | null>(null);
  const [isLassoing, setIsLassoing] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [graphEditor, setGraphEditor] = useState<GraphEditorState | null>(null);
  const [copiedLayer, setCopiedLayer] = useState<CopiedLayer | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const getTakenGraphShortLabels = (excludeTrackId?: string, sourceTracks = tracks) => sourceTracks
    .filter(track => (
      track.type === 'graph' &&
      track.id !== excludeTrackId &&
      track.graph?.shortLabel?.trim()
    ))
    .map(track => track.graph!.shortLabel!.trim());

  useEffect(() => {
    if (renamingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingId]);
  
  const SIDEBAR_WIDTH = 256; 
  const timelineWidth = totalDuration * zoom;
  const enabledTimelineSceneIds = useMemo(() => (
    previewSceneIds.length > 0 ? new Set(previewSceneIds) : undefined
  ), [previewSceneIds]);
  const timelineScenes = useMemo(() => {
    const enabledScenes = enabledTimelineSceneIds
      ? scenes.filter(scene => enabledTimelineSceneIds.has(scene.id))
      : scenes;
    const visibleScenes = enabledScenes.length > 0 ? enabledScenes : scenes.filter(scene => scene.id === activeSceneId);
    return visibleScenes.length > 1 ? visibleScenes : scenes.filter(scene => scene.id === activeSceneId);
  }, [activeSceneId, enabledTimelineSceneIds, scenes]);
  const isMultiSceneTimeline = timelineScenes.length > 1;
  const parentTracks = useMemo(() => timelineScenes.flatMap(scene => scene.tracks.filter(t => !t.parentId)), [timelineScenes]);
  const activeParentTracks = useMemo(() => tracks.filter(t => !t.parentId), [tracks]);
  const getLayerSectionCollapseId = React.useCallback((parentId: string, sectionId: LayerSectionId) => (
    `${parentId}::layer-section::${sectionId}`
  ), []);
  const getLayerKind = React.useCallback((track: Pick<TimelineTrack, 'id' | 'name' | 'type'> | Pick<CopiedLayer, 'name' | 'type'>, sourceClips = clips): LayerSectionId => {
    if (track.type === 'graph') return 'graph';

    const trackClips = 'id' in track ? sourceClips.filter(clip => clip.trackId === track.id) : [];
    const hasMedia = trackClips.some(clip => clip.type === 'video' || clip.type === 'image');
    const hasDialog = trackClips.some(clip => clip.type === 'dialog');
    const hasNotes = trackClips.some(clip => clip.type === 'note');
    const name = track.name.toLowerCase();

    if (!hasMedia && !hasDialog && (hasNotes || /\bnotes?\b/.test(name))) return 'notes';
    if (!hasMedia && (hasDialog || /\bdialog\b|\bnarrat/.test(name))) return 'dialog';
    return 'media';
  }, [clips]);
  const getLayerSections = React.useCallback((parent: TimelineTrack, sourceTracks = tracks, sourceClips = clips): LayerSection[] => {
    const children = sourceTracks.filter(track => track.parentId === parent.id);
    return LAYER_SECTIONS
      .map(section => ({
        ...section,
        tracks: children.filter(child => getLayerKind(child, sourceClips) === section.id),
      }))
      .filter(section => section.tracks.length > 0);
  }, [clips, getLayerKind, tracks]);
  // Track Lasso
  useEffect(() => {
    if (!isLassoing || !lassoStart || !contentRef.current) return;

    const container = contentRef.current;
    
    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      setLassoEnd({
        x: e.clientX - rect.left + container.scrollLeft,
        y: e.clientY - rect.top + container.scrollTop
      });
    };

    const onPointerUp = (e: PointerEvent) => {
      setIsLassoing(false);
      
      if (!lassoEnd) {
        setLassoStart(null);
        return;
      }

      // Calculate items inside
      const rect = container.getBoundingClientRect();
      const currentEnd = {
        x: e.clientX - rect.left + container.scrollLeft,
        y: e.clientY - rect.top + container.scrollTop
      };

      const x1 = Math.min(lassoStart.x, currentEnd.x);
      const x2 = Math.max(lassoStart.x, currentEnd.x);
      const y1 = Math.min(lassoStart.y, currentEnd.y);
      const y2 = Math.max(lassoStart.y, currentEnd.y);

      const selectedIds: string[] = [];
      let currentY = 0;
      const visibleTracks: { id: string; top: number; bottom: number }[] = [];
      
      parentTracks.forEach(parent => {
        currentY += 32; // parent header (h-8)
        if (!collapsedTrackIds.includes(parent.id)) {
          const children = tracks.filter(track => track.parentId === parent.id);
          LAYER_SECTIONS
            .map(section => ({
              ...section,
              tracks: children.filter(child => getLayerKind(child) === section.id),
            }))
            .filter(section => section.tracks.length > 0)
            .forEach(section => {
            currentY += 32; // layer type section header (h-8)
            if (!collapsedTrackIds.includes(getLayerSectionCollapseId(parent.id, section.id))) {
              section.tracks.forEach(child => {
                visibleTracks.push({
                  id: child.id,
                  top: currentY,
                  bottom: currentY + 48 // track row (h-12)
                });
                currentY += 48;
              });
            }
          });
        }
      });

      clips.forEach(clip => {
        const trackInfo = visibleTracks.find(vt => vt.id === clip.trackId);
        if (!trackInfo) return;

        const clipLeft = clip.startFrame * zoom;
        const clipRight = (clip.startFrame + clip.duration) * zoom;
        const clipTop = trackInfo.top;
        const clipBottom = trackInfo.bottom;

        if (x1 < clipRight && x2 > clipLeft && y1 < clipBottom && y2 > clipTop) {
          selectedIds.push(clip.id);
        }
      });

      setSelectedClipIds(selectedIds);
      setLassoStart(null);
      setLassoEnd(null);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isLassoing, lassoStart, lassoEnd, clips, parentTracks, tracks, collapsedTrackIds, zoom, setSelectedClipIds, getLayerKind, getLayerSectionCollapseId]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (headerRef.current) headerRef.current.scrollLeft = target.scrollLeft;
    if (sidebarRef.current) sidebarRef.current.scrollTop = target.scrollTop;
  };

  const handleSidebarWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!contentRef.current) return;

    e.preventDefault();
    contentRef.current.scrollTop += e.deltaY;
  };

  const handleTimelineClick = (e: React.MouseEvent | React.PointerEvent) => {
    if (!contentRef.current) return;
    const rect = contentRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + contentRef.current.scrollLeft;
    const frame = Math.max(0, Math.floor(x / zoom));
    setCurrentFrame(Math.min(frame, totalDuration));
  };

  const handleRenameSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (renamingId && renameValue.trim()) {
      updateTrack(renamingId, { name: renameValue.trim() });
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const startRenaming = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  };

  const getSectionIcon = (sectionId: LayerSectionId) => {
    switch (sectionId) {
      case 'dialog':
        return <Type className="h-3.5 w-3.5 text-zinc-500" />;
      case 'notes':
        return <MessageSquare className="h-3.5 w-3.5 text-zinc-500" />;
      case 'graph':
        return <Activity className="h-3.5 w-3.5 text-zinc-500" />;
      case 'media':
      default:
        return <Layers className="h-3.5 w-3.5 text-zinc-500" />;
    }
  };

  const copyLayer = (track: TimelineTrack, sourceClips = clips) => {
    setCopiedLayer({
      name: track.name,
      type: track.type,
      graph: cloneGraph(track.graph),
      clips: sourceClips
        .filter(clip => clip.trackId === track.id)
        .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id))
        .map(clip => ({ ...clip })),
    });
    toast.success(`Copied ${track.name}`);
  };

  const canPasteLayer = (target: TimelineTrack) => (
    Boolean(copiedLayer) && getLayerKind(copiedLayer!) === getLayerKind(target)
  );

  const pasteLayer = (target: TimelineTrack) => {
    if (!copiedLayer) return;

    if (!canPasteLayer(target)) {
      toast.error('Copied layer type does not match this layer.');
      return;
    }

    updateTrack(target.id, {
      name: copiedLayer.name,
      type: copiedLayer.type,
      graph: cloneGraph(copiedLayer.graph),
    });

    if (getLayerKind(copiedLayer) === 'media') {
      copiedLayer.clips.forEach((clip, index) => {
        addClip({
          ...clip,
          id: `clip-${Date.now()}-${index}`,
          trackId: target.id,
        });
      });
    }

    toast.success(`Pasted ${copiedLayer.name}`);
  };

  const openCreateGraphEditor = (parentId: string, sourceTracks = tracks) => {
    const label = 'Tension';
    setGraphEditor({
      mode: 'create',
      parentId,
      graphType: 'line',
      label,
      shortLabel: getDefaultGraphShortLabel(label, getTakenGraphShortLabels(undefined, sourceTracks)),
      min: '0',
      max: '5',
      increment: '0.5',
      barIntervalSeconds: '0.5',
      showValue: true,
      noteDurationSeconds: '3',
      color: '#155e75',
    });
  };

  const openEditGraphEditor = (track: TimelineTrack, sourceTracks = tracks) => {
    const label = track.graph?.label || track.name;
    setGraphEditor({
      mode: 'edit',
      track,
      graphType: track.graph?.type === 'bar' ? 'bar' : 'line',
      label,
      shortLabel: track.graph?.shortLabel || getDefaultGraphShortLabel(label, getTakenGraphShortLabels(track.id, sourceTracks)),
      min: String(track.graph?.min ?? 0),
      max: String(track.graph?.max ?? 5),
      increment: String(track.graph?.increment ?? 0.5),
      barIntervalSeconds: String(track.graph?.barIntervalSeconds ?? 0.5),
      showValue: track.graph?.showValue ?? shouldDefaultGraphShowValue(track.graph?.label || track.name),
      noteDurationSeconds: String(track.graph?.noteDurationSeconds ?? 3),
      color: track.graph?.color || '#155e75',
    });
  };

  const saveGraphEditor = () => {
    if (!graphEditor) return;

    const label = graphEditor.label.trim();
    const shortLabel = graphEditor.shortLabel.trim();
    const min = Number(graphEditor.min);
    const max = Number(graphEditor.max);
    const increment = Number(graphEditor.increment);
    const barIntervalSeconds = Number(graphEditor.barIntervalSeconds);
    const noteDurationSeconds = Number(graphEditor.noteDurationSeconds);

    if (!label) {
      setGraphEditor({ ...graphEditor, error: 'Name the graph before saving.' });
      return;
    }

    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      setGraphEditor({ ...graphEditor, error: 'Use a valid range where max is greater than min.' });
      return;
    }

    if (!Number.isFinite(increment) || increment <= 0) {
      setGraphEditor({ ...graphEditor, error: 'Use a valid increment greater than zero.' });
      return;
    }

    if (graphEditor.graphType === 'bar' && (!Number.isFinite(barIntervalSeconds) || barIntervalSeconds <= 0)) {
      setGraphEditor({ ...graphEditor, error: 'Use a valid bar interval greater than zero.' });
      return;
    }

    if (!Number.isFinite(noteDurationSeconds) || noteDurationSeconds < 0.25 || noteDurationSeconds > 30) {
      setGraphEditor({ ...graphEditor, error: 'Note display must be between 0.25 and 30 seconds.' });
      return;
    }

    if (!isHexColor(graphEditor.color)) {
      setGraphEditor({ ...graphEditor, error: 'Use a valid 6-digit hex color.' });
      return;
    }

    if (graphEditor.mode === 'create') {
      const nextShortLabel = shortLabel || getDefaultGraphShortLabel(label, getTakenGraphShortLabels());
      addGraphTrack(graphEditor.parentId, {
        type: graphEditor.graphType,
        label,
        shortLabel: nextShortLabel,
        min,
        max,
        increment,
        barIntervalSeconds,
        showValue: graphEditor.showValue,
        noteDurationSeconds,
        color: graphEditor.color,
      });
    } else if (graphEditor.track?.graph) {
      const previousGraph = graphEditor.track.graph;
      const nextShortLabel = shortLabel || getDefaultGraphShortLabel(label, getTakenGraphShortLabels(graphEditor.track.id));
      const defaultValue = Math.max(min, Math.min(max, 0));
      const graphTypeChanged = (previousGraph.type ?? 'line') !== graphEditor.graphType;
      const nextPoints = graphTypeChanged
        ? graphEditor.graphType === 'line'
          ? [{ frame: 0, value: defaultValue }, { frame: totalDuration, value: defaultValue }]
          : []
        : previousGraph.points.map(point => ({
          ...point,
          value: Math.max(min, Math.min(max, point.value)),
        }));

      updateTrack(graphEditor.track.id, {
        name: label,
        graph: {
          ...previousGraph,
          type: graphEditor.graphType,
          label,
          shortLabel: nextShortLabel,
          min,
          max,
          increment,
          barIntervalSeconds,
          showValue: graphEditor.showValue,
          noteDurationSeconds,
          color: graphEditor.color,
          points: nextPoints.length > 0 ? nextPoints : [{ frame: 0, value: defaultValue }],
        },
      });
    }

    setGraphEditor(null);
  };

  const renderLayerSectionHeader = (parentId: string, section: LayerSection) => {
    const sectionCollapseId = getLayerSectionCollapseId(parentId, section.id);
    const isSectionCollapsed = collapsedTrackIds.includes(sectionCollapseId);

    return (
      <button
        type="button"
        className="grid h-8 shrink-0 grid-cols-[24px_18px_minmax(0,1fr)_auto] items-center border-b border-white/[0.05] bg-zinc-900/20 pl-3 pr-2 text-left transition-colors hover:bg-zinc-800/55"
        onClick={() => toggleTrackCollapse(sectionCollapseId)}
      >
        {isSectionCollapsed ? (
          <ChevronRight className="h-2.5 w-2.5 text-zinc-500" />
        ) : (
          <ChevronDown className="h-2.5 w-2.5 text-zinc-500" />
        )}
        <span className="flex items-center justify-start pr-2">{getSectionIcon(section.id)}</span>
        <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
          {section.label}
        </span>
        <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] text-zinc-600">
          {section.tracks.length}
        </span>
      </button>
    );
  };

  const renderSidebarTrackRow = (parent: TimelineTrack, child: TimelineTrack, isParentMuted: boolean, sceneClips = clips, sceneTracks = tracks) => {
    const isChildDisabled = disabledTrackIds.includes(child.id);
    const isChildMuted = mutedTrackIds.includes(child.id);
    const isChildEffectivelyMuted = isParentMuted || isChildMuted;
    const isGraphLayer = child.type === 'graph' && child.graph;

    return (
      <div key={child.id} className={cn(
        "h-12 border-b border-white/[0.05] flex items-center px-4 pl-[55px] relative shrink-0 group/layer hover:bg-white/[0.02] transition-colors",
        isChildDisabled && "opacity-50 grayscale"
      )}>
        <div className="w-px h-full bg-zinc-800/40 absolute left-6" />
        <div className="flex-1 flex items-center min-w-0 pr-1">
          {renamingId === child.id ? (
            <form onSubmit={handleRenameSubmit} className="flex-1 min-w-0">
              <input
                ref={inputRef}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={() => handleRenameSubmit()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                className="w-full bg-zinc-800 text-[12px] text-zinc-100 outline-none border border-sky-500 rounded px-1.5 h-7 font-medium"
              />
            </form>
          ) : (
            <span className="text-[12px] font-medium text-zinc-300 truncate leading-tight">
              {child.name}
            </span>
          )}
        </div>

        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover/layer:opacity-100 transition-opacity gap-1">
          {!isGraphLayer && (
            <button
              type="button"
              className={cn(
                "p-1 rounded hover:bg-zinc-800 transition-colors cursor-pointer outline-none",
                isChildMuted ? "text-red-400" : "text-zinc-500 hover:text-zinc-200"
              )}
              onClick={() => toggleTrackMute(child.id)}
              title={isChildMuted ? "Unmute Layer" : "Mute Layer"}
            >
              {isChildMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger className="p-1 rounded bg-[#18181b]/90 backdrop-blur-md border border-zinc-700/50 shadow-xl text-zinc-500 hover:text-zinc-200 cursor-pointer outline-none">
              <MoreVertical className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-44 border border-border bg-popover text-popover-foreground shadow-2xl backdrop-blur-xl"
            >
              {!isGraphLayer && (
                <>
                  <DropdownMenuItem onClick={() => {
                    addClip({
                      id: `clip-${Date.now()}`,
                      name: 'New Item',
                      type: 'video',
                      startFrame: currentFrame,
                      duration: 90,
                      trackId: child.id,
                      color: 'bg-indigo-600',
                    });
                  }}>
                    <Plus className="h-3.5 w-3.5 mr-2" /> Add Item
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    addClip({
                      id: `clip-${Date.now()}`,
                      name: 'Note',
                      type: 'note',
                      startFrame: currentFrame,
                      duration: 90,
                      trackId: child.id,
                      color: 'bg-amber-600',
                    });
                  }}>
                    <MessageSquare className="h-3.5 w-3.5 mr-2" /> Add Note
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem onClick={() => setTimeout(() => startRenaming(child.id, child.name), 150)}>
                <Type className="h-3.5 w-3.5 mr-2" /> Rename Layer
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => copyLayer(child, sceneClips)}>
                <Copy className="h-3.5 w-3.5 mr-2" /> Copy Layer
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canPasteLayer(child)} onClick={() => pasteLayer(child)}>
                <ClipboardPaste className="h-3.5 w-3.5 mr-2" /> Paste Layer
              </DropdownMenuItem>
              {isGraphLayer && (
                <>
                  <DropdownMenuItem onClick={() => openEditGraphEditor(child, sceneTracks)}>
                    <Activity className="h-3.5 w-3.5 mr-2" /> Configure Graph
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-red-300 hover:text-red-200 focus:bg-red-400/10 focus:text-red-200"
                    onClick={() => updateTrack(child.id, {
                      graph: {
                        ...child.graph!,
                        points: [],
                      },
                    })}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Clear Graph Nodes
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem onClick={() => {
                if (isParentMuted) toggleTrackMute(parent.id);
                if (!isParentMuted) toggleTrackMute(child.id);
              }}>
                {isChildEffectivelyMuted ? (
                  <><Volume2 className="h-3.5 w-3.5 mr-2" /> Unmute Layer</>
                ) : (
                  <><VolumeX className="h-3.5 w-3.5 mr-2" /> Mute Layer</>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                className="text-red-400 hover:text-red-300 focus:bg-red-400/10 focus:text-red-300"
                onClick={() => deleteTrack(child.id)}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete Layer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0a0b] select-none overflow-hidden touch-none">
      {graphEditor && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
          onMouseDown={() => setGraphEditor(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-zinc-700/70 bg-[#111114] p-5 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  <Activity className="h-4 w-4 text-purple-300" />
                  {graphEditor.mode === 'create' ? 'Add Graph Layer' : 'Configure Graph'}
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Set the label and valid value range for timeline graph nodes.
                </p>
              </div>
              <button
                type="button"
                className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
                onClick={() => setGraphEditor(null)}
                aria-label="Close graph editor"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-zinc-500">Graph Type</span>
                <select
                  value={graphEditor.graphType}
                  onChange={(e) => setGraphEditor({
                    ...graphEditor,
                    graphType: e.target.value === 'bar' ? 'bar' : 'line',
                    error: undefined,
                  })}
                  className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition-colors focus:border-purple-400"
                >
                  <option value="line" className="bg-zinc-950 text-zinc-100">Line Graph</option>
                  <option value="bar" className="bg-zinc-950 text-zinc-100">Bar Graph</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-zinc-500">Label</span>
                <input
                  value={graphEditor.label}
                  onChange={(e) => {
                    const nextLabel = e.target.value;
                    const takenShortLabels = getTakenGraphShortLabels(graphEditor.track?.id);
                    const previousDefaultShortLabel = getDefaultGraphShortLabel(graphEditor.label, takenShortLabels);
                    const shouldRefreshShortLabel = !graphEditor.shortLabel.trim() || graphEditor.shortLabel.trim() === previousDefaultShortLabel;
                    setGraphEditor({
                      ...graphEditor,
                      label: nextLabel,
                      shortLabel: shouldRefreshShortLabel ? getDefaultGraphShortLabel(nextLabel, takenShortLabels) : graphEditor.shortLabel,
                      error: undefined,
                    });
                  }}
                  className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition-colors focus:border-purple-400"
                  placeholder="Tension"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-zinc-500">Short Label</span>
                <input
                  value={graphEditor.shortLabel}
                  onChange={(e) => setGraphEditor({ ...graphEditor, shortLabel: e.target.value, error: undefined })}
                  className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition-colors focus:border-purple-400"
                  placeholder="T"
                />
              </label>

              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-zinc-500">Minimum</span>
                  <input
                    type="number"
                    value={graphEditor.min}
                    onChange={(e) => setGraphEditor({ ...graphEditor, min: e.target.value, error: undefined })}
                    className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition-colors focus:border-purple-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-zinc-500">Maximum</span>
                  <input
                    type="number"
                    value={graphEditor.max}
                    onChange={(e) => setGraphEditor({ ...graphEditor, max: e.target.value, error: undefined })}
                    className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition-colors focus:border-purple-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-zinc-500">Increment</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={graphEditor.increment}
                    onChange={(e) => setGraphEditor({ ...graphEditor, increment: e.target.value, error: undefined })}
                    className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition-colors focus:border-purple-400"
                  />
                </label>
              </div>

              {graphEditor.graphType === 'bar' && (
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-zinc-500">Bar Interval</span>
                  <div className="flex h-10 overflow-hidden rounded-md border border-zinc-700 bg-zinc-950 focus-within:border-purple-400">
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={graphEditor.barIntervalSeconds}
                      onChange={(e) => setGraphEditor({ ...graphEditor, barIntervalSeconds: e.target.value, error: undefined })}
                      className="min-w-0 flex-1 bg-transparent px-3 text-sm text-zinc-100 outline-none"
                    />
                    <span className="flex items-center border-l border-zinc-800 px-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      sec
                    </span>
                  </div>
                </label>
              )}

              <label className="flex items-center justify-between gap-4 rounded-md border border-zinc-800 bg-zinc-950/70 px-3 py-2.5">
                <span>
                  <span className="block text-[11px] font-bold uppercase tracking-widest text-zinc-400">Show Current Value</span>
                  <span className="mt-0.5 block text-xs text-zinc-600">Display this graph as a value badge in preview and renders.</span>
                </span>
                <input
                  type="checkbox"
                  checked={graphEditor.showValue}
                  onChange={(e) => setGraphEditor({ ...graphEditor, showValue: e.target.checked, error: undefined })}
                  className="h-4 w-4 accent-purple-500"
                />
              </label>

              <div className="grid grid-cols-[1fr_auto] gap-3">
                <div />
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-zinc-500">Color</span>
                  <div className="flex h-10 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-2">
                    <input
                      type="color"
                      value={graphEditor.color}
                      onChange={(e) => setGraphEditor({ ...graphEditor, color: e.target.value, error: undefined })}
                      className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                      aria-label="Graph color"
                    />
                    <input
                      value={graphEditor.color}
                      onChange={(e) => setGraphEditor({ ...graphEditor, color: e.target.value, error: undefined })}
                      className="w-20 bg-transparent font-mono text-xs text-zinc-200 outline-none"
                    />
                  </div>
                </label>
              </div>

              {graphEditor.error && (
                <div className="rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {graphEditor.error}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                className="text-zinc-400 hover:text-zinc-100"
                onClick={() => setGraphEditor(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-purple-500 text-white hover:bg-purple-400"
                onClick={saveGraphEditor}
              >
                <Check className="h-4 w-4" />
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* 1. Header (Ruler) */}
      <div className="h-8 flex shrink-0 border-b border-zinc-800 bg-[#0a0a0b] z-[100]">
        <div className="w-64 shrink-0 h-full border-r border-zinc-800 flex items-center justify-between px-3 bg-[#0a0a0b] z-[110]">
          <div className="flex items-center">
            <Layers className="h-3.5 w-3.5 text-zinc-500 mr-2" />
            <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Timeline</div>
          </div>
          <button 
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              const name = `Group ${activeParentTracks.length + 1}`;
              addTrackGroup(name);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-[11px] font-bold text-white transition-all shadow-lg active:scale-95 border border-indigo-400/30 z-[200]"
          >
            <Plus className="h-4 w-4" />
            New Group
          </button>
        </div>
        <div 
          ref={headerRef}
          className="flex-1 h-full overflow-visible relative cursor-pointer"
          onPointerDown={handleTimelineClick}
        >
          <div style={{ width: `${timelineWidth + 500}px` }} className="relative h-full">
            <Ruler />
            <Playhead containerRef={headerRef} mode="handle" />
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 2. Sidebar Column (Labels) */}
        <div 
          ref={sidebarRef}
          className="w-64 shrink-0 flex flex-col bg-[#0a0a0b] border-r border-zinc-800 overflow-hidden shadow-[10px_0_30px_rgba(0,0,0,0.4)] z-50 pointer-events-auto"
          onWheel={handleSidebarWheel}
        >
          {timelineScenes.map((scene) => (
            <React.Fragment key={scene.id}>
              {isMultiSceneTimeline && (
                <button
                  type="button"
                  className={cn(
                    "flex h-9 shrink-0 items-center justify-between border-b border-white/[0.06] px-3 text-left transition-colors",
                    scene.id === activeSceneId ? "bg-indigo-500/10 text-indigo-200" : "bg-zinc-950 text-zinc-400 hover:bg-zinc-900"
                  )}
                  onClick={() => setActiveScene(scene.id)}
                >
                  <span className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.14em]">{scene.name}</span>
                  <span className="font-mono text-[9px] text-zinc-600">{scene.clips.length}</span>
                </button>
              )}
              {scene.tracks.filter(t => !t.parentId).map((parent) => {
                const isCollapsed = collapsedTrackIds.includes(parent.id);
                const isDisabled = disabledTrackIds.includes(parent.id);
                const isMuted = mutedTrackIds.includes(parent.id);
                const children = scene.tracks.filter(t => t.parentId === parent.id);
                const visibleChildren = children.filter(t => t.type !== 'graph');

                return (
                  <div key={parent.id} className={`flex flex-col ${isDisabled ? 'opacity-50 grayscale' : ''}`}>
                {/* Parent Sidebar Header */}
                <div className="h-8 border-b border-white/5 bg-zinc-900/50 flex items-center pr-1 shrink-0 group/parent hover:bg-zinc-800/80 transition-colors">
                  <div 
                    className="grid h-full flex-1 cursor-pointer grid-cols-[24px_minmax(0,1fr)] items-center overflow-hidden pl-3 pr-2 transition-colors"
                    onClick={() => toggleTrackCollapse(parent.id)}
                  >
                     {isCollapsed ? <ChevronRight className="h-3 w-3 text-zinc-500" /> : <ChevronDown className="h-3 w-3 text-zinc-500" />}
                     {renamingId === parent.id ? (
                        <form onSubmit={handleRenameSubmit} className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                          <input
                            ref={inputRef}
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={() => handleRenameSubmit()}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            className="w-full bg-zinc-800 text-[10px] text-zinc-100 outline-none border border-sky-500 rounded px-1.5 h-5.5 font-bold uppercase tracking-[0.1em]"
                          />
                        </form>
                     ) : (
                        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.1em] truncate">{parent.name}</span>
                     )}
                  </div>
                  
                  <div className="flex items-center opacity-0 group-hover/parent:opacity-100 transition-opacity pr-1 gap-1">
                    <button
                      type="button"
                      className={cn(
                        "p-1 rounded hover:bg-zinc-800 transition-colors cursor-pointer outline-none",
                        isMuted ? "text-red-400" : "text-zinc-500 hover:text-zinc-200"
                      )}
                      onClick={() => toggleTrackMute(parent.id)}
                      title={isMuted ? "Unmute Group" : "Mute Group"}
                    >
                      {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="p-1 rounded hover:bg-white/10 transition-colors text-zinc-500 hover:text-zinc-200 cursor-pointer outline-none">
                        <MoreVertical className="h-3 w-3" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent 
                        align="end" 
                        className="w-52 border border-border bg-popover text-popover-foreground shadow-2xl backdrop-blur-xl"
                      >
                        <DropdownMenuItem onClick={() => setTimeout(() => startRenaming(parent.id, parent.name), 150)}>
                          <Edit2 className="h-3.5 w-3.5 mr-2" /> Rename Group
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => {
                          duplicateTrackGroup(parent.id);
                          toast.success(`Duplicated ${parent.name}`);
                        }}>
                          <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate Group
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => addTrack(parent.id, `Layer ${visibleChildren.length + 1}`)}>
                          <SquarePlus className="h-3.5 w-3.5 mr-2" /> Add Layer
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openCreateGraphEditor(parent.id, scene.tracks)}>
                          <Activity className="h-3.5 w-3.5 mr-2" /> Add Graph Layer
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateTrack(parent.id, { showDialogGridItem: !parent.showDialogGridItem })}>
                          <Type className="h-3.5 w-3.5 mr-2" />
                          {parent.showDialogGridItem ? 'Hide Dialog Grid Item' : 'Show Dialog Grid Item'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateTrack(parent.id, { notePlacement: parent.notePlacement === 'graph' ? 'dialog' : 'graph' })}>
                          <MessageSquare className="h-3.5 w-3.5 mr-2" />
                          Notes: {parent.notePlacement === 'graph' ? 'Under Graph' : 'Above Dialog'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateTrack(parent.id, { graphUiLayout: parent.graphUiLayout === 'column' || parent.graphUiLayout === 'column-many' ? 'grid' : 'column' })}>
                          <Activity className="h-3.5 w-3.5 mr-2" />
                          Graph UI: {parent.graphUiLayout === 'column' || parent.graphUiLayout === 'column-many' ? 'Grid' : 'Column'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border" />
                        <DropdownMenuItem onClick={() => toggleTrackMute(parent.id)}>
                          {isMuted ? (
                            <><Volume2 className="h-3.5 w-3.5 mr-2" /> Unmute Group</>
                          ) : (
                            <><VolumeX className="h-3.5 w-3.5 mr-2" /> Mute Group</>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-zinc-700/50" />
                        <DropdownMenuItem 
                          className="text-red-400 hover:text-red-300 focus:bg-red-400/10 focus:text-red-300"
                          onClick={() => deleteTrack(parent.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete Group
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                
                {/* Children Sidebar Labels */}
                {!isCollapsed && getLayerSections(parent, scene.tracks, scene.clips).map((section) => {
                  const sectionCollapseId = getLayerSectionCollapseId(parent.id, section.id);
                  const isSectionCollapsed = collapsedTrackIds.includes(sectionCollapseId);
                  return (
                    <React.Fragment key={section.id}>
                      {renderLayerSectionHeader(parent.id, section)}
                      {!isSectionCollapsed && section.tracks.map(child => renderSidebarTrackRow(parent, child, isMuted, scene.clips, scene.tracks))}
                    </React.Fragment>
                  );
                })}
              </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>

        {/* 3. Content Scroll Area (Clips) */}
        <div 
          ref={contentRef}
          className="flex-1 bg-[#0a0a0b] relative overflow-auto"
          onScroll={handleScroll}
            onMouseDown={(e) => {
              // Start lasso if clicking on background, track row empty space, or parent headers
              const target = e.target as HTMLElement;
              const isBackground = target === e.currentTarget || 
                                target.closest('.track-row-inner') || 
                                target.closest('.parent-row-spacer');
              
              if (isBackground) {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
                const y = e.clientY - rect.top + e.currentTarget.scrollTop;
                
                setLassoStart({ x, y });
                setLassoEnd({ x, y });
                setIsLassoing(true);
                
                // Also move playhead
                handleTimelineClick(e);
              }
            }}
        >
          <div style={{ width: `${timelineWidth + 500}px` }} className="flex flex-col relative h-max min-h-full">
            {timelineScenes.map((scene) => (
              <React.Fragment key={scene.id}>
                {isMultiSceneTimeline && (
                  <div
                    className={cn(
                      "flex h-9 shrink-0 items-center border-b border-white/[0.06] px-4 parent-row-spacer",
                      scene.id === activeSceneId ? "bg-indigo-500/[0.06]" : "bg-zinc-950/80"
                    )}
                    onClick={() => setActiveScene(scene.id)}
                  >
                    <div className="h-px flex-1 bg-white/[0.04]" />
                    <span className="ml-3 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-600">{scene.name}</span>
                  </div>
                )}
                {scene.tracks.filter(t => !t.parentId).map((parent) => {
                  const isCollapsed = collapsedTrackIds.includes(parent.id);
                  const isDisabled = disabledTrackIds.includes(parent.id);
                  return (
                    <div key={parent.id} className={`flex flex-col ${isDisabled ? 'opacity-50 grayscale' : ''}`}>
                  {/* Parent Group Content (Spacer line) */}
                <div className="h-8 border-b border-white/[0.05] bg-zinc-900/10 flex items-center shrink-0 parent-row-spacer">
                  <div className="flex-1 h-px bg-white/[0.02]" />
                </div>
                  
                  {/* Children Track Content Rows */}
                  {!isCollapsed && getLayerSections(parent, scene.tracks, scene.clips).map((section) => {
                    const sectionCollapseId = getLayerSectionCollapseId(parent.id, section.id);
                    const isSectionCollapsed = collapsedTrackIds.includes(sectionCollapseId);
                    return (
                      <React.Fragment key={section.id}>
                        <div className="h-8 border-b border-white/[0.05] bg-zinc-900/10 flex items-center shrink-0 parent-row-spacer">
                          <div className="flex-1 h-px bg-white/[0.02]" />
                        </div>
                        {!isSectionCollapsed && section.tracks.map((child) => (
                        <div key={child.id} className={cn(disabledTrackIds.includes(child.id) && "opacity-50 grayscale")}>
                          <TrackRow track={child} sceneClips={scene.clips} sceneTracks={scene.tracks} sceneId={scene.id} />
                        </div>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </div>
                  );
                })}
              </React.Fragment>
            ))}

            {/* Snap line */}
            {snapLineFrame !== null && (
              <div 
                className="absolute top-0 bottom-0 w-[1px] bg-sky-500/50 z-40 pointer-events-none"
                style={{ left: `${snapLineFrame * zoom}px` }}
              >
                <div className="absolute top-0 -left-[3px] w-2 h-2 rounded-full bg-sky-500/50" />
              </div>
            )}

            {/* Playhead Vertical Line only */}
            <Playhead containerRef={contentRef} mode="line" />

            {/* Lasso UI */}
            {isLassoing && lassoStart && lassoEnd && (
              <div 
                className="absolute border-2 border-white bg-sky-500/30 z-[999] pointer-events-none shadow-[0_0_15px_rgba(0,0,0,0.5)]"
                style={{
                  left: Math.min(lassoStart.x, lassoEnd.x),
                  top: Math.min(lassoStart.y, lassoEnd.y),
                  width: Math.max(1, Math.abs(lassoEnd.x - lassoStart.x)),
                  height: Math.max(1, Math.abs(lassoEnd.y - lassoStart.y))
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
