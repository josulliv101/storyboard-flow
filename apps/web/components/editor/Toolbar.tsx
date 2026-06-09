'use client';

import React, { useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, ZoomIn, ZoomOut, Plus, Trash2, Video, Image as ImageIcon, MessageSquare, User, ChevronDown, Monitor, Filter, Activity, Tags, Type, Star } from 'lucide-react';
import {
  Button,
  buttonVariants,
  Slider,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@storyboard/ui";
import { useTimeline, TimelineClip, ClipType } from '@/lib/timeline-context';
import { cn } from '@/lib/utils';
import { getGraphDisplayLabel, getGraphShortLabel } from '@/lib/graph-style';

const NOTE_TAG_FILTER_NONE = '__NO_NOTE_TAGS_VISIBLE__';
const normalizeTagKey = (value: string | undefined) => value?.trim().toLowerCase() || '';

export function Toolbar() {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [pendingType, setPendingType] = React.useState<ClipType | null>(null);

  const { 
    currentFrame, setCurrentFrame, 
    isPlaying, setPlaying, 
    playbackRate, setPlaybackRate,
    fps, totalDuration,
    zoom, setZoom,
    selectedClipIds, deleteClip, addClip, tracks,
    disabledTrackIds, toggleTrackDisable,
    aspectRatio, setAspectRatio,
    addGridItemPosition, setAddGridItemPosition,
    scenes, activeSceneId, setActiveScene,
    previewSceneMode, previewSceneIds,
    previewMediaLayout, setPreviewMediaLayout,
    compactNoteOverlays, setCompactNoteOverlays,
    showDialogPreviewUi, setShowDialogPreviewUi,
    showSceneTitleUi, setShowSceneTitleUi,
    noteTagFilter, setNoteTagFilter,
    showStarredNoteOverlaysOnly, setShowStarredNoteOverlaysOnly
  } = useTimeline();

  const previewScenes = React.useMemo(() => {
    const previewSceneIdSet = previewSceneIds.length > 0 ? new Set(previewSceneIds) : undefined;
    const includedScenes = previewSceneIdSet
      ? scenes.filter(scene => previewSceneIdSet.has(scene.id))
      : scenes;
    if (previewSceneMode === 'all' || includedScenes.length > 1) {
      return includedScenes.length > 0 ? includedScenes : scenes.filter(scene => scene.id === activeSceneId);
    }
    return scenes.filter(scene => scene.id === activeSceneId);
  }, [activeSceneId, previewSceneIds, previewSceneMode, scenes]);

  const noteTagCounts = React.useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    previewScenes.flatMap(scene => scene.clips)
        .filter(clip => clip.type === 'note')
        .flatMap(clip => clip.tags || [])
        .map(tag => tag.trim())
        .filter(Boolean)
        .forEach(tag => {
          const key = tag.toLowerCase();
          const existing = counts.get(key);
          counts.set(key, { label: existing?.label || tag, count: (existing?.count || 0) + 1 });
        });
    return counts;
  }, [previewScenes]);
  const graphTagKeySet = React.useMemo(() => (
    new Set(
      previewScenes
        .flatMap(scene => scene.tracks)
        .filter(track => track.type === 'graph' && track.graph)
        .flatMap(track => [
          track.name,
          track.graph?.label,
          track.graph?.shortLabel,
          getGraphDisplayLabel(track.graph, track.name),
          getGraphShortLabel(track.graph, track.name),
        ])
        .map(normalizeTagKey)
        .filter(Boolean)
    )
  ), [previewScenes]);
  const noteTags = React.useMemo(() => (
    Array.from(noteTagCounts.values())
      .map(item => item.label)
      .filter(tag => normalizeTagKey(tag) !== 'preview' && !graphTagKeySet.has(normalizeTagKey(tag)))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  ), [graphTagKeySet, noteTagCounts]);
  const graphLayers = React.useMemo(() => {
    const trackById = new Map(tracks.map(track => [track.id, track]));
    return tracks
      .filter(track => track.type === 'graph' && track.graph)
      .map(track => ({
        id: track.id,
        label: getGraphDisplayLabel(track.graph, track.name),
        parentName: track.parentId ? trackById.get(track.parentId)?.name : undefined,
        isVisible: !disabledTrackIds.includes(track.id),
      }))
      .sort((a, b) => (
        (a.parentName || '').localeCompare(b.parentName || '', undefined, { sensitivity: 'base' }) ||
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
      ));
  }, [disabledTrackIds, tracks]);
  const visibleGraphLayerCount = graphLayers.filter(layer => layer.isVisible).length;
  const enabledNoteTagSet = React.useMemo(() => (
    new Set((noteTagFilter.length > 0 ? noteTagFilter : noteTags)
      .filter(tag => tag !== NOTE_TAG_FILTER_NONE)
      .map(tag => tag.toLowerCase()))
  ), [noteTagFilter, noteTags]);
  const activeFilterCount = noteTagFilter.length > 0
    ? noteTags.filter(tag => enabledNoteTagSet.has(tag.toLowerCase())).length
    : noteTags.length;
  const selectedFilterLabels = React.useMemo(() => {
    if (noteTagFilter.includes(NOTE_TAG_FILTER_NONE)) return showStarredNoteOverlaysOnly ? ['Starred only', 'No notes'] : ['No notes'];
    if (noteTags.length === 0) return [];
    const labels = noteTagFilter.length === 0
      ? ['All tags']
      : enabledNoteTagSet.size === 0
        ? ['None']
        : noteTags.filter(tag => enabledNoteTagSet.has(tag.toLowerCase()));
    return showStarredNoteOverlaysOnly ? ['Starred only', ...labels] : labels;
  }, [enabledNoteTagSet, noteTagFilter, noteTags, showStarredNoteOverlaysOnly]);
  const filterSummaryLabel = selectedFilterLabels.length > 2
    ? `${selectedFilterLabels.slice(0, 2).join(', ')} +${selectedFilterLabels.length - 2}`
    : selectedFilterLabels.join(', ');

  React.useEffect(() => {
    if (noteTagFilter.length === 0) return;

    const noteTagKeySet = new Set(noteTags.map(normalizeTagKey));
    const nextNoteTagFilter = noteTagFilter.filter(tag => (
      tag === NOTE_TAG_FILTER_NONE || noteTagKeySet.has(normalizeTagKey(tag))
    ));

    if (nextNoteTagFilter.length !== noteTagFilter.length) {
      setNoteTagFilter(
        nextNoteTagFilter.includes(NOTE_TAG_FILTER_NONE) || nextNoteTagFilter.some(tag => tag !== NOTE_TAG_FILTER_NONE)
          ? nextNoteTagFilter
          : []
      );
    }
  }, [noteTagFilter, noteTags, setNoteTagFilter]);

  const toggleNoteTag = (tag: string) => {
    const tagKey = tag.toLowerCase();
    const currentEnabledTags = noteTagFilter.length > 0
      ? noteTagFilter.filter(item => item !== NOTE_TAG_FILTER_NONE)
      : noteTags;
    const isEnabled = currentEnabledTags.some(item => item.toLowerCase() === tagKey);
    const nextEnabledTags = isEnabled
      ? currentEnabledTags.filter(item => item.toLowerCase() !== tagKey)
      : [...currentEnabledTags, tag];

    setNoteTagFilter(nextEnabledTags.length > 0 ? nextEnabledTags : [NOTE_TAG_FILTER_NONE]);
  };

  const sceneTabs = previewScenes.length > 1 ? previewScenes : [];

  const formatTime = (frame: number) => {
    const totalSeconds = frame / fps;
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    const frames = frame % fps;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${frames.toString().padStart(2, '0')}`;
  };

  const handleAddClipClick = (type: ClipType) => {
    if (type === 'dialog') {
      handleAddClip('dialog', 'Narrator');
    } else if (type === 'note') {
      handleAddClip('note');
    } else {
      setPendingType(type);
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && pendingType) {
      handleAddClip(pendingType, undefined, file);
    }
    e.target.value = '';
    setPendingType(null);
  };

  const handleAddClip = (type: ClipType, character?: string, file?: File) => {
    let trackId = 'track-1';
    let color = 'bg-indigo-600';
    let name = file ? file.name : 'New Clip';

    if (type === 'video') {
       trackId = tracks.find(t => t.name.includes('Video'))?.id || 'track-1';
       color = 'bg-zinc-600';
    } else if (type === 'image') {
       trackId = tracks.find(t => t.name.includes('Images'))?.id || 'track-4';
       color = 'bg-zinc-600';
    } else if (type === 'dialog') {
       trackId = tracks.find(t => t.name.includes('Dialog'))?.id || 'track-3';
       color = 'bg-purple-600';
       name = character ? `Line for ${character}` : 'Dialog';
    } else if (type === 'note') {
       trackId = tracks.find(t => t.name.includes('Dialog'))?.id || 'track-3';
       color = 'bg-amber-600';
       name = 'Note';
    }

    addClip({
      id: `clip-${Math.random().toString(36).substr(2, 9)}`,
      name,
      type,
      startFrame: currentFrame,
      duration: type === 'video' ? 150 : 60, // approximate default
      trackId,
      color,
      character
    }, file);
  };

  return (
    <TooltipProvider>
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept={pendingType === 'video' ? 'video/*' : 'image/*'}
        onChange={handleFileChange}
      />
      <div className="relative z-30 flex h-12 items-center justify-between border-b border-zinc-800 bg-[#111114] px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 pr-4">
          {sceneTabs.length > 1 ? (
            <>
              <div className="shrink-0 text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600">
                Scenes
              </div>
              <div className="flex min-w-0 max-w-[min(34vw,420px)] items-center gap-1.5 overflow-x-auto">
                {sceneTabs.map((scene, index) => {
                  const isActive = scene.id === activeSceneId;
                  return (
                    <button
                      key={scene.id}
                      type="button"
                      className={cn(
                        "flex h-7 shrink-0 items-center gap-1.5 rounded border px-2 text-left transition-colors",
                        isActive
                          ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-100"
                          : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200"
                      )}
                      onClick={() => setActiveScene(scene.id)}
                    >
                      <span className={cn(
                        "flex h-4 min-w-4 items-center justify-center rounded-sm font-mono text-[9px] font-black tabular-nums",
                        isActive ? "bg-indigo-400 text-black" : "bg-zinc-800 text-zinc-500"
                      )}>
                        {index + 1}
                      </span>
                      <span className="max-w-24 truncate text-[10px] font-bold uppercase tracking-wider">
                        {scene.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="h-8" />
          )}
        </div>

        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2">
          <Tooltip>
            <TooltipTrigger 
              className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "text-zinc-500 hover:text-zinc-300")}
              onClick={() => setCurrentFrame(0)}
            >
              <SkipBack className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>Reset to Start</TooltipContent>
          </Tooltip>

          <Button 
            variant="secondary" 
            size="icon" 
            className="h-8 w-8 rounded-full bg-white text-black hover:bg-zinc-200 transition-all shadow-[0_0_15px_rgba(255,255,255,0.1)]"
            onClick={() => {
              if (!isPlaying) {
                window.dispatchEvent(new Event('timeline-preview-play-request'));
              }
              setPlaying(!isPlaying);
            }}
          >
            {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 ml-0.5 fill-current" />}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "relative text-zinc-500 hover:text-zinc-300",
                (noteTagFilter.length > 0 || showStarredNoteOverlaysOnly) && "text-indigo-300 hover:text-indigo-200"
              )}
              aria-label="Filter notes"
            >
              <Filter className="h-4 w-4" />
              {(noteTagFilter.length > 0 || showStarredNoteOverlaysOnly) && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-indigo-400" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="max-h-80 w-64 overflow-y-auto border-zinc-800 bg-[#111114] p-2 text-zinc-300">
              <div className="mb-2 flex flex-col gap-2 rounded border border-zinc-800 bg-zinc-950/70 p-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Preview UI</div>
                <button
                  type="button"
                  aria-pressed={showDialogPreviewUi}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                    showDialogPreviewUi
                      ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-100"
                      : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                  )}
                  onClick={() => setShowDialogPreviewUi(!showDialogPreviewUi)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate text-[10px] font-bold uppercase tracking-wider">Dialog UI</span>
                  </span>
                  <span
                    className={cn(
                      "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
                      showDialogPreviewUi ? "border-indigo-400/60 bg-indigo-400/25" : "border-zinc-700 bg-zinc-900"
                    )}
                    aria-hidden="true"
                  >
                    <span
                      className={cn(
                        "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform",
                        showDialogPreviewUi ? "translate-x-3.5 bg-indigo-200" : "translate-x-0.5 bg-zinc-600"
                      )}
                    />
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={showSceneTitleUi}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                    showSceneTitleUi
                      ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-100"
                      : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                  )}
                  onClick={() => setShowSceneTitleUi(!showSceneTitleUi)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Type className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate text-[10px] font-bold uppercase tracking-wider">Scene Info</span>
                  </span>
                  <span
                    className={cn(
                      "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
                      showSceneTitleUi ? "border-indigo-400/60 bg-indigo-400/25" : "border-zinc-700 bg-zinc-900"
                    )}
                    aria-hidden="true"
                  >
                    <span
                      className={cn(
                        "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform",
                        showSceneTitleUi ? "translate-x-3.5 bg-indigo-200" : "translate-x-0.5 bg-zinc-600"
                      )}
                    />
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={previewMediaLayout === 'full'}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                    previewMediaLayout === 'full'
                      ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-100"
                      : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                  )}
                  onClick={() => setPreviewMediaLayout(previewMediaLayout === 'full' ? 'inset' : 'full')}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Monitor className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate text-[10px] font-bold uppercase tracking-wider">
                      {previewMediaLayout === 'full' ? 'Full Video' : 'Inset Video'}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
                      previewMediaLayout === 'full' ? "border-indigo-400/60 bg-indigo-400/25" : "border-zinc-700 bg-zinc-900"
                    )}
                    aria-hidden="true"
                  >
                    <span
                      className={cn(
                        "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform",
                        previewMediaLayout === 'full' ? "translate-x-3.5 bg-indigo-200" : "translate-x-0.5 bg-zinc-600"
                      )}
                    />
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={compactNoteOverlays}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                    compactNoteOverlays
                      ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-100"
                      : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                  )}
                  onClick={() => setCompactNoteOverlays(!compactNoteOverlays)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Tags className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate text-[10px] font-bold uppercase tracking-wider">Note Tags</span>
                  </span>
                  <span
                    className={cn(
                      "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
                      compactNoteOverlays ? "border-indigo-400/60 bg-indigo-400/25" : "border-zinc-700 bg-zinc-900"
                    )}
                    aria-hidden="true"
                  >
                    <span
                      className={cn(
                        "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform",
                        compactNoteOverlays ? "translate-x-3.5 bg-indigo-200" : "translate-x-0.5 bg-zinc-600"
                      )}
                    />
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={showStarredNoteOverlaysOnly}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                    showStarredNoteOverlaysOnly
                      ? "border-amber-400/50 bg-amber-400/10 text-amber-100"
                      : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                  )}
                  onClick={() => setShowStarredNoteOverlaysOnly(!showStarredNoteOverlaysOnly)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Star className={cn("h-3.5 w-3.5 shrink-0", showStarredNoteOverlaysOnly && "fill-amber-300 text-amber-300")} />
                    <span className="truncate text-[10px] font-bold uppercase tracking-wider">Starred Notes Only</span>
                  </span>
                  <span
                    className={cn(
                      "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
                      showStarredNoteOverlaysOnly ? "border-amber-300/60 bg-amber-300/25" : "border-zinc-700 bg-zinc-900"
                    )}
                    aria-hidden="true"
                  >
                    <span
                      className={cn(
                        "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform",
                        showStarredNoteOverlaysOnly ? "translate-x-3.5 bg-amber-100" : "translate-x-0.5 bg-zinc-600"
                      )}
                    />
                  </span>
                </button>
              </div>
              <DropdownMenuSeparator className="mb-2 bg-zinc-800" />
              <div className="mb-2 flex flex-col gap-2 rounded border border-zinc-800 bg-zinc-950/70 p-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Graph Layers</div>
                    <div className="mt-0.5 text-[9px] font-mono uppercase tracking-widest text-zinc-600">
                      {graphLayers.length === 0 ? 'No graphs' : `${visibleGraphLayerCount}/${graphLayers.length} visible`}
                    </div>
                  </div>
                </div>
                {graphLayers.length === 0 ? (
                  <div className="rounded border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                    No graph layers yet
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {graphLayers.map(layer => (
                      <button
                        key={layer.id}
                        type="button"
                        aria-pressed={layer.isVisible}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                          layer.isVisible
                            ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-100"
                            : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                        )}
                        onClick={() => toggleTrackDisable(layer.id)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Activity className="h-3.5 w-3.5 shrink-0" />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-[10px] font-bold uppercase tracking-wider">{layer.label}</span>
                            {layer.parentName && (
                              <span className="truncate text-[9px] font-mono uppercase tracking-widest text-zinc-600">{layer.parentName}</span>
                            )}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
                            layer.isVisible ? "border-indigo-400/60 bg-indigo-400/25" : "border-zinc-700 bg-zinc-900"
                          )}
                          aria-hidden="true"
                        >
                          <span
                            className={cn(
                              "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform",
                              layer.isVisible ? "translate-x-3.5 bg-indigo-200" : "translate-x-0.5 bg-zinc-600"
                            )}
                          />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <DropdownMenuSeparator className="mb-2 bg-zinc-800" />
              <div className="mb-2 flex items-center justify-between gap-3 px-1">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Note Tags</div>
                  <div className="mt-0.5 text-[9px] font-mono uppercase tracking-widest text-zinc-600">
                    {noteTags.length === 0 ? 'No tags' : `${activeFilterCount}/${noteTags.length} visible`}
                  </div>
                </div>
                {noteTags.length > 0 && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      className="rounded border border-zinc-800 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                      onClick={() => setNoteTagFilter([])}
                    >
                      Show All
                    </button>
                    <button
                      type="button"
                      className="rounded border border-zinc-800 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                      onClick={() => setNoteTagFilter([NOTE_TAG_FILTER_NONE])}
                    >
                      Hide All
                    </button>
                  </div>
                )}
              </div>
              {noteTags.length === 0 ? (
                <div className="rounded border border-zinc-800 bg-zinc-950/80 px-3 py-4 text-center text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                  No note tags yet
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {noteTags.map(tag => {
                    const isEnabled = enabledNoteTagSet.has(tag.toLowerCase());
                    const noteCount = noteTagCounts.get(tag.toLowerCase())?.count || 0;
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
                          isEnabled
                            ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-200"
                            : "border-zinc-800 bg-zinc-950/80 text-zinc-600 hover:border-zinc-700 hover:text-zinc-300"
                        )}
                        onClick={() => toggleNoteTag(tag)}
                      >
                        <span>{tag}</span>
                        <span className={cn(
                          "ml-0.5 rounded px-1 font-mono text-[9px] leading-none",
                          isEnabled ? "bg-indigo-300/15 text-indigo-100" : "bg-white/[0.04] text-zinc-500"
                        )}>
                          {noteCount}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {noteTags.length === 0 && (
                <div className="mt-2 flex items-center justify-center gap-1.5">
                  <button
                    type="button"
                    className="rounded border border-zinc-800 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                    onClick={() => setNoteTagFilter([])}
                  >
                    Show All
                  </button>
                  <button
                    type="button"
                    className="rounded border border-zinc-800 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                    onClick={() => setNoteTagFilter([NOTE_TAG_FILTER_NONE])}
                  >
                    Hide All
                  </button>
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {filterSummaryLabel && (
            <div
              className="max-w-44 truncate rounded border border-zinc-800 bg-zinc-950/80 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500"
              title={selectedFilterLabels.join(', ')}
            >
              {filterSummaryLabel}
            </div>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 min-w-14 justify-center border-zinc-800 bg-[#0a0a0b] px-2 font-mono text-[10px] font-bold text-zinc-300 hover:bg-zinc-900 hover:text-white")}
            >
              {playbackRate.toFixed(playbackRate % 1 === 0 ? 0 : 2)}x
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-28 bg-[#111114] border-zinc-800 text-zinc-300">
              <div className="px-2 py-1 text-[9px] uppercase tracking-widest text-zinc-500 font-bold select-none cursor-default">Speed</div>
              {[0.25, 0.5, 0.75, 1, 1.25, 1.5].map((rate) => (
                <DropdownMenuItem
                  key={rate}
                  onClick={() => setPlaybackRate(rate)}
                  className="justify-between font-mono text-xs"
                >
                  {rate.toFixed(rate % 1 === 0 ? 0 : 2)}x
                  {playbackRate === rate && <span className="text-indigo-300">•</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center gap-3 ml-4">
            <span className="text-sm font-mono text-indigo-400 font-bold tabular-nums">
              {formatTime(currentFrame)}
            </span>
            <div className="h-4 w-px bg-zinc-800" />
            <span className="text-[10px] text-zinc-600 font-mono tracking-widest">
               {currentFrame} / {totalDuration} FR
            </span>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-end gap-4 pl-4">
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger 
                className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "text-zinc-500 hover:text-red-400 hover:bg-red-900/10 transition-colors disabled:opacity-50")}
                disabled={selectedClipIds.length === 0}
                onClick={() => selectedClipIds.forEach(id => deleteClip(id))}
              >
                <Trash2 className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent>Delete Selection</TooltipContent>
            </Tooltip>

            <div className="h-4 w-px bg-zinc-800 mx-1" />

            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 gap-2 bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500 hover:text-white")}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Item
                <ChevronDown className="h-3 w-3 opacity-50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-[#111114] border-zinc-800 text-zinc-300">
                <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-bold select-none cursor-default">Media Assets</div>
                <DropdownMenuItem onClick={() => handleAddClipClick('video')} className="focus:bg-zinc-600 focus:text-white gap-2">
                  <Video className="h-4 w-4" /> Video Layer
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAddClipClick('image')} className="focus:bg-zinc-600 focus:text-white gap-2">
                  <ImageIcon className="h-4 w-4" /> Image/Graphic
                </DropdownMenuItem>
                
                <DropdownMenuSeparator className="bg-zinc-800" />
                <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-bold select-none cursor-default">Characters Dialog</div>
                <DropdownMenuItem onClick={() => handleAddClip('dialog', 'Hero')} className="focus:bg-purple-600 focus:text-white gap-2">
                  <div className="w-4 h-4 rounded-full bg-blue-500/20 flex items-center justify-center"><User className="h-2.5 w-2.5 text-blue-400" /></div>
                  Hero Dialog
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAddClip('dialog', 'Villain')} className="focus:bg-purple-600 focus:text-white gap-2">
                  <div className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center"><User className="h-2.5 w-2.5 text-red-400" /></div>
                  Villain Dialog
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAddClip('dialog', 'Narrator')} className="focus:bg-purple-600 focus:text-white gap-2">
                  <div className="w-4 h-4 rounded-full bg-zinc-500/20 flex items-center justify-center"><MessageSquare className="h-2.5 w-2.5 text-zinc-400" /></div>
                  Narrator Node
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAddClip('note')} className="focus:bg-amber-600 focus:text-white gap-2">
                  <MessageSquare className="h-4 w-4" /> Note
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="h-4 w-px bg-zinc-800" />

          <DropdownMenu>
            <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2 gap-2 text-zinc-400 hover:text-zinc-200")}>
              <Monitor className="h-3.5 w-3.5" />
              <span className="text-[10px] font-mono font-bold tracking-widest">{aspectRatio}</span>
              <ChevronDown className="h-3 w-3 opacity-30" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 bg-[#1d1d21] border-zinc-800 text-zinc-300">
              <div className="px-2 py-1 text-[9px] uppercase tracking-widest text-zinc-500 font-bold select-none cursor-default">Aspect Ratio</div>
              <DropdownMenuItem onClick={() => setAspectRatio('16:9')} className="hover:bg-indigo-600 hover:text-white justify-between cursor-pointer">
                <span>Widescreen</span>
                <span className="text-[10px] opacity-50">16:9</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAspectRatio('21:9')} className="hover:bg-indigo-600 hover:text-white justify-between cursor-pointer">
                <span>Ultrawide</span>
                <span className="text-[10px] opacity-50">21:9</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="h-4 w-px bg-zinc-800" />

          <div className="flex items-center gap-3 bg-[#0a0a0b] px-3 py-1.5 rounded-md border border-zinc-800">
            <ZoomOut className="h-3 w-3 text-zinc-600" />
            <div className="w-24">
              <Slider 
                value={[zoom]} 
                min={1} 
                max={20} 
                step={0.1} 
                onValueChange={(val) => {
                  const newValue = Array.isArray(val) ? val[0] : val;
                  setZoom(newValue);
                }} 
                className="cursor-pointer"
              />
            </div>
            <ZoomIn className="h-3 w-3 text-zinc-600" />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
