'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { useTimeline, TimelineClip, TimelineTrack } from '@/lib/timeline-context';
import { cn } from '@/lib/utils';
import { getGraphColor, getGraphDisplayLabel, getGraphShortLabel } from '@/lib/graph-style';
import { Video, Image as ImageIcon, MessageSquare, User, GripVertical } from 'lucide-react';

interface ClipItemProps {
  clip: TimelineClip;
  sceneClips?: TimelineClip[];
  sceneTracks?: TimelineTrack[];
  sceneId?: string;
}

export function ClipItem({ clip, sceneClips, sceneTracks, sceneId }: ClipItemProps) {
  const { zoom, updateClip, selectClip, selectedClipIds, tracks, collapsedTrackIds, clips, setSnapLineFrame, setIsInteracting, characters, setActiveScene, mutedTrackIds } = useTimeline();
  const clipTracks = sceneTracks || tracks;
  const clipSceneClips = sceneClips || clips;
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  
  const isSelected = selectedClipIds.includes(clip.id);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;

    if (isHovered && !isDragging) {
      const isMuted = mutedTrackIds.includes(clip.trackId);
      video.muted = isMuted;
      video.volume = isMuted ? 0 : 1;

      const playVideo = () => {
        const startSec = (clip.trimStart || 0) / 30;
        if (Math.abs(video.currentTime - startSec) > 0.1) {
          video.currentTime = startSec;
        }
        video.play().catch((err) => {
          if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
            video.muted = true;
            video.play().catch(() => {});
          }
        });
      };

      if (video.readyState >= 1) {
        playVideo();
      } else {
        video.onloadedmetadata = playVideo;
      }
    } else {
      video.onloadedmetadata = null;
      if (!video.paused) {
        video.pause();
      }
      
      const seekToTrimStart = () => {
        const startSec = (clip.trimStart || 0) / 30;
        if (Math.abs(video.currentTime - startSec) > 0.05) {
          video.currentTime = startSec;
        }
      };

      if (video.readyState >= 1) {
        seekToTrimStart();
      } else {
        video.onloadedmetadata = seekToTrimStart;
      }
    }
  }, [isHovered, isDragging, clip.trimStart, clip.trackId, mutedTrackIds]);

  const linkedCharacter = useMemo(() => {
    if (!clip.characterId) return null;
    return characters.find(c => c.id === clip.characterId);
  }, [characters, clip.characterId]);

  const characterName = linkedCharacter?.name || clip.character;
  const characterImage = linkedCharacter?.image;
  const linkedGraphColors = useMemo(() => {
    const clipTrack = clipTracks.find(track => track.id === clip.trackId);
    const linkedGraphIdSet = new Set(clip.linkedGraphTrackIds || []);
    const tagKeySet = new Set((clip.tags || []).map(tag => tag.trim().toLowerCase()).filter(Boolean));
    return clipTracks
      .filter(track => (
        track.type === 'graph' &&
        track.graph &&
        track.parentId === clipTrack?.parentId
      ))
      .map((track, graphIndex) => ({ track, graphIndex }))
      .filter(({ track }) => {
        const graphTagKeys = [
          track.name,
          track.graph?.label,
          track.graph?.shortLabel,
          getGraphDisplayLabel(track.graph, track.name),
          getGraphShortLabel(track.graph, track.name),
        ].map(value => value?.trim().toLowerCase()).filter((value): value is string => Boolean(value));

        return linkedGraphIdSet.has(track.id) || graphTagKeys.some(tagKey => tagKeySet.has(tagKey));
      })
      .map(({ track, graphIndex }) => {
        const color = getGraphColor(track.graph, graphIndex);
        return color.line || color.accent;
      });
  }, [clip.linkedGraphTrackIds, clip.tags, clip.trackId, clipTracks]);
  const hasLinkedGraphs = clip.type === 'note' && linkedGraphColors.length > 0;

  const visibleChildTracks = useMemo(() => {
    const parents = clipTracks.filter(t => !t.parentId);
    return parents.flatMap(p => {
      if (collapsedTrackIds.includes(p.id)) return [];
      return clipTracks.filter(t => t.parentId === p.id);
    });
  }, [clipTracks, collapsedTrackIds]);

  const getSnapFrames = (trackId: string, excludeIds: string[]) => {
    const currentTrack = clipTracks.find(t => t.id === trackId);
    const parentId = currentTrack?.parentId;

    const otherClips = clipSceneClips.filter(c => {
      if (excludeIds.includes(c.id)) return false;
      const t = clipTracks.find(track => track.id === c.trackId);
      return t?.parentId === parentId;
    });

    const snapFrames = new Set<number>();
    otherClips.forEach(c => {
      snapFrames.add(c.startFrame);
      snapFrames.add(c.startFrame + c.duration);
    });
    return Array.from(snapFrames);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    
    e.preventDefault();
    e.stopPropagation();
    if (sceneId) setActiveScene(sceneId);

    const isMultiSelected = selectedClipIds.includes(clip.id);
    const draggingClips = isMultiSelected 
      ? clipSceneClips.filter(c => selectedClipIds.includes(c.id))
      : [clip];
    
    // Check if dragging clips span multiple tracks
    const uniqueTracks = new Set(draggingClips.map(c => c.trackId));
    const canChangeTrack = uniqueTracks.size === 1;

    let hasMoved = false;
    const startX = e.pageX;
    const startY = e.pageY;
    
    const initialPositions = draggingClips.map(c => ({
      id: c.id,
      startFrame: c.startFrame,
      trackId: c.trackId,
      trackIndex: visibleChildTracks.findIndex(t => t.id === c.trackId)
    }));

    const anchorInitial = initialPositions.find(p => p.id === clip.id)!;
    const thresholdFrames = 10 / zoom;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.pageX - startX;
      const deltaY = moveEvent.pageY - startY;
      
      if (!hasMoved && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
        hasMoved = true;
        setIsDragging(true);
        setIsInteracting(true);
      }

      if (!hasMoved) return;

      // Vertical movement (Track change)
      const trackHeight = 48;
      const trackDelta = canChangeTrack ? Math.round(deltaY / trackHeight) : 0;
      
      // Horizontal movement (Time change)
      const deltaFrames = Math.round(deltaX / zoom);
      let anchorNewStart = Math.max(0, anchorInitial.startFrame + deltaFrames);

      // Snapping (based on anchor clip)
      let snapOffset = 0;
      let minSnapDiff = Infinity;
      let snappedLineFrame: number | null = null;
      
      const newAnchorTrackIndex = Math.max(0, Math.min(visibleChildTracks.length - 1, anchorInitial.trackIndex + trackDelta));
      const newAnchorTrackId = visibleChildTracks[newAnchorTrackIndex]?.id;
      
      const snapArray = getSnapFrames(newAnchorTrackId || clip.trackId, draggingClips.map(c => c.id));
      
      for (const sf of snapArray) {
        const diffStart = sf - anchorNewStart;
        if (Math.abs(diffStart) < minSnapDiff && Math.abs(diffStart) <= thresholdFrames) {
          minSnapDiff = Math.abs(diffStart);
          snapOffset = diffStart;
          snappedLineFrame = sf;
        }
        const diffEnd = sf - (anchorNewStart + clip.duration);
        if (Math.abs(diffEnd) < minSnapDiff && Math.abs(diffEnd) <= thresholdFrames) {
          minSnapDiff = Math.abs(diffEnd);
          snapOffset = diffEnd;
          snappedLineFrame = sf;
        }
      }

      setSnapLineFrame(snappedLineFrame);
      anchorNewStart += snapOffset;
      const finalDeltaFrames = anchorNewStart - anchorInitial.startFrame;

      // Update all dragging clips
      initialPositions.forEach(pos => {
        const newStart = Math.max(0, pos.startFrame + finalDeltaFrames);
        const newIdx = Math.max(0, Math.min(visibleChildTracks.length - 1, pos.trackIndex + trackDelta));
        const newTId = visibleChildTracks[newIdx]?.id;

        if (newTId && (newStart !== clipSceneClips.find(c => c.id === pos.id)?.startFrame || newTId !== clipSceneClips.find(c => c.id === pos.id)?.trackId)) {
          updateClip(pos.id, { 
            startFrame: newStart,
            trackId: newTId
          });
        }
      });
    };

    const onPointerUp = () => {
      if (!hasMoved) {
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          selectClip(clip.id, true);
        } else {
          selectClip(clip.id);
        }
      }
      setIsDragging(false);
      setIsInteracting(false);
      setSnapLineFrame(null);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const [resizingState, setResizingState] = useState<{
    type: 'start' | 'end';
    trimStart: number;
    duration: number;
  } | null>(null);

  const handleResize = (e: React.PointerEvent, type: 'start' | 'end') => {
    e.stopPropagation();
    e.preventDefault();
    setIsInteracting(true);
    const startX = e.pageX;
    const startDuration = clip.duration;
    const startFrame = clip.startFrame;
    const initialTrimStart = clip.trimStart || 0;
    const snapArray = getSnapFrames(clip.trackId, [clip.id]);
    const thresholdFrames = 10 / zoom;

    setResizingState({
      type,
      trimStart: initialTrimStart,
      duration: startDuration
    });

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.pageX - startX;
      const deltaFrames = Math.round(deltaX / zoom);

      let snappedLineFrame: number | null = null;

      if (type === 'end') {
        let newEndFrame = startFrame + startDuration + deltaFrames;
        let snapOffset = 0;
        let minSnapDiff = Infinity;
        for (const sf of snapArray) {
          const diff = sf - newEndFrame;
          if (Math.abs(diff) < minSnapDiff && Math.abs(diff) <= thresholdFrames) {
            minSnapDiff = Math.abs(diff);
            snapOffset = diff;
            snappedLineFrame = sf;
          }
        }
        newEndFrame += snapOffset;
        setSnapLineFrame(snappedLineFrame);

        let newDuration = Math.max(1, newEndFrame - startFrame);
        if (clip.type === 'video') {
          const maxDuration = (clip.mediaDuration || Infinity) - initialTrimStart;
          newDuration = Math.min(newDuration, maxDuration);
        }

        setResizingState({
          type: 'end',
          trimStart: initialTrimStart,
          duration: newDuration
        });
        updateClip(clip.id, { duration: newDuration });
      } else {
        const newStartRaw = startFrame + deltaFrames;
        const maxAllowedStart = startFrame + startDuration - 1;
        let newStart = Math.max(0, Math.min(newStartRaw, maxAllowedStart));
        
        let snapOffset = 0;
        let minSnapDiff = Infinity;
        for (const sf of snapArray) {
          const diff = sf - newStart;
          if (Math.abs(diff) < minSnapDiff && Math.abs(diff) <= thresholdFrames) {
            minSnapDiff = Math.abs(diff);
            snapOffset = diff;
            snappedLineFrame = sf;
          }
        }
        newStart += snapOffset;
        // Clamp to not exceed the end - 1
        newStart = Math.min(newStart, maxAllowedStart);

        let diffStart = newStart - startFrame;
        let newTrimStart = initialTrimStart + diffStart;
        if (clip.type === 'video') {
          if (newTrimStart < 0) {
            const adjustment = -newTrimStart;
            newTrimStart = 0;
            newStart += adjustment;
            diffStart = newStart - startFrame;
          }
        } else {
          // For non-video, trimStart isn't used, but clamp startFrame so it doesn't go below 0
          if (newStart < 0) {
            newStart = 0;
            diffStart = newStart - startFrame;
          }
        }

        if (newStart < startFrame + startDuration) {
           setSnapLineFrame(snappedLineFrame);
           const newDuration = (startFrame + startDuration) - newStart;
           setResizingState({
             type: 'start',
             trimStart: clip.type === 'video' ? newTrimStart : 0,
             duration: newDuration
           });
           updateClip(clip.id, { 
             startFrame: newStart, 
             duration: newDuration,
             ...(clip.type === 'video' ? { trimStart: newTrimStart } : {})
           });
        } else {
           setSnapLineFrame(null);
        }
      }
    };

    const onPointerUp = () => {
      setSnapLineFrame(null);
      setIsInteracting(false);
      setResizingState(null);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const getIcon = () => {
    switch (clip.type) {
      case 'video': return <Video className="h-3 w-3" />;
      case 'image': return <ImageIcon className="h-3 w-3" />;
      case 'dialog': return <MessageSquare className="h-3 w-3" />;
      case 'note': return (
        <span className="relative inline-flex h-3 w-3">
          <MessageSquare className="h-3 w-3" />
          {hasLinkedGraphs && (
            <span className="absolute -right-1 -top-1 flex max-w-4 flex-wrap justify-end gap-px">
              {(linkedGraphColors.length > 0 ? linkedGraphColors : ['#fcd34d']).map((color, index) => (
                <span
                  key={`${color}-${index}`}
                  className="h-1.5 w-1.5 rounded-full ring-1 ring-black/70"
                  style={{ background: color }}
                />
              ))}
            </span>
          )}
        </span>
      );
      default: return null;
    }
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "absolute top-1.5 bottom-1.5 rounded-sm flex items-center cursor-grab active:cursor-grabbing border transition-all duration-200 group",
        clip.type === 'video' && "bg-indigo-600/40 border-indigo-500/50 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]",
        clip.type === 'image' && "bg-emerald-600/40 border-emerald-500/50",
        clip.type === 'dialog' && "bg-purple-600/40 border-purple-500/50",
        clip.type === 'note' && "bg-amber-600/40 border-amber-500/50",
        isSelected && "ring-2 ring-white/50 ring-offset-2 ring-offset-[#0a0a0b] z-30 scale-[1.01] border-white/50",
        isDragging && "opacity-90 z-50 shadow-2xl scale-105"
      )}
      style={{
        left: `${clip.startFrame * zoom}px`,
        width: `${clip.duration * zoom}px`,
      }}
    >
      {/* Background Media wrapped in an overflow-hidden rounded container */}
      <div className="absolute inset-0 z-0 overflow-hidden rounded-sm pointer-events-none">
        {clip.src && (
          <div className="absolute inset-0 opacity-40">
            {clip.type === 'video' ? (
              <video 
                ref={previewVideoRef}
                src={clip.src} 
                className="w-full h-full object-cover" 
                playsInline
                muted={mutedTrackIds.includes(clip.trackId)}
              />
            ) : (
              <img src={clip.src} alt="" className="w-full h-full object-cover" />
            )}
          </div>
        )}
      </div>

      {/* Visual drag handle */}
      <div className="absolute left-4 opacity-20 group-hover:opacity-100 transition-opacity z-20 pointer-events-none">
        <GripVertical className="h-3 w-3" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex items-center gap-2 pl-8 pr-6 w-full pointer-events-none select-none">
        <div className="shrink-0 opacity-80">
          {clip.type === 'dialog' && characterName ? (
            <div className="w-4 h-4 rounded-full bg-white/20 border border-white/10 overflow-hidden flex items-center justify-center">
               {characterImage ? (
                 <img src={characterImage} className="w-full h-full object-cover" />
               ) : (
                 <User className="h-2.5 w-2.5" />
               )}
            </div>
          ) : getIcon()}
        </div>
        
        <span className="text-[10px] font-bold text-white/90 uppercase tracking-wider truncate">
          {clip.type === 'dialog' && characterName ? `${characterName}: ` : ''}
          {clip.name}
        </span>

        {/* Thumbnail preview simulation replaced by background if src exists */}
        {clip.type !== 'dialog' && clip.type !== 'note' && !clip.src && (
           <div className="ml-auto flex gap-0.5 opacity-20">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="w-4 h-full bg-white/20 rounded-sm" />
              ))}
           </div>
        )}
      </div>

      {/* Resize handles */}
      <div 
        className="resize-handle absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize hover:bg-white/10 z-30 flex items-center justify-start"
        onPointerDown={(e) => handleResize(e, 'start')}
      >
        <div className="w-1.5 h-1/2 bg-white rounded-r-sm shadow-md transition-opacity opacity-0 group-hover:opacity-100 ml-0.5" />
      </div>
      <div 
        className="resize-handle absolute right-0 top-0 bottom-0 w-4 cursor-ew-resize hover:bg-white/10 z-30 flex items-center justify-end"
        onPointerDown={(e) => handleResize(e, 'end')}
      >
        <div className="w-1.5 h-1/2 bg-white rounded-l-sm shadow-md transition-opacity opacity-0 group-hover:opacity-100 mr-0.5" />
      </div>
      
      {/* Resizing Tooltip */}
      {resizingState && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-700 text-white text-[10px] font-mono font-bold px-2 py-1 rounded shadow-[0_12px_24px_rgba(0,0,0,0.5)] z-[60] whitespace-nowrap uppercase tracking-wider flex items-center gap-2 select-none pointer-events-none">
          {clip.type === 'video' && (
            <>
              {resizingState.type === 'start' ? (
                <span className="text-indigo-400">Trim Start: +{(resizingState.trimStart / 30).toFixed(2)}s ({resizingState.trimStart}f)</span>
              ) : (
                <span className="text-emerald-400">Trim End: +{(((clip.trimStart || 0) + resizingState.duration) / 30).toFixed(2)}s</span>
              )}
              <span className="text-zinc-600">|</span>
            </>
          )}
          <span>Dur: {(resizingState.duration / 30).toFixed(2)}s ({resizingState.duration}f)</span>
        </div>
      )}

      {/* Hover Info (hidden while resizing) */}
      {!resizingState && (
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-white text-black text-[9px] font-black px-2 py-0.5 rounded shadow-2xl opacity-0 group-hover:opacity-100 transition-all transform translate-y-1 group-hover:translate-y-0 whitespace-nowrap pointer-events-none z-50 uppercase tracking-tighter">
          {clip.type} • {clip.duration}F • {(clip.duration / 30).toFixed(2)}s
          {clip.type === 'video' && clip.trimStart ? ` • trim: +${(clip.trimStart / 30).toFixed(2)}s` : ''}
        </div>
      )}
    </div>
  );
}
