'use client';

import React from 'react';
import { useTimeline, TimelineTrack, ClipType, TimelineClip } from '@/lib/timeline-context';
import { ClipItem } from './ClipItem';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { Activity, Type, Image as ImageIcon, Video, Plus, Check, Trash2, X, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { getGraphColor, getGraphDisplayLabel } from '@/lib/graph-style';

interface TrackRowProps {
  track: TimelineTrack;
  sceneClips?: TimelineClip[];
  sceneTracks?: TimelineTrack[];
  sceneId?: string;
}

const shouldShowGraphValue = (graph: { label: string; showValue?: boolean }) => (
  graph.showValue ?? /\btension\b/i.test(graph.label)
);

export function TrackRow({ track, sceneClips, sceneTracks, sceneId }: TrackRowProps) {
  const { clips, tracks, zoom, fps, addClip, isInteracting, totalDuration, updateTrack, setActiveScene } = useTimeline();
  const rowClips = sceneClips || clips;
  const rowTracks = sceneTracks || tracks;
  const trackClips = rowClips.filter((c) => c.trackId === track.id);
  const [contextMenuPos, setContextMenuPos] = React.useState<{ x: number, y: number } | null>(null);
  const [isDraggingOver, setIsDraggingOver] = React.useState(false);
  const [graphNodeEditor, setGraphNodeEditor] = React.useState<{
    x: number;
    y: number;
    frame: string;
    value: string;
    note: string;
    tag: string;
    originalFrame?: number;
    error?: string;
  } | null>(null);
  const [selectedGraphFrames, setSelectedGraphFrames] = React.useState<Set<number>>(() => new Set());
  const [graphLasso, setGraphLasso] = React.useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const graphDragMovedRef = React.useRef(false);

  const lastClipEndFrame = React.useMemo(() => {
    if (trackClips.length === 0) return 0;
    return Math.max(...trackClips.map(c => c.startFrame + c.duration));
  }, [trackClips]);

  const gaps = React.useMemo(() => {
    if (trackClips.length < 1) return [];
    
    // Sort clips by start frame
    const sortedClips = [...trackClips].sort((a, b) => a.startFrame - b.startFrame);
    const gapsFound: { start: number, end: number }[] = [];
    
    // Check gap before first clip
    if (sortedClips[0].startFrame > 10) {
      gapsFound.push({ start: 0, end: sortedClips[0].startFrame });
    }
    
    // Check gaps between clips
    for (let i = 0; i < sortedClips.length - 1; i++) {
      const currentEnd = sortedClips[i].startFrame + sortedClips[i].duration;
      const nextStart = sortedClips[i+1].startFrame;
      
      // Only show gap if it's large enough (at least 10 frames)
      if (nextStart - currentEnd > 10) {
        gapsFound.push({ start: currentEnd, end: nextStart });
      }
    }
    
    return gapsFound;
  }, [trackClips]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleAddItem = (type: ClipType) => {
    if (!contextMenuPos || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    const localX = contextMenuPos.x - rect.left;
    const startFrame = Math.max(0, Math.floor(localX / zoom));
    
    addClip({ 
      id: 'clip-' + Date.now(), 
      name: 'New ' + type, 
      type, 
      startFrame, 
      duration: 60, 
      trackId: track.id, 
      color: type === 'note' ? 'bg-amber-600' : type === 'dialog' ? 'bg-purple-600' : 'bg-zinc-600'
    });
    setContextMenuPos(null);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    let currentStart = 0;
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      currentStart = Math.max(0, Math.floor(localX / zoom));
    } else {
      currentStart = lastClipEndFrame;
    }

    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('video/') || f.type.startsWith('image/'));
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    for (const file of files) {
      const isVideo = file.type.startsWith('video/');
      const type: ClipType = isVideo ? 'video' : 'image';
      
      const newClip: TimelineClip = {
        id: 'clip-' + Date.now() + '-' + Math.random().toString(36).substring(7),
        name: file.name,
        type,
        startFrame: currentStart,
        duration: 90,
        trackId: track.id,
        color: isVideo ? 'bg-zinc-600' : 'bg-zinc-700'
      };

      await addClip(newClip, file);
      
      // Add 90 frames for sequential stacking plus a small gap maybe?
      // No gap, just contiguous
      currentStart += 90; 
    }
  };

  const graph = track.graph;
  const graphType = graph?.type === 'bar' ? 'bar' : 'line';
  const isBarGraph = graphType === 'bar';
  const graphHasValueAxis = graph ? shouldShowGraphValue(graph) : false;
  const graphPlotTop = graphHasValueAxis ? 8 : 7;
  const graphPlotHeight = graphHasValueAxis ? 34 : 18;
  const graphPlotBottom = graphPlotTop + graphPlotHeight;
  const graphIncrement = graph?.increment && graph.increment > 0 ? graph.increment : 0.5;
  const graphDefaultValue = graph ? Math.max(graph.min, Math.min(graph.max, 0)) : 0;
  const barIntervalFrames = Math.max(1, Math.round((graph?.barIntervalSeconds ?? 0.5) * fps));
  const sortedGraphPoints = React.useMemo(() => (
    [...(graph?.points || [])].sort((a, b) => a.frame - b.frame)
  ), [graph?.points]);

  React.useEffect(() => {
    if (!graph) return;

    if (isBarGraph) {
      const existingByFrame = new Map(sortedGraphPoints.map(point => [point.frame, point]));
      const frameCount = Math.floor(totalDuration / barIntervalFrames) + 1;
      const nextPoints = Array.from({ length: Math.max(1, frameCount) }, (_, index) => {
        const frame = index * barIntervalFrames;
        const existing = existingByFrame.get(frame);
        return existing
          ? { ...existing, value: Math.max(graph.min, Math.min(graph.max, existing.value)) }
          : { frame, value: graphDefaultValue };
      });
      const changed = nextPoints.length !== sortedGraphPoints.length ||
        nextPoints.some((point, index) => {
          const current = sortedGraphPoints[index];
          return !current || current.frame !== point.frame || current.value !== point.value;
        });

      if (changed) {
        updateTrack(track.id, {
          graph: {
            ...graph,
            points: nextPoints,
          },
        });
      }
      return;
    }

    if (sortedGraphPoints.length === 0) {
      updateTrack(track.id, {
        graph: {
          ...graph,
          points: [
            { frame: 0, value: graphDefaultValue },
            { frame: totalDuration, value: graphDefaultValue },
          ],
        },
      });
    }
  }, [barIntervalFrames, graph, graphDefaultValue, isBarGraph, sortedGraphPoints, totalDuration, track.id, updateTrack]);

  const getGraphValueFromLocalY = React.useCallback((localY: number) => {
    if (!graph) return 0;
    if (!graphHasValueAxis) return graph.min;
    const progress = Math.max(0, Math.min(1, (localY - graphPlotTop) / graphPlotHeight));
    const rawValue = graph.max - progress * (graph.max - graph.min);
    const snappedValue = Math.round(rawValue / graphIncrement) * graphIncrement;
    const clampedValue = Math.max(graph.min, Math.min(graph.max, snappedValue));
    return Number(clampedValue.toFixed(4));
  }, [graph, graphHasValueAxis, graphIncrement, graphPlotHeight, graphPlotTop]);

  const getFrameFromClientX = React.useCallback((clientX: number) => {
    if (!rowRef.current) return 0;
    const rect = rowRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(totalDuration, Math.floor((clientX - rect.left) / zoom)));
  }, [totalDuration, zoom]);

  const updateGraphPoint = React.useCallback((frame: number, value: number, note?: string, nextFrame = frame) => {
    if (!graph) return;
    const targetFrame = isBarGraph ? frame : Math.max(0, Math.min(totalDuration, nextFrame));
    updateTrack(track.id, {
      graph: {
        ...graph,
        points: sortedGraphPoints
          .filter(point => point.frame !== targetFrame || point.frame === frame)
          .map(point => point.frame === frame ? { ...point, frame: targetFrame, value, note } : point)
          .sort((a, b) => a.frame - b.frame),
      },
    });
  }, [graph, isBarGraph, sortedGraphPoints, totalDuration, track.id, updateTrack]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (!graph || selectedGraphFrames.size === 0) return;
      if (isBarGraph) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea')) return;
      event.preventDefault();
      updateTrack(track.id, {
        graph: {
          ...graph,
          points: sortedGraphPoints.filter(point => !selectedGraphFrames.has(point.frame)),
        },
      });
      setSelectedGraphFrames(new Set());
      setGraphNodeEditor(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [graph, isBarGraph, selectedGraphFrames, sortedGraphPoints, track.id, updateTrack]);

  const openGraphNodeEditor = (clientX: number, clientY: number) => {
    if (!graph || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    const localX = clientX - rect.left;
    const frame = isBarGraph
      ? Math.max(0, Math.round(Math.floor(localX / zoom) / barIntervalFrames) * barIntervalFrames)
      : Math.max(0, Math.floor(localX / zoom));
    const hitThresholdFrames = Math.max(1, Math.ceil(8 / zoom));
    const existingPoint = sortedGraphPoints.find(point => Math.abs(point.frame - frame) <= hitThresholdFrames);
    const targetFrame = existingPoint?.frame ?? frame;
    const currentValue = sortedGraphPoints
      .filter(point => point.frame <= targetFrame)
      .at(-1)?.value ?? graph.min;

    setGraphNodeEditor({
      x: Math.max(12, Math.min(clientX - 120, window.innerWidth - 252)),
      y: Math.max(12, Math.min(clientY - 318, window.innerHeight - 320)),
      frame: String(targetFrame),
      value: String(existingPoint?.value ?? currentValue),
      note: existingPoint?.note ?? '',
      tag: existingPoint?.tag?.trim() || 'note',
      originalFrame: existingPoint?.frame,
    });
    setSelectedGraphFrames(existingPoint ? new Set([existingPoint.frame]) : new Set());
  };

  const addGraphNodeAtPointer = (clientX: number, clientY: number) => {
    if (!graph || !rowRef.current) return;
    if (isBarGraph) return;
    const rect = rowRef.current.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const frame = Math.max(0, Math.floor(localX / zoom));
    const value = getGraphValueFromLocalY(localY);

    updateTrack(track.id, {
      graph: {
        ...graph,
        points: sortedGraphPoints
          .filter(point => point.frame !== frame)
          .concat({ frame, value })
          .sort((a, b) => a.frame - b.frame),
      },
    });
    setSelectedGraphFrames(new Set([frame]));
    setGraphNodeEditor(null);
  };

  const handleGraphPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!graph || !rowRef.current || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-graph-node], [data-graph-editor], button, input, textarea')) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = rowRef.current.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    const pointsAtLassoStart = sortedGraphPoints;
    const hadSelectionAtPointerDown = selectedGraphFrames.size > 0;
    let didDrag = false;

    const onPointerMove = (event: PointerEvent) => {
      const currentX = event.clientX - rect.left;
      const currentY = event.clientY - rect.top;
      if (Math.abs(currentX - startX) > 4 || Math.abs(currentY - startY) > 4) {
        didDrag = true;
      }
      if (!didDrag) return;

      setGraphNodeEditor(null);
      setGraphLasso({ startX, startY, currentX, currentY });

      const left = Math.min(startX, currentX);
      const right = Math.max(startX, currentX);
      const top = Math.min(startY, currentY);
      const bottom = Math.max(startY, currentY);
      const nextSelection = new Set<number>();

      pointsAtLassoStart.forEach(point => {
        const pointX = point.frame * zoom;
        const pointY = graphHasValueAxis
          ? graphPlotBottom - ((point.value - graph.min) / Math.max(1, graph.max - graph.min)) * graphPlotHeight
          : graphPlotTop + graphPlotHeight / 2;
        if (pointX >= left && pointX <= right && pointY >= top && pointY <= bottom) {
          nextSelection.add(point.frame);
        }
      });

      setSelectedGraphFrames(nextSelection);
    };

    const onPointerUp = (event: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      setGraphLasso(null);
      if (!didDrag && !isBarGraph) {
        if (hadSelectionAtPointerDown) {
          setSelectedGraphFrames(new Set());
          setGraphNodeEditor(null);
        } else {
          addGraphNodeAtPointer(event.clientX, event.clientY);
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const handleGraphPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!graph || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-graph-node], [data-graph-editor], button, input, textarea')) return;
  };

  const startGraphNodeDrag = (e: React.PointerEvent<HTMLDivElement>, frame: number, note?: string) => {
    if (!graph || !rowRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = rowRef.current.getBoundingClientRect();
    const isLineEndpoint = !isBarGraph && (frame === 0 || frame === totalDuration);
    const isGroupLineDrag = !isBarGraph && selectedGraphFrames.size > 1 && selectedGraphFrames.has(frame);
    const dragStartX = e.clientX;
    const dragStartY = e.clientY;
    const selectedFramesAtDragStart = new Set(selectedGraphFrames);
    const selectedPointsAtDragStart = sortedGraphPoints.filter(point => selectedFramesAtDragStart.has(point.frame));
    const unselectedPointsAtDragStart = sortedGraphPoints.filter(point => !selectedFramesAtDragStart.has(point.frame));
    graphDragMovedRef.current = false;
    let currentFrameForDrag = frame;
    let dragPoints = sortedGraphPoints;

    const getGraphYFromValue = (value: number) => (
      graphHasValueAxis
        ? graphPlotBottom - ((value - graph.min) / Math.max(1, graph.max - graph.min)) * graphPlotHeight
        : graphPlotTop + graphPlotHeight / 2
    );

    const applyGroupDrag = (clientX: number, clientY: number) => {
      const deltaFrames = Math.round((clientX - dragStartX) / zoom);
      const deltaY = clientY - dragStartY;
      const movedPoints = selectedPointsAtDragStart.map(point => {
        const isEndpoint = point.frame === 0 || point.frame === totalDuration;
        const nextFrame = isEndpoint
          ? point.frame
          : Math.max(0, Math.min(totalDuration, point.frame + deltaFrames));
        const nextValue = getGraphValueFromLocalY(getGraphYFromValue(point.value) + deltaY);
        return { ...point, frame: nextFrame, value: nextValue };
      });
      const movedFrames = new Set(movedPoints.map(point => point.frame));
      const nextPoints = unselectedPointsAtDragStart
        .filter(point => !movedFrames.has(point.frame))
        .concat(movedPoints)
        .sort((a, b) => a.frame - b.frame);

      dragPoints = nextPoints;
      updateTrack(track.id, {
        graph: {
          ...graph,
          points: nextPoints,
        },
      });
      setSelectedGraphFrames(new Set(movedPoints.map(point => point.frame)));
    };

    const applyDragValue = (clientX: number, clientY: number) => {
      const nextFrame = isLineEndpoint || isBarGraph ? frame : getFrameFromClientX(clientX);
      const value = getGraphValueFromLocalY(clientY - rect.top);
      const targetFrame = isBarGraph ? currentFrameForDrag : Math.max(0, Math.min(totalDuration, nextFrame));
      const nextPoints = dragPoints
        .filter(point => point.frame !== targetFrame || point.frame === currentFrameForDrag)
        .map(point => point.frame === currentFrameForDrag ? { ...point, frame: targetFrame, value, note } : point)
        .sort((a, b) => a.frame - b.frame);
      dragPoints = nextPoints;
      updateTrack(track.id, {
        graph: {
          ...graph,
          points: nextPoints,
        },
      });
      currentFrameForDrag = nextFrame;
    };
    if (!isGroupLineDrag) {
      setSelectedGraphFrames(new Set([frame]));
    }

    const onPointerMove = (event: PointerEvent) => {
      graphDragMovedRef.current = true;
      if (isGroupLineDrag) {
        applyGroupDrag(event.clientX, event.clientY);
      } else {
        applyDragValue(event.clientX, event.clientY);
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (!isGroupLineDrag) {
        setSelectedGraphFrames(new Set([currentFrameForDrag]));
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const saveGraphNode = () => {
    if (!graph || !graphNodeEditor) return;

    const frame = Math.max(0, Math.floor(Number(graphNodeEditor.frame)));
    const value = Number(graphNodeEditor.value);
    const note = graphNodeEditor.note.trim();
    const tag = graphNodeEditor.tag.trim() || 'note';

    if (!Number.isFinite(frame)) {
      setGraphNodeEditor({ ...graphNodeEditor, error: 'Use a valid frame.' });
      return;
    }

    if (!Number.isFinite(value) || value < graph.min || value > graph.max) {
      setGraphNodeEditor({ ...graphNodeEditor, error: `Value must be between ${graph.min} and ${graph.max}.` });
      return;
    }

    const targetFrame = isBarGraph ? (graphNodeEditor.originalFrame ?? frame) : frame;
    const nextPoints = sortedGraphPoints
      .filter(point => point.frame !== graphNodeEditor.originalFrame && point.frame !== targetFrame)
      .concat({ frame: targetFrame, value, ...(note ? { note, tag } : {}) })
      .sort((a, b) => a.frame - b.frame);

    updateTrack(track.id, {
      graph: {
        ...graph,
        points: nextPoints,
      },
    });
    setGraphNodeEditor(null);
  };

  const deleteGraphNode = () => {
    if (!graph || !graphNodeEditor || graphNodeEditor.originalFrame === undefined) return;
    if (isBarGraph || graphNodeEditor.originalFrame === 0 || graphNodeEditor.originalFrame === totalDuration) return;
    updateTrack(track.id, {
      graph: {
        ...graph,
        points: sortedGraphPoints.filter(point => point.frame !== graphNodeEditor.originalFrame),
      },
    });
    setGraphNodeEditor(null);
  };

  const deleteSelectedGraphNodes = () => {
    if (!graph || selectedGraphFrames.size === 0) return;
    if (isBarGraph) return;
    updateTrack(track.id, {
      graph: {
        ...graph,
        points: sortedGraphPoints.filter(point => (
          point.frame === 0 ||
          point.frame === totalDuration ||
          !selectedGraphFrames.has(point.frame)
        )),
      },
    });
    setSelectedGraphFrames(new Set());
    setGraphNodeEditor(null);
  };

  if (track.type === 'graph' && graph) {
    const graphIndex = Math.max(0, rowTracks.filter(item => item.type === 'graph').findIndex(item => item.id === track.id));
    const graphColor = getGraphColor(graph, graphIndex);
    const valueRange = Math.max(1, graph.max - graph.min);
    const points = sortedGraphPoints.length > 0 ? sortedGraphPoints : [{ frame: 0, value: graphDefaultValue }];

    return (
      <div
        ref={rowRef}
        className={cn(
          "relative z-[60] border-b border-purple-400/10 bg-purple-500/[0.03] group transition-colors hover:z-[220] hover:bg-purple-500/[0.06] track-row-inner",
          graphHasValueAxis ? "h-12" : "h-8"
        )}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDownCapture={handleGraphPointerDownCapture}
        onPointerDown={handleGraphPointerDown}
      >
        <div className="absolute inset-0 pointer-events-none">
          {points.map((segment, index) => {
            const next = points[index + 1];
            const left = segment.frame * zoom;
            const width = isBarGraph ? Math.max(2, barIntervalFrames * zoom - 1) : Math.max(1, ((next?.frame ?? segment.frame) - segment.frame) * zoom);
            const y = graphHasValueAxis
              ? graphPlotTop + graphPlotHeight - ((segment.value - graph.min) / valueRange) * graphPlotHeight
              : graphPlotTop + graphPlotHeight / 2;
            const nextY = next
              ? graphPlotTop + graphPlotHeight - ((next.value - graph.min) / valueRange) * graphPlotHeight
              : y;
            const lineLength = next ? Math.hypot(width, nextY - y) : 0;
            const lineAngle = next ? Math.atan2(nextY - y, width) * 180 / Math.PI : 0;
            const nodeLeft = isBarGraph ? left + width / 2 : left;
            const isSelected = selectedGraphFrames.has(segment.frame);
            const segmentTag = segment.tag?.trim() || 'note';
            return (
              <div key={`${segment.frame}-${index}`}>
                {isBarGraph ? (
                  <div
                    className="absolute rounded-t-sm"
                    style={{
                      background: graphColor.fill,
                      left,
                      width,
                      top: graphHasValueAxis ? y : y - 1,
                      height: graphHasValueAxis ? graphPlotBottom - y : 2,
                    }}
                  />
                ) : next ? (
                  <div
                    className="absolute h-0.5 origin-left rounded-full"
                    style={{
                      background: graphColor.line,
                      left,
                      top: y,
                      width: lineLength,
                      transform: `rotate(${lineAngle}deg)`,
                    }}
                  />
                ) : null}
                <div
                  data-graph-node
                  className={cn(
                    "group/node absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto transition-transform hover:scale-125",
                    isBarGraph ? "cursor-ns-resize" : "cursor-move",
                    isSelected && "scale-125"
                  )}
                  style={{ left: nodeLeft, top: y }}
                  onPointerDown={(e) => startGraphNodeDrag(e, segment.frame, segment.note)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!graphDragMovedRef.current) {
                      openGraphNodeEditor(e.clientX, e.clientY);
                    }
                  }}
                >
                  <div
                    className={cn(
                      segment.note
                        ? "h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent drop-shadow"
                        : "h-2.5 w-2.5 rounded-full shadow ring-2 ring-purple-200/0 group-hover/node:ring-purple-200/30",
                      isSelected && !segment.note && "bg-white ring-purple-200/70"
                    )}
                    style={segment.note
                      ? { borderBottomColor: isSelected ? '#ffffff' : graphColor.marker }
                      : { background: isSelected ? undefined : graphColor.line }
                    }
                  />
                  <div className="pointer-events-none absolute left-1/2 bottom-full z-[1000] mb-3 w-64 -translate-x-1/2 rounded-lg border border-zinc-700/80 bg-[#101014]/95 p-3 text-left text-zinc-100 opacity-0 shadow-2xl ring-1 ring-white/5 backdrop-blur-md transition-opacity duration-150 group-hover/node:opacity-100">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-black uppercase tracking-widest" style={{ color: graphColor.label }}>
                          {getGraphDisplayLabel(graph)}
                        </div>
                        <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                          {segment.note ? segmentTag : 'value point'}
                        </div>
                      </div>
                      {graphHasValueAxis && (
                        <div className="rounded bg-zinc-900 px-2 py-1 font-mono text-[11px] font-black tabular-nums text-zinc-100 ring-1 ring-white/10">
                          {segment.value}
                        </div>
                      )}
                    </div>
                    <div className={cn("grid gap-2 text-[11px]", graphHasValueAxis ? "grid-cols-2" : "grid-cols-1")}>
                      <div className="rounded border border-zinc-800 bg-black/30 px-2 py-1.5">
                        <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Frame</div>
                        <div className="mt-0.5 font-mono font-semibold tabular-nums text-zinc-200">{segment.frame}</div>
                      </div>
                      {graphHasValueAxis && (
                        <div className="rounded border border-zinc-800 bg-black/30 px-2 py-1.5">
                          <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Value</div>
                          <div className="mt-0.5 font-mono font-semibold tabular-nums text-zinc-200">{segment.value}</div>
                        </div>
                      )}
                    </div>
                    {segment.note && (
                      <div className="mt-2 rounded border border-zinc-800 bg-black/30 px-2 py-1.5">
                        <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Note</div>
                        <div className="mt-1 max-h-28 overflow-hidden text-xs leading-snug text-zinc-100">
                          {segment.note}
                        </div>
                      </div>
                    )}
                    <div className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-zinc-700/80 bg-[#101014]" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {graphHasValueAxis && (
          <div className="absolute inset-y-1 right-2 flex flex-col justify-between text-right font-mono text-[9px] font-black tabular-nums text-zinc-500 pointer-events-none">
            <span>{graph.max}</span>
            <span>{graph.min}</span>
          </div>
        )}
        {graphLasso && (
          <div
            className="absolute z-[90] rounded border border-sky-300/60 bg-sky-400/10 pointer-events-none"
            style={{
              left: Math.min(graphLasso.startX, graphLasso.currentX),
              top: Math.min(graphLasso.startY, graphLasso.currentY),
              width: Math.abs(graphLasso.currentX - graphLasso.startX),
              height: Math.abs(graphLasso.currentY - graphLasso.startY),
            }}
          />
        )}
        {selectedGraphFrames.size > 0 && !isBarGraph && (
          <div className="absolute right-3 top-1/2 z-[110] flex -translate-y-1/2 items-center gap-2 rounded-md border border-zinc-700 bg-[#131317]/95 px-2 py-1 shadow-xl backdrop-blur">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{selectedGraphFrames.size} selected</span>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              onClick={deleteSelectedGraphNodes}
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </Button>
          </div>
        )}
        {graphNodeEditor && (
          <div
            data-graph-editor
            className="fixed z-[500] w-60 rounded-lg border border-purple-300/30 bg-[#131317]/95 p-3 text-zinc-100 shadow-2xl backdrop-blur-md after:absolute after:left-1/2 after:top-full after:h-3 after:w-3 after:-translate-x-1/2 after:-translate-y-1/2 after:rotate-45 after:border-b after:border-r after:border-purple-300/30 after:bg-[#131317]"
            style={{ left: graphNodeEditor.x, top: graphNodeEditor.y }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-zinc-100">
                  {graphNodeEditor.originalFrame === undefined ? 'Add Node' : 'Edit Node'}
                </div>
                <div className="text-[10px] font-medium uppercase tracking-widest text-purple-300">{getGraphDisplayLabel(graph)}</div>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
                onClick={() => setGraphNodeEditor(null)}
                aria-label="Close graph node editor"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">Frame</span>
                <input
                  type="number"
                  min={0}
                  value={graphNodeEditor.frame}
                  onChange={(e) => setGraphNodeEditor({ ...graphNodeEditor, frame: e.target.value, error: undefined })}
                  disabled={isBarGraph}
                  className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none focus:border-purple-400"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">Value</span>
                <input
                  type="number"
                  min={graph.min}
                  max={graph.max}
                  step={graphIncrement}
                  value={graphNodeEditor.value}
                  onChange={(e) => setGraphNodeEditor({ ...graphNodeEditor, value: e.target.value, error: undefined })}
                  disabled={!graphHasValueAxis}
                  className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none focus:border-purple-400"
                />
              </label>
            </div>

            {graphNodeEditor.error && (
              <div className="mt-2 rounded-md border border-red-400/20 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">
                {graphNodeEditor.error}
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-2">
              {graphNodeEditor.originalFrame !== undefined && !isBarGraph && graphNodeEditor.originalFrame !== 0 && graphNodeEditor.originalFrame !== totalDuration ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={deleteGraphNode}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              ) : (
                <div />
              )}
              <Button
                type="button"
                size="sm"
                className="bg-purple-500 text-white hover:bg-purple-400"
                onClick={saveGraphNode}
              >
                <Check className="h-3.5 w-3.5" />
                Save
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div 
      ref={rowRef}
      className={cn(
        "relative h-12 border-b border-white/[0.05] group transition-colors overflow-visible track-row-inner",
        isDraggingOver ? "bg-indigo-500/20" : "hover:bg-white/[0.01]"
      )}
      onMouseDown={() => {
        if (sceneId) setActiveScene(sceneId);
      }}
      onContextMenu={handleContextMenu}
      onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setIsDraggingOver(false); }}
      onDrop={handleDrop}
    >
      <DropdownMenu open={!!contextMenuPos} onOpenChange={(open) => !open && setContextMenuPos(null)}>
        <DropdownMenuTrigger>
          <div 
            className="fixed pointer-events-none" 
            style={{ 
              left: contextMenuPos ? contextMenuPos.x : 0,
              top: contextMenuPos ? contextMenuPos.y : 0,
              width: 1,
              height: 1,
              zIndex: 1000
            }} 
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-48 bg-[#18181b] border-zinc-700/50 text-zinc-300 shadow-2xl backdrop-blur-xl">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 px-3 py-2 font-bold select-none cursor-default">Add Item At Position</div>
          <DropdownMenuSeparator className="bg-zinc-700/50" />
          <DropdownMenuItem onClick={() => handleAddItem('dialog')} className="gap-2 focus:bg-purple-500/10 focus:text-purple-300 cursor-pointer">
            <Type className="h-3.5 w-3.5" /> Text / Dialog
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleAddItem('note')} className="gap-2 focus:bg-amber-500/10 focus:text-amber-300 cursor-pointer">
            <MessageSquare className="h-3.5 w-3.5" /> Note
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleAddItem('image')} className="gap-2 focus:bg-emerald-500/10 focus:text-emerald-300 cursor-pointer">
            <ImageIcon className="h-3.5 w-3.5" /> Image
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleAddItem('video')} className="gap-2 focus:bg-amber-500/10 focus:text-amber-300 cursor-pointer">
            <Video className="h-3.5 w-3.5" /> Video
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Scrollable area content */}
      <div className="absolute inset-0 h-full">
        <div className="absolute inset-0 pointer-events-none opacity-[0.03] flex">
          {[...Array(20)].map((_, i) => (
             <div key={i} className="h-full w-32 border-r border-white" />
          ))}
        </div>
        {trackClips.length === 0 && !isInteracting && (
          <div className="absolute inset-y-0 left-0 flex items-center px-4 pointer-events-none">
            <DropdownMenu>
              <DropdownMenuTrigger>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-zinc-800/40 hover:bg-zinc-700/60 text-[11px] font-medium text-zinc-400 border border-zinc-700/30 transition-all pointer-events-auto backdrop-blur-sm group-hover:border-sky-500/30 group-hover:text-zinc-300 cursor-pointer">
                  <Plus className="h-3.5 w-3.5" />
                  Add item to this layer
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48 bg-[#18181b] border-zinc-700/50 text-zinc-300 shadow-2xl backdrop-blur-xl">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 px-3 py-2 font-bold select-none cursor-default">Select Item Type</div>
                <DropdownMenuSeparator className="bg-zinc-700/50" />
                <DropdownMenuItem onClick={() => addClip({ id: 'clip-'+Date.now(), name: 'New Text', type: 'dialog', startFrame: 0, duration: 60, trackId: track.id, color: 'bg-purple-600' })} className="gap-2 focus:bg-purple-500/10 focus:text-purple-300 cursor-pointer">
                  <Type className="h-3.5 w-3.5" /> Text / Dialog
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addClip({ id: 'clip-'+Date.now(), name: 'Note', type: 'note', startFrame: 0, duration: 90, trackId: track.id, color: 'bg-amber-600' })} className="gap-2 focus:bg-amber-500/10 focus:text-amber-300 cursor-pointer">
                  <MessageSquare className="h-3.5 w-3.5" /> Note
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addClip({ id: 'clip-'+Date.now(), name: 'New Image', type: 'image', startFrame: 0, duration: 60, trackId: track.id, color: 'bg-emerald-600' })} className="gap-2 focus:bg-emerald-500/10 focus:text-emerald-300 cursor-pointer">
                  <ImageIcon className="h-3.5 w-3.5" /> Image
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addClip({ id: 'clip-'+Date.now(), name: 'New Video', type: 'video', startFrame: 0, duration: 60, trackId: track.id, color: 'bg-indigo-600' })} className="gap-2 focus:bg-amber-500/10 focus:text-amber-300 cursor-pointer">
                  <Video className="h-3.5 w-3.5" /> Video
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        {trackClips.map((clip) => (
          <ClipItem key={clip.id} clip={clip} sceneClips={rowClips} sceneTracks={rowTracks} sceneId={sceneId} />
        ))}

        {/* Existing Gaps UI */}
        {!isInteracting && gaps.map((gap, idx) => (
          <div 
            key={`gap-${idx}`}
            className="absolute top-1.5 bottom-1.5 flex items-center justify-center z-10 transition-opacity opacity-0 group-hover:opacity-100"
            style={{ 
              left: `${gap.start * zoom + 4}px`, 
              width: `${(gap.end - gap.start) * zoom - 8}px` 
            }}
          >
            <DropdownMenu>
              <DropdownMenuTrigger>
                <div className="w-full max-w-[40px] h-full rounded border border-dashed border-zinc-700/30 hover:bg-zinc-800/40 hover:border-zinc-500/50 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-all cursor-pointer backdrop-blur-sm">
                  <Plus className="h-3 w-3" />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-48 bg-[#18181b] border-zinc-700/50 text-zinc-300 shadow-2xl backdrop-blur-xl">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 px-3 py-2 font-bold select-none cursor-default">Select Item Type</div>
                <DropdownMenuSeparator className="bg-zinc-700/50" />
                <DropdownMenuItem 
                  onClick={() => addClip({ id: 'clip-'+Date.now(), name: 'New Text', type: 'dialog', startFrame: gap.start, duration: Math.min(60, gap.end - gap.start), trackId: track.id, color: 'bg-purple-600' })} 
                  className="gap-2 focus:bg-purple-500/10 focus:text-purple-300 cursor-pointer"
                >
                  <Type className="h-3.5 w-3.5" /> Text / Dialog
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => addClip({ id: 'clip-'+Date.now(), name: 'Note', type: 'note', startFrame: gap.start, duration: Math.min(90, gap.end - gap.start), trackId: track.id, color: 'bg-amber-600' })}
                  className="gap-2 focus:bg-amber-500/10 focus:text-amber-300 cursor-pointer"
                >
                  <MessageSquare className="h-3.5 w-3.5" /> Note
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => addClip({ id: 'clip-'+Date.now(), name: 'New Image', type: 'image', startFrame: gap.start, duration: Math.min(60, gap.end - gap.start), trackId: track.id, color: 'bg-emerald-600' })} 
                  className="gap-2 focus:bg-emerald-500/10 focus:text-emerald-300 cursor-pointer"
                >
                  <ImageIcon className="h-3.5 w-3.5" /> Image
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => addClip({ id: 'clip-'+Date.now(), name: 'New Video', type: 'video', startFrame: gap.start, duration: Math.min(60, gap.end - gap.start), trackId: track.id, color: 'bg-indigo-600' })} 
                  className="gap-2 focus:bg-amber-500/10 focus:text-amber-300 cursor-pointer"
                >
                  <Video className="h-3.5 w-3.5" /> Video
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}

        {trackClips.length > 0 && !isInteracting && (
          <div 
            className="absolute top-1.5 bottom-1.5 flex items-center z-10 transition-opacity opacity-0 group-hover:opacity-100"
            style={{ left: `${lastClipEndFrame * zoom + 8}px` }}
          >
            <DropdownMenu>
              <DropdownMenuTrigger>
                <div className="w-8 h-full rounded border border-dashed border-zinc-700/50 hover:bg-zinc-800/40 hover:border-zinc-500/50 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-all cursor-pointer backdrop-blur-sm">
                  <Plus className="h-3.5 w-3.5" />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48 bg-[#18181b] border-zinc-700/50 text-zinc-300 shadow-2xl backdrop-blur-xl">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 px-3 py-2 font-bold select-none cursor-default">Select Item Type</div>
                <DropdownMenuSeparator className="bg-zinc-700/50" />
                <DropdownMenuItem onClick={() => addClip({ id: 'clip-'+Date.now(), name: 'New Text', type: 'dialog', startFrame: lastClipEndFrame, duration: 60, trackId: track.id, color: 'bg-purple-600' })} className="gap-2 focus:bg-purple-500/10 focus:text-purple-300 cursor-pointer">
                  <Type className="h-3.5 w-3.5" /> Text / Dialog
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addClip({ id: 'clip-'+Date.now(), name: 'Note', type: 'note', startFrame: lastClipEndFrame, duration: 90, trackId: track.id, color: 'bg-amber-600' })} className="gap-2 focus:bg-amber-500/10 focus:text-amber-300 cursor-pointer">
                  <MessageSquare className="h-3.5 w-3.5" /> Note
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addClip({ id: 'clip-'+Date.now(), name: 'New Image', type: 'image', startFrame: lastClipEndFrame, duration: 60, trackId: track.id, color: 'bg-emerald-600' })} className="gap-2 focus:bg-emerald-500/10 focus:text-emerald-300 cursor-pointer">
                  <ImageIcon className="h-3.5 w-3.5" /> Image
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addClip({ id: 'clip-'+Date.now(), name: 'New Video', type: 'video', startFrame: lastClipEndFrame, duration: 60, trackId: track.id, color: 'bg-indigo-600' })} className="gap-2 focus:bg-amber-500/10 focus:text-amber-300 cursor-pointer">
                  <Video className="h-3.5 w-3.5" /> Video
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
}
