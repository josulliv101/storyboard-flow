'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { saveBlob, loadBlob, deleteBlob, clearOldBlobs } from './db';
import { getDefaultGraphShortLabel, isHexColor } from './graph-style';

export type ClipType = 'video' | 'image' | 'dialog' | 'note';

export interface TimelineClip {
  id: string;
  name: string;
  description?: string;
  type: ClipType;
  startFrame: number;
  duration: number;
  trackId: string;
  color?: string;
  characterId?: string; // Reference to character
  character?: string; // Legacy support
  thumbnail?: string;
  src?: string;
  linkedGraphTrackIds?: string[];
  tags?: string[];
  animationMode?: 'all' | 'entrance' | 'exit' | 'none';
  animationDirection?: 'left' | 'right' | 'top' | 'bottom' | 'center';
  layoutOrder?: number;
  layoutType?: 'grid' | 'overlay';
  anchorPoint?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'top' | 'bottom' | 'left' | 'right';
}

export interface Character {
  id: string;
  name: string;
  image?: string;
  description?: string;
}

export interface TimelineTrack {
  id: string;
  name: string;
  parentId?: string;
  showDialogGridItem?: boolean;
  notePlacement?: 'dialog' | 'graph';
  graphUiLayout?: 'grid' | 'column' | 'column-many';
  type?: 'media' | 'graph';
  graph?: {
    type?: 'line' | 'bar';
    label: string;
    shortLabel?: string;
    min: number;
    max: number;
    increment?: number;
    barIntervalSeconds?: number;
    showValue?: boolean;
    noteDurationSeconds?: number;
    color?: string;
    points: Array<{ frame: number; value: number; note?: string; tag?: string }>;
  };
}

export interface TimelineGraphConfig {
  type?: 'line' | 'bar';
  label: string;
  shortLabel?: string;
  min: number;
  max: number;
  increment?: number;
  barIntervalSeconds?: number;
  showValue?: boolean;
  noteDurationSeconds?: number;
  color?: string;
}

export interface Scene {
  id: string;
  name: string;
  description?: string;
  thumbnailUrl?: string;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  duration?: number;
  analysisModel?: string;
  analysisReport?: any;
}

export type TimelineAspectRatio = '16:9' | '21:9';
export type AnalyticsOverlayStyle = 'compact' | 'analysis';
export type PreviewSceneMode = 'active' | 'all';
export type PreviewMediaLayout = 'inset' | 'full';
export type WorkspaceViewMode = 'editor' | 'review' | 'analysis';

export interface TimelineProjectJson {
  version: 1;
  exportedAt: string;
  scenes: Scene[];
  characters: Character[];
  activeSceneId: string;
  collapsedTrackIds: string[];
  disabledTrackIds: string[];
  mutedTrackIds: string[];
  config: {
    aspectRatio: TimelineAspectRatio;
    zoom: number;
    fps: number;
    playbackRate?: number;
    addGridItemPosition: 'first' | 'last';
    previewGroupLayout: 'row' | 'grid';
    previewSceneMode?: PreviewSceneMode;
    previewSceneIds?: string[];
    previewMediaLayout?: PreviewMediaLayout;
    analyticsOverlayStyle?: AnalyticsOverlayStyle;
    showNoteOverlayIcons?: boolean;
    compactNoteOverlays?: boolean;
    showDialogPreviewUi?: boolean;
    showSceneTitleUi?: boolean;
    noteTagFilter?: string[];
    workspaceViewMode?: WorkspaceViewMode;
    dedicatedDialogPanel?: boolean;
  };
}

interface TimelineState {
  currentFrame: number;
  totalDuration: number; // in frames
  fps: number;
  zoom: number; // pixels per frame
  scenes: Scene[];
  characters: Character[];
  activeSceneId: string;
  selectedClipIds: string[];
  isPlaying: boolean;
  playbackRate: number;
  collapsedTrackIds: string[];
  disabledTrackIds: string[];
  mutedTrackIds: string[];
  aspectRatio: TimelineAspectRatio;
  snapLineFrame: number | null;
  isInteracting: boolean;
  addGridItemPosition: 'first' | 'last';
  previewGroupLayout: 'row' | 'grid';
  previewSceneMode: PreviewSceneMode;
  previewSceneIds: string[];
  previewMediaLayout: PreviewMediaLayout;
  analyticsOverlayStyle: AnalyticsOverlayStyle;
  showNoteOverlayIcons: boolean;
  compactNoteOverlays: boolean;
  showDialogPreviewUi: boolean;
  showSceneTitleUi: boolean;
  noteTagFilter: string[];
  workspaceViewMode: WorkspaceViewMode;
}

interface TimelineContextType extends TimelineState {
  isHydrated: boolean;
  setCurrentFrame: React.Dispatch<React.SetStateAction<number>>;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setPlaybackRate: React.Dispatch<React.SetStateAction<number>>;
  setIsInteracting: React.Dispatch<React.SetStateAction<boolean>>;
  setAddGridItemPosition: (pos: 'first' | 'last') => void;
  setPreviewGroupLayout: (layout: 'row' | 'grid') => void;
  setPreviewSceneMode: (mode: PreviewSceneMode) => void;
  setPreviewSceneIds: React.Dispatch<React.SetStateAction<string[]>>;
  setPreviewMediaLayout: (layout: PreviewMediaLayout) => void;
  togglePreviewScene: (id: string) => void;
  setAnalyticsOverlayStyle: (style: AnalyticsOverlayStyle) => void;
  setShowNoteOverlayIcons: (show: boolean) => void;
  setCompactNoteOverlays: (show: boolean) => void;
  setShowDialogPreviewUi: (show: boolean) => void;
  setShowSceneTitleUi: (show: boolean) => void;
  setNoteTagFilter: React.Dispatch<React.SetStateAction<string[]>>;
  setWorkspaceViewMode: (mode: WorkspaceViewMode) => void;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
  selectClip: (id: string | null, multi?: boolean) => void;
  addClip: (clip: TimelineClip, file?: File) => void;
  deleteClip: (id: string) => void;
  toggleTrackCollapse: (id: string) => void;
  toggleTrackDisable: (id: string) => void;
  toggleTrackMute: (id: string) => void;
  setAspectRatio: (ratio: TimelineAspectRatio) => void;
  setSnapLineFrame: React.Dispatch<React.SetStateAction<number | null>>;
  setSelectedClipIds: React.Dispatch<React.SetStateAction<string[]>>;
  // Character actions
  addCharacter: (name: string, file?: File) => void;
  updateCharacter: (id: string, updates: Partial<Character>, file?: File) => void;
  deleteCharacter: (id: string) => void;
  // Scene actions
  addScene: (name: string) => void;
  deleteScene: (id: string) => void;
  setActiveScene: (id: string) => void;
  updateScene: (id: string, updates: Partial<Scene>) => void;
  reorderScenes: (scenes: Scene[]) => void;
  exportProject: () => TimelineProjectJson;
  importProject: (project: TimelineProjectJson) => void;
  importProjectIntoCurrent: (project: TimelineProjectJson) => void;
  addTrack: (parentId: string | undefined, name: string, id?: string) => void;
  addGraphTrack: (parentId: string | undefined, graph: TimelineGraphConfig) => void;
  addTrackGroup: (name: string) => void;
  duplicateTrackGroup: (id: string) => void;
  updateTrack: (id: string, updates: Partial<TimelineTrack>) => void;
  deleteTrack: (id: string) => void;
  moveClipToFirst: (id: string) => void;
  moveClipToLast: (id: string) => void;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
}

const TimelineContext = createContext<TimelineContextType | undefined>(undefined);

const ASPECT_RATIOS = ['16:9', '21:9'] as const;
const GRID_ITEM_POSITIONS = ['first', 'last'] as const;
const PREVIEW_GROUP_LAYOUTS = ['row', 'grid'] as const;
const PREVIEW_SCENE_MODES = ['active', 'all'] as const;
const PREVIEW_MEDIA_LAYOUTS = ['inset', 'full'] as const;
const ANALYTICS_OVERLAY_STYLES = ['compact', 'analysis'] as const;
const APP_SETTINGS_STORAGE_KEY = 'timeline-app-settings';
const SCENE_THUMBNAIL_BLOB_PREFIX = 'scene-thumbnail';

const isAspectRatio = (value: unknown): value is TimelineProjectJson['config']['aspectRatio'] => (
  typeof value === 'string' && ASPECT_RATIOS.includes(value as TimelineProjectJson['config']['aspectRatio'])
);

const isGridItemPosition = (value: unknown): value is TimelineProjectJson['config']['addGridItemPosition'] => (
  typeof value === 'string' && GRID_ITEM_POSITIONS.includes(value as TimelineProjectJson['config']['addGridItemPosition'])
);

const isPreviewGroupLayout = (value: unknown): value is TimelineProjectJson['config']['previewGroupLayout'] => (
  typeof value === 'string' && PREVIEW_GROUP_LAYOUTS.includes(value as TimelineProjectJson['config']['previewGroupLayout'])
);

const isPreviewSceneMode = (value: unknown): value is PreviewSceneMode => (
  typeof value === 'string' && PREVIEW_SCENE_MODES.includes(value as PreviewSceneMode)
);

const isPreviewMediaLayout = (value: unknown): value is PreviewMediaLayout => (
  typeof value === 'string' && PREVIEW_MEDIA_LAYOUTS.includes(value as PreviewMediaLayout)
);

const isAnalyticsOverlayStyle = (value: unknown): value is AnalyticsOverlayStyle => (
  typeof value === 'string' && ANALYTICS_OVERLAY_STYLES.includes(value as AnalyticsOverlayStyle)
);

const isWorkspaceViewMode = (value: unknown): value is WorkspaceViewMode => (
  value === 'editor' || value === 'review' || value === 'analysis'
);

const normalizeDialogClip = (clip: TimelineClip): TimelineClip => (
  clip.type === 'dialog' || clip.type === 'note'
    ? { ...clip, layoutType: 'overlay', anchorPoint: 'bottom' }
    : clip
);

const normalizeDialogClipsInScenes = (sourceScenes: Scene[]) => sourceScenes.map(scene => ({
  ...scene,
  clips: scene.clips.map(normalizeDialogClip)
}));

const isLocalRuntimeMediaUrl = (value: string | undefined) => (
  value?.startsWith('blob:') || value?.startsWith('data:')
);

const stripRuntimeUrlsFromScenes = (sourceScenes: Scene[]) => sourceScenes.map(scene => ({
  ...scene,
  thumbnailUrl: isLocalRuntimeMediaUrl(scene.thumbnailUrl) ? undefined : scene.thumbnailUrl,
  clips: scene.clips.map(({ src, ...clip }) => (
    isLocalRuntimeMediaUrl(src) ? clip : { ...clip, src }
  ))
}));

const stripRuntimeUrlsFromCharacters = (sourceCharacters: Character[]) => sourceCharacters.map(({ image, ...character }) => (
  isLocalRuntimeMediaUrl(image) ? character : { ...character, image }
));

const setLocalStorageItem = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save ${key} to localStorage`, error);
  }
};

const normalizeGraphSettings = (track: TimelineTrack, takenShortLabels?: Set<string>): TimelineTrack => {
  if (track.type !== 'graph' || !track.graph) return track;

  const noteDurationSeconds = Number.isFinite(track.graph.noteDurationSeconds)
    ? Math.max(0.25, Math.min(30, track.graph.noteDurationSeconds!))
    : 3;
  const graphType = track.graph.type === 'bar' ? 'bar' : 'line';
  const barIntervalSeconds = Number.isFinite(track.graph.barIntervalSeconds)
    ? Math.max(0.1, track.graph.barIntervalSeconds!)
    : 0.5;
  const label = track.graph.label?.trim() || track.name || 'Graph';
  const shortLabel = typeof track.graph.shortLabel === 'string' && track.graph.shortLabel.trim()
    ? track.graph.shortLabel.trim()
    : getDefaultGraphShortLabel(label, takenShortLabels ?? []);
  takenShortLabels?.add(shortLabel.toUpperCase());

  return {
    ...track,
    graph: {
      ...track.graph,
      type: graphType,
      label,
      shortLabel,
      barIntervalSeconds,
      noteDurationSeconds,
      color: isHexColor(track.graph.color) ? track.graph.color : undefined,
    },
  };
};

const normalizeTrackSettings = (
  track: TimelineTrack,
  legacyDialogGridEnabled = false,
  takenShortLabels?: Set<string>,
): TimelineTrack => {
  const normalizedTrack = normalizeGraphSettings(track, takenShortLabels);

  if (normalizedTrack.parentId) return normalizedTrack;

  return {
    ...normalizedTrack,
    showDialogGridItem: typeof track.showDialogGridItem === 'boolean'
      ? track.showDialogGridItem
      : legacyDialogGridEnabled,
    notePlacement: track.notePlacement === 'graph' ? 'graph' : 'dialog',
    graphUiLayout: track.graphUiLayout === 'column' || track.graphUiLayout === 'column-many' ? 'column' : 'grid',
  };
};

const createTakenGraphShortLabels = (tracks: TimelineTrack[]) => new Set(
  tracks
    .filter(track => track.type === 'graph' && track.graph?.shortLabel?.trim())
    .map(track => track.graph!.shortLabel!.trim().toUpperCase())
);

const normalizeTrackSettingsInScene = (
  tracks: TimelineTrack[],
  legacyDialogGridEnabled = false,
) => {
  const takenShortLabels = createTakenGraphShortLabels(tracks);
  return tracks.map(track => normalizeTrackSettings(track, legacyDialogGridEnabled, takenShortLabels));
};

const assignImportedNoteLanes = (scene: Scene, sceneIndex: number): Scene => {
  const notes = scene.clips
    .filter(clip => clip.type === 'note')
    .sort((a, b) => a.startFrame - b.startFrame || b.duration - a.duration || a.id.localeCompare(b.id));

  if (notes.length <= 1) return scene;

  const tracks = [...scene.tracks];
  const trackById = new Map(tracks.map(track => [track.id, track]));
  const noteGroups = new Map<string, TimelineClip[]>();

  notes.forEach(note => {
    const track = trackById.get(note.trackId);
    const groupId = track?.parentId || note.trackId;
    noteGroups.set(groupId, [...(noteGroups.get(groupId) || []), note]);
  });

  const reassignedTrackIds = new Map<string, string>();

  noteGroups.forEach((groupNotes, groupId) => {
    if (groupNotes.length <= 1) return;

    const existingNoteTrackIds = Array.from(new Set(groupNotes.map(note => note.trackId)))
      .filter(trackId => trackById.has(trackId));
    const sourceTrack = trackById.get(existingNoteTrackIds[0]) || trackById.get(groupId);
    const laneTrackIds = existingNoteTrackIds.length > 0 ? [...existingNoteTrackIds] : [];
    const laneEndFrames: number[] = [];

    const createLaneTrack = (laneIndex: number) => {
      const baseName = sourceTrack?.name?.trim() || 'Notes';
      const idBase = `${sourceTrack?.id || groupId}-note-lane-${sceneIndex}-${laneIndex}`;
      let id = idBase;
      let suffix = 1;
      while (trackById.has(id)) {
        id = `${idBase}-${suffix}`;
        suffix += 1;
      }

      const newTrack: TimelineTrack = {
        ...(sourceTrack || { id, name: baseName }),
        id,
        name: laneIndex === 0 ? baseName : `${baseName} ${laneIndex + 1}`,
        parentId: sourceTrack?.parentId || (trackById.has(groupId) ? groupId : undefined),
      };

      tracks.push(newTrack);
      trackById.set(id, newTrack);
      laneTrackIds.push(id);
      return id;
    };

    if (laneTrackIds.length === 0) createLaneTrack(0);

    groupNotes.forEach(note => {
      const noteEndFrame = note.startFrame + note.duration;
      let laneIndex = laneEndFrames.findIndex(endFrame => endFrame <= note.startFrame);

      if (laneIndex === -1) {
        laneIndex = laneEndFrames.length;
        if (!laneTrackIds[laneIndex]) createLaneTrack(laneIndex);
      }

      reassignedTrackIds.set(note.id, laneTrackIds[laneIndex]);
      laneEndFrames[laneIndex] = noteEndFrame;
    });
  });

  if (reassignedTrackIds.size === 0) return scene;

  return {
    ...scene,
    tracks,
    clips: scene.clips.map(clip => (
      reassignedTrackIds.has(clip.id)
        ? { ...clip, trackId: reassignedTrackIds.get(clip.id)! }
        : clip
    )),
  };
};

const normalizeImportedProject = (input: TimelineProjectJson): TimelineProjectJson => {
  if (!Array.isArray(input.scenes) || input.scenes.length === 0) {
    throw new Error('Project JSON must include at least one scene.');
  }

  const config = input.config || {};
  const legacyDialogGridEnabled = config.dedicatedDialogPanel === true;
  const scenes = input.scenes.map((scene, sceneIndex) => {
    if (!scene || typeof scene !== 'object') {
      throw new Error(`Scene ${sceneIndex + 1} is invalid.`);
    }

    const tracks = Array.isArray(scene.tracks) ? scene.tracks : [];
    const clips = Array.isArray(scene.clips) ? scene.clips : [];

    return assignImportedNoteLanes({
      id: typeof scene.id === 'string' && scene.id ? scene.id : `scene-${Date.now()}-${sceneIndex}`,
      name: typeof scene.name === 'string' && scene.name ? scene.name : `Scene ${sceneIndex + 1}`,
      description: typeof scene.description === 'string' && scene.description.trim()
        ? scene.description.trim()
        : undefined,
      clips: clips.map(normalizeDialogClip),
      tracks: normalizeTrackSettingsInScene(tracks, legacyDialogGridEnabled),
      duration: typeof scene.duration === 'number' ? scene.duration : undefined,
      analysisModel: typeof scene.analysisModel === 'string' && scene.analysisModel.trim()
        ? scene.analysisModel.trim()
        : undefined,
      analysisReport: scene.analysisReport,
    }, sceneIndex);
  });

  const activeSceneId = scenes.some(scene => scene.id === input.activeSceneId)
    ? input.activeSceneId
    : scenes[0].id;
  const sceneIdSet = new Set(scenes.map(scene => scene.id));
  const previewSceneIds = Array.isArray(config.previewSceneIds)
    ? config.previewSceneIds.filter((id): id is string => typeof id === 'string' && sceneIdSet.has(id))
    : [];

  return {
    version: 1,
    exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt : new Date().toISOString(),
    scenes,
    characters: Array.isArray(input.characters) ? input.characters : [],
    activeSceneId,
    collapsedTrackIds: Array.isArray(input.collapsedTrackIds) ? input.collapsedTrackIds.filter(id => typeof id === 'string') : [],
    disabledTrackIds: Array.isArray(input.disabledTrackIds) ? input.disabledTrackIds.filter(id => typeof id === 'string') : [],
    mutedTrackIds: Array.isArray(input.mutedTrackIds) ? input.mutedTrackIds.filter(id => typeof id === 'string') : [],
    config: {
      aspectRatio: isAspectRatio(config.aspectRatio) ? config.aspectRatio : '16:9',
      zoom: typeof config.zoom === 'number' ? config.zoom : 5,
      fps: typeof config.fps === 'number' ? config.fps : 30,
      addGridItemPosition: isGridItemPosition(config.addGridItemPosition) ? config.addGridItemPosition : 'last',
      previewGroupLayout: isPreviewGroupLayout(config.previewGroupLayout) ? config.previewGroupLayout : 'row',
      previewSceneMode: isPreviewSceneMode(config.previewSceneMode) ? config.previewSceneMode : 'active',
      previewSceneIds,
      previewMediaLayout: isPreviewMediaLayout(config.previewMediaLayout) ? config.previewMediaLayout : 'inset',
      analyticsOverlayStyle: isAnalyticsOverlayStyle(config.analyticsOverlayStyle) ? config.analyticsOverlayStyle : 'compact',
      showNoteOverlayIcons: typeof config.showNoteOverlayIcons === 'boolean' ? config.showNoteOverlayIcons : false,
      compactNoteOverlays: typeof config.compactNoteOverlays === 'boolean' ? config.compactNoteOverlays : false,
      showDialogPreviewUi: typeof config.showDialogPreviewUi === 'boolean' ? config.showDialogPreviewUi : true,
      showSceneTitleUi: typeof config.showSceneTitleUi === 'boolean' ? config.showSceneTitleUi : true,
      noteTagFilter: Array.isArray(config.noteTagFilter) ? config.noteTagFilter.filter((tag): tag is string => typeof tag === 'string') : [],
      workspaceViewMode: isWorkspaceViewMode(config.workspaceViewMode) ? config.workspaceViewMode : 'editor',
    }
  };
};

const remapImportedScenesForCurrentProject = (
  importedScenes: Scene[],
  importedCharacters: Character[],
) => {
  const timestamp = Date.now();
  const sceneIdMap = new Map<string, string>();
  const trackIdMap = new Map<string, string>();
  const clipIdMap = new Map<string, string>();
  const characterIdMap = new Map<string, string>();

  importedCharacters.forEach((character, index) => {
    characterIdMap.set(character.id, `imported-char-${timestamp}-${index}`);
  });

  importedScenes.forEach((scene, sceneIndex) => {
    sceneIdMap.set(scene.id, `imported-scene-${timestamp}-${sceneIndex}`);
    scene.tracks.forEach((track, trackIndex) => {
      trackIdMap.set(track.id, `imported-track-${timestamp}-${sceneIndex}-${trackIndex}`);
    });
    scene.clips.forEach((clip, clipIndex) => {
      clipIdMap.set(clip.id, `imported-clip-${timestamp}-${sceneIndex}-${clipIndex}`);
    });
  });

  const characters = importedCharacters.map((character) => ({
    ...character,
    id: characterIdMap.get(character.id)!,
  }));

  const scenes = importedScenes.map((scene) => ({
    ...scene,
    id: sceneIdMap.get(scene.id)!,
    name: `${scene.name} (Imported)`,
    tracks: scene.tracks.map((track) => ({
      ...track,
      id: trackIdMap.get(track.id)!,
      parentId: track.parentId ? trackIdMap.get(track.parentId) : undefined,
    })),
    clips: scene.clips.map((clip) => ({
      ...clip,
      id: clipIdMap.get(clip.id)!,
      trackId: trackIdMap.get(clip.trackId) || clip.trackId,
      characterId: clip.characterId ? characterIdMap.get(clip.characterId) : undefined,
      linkedGraphTrackIds: clip.linkedGraphTrackIds
        ?.map((trackId) => trackIdMap.get(trackId))
        .filter((trackId): trackId is string => Boolean(trackId)),
    })),
  }));

  return { scenes, characters };
};

const INITIAL_CLIPS: TimelineClip[] = [
  { id: 'clip-1', name: 'Intro Video', description: 'Opening cinematic for the project.', type: 'video', startFrame: 0, duration: 90, trackId: 'track-1', color: 'bg-indigo-600' },
  { id: 'clip-2', name: 'Ambient Music', description: 'Relaxing background score.', type: 'video', startFrame: 30, duration: 180, trackId: 'track-2', color: 'bg-zinc-600' },
  normalizeDialogClip({ id: 'clip-3', name: 'Narrator', description: 'Voiceover instructions.', type: 'dialog', startFrame: 60, duration: 60, trackId: 'track-3', color: 'bg-purple-600', character: 'Narrator' }),
  { id: 'clip-4', name: 'Outro', description: 'Closing credits.', type: 'video', startFrame: 210, duration: 120, trackId: 'track-1', color: 'bg-indigo-600' },
  { id: 'clip-5', name: 'Profile Image', description: 'User avatar display.', type: 'image', startFrame: 120, duration: 60, trackId: 'track-4', color: 'bg-orange-600' },
];

const INITIAL_TRACKS: TimelineTrack[] = [
  { id: 'group-video', name: 'Video Tracks' },
  { id: 'group-audio', name: 'Audio Tracks' },
  { id: 'group-fx', name: 'Effects' },
  { id: 'track-3', name: 'Dialog', parentId: 'group-audio' },
  { id: 'track-c1', name: 'Callouts', parentId: 'group-fx' },
  { id: 'track-1', name: 'Main Video', parentId: 'group-video' },
  { id: 'track-2', name: 'Background Video', parentId: 'group-video' },
  { id: 'track-4', name: 'Images & Photos', parentId: 'group-video' },
  { id: 'track-overlay', name: 'Color Overlays', parentId: 'group-fx' },
];

const createDefaultSceneTracks = (timestamp = Date.now()): TimelineTrack[] => {
  const groupId = `group-scene-${timestamp}`;
  const graphLabel = 'Graph Layer';

  return [
    { id: groupId, name: 'Scene Group', showDialogGridItem: false, notePlacement: 'dialog', graphUiLayout: 'grid' },
    { id: `track-scene-${timestamp}-media`, name: 'Media Layer', parentId: groupId, type: 'media' },
    { id: `track-scene-${timestamp}-dialog`, name: 'Dialog Layer', parentId: groupId },
    { id: `track-scene-${timestamp}-notes`, name: 'Notes Layer', parentId: groupId },
    {
      id: `graph-scene-${timestamp}`,
      name: graphLabel,
      parentId: groupId,
      type: 'graph',
      graph: {
        type: 'line',
        label: graphLabel,
        shortLabel: 'G',
        min: 0,
        max: 5,
        increment: 0.5,
        barIntervalSeconds: 0.5,
        showValue: false,
        noteDurationSeconds: 3,
        points: [
          { frame: 0, value: 0 },
          { frame: 300, value: 0 },
        ],
      },
    },
  ];
};

const INITIAL_SCENES: Scene[] = [
  { id: 'scene-1', name: 'Introduction', clips: INITIAL_CLIPS, tracks: INITIAL_TRACKS },
  { id: 'scene-2', name: 'Main Content', clips: [], tracks: INITIAL_TRACKS },
];

export function TimelineProvider({ children }: { children: React.ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [fps, setFps] = useState(30);
  const [zoom, setZoom] = useState(5);
  const [scenes, setScenes] = useState<Scene[]>(INITIAL_SCENES);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeSceneId, setActiveSceneId] = useState<string>('scene-1');
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [isPlaying, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [collapsedTrackIds, setCollapsedTrackIds] = useState<string[]>([]);
  const [disabledTrackIds, setDisabledTrackIds] = useState<string[]>([]);
  const [mutedTrackIds, setMutedTrackIds] = useState<string[]>([]);
  const [aspectRatio, setAspectRatio] = useState<TimelineAspectRatio>('16:9');
  const [snapLineFrame, setSnapLineFrame] = useState<number | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [addGridItemPosition, setAddGridItemPosition] = useState<'first' | 'last'>('last');
  const [previewGroupLayout, setPreviewGroupLayout] = useState<'row' | 'grid'>('row');
  const [previewSceneMode, setPreviewSceneMode] = useState<PreviewSceneMode>('active');
  const [previewSceneIds, setPreviewSceneIds] = useState<string[]>([]);
  const [previewMediaLayout, setPreviewMediaLayout] = useState<PreviewMediaLayout>('inset');
  const [analyticsOverlayStyle, setAnalyticsOverlayStyle] = useState<AnalyticsOverlayStyle>('compact');
  const [showNoteOverlayIcons, setShowNoteOverlayIcons] = useState(false);
  const [compactNoteOverlays, setCompactNoteOverlays] = useState(false);
  const [showDialogPreviewUi, setShowDialogPreviewUi] = useState(true);
  const [showSceneTitleUi, setShowSceneTitleUi] = useState(true);
  const [noteTagFilter, setNoteTagFilter] = useState<string[]>([]);
  const [workspaceViewMode, setWorkspaceViewMode] = useState<WorkspaceViewMode>('editor');

  const activeScene = useMemo(() => 
    scenes.find(s => s.id === activeSceneId) || scenes[0], 
  [scenes, activeSceneId]);

  const clips = activeScene.clips;
  const tracks = activeScene.tracks;

  // Hydration
  useEffect(() => {
    async function hydrate() {
      const savedScenesJson = localStorage.getItem('timeline-scenes');
      const savedCharactersJson = localStorage.getItem('timeline-characters');
      const savedActiveSceneId = localStorage.getItem('timeline-active-scene-id');
      const savedConfigJson = localStorage.getItem('timeline-config');
      const savedAppSettingsJson = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
      let savedConfig: Record<string, unknown> | undefined;
      let savedAppSettings: Record<string, unknown> | undefined;
      let hydratedSceneIds = INITIAL_SCENES.map(scene => scene.id);
      let hydratedScenesForState: Scene[] = INITIAL_SCENES;

      if (savedConfigJson) {
        try {
          savedConfig = JSON.parse(savedConfigJson);
        } catch (e) {
           console.error('Failed to parse saved config', e);
        }
      }

      if (savedAppSettingsJson) {
        try {
          savedAppSettings = JSON.parse(savedAppSettingsJson);
        } catch (e) {
          console.error('Failed to parse saved app settings', e);
        }
      }

      if (savedScenesJson) {
        try {
          const parsedScenes: Scene[] = JSON.parse(savedScenesJson);
          hydratedSceneIds = parsedScenes.map(scene => scene.id);
          const legacyDialogGridEnabled = savedConfig?.dedicatedDialogPanel === true;
          const hydratedScenes = await Promise.all(parsedScenes.map(async scene => {
            const hydratedClips = await Promise.all(scene.clips.map(async clip => {
              const blob = await loadBlob(clip.id);
              if (blob) return normalizeDialogClip({ ...clip, src: URL.createObjectURL(blob) });
              return normalizeDialogClip(clip);
            }));
            const thumbnailBlob = await loadBlob(`${SCENE_THUMBNAIL_BLOB_PREFIX}-${scene.id}`);
            return {
              ...scene,
              thumbnailUrl: thumbnailBlob ? URL.createObjectURL(thumbnailBlob) : scene.thumbnailUrl,
              clips: hydratedClips,
              tracks: normalizeTrackSettingsInScene(scene.tracks, legacyDialogGridEnabled),
            };
          }));
          hydratedScenesForState = hydratedScenes;
          setScenes(hydratedScenes);
        } catch (e) {
          console.error('Failed to hydrate scenes', e);
        }
      }

      if (savedCharactersJson) {
        try {
          const parsedCharacters: Character[] = JSON.parse(savedCharactersJson);
          const hydratedCharacters = await Promise.all(parsedCharacters.map(async char => {
            const blob = await loadBlob(`char-${char.id}`);
            if (blob) return { ...char, image: URL.createObjectURL(blob) };
            return char;
          }));
          setCharacters(hydratedCharacters);
        } catch (e) {
          console.error('Failed to hydrate characters', e);
        }
      }

      if (savedActiveSceneId) setActiveSceneId(savedActiveSceneId);

      const savedCollapsedJson = localStorage.getItem('timeline-collapsed-tracks');
      const savedDisabledJson = localStorage.getItem('timeline-disabled-tracks');
      const savedMutedJson = localStorage.getItem('timeline-muted-tracks');
      if (savedCollapsedJson) setCollapsedTrackIds(JSON.parse(savedCollapsedJson));
      if (savedDisabledJson) {
        const parsedDisabledTrackIds = JSON.parse(savedDisabledJson);
        const disabledIds = Array.isArray(parsedDisabledTrackIds)
          ? parsedDisabledTrackIds.filter((id): id is string => typeof id === 'string')
          : [];
        const hasOutputParent = hydratedScenesForState.some(scene =>
          scene.tracks.some(track => !track.parentId)
        );
        const hasEnabledOutputParent = hydratedScenesForState.some(scene =>
          scene.tracks.some(track => !track.parentId && !disabledIds.includes(track.id))
        );

        setDisabledTrackIds(hasOutputParent && !hasEnabledOutputParent ? [] : disabledIds);
      }
      if (savedMutedJson) setMutedTrackIds(JSON.parse(savedMutedJson));
      
      const savedSettings = savedAppSettings || savedConfig;
      if (savedSettings) {
        if (isAspectRatio(savedSettings.aspectRatio)) setAspectRatio(savedSettings.aspectRatio);
        if (savedSettings.fps) setFps(Number(savedSettings.fps));
        if (savedSettings.zoom) setZoom(Number(savedSettings.zoom));
        if (typeof savedSettings.playbackRate === 'number') setPlaybackRate(Math.max(0.25, Math.min(1.5, savedSettings.playbackRate)));
        if (isGridItemPosition(savedSettings.addGridItemPosition)) setAddGridItemPosition(savedSettings.addGridItemPosition);
        if (isPreviewGroupLayout(savedSettings.previewGroupLayout)) setPreviewGroupLayout(savedSettings.previewGroupLayout);
        if (isPreviewSceneMode(savedSettings.previewSceneMode)) setPreviewSceneMode(savedSettings.previewSceneMode);
        if (isPreviewMediaLayout(savedSettings.previewMediaLayout)) setPreviewMediaLayout(savedSettings.previewMediaLayout);
        if (Array.isArray(savedSettings.previewSceneIds)) {
          const sceneIdSet = new Set(hydratedSceneIds);
          setPreviewSceneIds(savedSettings.previewSceneIds.filter((id): id is string => typeof id === 'string' && sceneIdSet.has(id)));
        }
        if (isAnalyticsOverlayStyle(savedSettings.analyticsOverlayStyle)) setAnalyticsOverlayStyle(savedSettings.analyticsOverlayStyle);
        if (typeof savedSettings.showNoteOverlayIcons === 'boolean') setShowNoteOverlayIcons(savedSettings.showNoteOverlayIcons);
        if (typeof savedSettings.compactNoteOverlays === 'boolean') setCompactNoteOverlays(savedSettings.compactNoteOverlays);
        if (typeof savedSettings.showDialogPreviewUi === 'boolean') setShowDialogPreviewUi(savedSettings.showDialogPreviewUi);
        if (typeof savedSettings.showSceneTitleUi === 'boolean') setShowSceneTitleUi(savedSettings.showSceneTitleUi);
        if (Array.isArray(savedSettings.noteTagFilter)) setNoteTagFilter(savedSettings.noteTagFilter.filter((tag): tag is string => typeof tag === 'string'));
        if (isWorkspaceViewMode(savedSettings.workspaceViewMode)) setWorkspaceViewMode(savedSettings.workspaceViewMode);
      }
      setIsHydrated(true);
    }
    hydrate();
  }, []);

  // Sync to local storage
  useEffect(() => {
    if (!isHydrated) return;
    setLocalStorageItem('timeline-scenes', stripRuntimeUrlsFromScenes(normalizeDialogClipsInScenes(scenes)));
    setLocalStorageItem('timeline-characters', stripRuntimeUrlsFromCharacters(characters));
    setLocalStorageItem('timeline-active-scene-id', activeSceneId);
    setLocalStorageItem('timeline-collapsed-tracks', collapsedTrackIds);
    setLocalStorageItem('timeline-disabled-tracks', disabledTrackIds);
    setLocalStorageItem('timeline-muted-tracks', mutedTrackIds);
    const appSettings = { aspectRatio, zoom, fps, playbackRate, addGridItemPosition, previewGroupLayout, previewSceneMode, previewSceneIds, previewMediaLayout, analyticsOverlayStyle, showNoteOverlayIcons, compactNoteOverlays, showDialogPreviewUi, showSceneTitleUi, noteTagFilter, workspaceViewMode };
    setLocalStorageItem('timeline-config', appSettings);
    setLocalStorageItem(APP_SETTINGS_STORAGE_KEY, appSettings);
  }, [scenes, characters, activeSceneId, aspectRatio, zoom, fps, playbackRate, isHydrated, collapsedTrackIds, disabledTrackIds, mutedTrackIds, addGridItemPosition, previewGroupLayout, previewSceneMode, previewSceneIds, previewMediaLayout, analyticsOverlayStyle, showNoteOverlayIcons, compactNoteOverlays, showDialogPreviewUi, showSceneTitleUi, noteTagFilter, workspaceViewMode]);

  const playbackScenes = useMemo(() => {
    const previewSceneIdSet = previewSceneIds.length > 0 ? new Set(previewSceneIds) : undefined;
    const enabledScenes = previewSceneIdSet
      ? scenes.filter(scene => previewSceneIdSet.has(scene.id))
      : scenes;

    if (previewSceneMode === 'all' || enabledScenes.length > 1) {
      return enabledScenes.length > 0 ? enabledScenes : [activeScene];
    }

    return [activeScene];
  }, [activeScene, previewSceneIds, previewSceneMode, scenes]);

  const lastFrame = useMemo(() => {
    return playbackScenes
      .flatMap(scene => scene.clips)
      .reduce((max, clip) => Math.max(max, clip.startFrame + clip.duration), 0);
  }, [playbackScenes]);

  const visibleLastFrame = useMemo(() => {
    const visibleTrackIds = new Set(
      playbackScenes.flatMap(scene => {
        const visibleParentIds = scene.tracks
          .filter(track => !track.parentId && !disabledTrackIds.includes(track.id))
          .map(track => track.id);

        return scene.tracks
          .filter(track => (
            !disabledTrackIds.includes(track.id) &&
            (!track.parentId || visibleParentIds.includes(track.parentId))
          ))
          .map(track => track.id);
      })
    );

    return playbackScenes
      .flatMap(scene => scene.clips)
      .filter(clip => visibleTrackIds.has(clip.trackId))
      .reduce((max, clip) => Math.max(max, clip.startFrame + clip.duration), 0);
  }, [disabledTrackIds, playbackScenes]);

  const totalDuration = Math.max(300, lastFrame + fps * 2);

  const currentFrameRef = React.useRef(currentFrame);
  React.useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  React.useEffect(() => {
    if (!isPlaying) return;
    let animationFrameId: number;
    let lastRealTime: number | null = null;
    let frameRemainder = 0;
    const limitFrame = visibleLastFrame;

    if (limitFrame <= 0) {
      animationFrameId = requestAnimationFrame(() => setPlaying(false));
      return () => cancelAnimationFrame(animationFrameId);
    }

    if (currentFrameRef.current >= limitFrame) {
      currentFrameRef.current = 0;
      setCurrentFrame(0);
    }

    const loop = (currentTime: number) => {
      if (lastRealTime === null) {
        lastRealTime = currentTime;
        animationFrameId = requestAnimationFrame(loop);
        return;
      }

      const elapsedMs = currentTime - lastRealTime;
      lastRealTime = currentTime;
      frameRemainder += elapsedMs * fps * playbackRate / 1000;
      const framesToAdvance = Math.floor(frameRemainder);

      if (framesToAdvance > 0) {
        frameRemainder -= framesToAdvance;
        const nextFrame = currentFrameRef.current + framesToAdvance;

        if (nextFrame >= limitFrame) {
          currentFrameRef.current = limitFrame;
          setCurrentFrame(limitFrame);
          setPlaying(false);
          return;
        }

        currentFrameRef.current = nextFrame;
        setCurrentFrame(nextFrame);
      }

      if (currentFrameRef.current >= limitFrame) {
        setPlaying(false);
        return;
      }

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, fps, playbackRate, visibleLastFrame]);

  // Actions
  const updateClip = useCallback((id: string, updates: Partial<TimelineClip>) => {
    setScenes(prev => prev.map(scene => {
      if (!scene.clips.some(clip => clip.id === id)) return scene;
      return {
        ...scene,
        clips: scene.clips.map(clip => clip.id === id ? normalizeDialogClip({ ...clip, ...updates }) : clip)
      };
    }));
  }, []);

  const selectClip = useCallback((id: string | null, multi = false) => {
    if (id === null) {
      setSelectedClipIds([]);
      return;
    }
    if (multi) {
      setSelectedClipIds(prev => prev.includes(id) ? prev.filter(cid => cid !== id) : [...prev, id]);
    } else {
      setSelectedClipIds([id]);
    }
  }, []);

  const addClip = useCallback(async (clip: TimelineClip, file?: File) => {
    let finalClip = normalizeDialogClip({ ...clip });
    if (file) {
      await saveBlob(clip.id, file);
      finalClip.src = URL.createObjectURL(file);
    }
    setScenes(prev => prev.map(scene => {
      if (!scene.tracks.some(track => track.id === finalClip.trackId)) return scene;
      
      // Calculate layout order if not provided
      if (finalClip.layoutOrder === undefined) {
        const isOverlay = finalClip.layoutType === 'overlay';
        if (!isOverlay) {
          const track = scene.tracks.find(t => t.id === finalClip.trackId);
          const parentId = track?.parentId;
          
          const getGroupClips = (clips: TimelineClip[]) => {
            if (parentId) {
              const siblingTrackIds = scene.tracks.filter(t => t.parentId === parentId).map(t => t.id);
              return clips.filter(c => siblingTrackIds.includes(c.trackId) && c.layoutType !== 'overlay');
            }
            return clips.filter(c => c.trackId === finalClip.trackId && c.layoutType !== 'overlay');
          };

          const groupClips = getGroupClips(scene.clips);

          if (addGridItemPosition === 'first') {
            // Push everything else up
            const updatedClips = scene.clips.map(c => {
              const isInGroup = parentId ? 
                scene.tracks.find(t => t.id === c.trackId)?.parentId === parentId : 
                c.trackId === finalClip.trackId;

              if (isInGroup && c.layoutType !== 'overlay') {
                return { ...c, layoutOrder: (c.layoutOrder || 0) + 1 };
              }
              return c;
            });
            finalClip.layoutOrder = 0;
            return { ...scene, clips: [...updatedClips, finalClip] };
          } else {
            const maxOrder = groupClips.reduce((max, c) => Math.max(max, c.layoutOrder || 0), -1);
            finalClip.layoutOrder = maxOrder + 1;
          }
        }
      }

      return { ...scene, clips: [...scene.clips, finalClip] };
    }));
  }, [addGridItemPosition]);

  const deleteClip = useCallback((id: string) => {
    setScenes(prev => prev.map(scene => {
      if (!scene.clips.some(c => c.id === id)) return scene;
      return { ...scene, clips: scene.clips.filter(c => c.id !== id) };
    }));
    deleteBlob(id);
    setSelectedClipIds(prev => prev.filter(cid => cid !== id));
  }, []);

  const toggleTrackCollapse = useCallback((id: string) => {
    setCollapsedTrackIds(prev => 
      prev.includes(id) ? prev.filter(tid => tid !== id) : [...prev, id]
    );
  }, []);

  const toggleTrackDisable = useCallback((id: string) => {
    setDisabledTrackIds(prev => 
      prev.includes(id) ? prev.filter(tid => tid !== id) : [...prev, id]
    );
  }, []);

  const toggleTrackMute = useCallback((id: string) => {
    const idsToRestore = new Set([
      id,
      ...tracks
        .filter(track => track.parentId === id)
        .map(track => track.id),
    ]);

    setDisabledTrackIds(prev => prev.filter(tid => !idsToRestore.has(tid)));
    setMutedTrackIds(prev => {
      const isMuted = prev.includes(id);
      if (!isMuted) return [...prev, id];

      return prev.filter(tid => !idsToRestore.has(tid));
    });
  }, [tracks]);

  const addCharacter = useCallback(async (name: string, file?: File) => {
    const id = `char-${Date.now()}`;
    let image: string | undefined;
    if (file) {
      await saveBlob(`char-${id}`, file);
      image = URL.createObjectURL(file);
    }
    const newChar: Character = { id, name, image };
    setCharacters(prev => [...prev, newChar]);
  }, []);

  const updateCharacter = useCallback(async (id: string, updates: Partial<Character>, file?: File) => {
    if (file) {
      await saveBlob(`char-${id}`, file);
      updates.image = URL.createObjectURL(file);
    }
    setCharacters(prev => prev.map(char => char.id === id ? { ...char, ...updates } : char));
  }, []);

  const deleteCharacter = useCallback((id: string) => {
    setCharacters(prev => prev.filter(char => char.id !== id));
    deleteBlob(`char-${id}`);
    
    // Unset character from any clips using it
    setScenes(prev => prev.map(scene => ({
      ...scene,
      clips: scene.clips.map(clip => clip.characterId === id ? { ...clip, characterId: undefined } : clip)
    })));
  }, []);

  const addScene = useCallback((name: string) => {
    const timestamp = Date.now();
    const newScene: Scene = {
      id: `scene-${timestamp}`,
      name,
      clips: [],
      tracks: createDefaultSceneTracks(timestamp)
    };
    setScenes(prev => [...prev, newScene]);
    setActiveSceneId(newScene.id);
  }, []);

  const deleteScene = useCallback((id: string) => {
    setScenes(prev => {
      if (prev.length <= 1) return prev;
      const sceneToDelete = prev.find(s => s.id === id);
      if (sceneToDelete) {
        sceneToDelete.clips.forEach(c => deleteBlob(c.id));
        deleteBlob(`${SCENE_THUMBNAIL_BLOB_PREFIX}-${sceneToDelete.id}`);
      }
      const filtered = prev.filter(s => s.id !== id);
      if (activeSceneId === id) setActiveSceneId(filtered[0].id);
      return filtered;
    });
    setPreviewSceneIds(prev => prev.filter(sceneId => sceneId !== id));
  }, [activeSceneId]);

  const setActiveScene = useCallback((id: string) => {
    setActiveSceneId(id);
    setCurrentFrame(0);
    setSelectedClipIds([]);
  }, []);

  const updateScene = useCallback((id: string, updates: Partial<Scene>) => {
    setScenes(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  const reorderScenes = useCallback((newScenes: Scene[]) => {
    setScenes(newScenes);
  }, []);

  const togglePreviewScene = useCallback((id: string) => {
    setPreviewSceneIds(prev => {
      const sceneIds = scenes.map(scene => scene.id);
      const currentIds = prev.length > 0 ? prev.filter(sceneId => sceneIds.includes(sceneId)) : sceneIds;
      const isIncluded = currentIds.includes(id);

      if (isIncluded && currentIds.length <= 1) return currentIds;
      return isIncluded
        ? currentIds.filter(sceneId => sceneId !== id)
        : [...currentIds, id];
    });
  }, [scenes]);

  const exportProject = useCallback((): TimelineProjectJson => ({
    version: 1,
    exportedAt: new Date().toISOString(),
    scenes: stripRuntimeUrlsFromScenes(normalizeDialogClipsInScenes(scenes)),
    characters: stripRuntimeUrlsFromCharacters(characters),
    activeSceneId,
    collapsedTrackIds,
    disabledTrackIds,
    mutedTrackIds,
    config: {
      aspectRatio,
      zoom,
      fps,
      playbackRate,
      addGridItemPosition,
      previewGroupLayout,
      previewSceneMode,
      previewSceneIds: previewSceneIds.filter(id => scenes.some(scene => scene.id === id)),
      previewMediaLayout,
      analyticsOverlayStyle,
      showNoteOverlayIcons,
      compactNoteOverlays,
      showDialogPreviewUi,
      showSceneTitleUi,
      noteTagFilter,
      workspaceViewMode,
    }
  }), [scenes, characters, activeSceneId, collapsedTrackIds, disabledTrackIds, mutedTrackIds, aspectRatio, zoom, fps, playbackRate, addGridItemPosition, previewGroupLayout, previewSceneMode, previewSceneIds, previewMediaLayout, analyticsOverlayStyle, showNoteOverlayIcons, compactNoteOverlays, showDialogPreviewUi, showSceneTitleUi, noteTagFilter, workspaceViewMode]);

  const importProject = useCallback((project: TimelineProjectJson) => {
    const normalizedProject = normalizeImportedProject(project);

    setPlaying(false);

    const hydrate = async () => {
      const hydratedScenes = await Promise.all(normalizedProject.scenes.map(async scene => {
        const hydratedClips = await Promise.all(scene.clips.map(async clip => {
          const blob = await loadBlob(clip.id);
          if (blob) return normalizeDialogClip({ ...clip, src: URL.createObjectURL(blob) });
          return normalizeDialogClip(clip);
        }));
        return {
          ...scene,
          clips: hydratedClips
        };
      }));

      const hydratedCharacters = await Promise.all(normalizedProject.characters.map(async char => {
        const blob = await loadBlob(`char-${char.id}`);
        if (blob) return { ...char, image: URL.createObjectURL(blob) };
        return char;
      }));

      setScenes(hydratedScenes);
      setCharacters(hydratedCharacters);
    };

    void hydrate();
    setActiveSceneId(normalizedProject.activeSceneId);
    setCollapsedTrackIds(normalizedProject.collapsedTrackIds);
    setDisabledTrackIds(normalizedProject.disabledTrackIds);
    setMutedTrackIds(normalizedProject.mutedTrackIds);
    setAspectRatio(normalizedProject.config.aspectRatio);
    setZoom(normalizedProject.config.zoom);
    setFps(normalizedProject.config.fps);
    setPlaybackRate(Math.max(0.25, Math.min(1.5, normalizedProject.config.playbackRate ?? 1)));
    setAddGridItemPosition(normalizedProject.config.addGridItemPosition);
    setPreviewGroupLayout(normalizedProject.config.previewGroupLayout);
    setPreviewSceneMode(normalizedProject.config.previewSceneMode ?? 'active');
    setPreviewSceneIds(normalizedProject.config.previewSceneIds ?? []);
    setPreviewMediaLayout(normalizedProject.config.previewMediaLayout ?? 'inset');
    setAnalyticsOverlayStyle(normalizedProject.config.analyticsOverlayStyle ?? 'compact');
    setShowNoteOverlayIcons(normalizedProject.config.showNoteOverlayIcons ?? false);
    setCompactNoteOverlays(normalizedProject.config.compactNoteOverlays ?? false);
    setShowDialogPreviewUi(normalizedProject.config.showDialogPreviewUi ?? true);
    setShowSceneTitleUi(normalizedProject.config.showSceneTitleUi ?? true);
    setNoteTagFilter(normalizedProject.config.noteTagFilter ?? []);
    setWorkspaceViewMode(normalizedProject.config.workspaceViewMode ?? 'editor');
    setCurrentFrame(0);
    setSelectedClipIds([]);
  }, []);

  const importProjectIntoCurrent = useCallback((project: TimelineProjectJson) => {
    const normalizedProject = normalizeImportedProject(project);
    const remappedProject = remapImportedScenesForCurrentProject(
      normalizedProject.scenes,
      normalizedProject.characters,
    );
    const firstImportedSceneId = remappedProject.scenes[0]?.id;

    if (!firstImportedSceneId) return;

    setPlaying(false);

    const hydrate = async () => {
    const hydratedScenes = await Promise.all(remappedProject.scenes.map(async scene => {
      const hydratedClips = await Promise.all(scene.clips.map(async clip => {
          const blob = await loadBlob(clip.id);
          if (blob) return normalizeDialogClip({ ...clip, src: URL.createObjectURL(blob) });
          return normalizeDialogClip(clip);
        }));
        return {
          ...scene,
          clips: hydratedClips
        };
      }));

      const hydratedCharacters = await Promise.all(remappedProject.characters.map(async char => {
        const blob = await loadBlob(`char-${char.id}`);
        if (blob) return { ...char, image: URL.createObjectURL(blob) };
        return char;
      }));

      setScenes(prev => [...prev, ...hydratedScenes]);
      setCharacters(prev => [...prev, ...hydratedCharacters]);
    };

    void hydrate();
    setPreviewSceneIds(prev => prev.length > 0 ? [...prev, ...remappedProject.scenes.map(scene => scene.id)] : prev);
    setActiveSceneId(firstImportedSceneId);
    setCurrentFrame(0);
    setSelectedClipIds([]);
  }, []);

  const addTrack = useCallback((parentId: string | undefined, name: string, id?: string) => {
    const newTrack: TimelineTrack = {
      id: id || `track-${Date.now()}`,
      name,
      parentId: parentId || undefined
    };
    setScenes(prev => prev.map(scene => {
      if (parentId && !scene.tracks.some(track => track.id === parentId)) return scene;
      if (!parentId && scene.id !== activeSceneId) return scene;
      return { ...scene, tracks: [...scene.tracks, newTrack] };
    }));
  }, [activeSceneId]);

  const addGraphTrack = useCallback((parentId: string | undefined, graphConfig: TimelineGraphConfig) => {
    const label = graphConfig.label.trim() || 'Graph';
    const graphType = graphConfig.type === 'bar' ? 'bar' : 'line';
    const graphMin = Number.isFinite(graphConfig.min) ? graphConfig.min : 0;
    const graphMax = Number.isFinite(graphConfig.max) && graphConfig.max > graphMin ? graphConfig.max : graphMin + 1;
    const graphIncrement = Number.isFinite(graphConfig.increment) && graphConfig.increment! > 0 ? graphConfig.increment! : 0.5;
    const barIntervalSeconds = Number.isFinite(graphConfig.barIntervalSeconds) && graphConfig.barIntervalSeconds! > 0
      ? graphConfig.barIntervalSeconds!
      : 0.5;
    const noteDurationSeconds = Number.isFinite(graphConfig.noteDurationSeconds)
      ? Math.max(0.25, Math.min(30, graphConfig.noteDurationSeconds!))
      : 3;
    const defaultValue = Math.max(graphMin, Math.min(graphMax, 0));
    const defaultPoints = graphType === 'bar'
      ? Array.from(
        { length: Math.max(1, Math.floor(totalDuration / Math.max(1, Math.round(barIntervalSeconds * fps))) + 1) },
        (_, index) => ({ frame: index * Math.max(1, Math.round(barIntervalSeconds * fps)), value: defaultValue })
      )
      : [
        { frame: 0, value: defaultValue },
        { frame: totalDuration, value: defaultValue },
      ];
    setScenes(prev => prev.map(scene => (
      (!parentId && scene.id === activeSceneId) || (parentId && scene.tracks.some(track => track.id === parentId))
        ? {
          ...scene,
          tracks: [
            ...scene.tracks,
            {
              id: `graph-${Date.now()}`,
              name: label,
              parentId: parentId || undefined,
              type: 'graph',
              graph: {
                type: graphType,
                label,
                shortLabel: graphConfig.shortLabel?.trim() || getDefaultGraphShortLabel(label, createTakenGraphShortLabels(scene.tracks)),
                min: graphMin,
                max: graphMax,
                increment: graphIncrement,
                barIntervalSeconds,
                showValue: graphConfig.showValue ?? false,
                noteDurationSeconds,
                color: isHexColor(graphConfig.color) ? graphConfig.color : undefined,
                points: defaultPoints,
              },
            },
          ],
        }
        : scene
    )));
  }, [activeSceneId, fps, totalDuration]);

  const addTrackGroup = useCallback((name: string) => {
    const groupId = `group-${Date.now()}`;
    const trackId = `track-${Date.now() + 1}`;
    
    setScenes(prev => prev.map(scene => {
      if (scene.id !== activeSceneId) return scene;
      const newParent: TimelineTrack = { id: groupId, name, showDialogGridItem: false, notePlacement: 'dialog', graphUiLayout: 'grid' };
      const newChild: TimelineTrack = { id: trackId, name: 'Layer 1', parentId: groupId };
      return { ...scene, tracks: [...scene.tracks, newParent, newChild] };
    }));
  }, [activeSceneId]);

  const duplicateTrackGroup = useCallback(async (id: string) => {
    const timestamp = Date.now();
    const clipIdPairs: Array<{ sourceId: string; targetId: string }> = [];
    const sourceScene = scenes.find(scene => scene.tracks.some(track => track.id === id && !track.parentId));
    const sourceParent = sourceScene?.tracks.find(track => track.id === id && !track.parentId);

    if (!sourceScene || !sourceParent) return;

    const childTracks = sourceScene.tracks.filter(track => track.parentId === id);
    const nextParentId = `group-${timestamp}`;
    const trackIdMap = new Map<string, string>();
    const nextParent: TimelineTrack = {
      ...sourceParent,
      id: nextParentId,
      name: `${sourceParent.name} Copy`,
    };
    const nextChildren = childTracks.map((track, index) => {
      const nextTrackId = `${track.type === 'graph' ? 'graph' : 'track'}-${timestamp}-${index}`;
      trackIdMap.set(track.id, nextTrackId);

      return {
        ...track,
        id: nextTrackId,
        parentId: nextParentId,
        graph: track.graph
          ? {
            ...track.graph,
            points: track.graph.points.map(point => ({ ...point })),
          }
          : undefined,
      };
    });
    const nextClips = sourceScene.clips
      .filter(clip => trackIdMap.has(clip.trackId))
      .map((clip, index) => {
        const nextClipId = `clip-${timestamp}-${index}`;
        clipIdPairs.push({ sourceId: clip.id, targetId: nextClipId });

        return normalizeDialogClip({
          ...clip,
          id: nextClipId,
          trackId: trackIdMap.get(clip.trackId)!,
        });
      });

    setScenes(prev => prev.map(scene => {
      if (scene.id !== sourceScene.id) return scene;
      return {
        ...scene,
        tracks: [...scene.tracks, nextParent, ...nextChildren],
        clips: [...scene.clips, ...nextClips],
      };
    }));

    await Promise.all(clipIdPairs.map(async ({ sourceId, targetId }) => {
      const blob = await loadBlob(sourceId);
      if (blob) await saveBlob(targetId, blob);
    }));
  }, [scenes]);

  const updateTrack = useCallback((id: string, updates: Partial<TimelineTrack>) => {
    setScenes(prev => prev.map(scene => {
      if (!scene.tracks.some(track => track.id === id)) return scene;
      const takenShortLabels = createTakenGraphShortLabels(scene.tracks.filter(track => track.id !== id));
      return {
        ...scene,
        tracks: scene.tracks.map(t => {
          if (t.id !== id) return t;
          const nextTrack = { ...t, ...updates };
          if (nextTrack.type !== 'graph' || !nextTrack.graph) return nextTrack;

          const label = nextTrack.graph.label?.trim() || nextTrack.name || 'Graph';
          return {
            ...nextTrack,
            graph: {
              ...nextTrack.graph,
              label,
              shortLabel: nextTrack.graph.shortLabel?.trim() || getDefaultGraphShortLabel(label, takenShortLabels),
            },
          };
        })
      };
    }));
  }, []);

  const deleteTrack = useCallback((id: string) => {
    setScenes(prev => prev.map(scene => {
      if (!scene.tracks.some(track => track.id === id)) return scene;
      
      const tracksToDelete = [id];
      // Find all children if this is a parent
      scene.tracks.forEach(t => {
        if (t.parentId === id) tracksToDelete.push(t.id);
      });

      const clipsToDelete = scene.clips.filter(c => tracksToDelete.includes(c.trackId));
      clipsToDelete.forEach(c => deleteBlob(c.id));

      return {
        ...scene,
        tracks: scene.tracks.filter(t => !tracksToDelete.includes(t.id)),
        clips: scene.clips.filter(c => !tracksToDelete.includes(c.trackId))
      };
    }));
    
    // Clean up auxiliary state
    setCollapsedTrackIds(prev => prev.filter(tid => tid !== id));
    setDisabledTrackIds(prev => prev.filter(tid => tid !== id));
  }, []);

  const moveClipToFirst = useCallback((id: string) => {
    setScenes(prev => prev.map(scene => {
      const targetClip = scene.clips.find(c => c.id === id);
      if (!targetClip) return scene;
      
      const track = scene.tracks.find(t => t.id === targetClip.trackId);
      const parentId = track?.parentId;
      
      const isInGroup = (c: TimelineClip) => {
        if (parentId) return scene.tracks.find(t => t.id === c.trackId)?.parentId === parentId;
        return c.trackId === targetClip.trackId;
      };

      const groupClips = scene.clips.filter(c => isInGroup(c) && c.layoutType !== 'overlay');
      if (groupClips.length <= 1) return scene;

      return {
        ...scene,
        clips: scene.clips.map(c => {
          if (c.id === id) return { ...c, layoutOrder: 0 };
          if (isInGroup(c) && c.layoutType !== 'overlay') {
            return { ...c, layoutOrder: (c.layoutOrder || 0) + 1 };
          }
          return c;
        })
      };
    }));
  }, []);

  const moveClipToLast = useCallback((id: string) => {
    setScenes(prev => prev.map(scene => {
      const targetClip = scene.clips.find(c => c.id === id);
      if (!targetClip) return scene;
      
      const track = scene.tracks.find(t => t.id === targetClip.trackId);
      const parentId = track?.parentId;
      
      const isInGroup = (c: TimelineClip) => {
        if (parentId) return scene.tracks.find(t => t.id === c.trackId)?.parentId === parentId;
        return c.trackId === targetClip.trackId;
      };

      const groupClips = scene.clips.filter(c => isInGroup(c) && c.layoutType !== 'overlay');
      const maxOrder = groupClips.reduce((max, c) => Math.max(max, c.layoutOrder || 0), 0);

      return {
        ...scene,
        clips: scene.clips.map(c => {
          if (c.id === id) return { ...c, layoutOrder: maxOrder + 1 };
          return c;
        })
      };
    }));
  }, []);

  const value = useMemo(() => ({
    isHydrated,
    currentFrame,
    totalDuration,
    fps,
    zoom,
    scenes,
    characters,
    activeSceneId,
    selectedClipIds,
    isPlaying,
    playbackRate,
    collapsedTrackIds,
    disabledTrackIds,
    mutedTrackIds,
    aspectRatio,
    snapLineFrame,
    isInteracting,
    addGridItemPosition,
    previewGroupLayout,
    previewSceneMode,
    previewSceneIds,
    previewMediaLayout,
    analyticsOverlayStyle,
    showNoteOverlayIcons,
    compactNoteOverlays,
    showDialogPreviewUi,
    showSceneTitleUi,
    noteTagFilter,
    workspaceViewMode,
    setCurrentFrame,
    setZoom,
    setPlaying,
    setPlaybackRate,
    setIsInteracting,
    setAddGridItemPosition,
    setPreviewGroupLayout,
    setPreviewSceneMode,
    setPreviewSceneIds,
    setPreviewMediaLayout,
    togglePreviewScene,
    setAnalyticsOverlayStyle,
    setShowNoteOverlayIcons,
    setCompactNoteOverlays,
    setShowDialogPreviewUi,
    setShowSceneTitleUi,
    setNoteTagFilter,
    setWorkspaceViewMode,
    updateClip,
    selectClip,
    addClip,
    deleteClip,
    toggleTrackCollapse,
    toggleTrackDisable,
    toggleTrackMute,
    setAspectRatio,
    setSnapLineFrame,
    setSelectedClipIds,
    addCharacter,
    updateCharacter,
    deleteCharacter,
    addScene,
    deleteScene,
    setActiveScene,
    updateScene,
    reorderScenes,
    exportProject,
    importProject,
    importProjectIntoCurrent,
    addTrack,
    addGraphTrack,
    addTrackGroup,
    duplicateTrackGroup,
    updateTrack,
    deleteTrack,
    moveClipToFirst,
    moveClipToLast,
    clips,
    tracks
  }), [
    isHydrated, currentFrame, totalDuration, fps, playbackRate, zoom, scenes, activeSceneId,
    selectedClipIds, isPlaying, collapsedTrackIds, disabledTrackIds, mutedTrackIds, aspectRatio,
    snapLineFrame, isInteracting, addGridItemPosition, previewGroupLayout, previewSceneMode, previewSceneIds, previewMediaLayout, analyticsOverlayStyle, showNoteOverlayIcons, compactNoteOverlays, showDialogPreviewUi, showSceneTitleUi, noteTagFilter, workspaceViewMode, updateClip, selectClip, addClip, deleteClip, toggleTrackCollapse,
    toggleTrackDisable, toggleTrackMute, addScene, deleteScene, setActiveScene, updateScene,
    reorderScenes, exportProject, importProject, importProjectIntoCurrent, addTrack, addGraphTrack, addTrackGroup, duplicateTrackGroup, updateTrack, deleteTrack, moveClipToFirst, moveClipToLast, clips, tracks,
    characters, addCharacter, updateCharacter, deleteCharacter, setAddGridItemPosition, setPreviewGroupLayout, setPreviewSceneMode, setPreviewSceneIds, setPreviewMediaLayout, togglePreviewScene, setAnalyticsOverlayStyle, setShowNoteOverlayIcons, setCompactNoteOverlays, setShowDialogPreviewUi, setShowSceneTitleUi, setNoteTagFilter, setWorkspaceViewMode, setPlaybackRate
  ]);

  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
}

export function useTimeline() {
  const context = useContext(TimelineContext);
  if (context === undefined) {
    throw new Error('useTimeline must be used within a TimelineProvider');
  }
  return context;
}
