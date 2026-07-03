'use client';

import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { TimelineProvider } from '@/lib/timeline-context';
import { Toolbar } from './Toolbar';
import { Preview } from './Preview';
import { AnalysisSidePanel } from './AnalysisSidePanel';
import { CollectionFrame } from './Frame';
import { CollectionProgressBar } from './CollectionProgressBar';
import { ReviewWorkspace } from './ReviewWorkspace';
import { AnalysisWorkspace } from './analysis/AnalysisWorkspace';
import { TimelineRoot } from './TimelineRoot';
import { CharactersPanel } from './CharactersPanel';
import { DirectorySidePanel } from './DirectorySidePanel';
import { EditorConfirmations, type PendingProjectImport } from './EditorConfirmations';
import { EditorFooterStatusBar } from './EditorFooterStatusBar';
import { EditorHeaderRail } from './EditorHeaderRail';
import { PreviewResizeDivider } from './PreviewResizeDivider';
import { PreviewFilterMenu } from './PreviewFilterMenu';
import { AdminUsersModal } from './AdminUsersModal';
import { AuthModal } from './AuthModal';
import { RenderGroupSelectionModal, type RenderGroupOption } from './RenderGroupSelectionModal';
import { SaveSceneModal } from './SaveSceneModal';
import { SettingsSidePanel } from './SettingsSidePanel';
import { SceneLibraryModal } from './SceneLibraryModal';
import { ScenesSidePanel } from './ScenesSidePanel';
import { ScriptClipEditorModal } from './ScriptClipEditorModal';
import { ClipPropertiesPanel } from './ClipPropertiesPanel';
import { EditorSidebarRail, type SidebarTab } from './EditorSidebarRail';
import { SceneLaunchWorkspace } from './scene-launch/SceneLaunchWorkspace';
import { useSceneLaunchBoard } from './scene-launch/useSceneLaunchBoard';
import { useVideoAnalysis } from './useVideoAnalysis';
import { useSavedScenes } from './useSavedScenes';
import {
  blobToDataUrl,
  captureVideoElementThumbnail,
  captureVideoThumbnail,
  getPreviewVideoElementForClip,
  localUpload,
  runtimeSrcToRenderSrc,
} from './editor-media-utils';
import { formatReviewTime, formatTimelineTime } from './editor-time-utils';
import {
  findMatchingSavedSceneId,
  getSuggestedSavedSceneName,
  SCENE_THUMBNAIL_BLOB_PREFIX,
  type SavedSceneSummary,
} from './saved-scene-utils';
import {
  Download,
  X,
  ChevronDown,
  Trash2,
  Clapperboard,
  MapPin,
  GripVertical,
  Plus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Grid2X2,
  MessageSquare,
  StickyNote,
  Play,
  Pause,
  SkipBack,
  ZoomIn,
  ZoomOut,
  Tags,
  Video,
  Image as ImageIcon,
  ChevronDown as ChevronDownTree
} from 'lucide-react';
import {
  Button,
  buttonVariants,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  Slider,
} from "@storyboard/ui";
import { useTimeline, TimelineClip, TimelineProjectJson, ClipType } from '@/lib/timeline-context';
import { loadBlob, saveBlob } from '@/lib/db';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { getGraphColor, getGraphDisplayLabel, getGraphShortLabel } from '@/lib/graph-style';
import { captureVideoAnalysisFrames, extractCharacterAvatarFromVideo, extractBeatThumbnailFromVideo } from '@/lib/video-helpers';

export { ScriptClipEditorModal } from './ScriptClipEditorModal';

type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

// captureVideoAnalysisFrames helper is imported from '@/lib/video-helpers'


function EditorInner() {
  // Routing integrations
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sceneIdParam = searchParams?.get('sceneId');

  const {
    zoom,
    setZoom,
    aspectRatio,
    setAspectRatio,
    fps,
    clips,
    selectedClipIds,
    characters,
    updateClip,
    addClip,
    setSelectedClipIds,
    deleteClip,
    scenes,
    activeSceneId,
    setActiveScene,
    addScene,
    deleteScene,
    updateScene,
    reorderScenes,
    tracks,
    updateTrack,
    deleteTrack,
    previewGroupLayout,
    setPreviewGroupLayout,
    previewSceneMode,
    setPreviewSceneMode,
    previewSceneIds,
    togglePreviewScene,
    previewMediaLayout,
    setPreviewMediaLayout,
    analyticsOverlayStyle,
    setAnalyticsOverlayStyle,
    showNoteOverlayIcons,
    setShowNoteOverlayIcons,
    moveClipToFirst,
    moveClipToLast,
    exportProject,
    importProject,
    importProjectIntoCurrent,
    resetToBlankScene,
    workspaceViewMode,
    setWorkspaceViewMode,
    currentFrame,
    setCurrentFrame,
    isPlaying,
    setPlaying,
    playbackRate,
    setPlaybackRate,
    totalDuration,
    noteTagFilter,
    setNoteTagFilter,
    showStarredNoteOverlaysOnly,
    setShowStarredNoteOverlaysOnly,
    showDialogPreviewUi,
    setShowDialogPreviewUi,
    showSceneTitleUi,
    setShowSceneTitleUi,
    compactNoteOverlays,
    setCompactNoteOverlays,
    disabledTrackIds,
    toggleTrackDisable,
    currentUser,
    setCurrentUser,
    isAuthChecking,
    activeSavedSceneId,
    setActiveSavedSceneId,
    activeSavedScenePublished,
    setActiveSavedScenePublished
  } = useTimeline();

  const isSceneLoading = !!(sceneIdParam && activeSavedSceneId !== sceneIdParam);
  const isNewSceneParam = searchParams.get('new') === '1';
  const showSceneLaunchView = pathname === '/editor' && isNewSceneParam && workspaceViewMode === 'editor' && !isSceneLoading;

  const selectedClip = clips.find(c => c.id === selectedClipIds[selectedClipIds.length - 1]);
  const activeScene = scenes.find(scene => scene.id === activeSceneId) || scenes[0];
  const [activeTab, setActiveTab] = React.useState<SidebarTab>(null);
  const [isDraggingSceneLaunchItem, setIsDraggingSceneLaunchItem] = React.useState(false);
  const [pendingMoveItem, setPendingMoveItem] = React.useState<{ type: 'media' | 'collection'; id: string } | null>(null);
  const [originalBeatPath, setOriginalBeatPath] = React.useState<string[] | null>(null);
  const [isFileMenuOpen, setIsFileMenuOpen] = React.useState(false);
  const [isRendering, setIsRendering] = React.useState(false);
  const [scriptEditorClipId, setScriptEditorClipId] = React.useState<string | null>(null);
  const [renderGroupOptions, setRenderGroupOptions] = React.useState<RenderGroupOption[] | null>(null);
  const [pendingProjectImport, setPendingProjectImport] = React.useState<PendingProjectImport | null>(null);
  const [directoryExpandedIds, setDirectoryExpandedIds] = React.useState<Set<string>>(new Set(['__root__']));


  // Authentication & Authorization Role States
  const [isAuthModalOpen, setIsAuthModalOpen] = React.useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = React.useState(false);
  const [authMode, setAuthMode] = React.useState<'login' | 'signup'>('login');
  const [authUsername, setAuthUsername] = React.useState('');
  const [authPassword, setAuthPassword] = React.useState('');
  const [authLoading, setAuthLoading] = React.useState(false);
  const [authError, setAuthError] = React.useState('');
  const [allUsers, setAllUsers] = React.useState<{ id: string; username: string; role: 'viewer' | 'editor' | 'admin'; createdAt: string }[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = React.useState(false);

  // Global drag-and-drop listener to detect Scene Launch item dragging
  React.useEffect(() => {
    const handleDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.id && target.id.startsWith('grid-item-')) {
        setIsDraggingSceneLaunchItem(true);
      }
    };

    const handleDragEnd = () => {
      setIsDraggingSceneLaunchItem(false);
    };

    window.addEventListener('dragstart', handleDragStart);
    window.addEventListener('dragend', handleDragEnd);
    return () => {
      window.removeEventListener('dragstart', handleDragStart);
      window.removeEventListener('dragend', handleDragEnd);
    };
  }, []);

  // Enforce authentication: redirect anonymous users back to landing homepage
  React.useEffect(() => {
    if (!isAuthChecking && !isSceneLoading) {
      if (!currentUser) {
        const isPublicAnalysis = pathname === '/analysis' && sceneIdParam && activeSavedScenePublished;
        if (!isPublicAnalysis) {
          toast.error('You must be logged in to access the workspace.', { id: 'auth-redirect-toast' });
          router.push('/');
        }
      }
    }
  }, [isAuthChecking, isSceneLoading, currentUser, router, pathname, sceneIdParam, activeSavedScenePublished]);

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        setCurrentUser(null);
        toast.success('Successfully logged out.');
        // Refresh scene library
        void loadSavedScenes({ silent: true });
      }
    } catch (err) {
      console.error('Logout error:', err);
      toast.error('Failed to log out.');
    }
  };

  const handleLoadUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const res = await fetch('/api/auth/users');
      if (res.ok) {
        const data = await res.json();
        setAllUsers(data.users || []);
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || 'Failed to load user list.');
      }
    } catch (err) {
      console.error('Error loading users:', err);
      toast.error('Error loading user list.');
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleUpdateUserRole = async (userId: string, role: 'viewer' | 'editor' | 'admin') => {
    try {
      const res = await fetch('/api/auth/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      });
      if (res.ok) {
        toast.success('User role updated successfully.');
        void handleLoadUsers();
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || 'Failed to update user role.');
      }
    } catch (err) {
      console.error('Error updating user role:', err);
      toast.error('Error updating user role.');
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!authUsername.trim() || !authPassword) {
      setAuthError('All fields are required.');
      return;
    }
    setAuthLoading(true);
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername.trim(), password: authPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (authMode === 'signup') {
          toast.success('Account created successfully! You can now log in.');
          setAuthMode('login');
          setAuthPassword('');
          setAuthLoading(false);
          return;
        }

        setCurrentUser(data.user);
        setIsAuthModalOpen(false);
        setAuthUsername('');
        setAuthPassword('');
        toast.success(`Welcome back, ${data.user.username}!`);
        // Refresh scene library
        void loadSavedScenes({ silent: true });
      } else {
        setAuthError(data.error || 'Authentication failed.');
      }
    } catch (err) {
      console.error('Auth error:', err);
      setAuthError('An error occurred. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const [isCapturingSceneThumbnail, setIsCapturingSceneThumbnail] = React.useState(false);
  const [sceneThumbnailPreviewUrls, setSceneThumbnailPreviewUrls] = React.useState<Record<string, string>>({});
  const isDraggingRef = React.useRef(false);
  const workspaceRef = React.useRef<HTMLDivElement>(null);
  const [previewPanelPercent, setPreviewPanelPercent] = React.useState(56);
  const [reviewShowPreviewTagUi, setReviewShowPreviewTagUi] = React.useState(true);
  const [reviewContentMode, setReviewContentMode] = React.useState<'notes' | 'dialog'>('notes');
  const [verticalTimeScale, setVerticalTimeScale] = React.useState(1);



  // Synchronize route pathname with workspaceViewMode
  React.useEffect(() => {
    if (pathname === '/analysis') {
      if (workspaceViewMode !== 'analysis') setWorkspaceViewMode('analysis');
    } else if (pathname === '/review') {
      if (workspaceViewMode !== 'review') setWorkspaceViewMode('review');
    } else if (pathname === '/editor' || pathname === '/') {
      if (workspaceViewMode !== 'editor') setWorkspaceViewMode('editor');
    }
  }, [pathname, workspaceViewMode, setWorkspaceViewMode]);

  // Synchronize search params sceneId with context activeSavedSceneId on mount/change
  React.useEffect(() => {
    if (isNewSceneParam && !sceneIdParam) {
      resetToBlankScene();
      return;
    }

    if (sceneIdParam) {
      if (sceneIdParam !== activeSavedSceneId) {
        const loadSceneFromUrl = async () => {
          try {
            const response = await fetch(`/api/scenes/${sceneIdParam}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({})) as {
              scene?: SavedSceneSummary & { project: TimelineProjectJson };
              error?: string;
            };
            if (response.ok && result.scene && result.scene.project) {
              importProject(result.scene.project);
              setActiveSavedSceneId(sceneIdParam);
              setActiveSavedScenePublished(!!result.scene.isPublished);
            }
          } catch (error) {
            console.error('Failed to load scene from URL parameter:', error);
          }
        };
        void loadSceneFromUrl();
      }
    } else {
      // No sceneId in URL: clear active saved scene state to start fresh/blank
      if (activeSavedSceneId !== null) {
        setActiveSavedSceneId(null);
        setActiveSavedScenePublished(false);
      }
    }
  }, [sceneIdParam, isNewSceneParam, activeSavedSceneId, importProject, resetToBlankScene, setActiveSavedSceneId, setActiveSavedScenePublished]);





  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [pendingType, setPendingType] = React.useState<ClipType | null>(null);

  const normalizeTagKey = React.useCallback((value: string | undefined) => value?.trim().toLowerCase() || '', []);
  const activeVideoClipAtCurrentFrame = React.useMemo(() => (
    activeScene?.clips
      .filter(clip => clip.type === 'video' && clip.src)
      .find(clip => currentFrame >= clip.startFrame && currentFrame < clip.startFrame + clip.duration)
  ), [activeScene, currentFrame]);
  const activeSceneThumbnailPreviewUrl = activeScene
    ? sceneThumbnailPreviewUrls[activeScene.id] || activeScene.thumbnailUrl
    : undefined;

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

  const sceneTabs = previewScenes.length > 1 ? previewScenes : [];

  const closeSceneLaunchView = () => {
    const currentParams = new URLSearchParams(window.location.search);
    currentParams.delete('new');
    const nextQuery = currentParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
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
      if (isNewSceneParam && (pendingType === 'video' || pendingType === 'image')) {
        board.addFilesToSceneLaunchMedia([file]);
      } else {
        handleAddClip(pendingType, undefined, file);
      }
    }
    e.target.value = '';
    setPendingType(null);
  };

  const handleAddClip = (type: ClipType, character?: string, file?: File, customId?: string, customDurationSeconds?: number) => {
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

    const duration = customDurationSeconds !== undefined
      ? Math.round(customDurationSeconds * 30)
      : (type === 'video' ? 150 : 60);

    addClip({
      id: customId || `clip-${Math.random().toString(36).substr(2, 9)}`,
      name,
      type,
      startFrame: currentFrame,
      duration,
      trackId,
      color,
      character
    }, file);
    return customId || `clip-${Math.random().toString(36).substr(2, 9)}`;
  };

  const board = useSceneLaunchBoard({
    activeScene,
    scenes,
    updateScene,
    handleAddClip,
    updateClip,
  });

  const handleCancelMove = React.useCallback(() => {
    if (!pendingMoveItem) return;
    if (originalBeatPath !== null) {
      board.setSceneLaunchBeatPath(originalBeatPath);
      setOriginalBeatPath(null);
    }
    setPendingMoveItem(null);
    toast.info('Move operation cancelled');
  }, [pendingMoveItem, originalBeatPath, board.setSceneLaunchBeatPath]);

  // Listen to Escape key to cancel Move mode
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pendingMoveItem) {
        handleCancelMove();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [pendingMoveItem, handleCancelMove]);

  // Cancel Move mode if directory side panel is closed
  React.useEffect(() => {
    if (activeTab !== 'directory' && pendingMoveItem) {
      handleCancelMove();
    }
  }, [activeTab, pendingMoveItem, handleCancelMove]);

  const NOTE_TAG_FILTER_NONE = '__NO_NOTE_TAGS_VISIBLE__';

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
  ), [previewScenes, normalizeTagKey]);

  const noteTags = React.useMemo(() => (
    Array.from(noteTagCounts.values())
      .map(item => item.label)
      .filter(tag => normalizeTagKey(tag) !== 'preview' && !graphTagKeySet.has(normalizeTagKey(tag)))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  ), [graphTagKeySet, noteTagCounts, normalizeTagKey]);

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
  }, [noteTagFilter, noteTags, setNoteTagFilter, normalizeTagKey]);

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

  const clampPreviewPanelPercent = React.useCallback((value: number) => (
    Math.max(28, Math.min(78, value))
  ), []);

  const resizePreviewPanel = React.useCallback((clientY: number) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const bounds = workspace.getBoundingClientRect();
    const nextPercent = ((clientY - bounds.top) / Math.max(1, bounds.height)) * 100;
    setPreviewPanelPercent(clampPreviewPanelPercent(nextPercent));
  }, [clampPreviewPanelPercent]);

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const handleResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    resizePreviewPanel(event.clientY);
  };

  const handleResizePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 8 : 3;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setPreviewPanelPercent(prev => clampPreviewPanelPercent(prev - step));
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPreviewPanelPercent(prev => clampPreviewPanelPercent(prev + step));
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setPreviewPanelPercent(28);
    }
    if (event.key === 'End') {
      event.preventDefault();
      setPreviewPanelPercent(78);
    }
  };

  const projectImportInputRef = React.useRef<HTMLInputElement>(null);
  const fileMenuRef = React.useRef<HTMLDivElement>(null);
  const sidePanelRef = React.useRef<HTMLElement>(null);
  const clipPropertiesPanelRef = React.useRef<HTMLElement>(null);
  const scriptEditorClip = scriptEditorClipId ? clips.find(clip => clip.id === scriptEditorClipId) : undefined;

  const {
    selectedVideoFile,
    setSelectedVideoFile,
    videoObjectURL,
    setVideoObjectURL,
    isAnalyzing,
    analysisProgress,
    setAnalysisProgress,
    analysisLogs,
    setAnalysisLogs,
    isAnalysisComplete,
    setIsAnalysisComplete,
    pendingAnalysisProject,
    setPendingAnalysisProject,
    showDevJson,
    setShowDevJson,
    videoDuration,
    setVideoDuration,
    analysisModelChoice,
    setAnalysisModelChoice,
    enabledGraphLayers,
    setEnabledGraphLayers,
    storyAnalyzePlotPoints,
    setStoryAnalyzePlotPoints,
    storyAnalyzeStakes,
    setStoryAnalyzeStakes,
    storyAnalyzeConfrontation,
    setStoryAnalyzeConfrontation,
    graphTracksInActiveScene,
    runVideoAnalysis,
  } = useVideoAnalysis({
    activeSceneId,
    scenes,
    updateScene,
    updateClip,
    tracks,
    fps,
    currentUser,
    importProjectIntoCurrent,
  });
  const openScriptEditorForClip = React.useCallback((clipId: string, sceneId: string) => {
    setActiveScene(sceneId);
    setSelectedClipIds([clipId]);
    setActiveTab(null);
    setScriptEditorClipId(clipId);
  }, [setActiveScene, setSelectedClipIds]);

  // Global key listener for deletion
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipIds.length > 0) {
        selectedClipIds.forEach(id => deleteClip(id));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipIds, deleteClip]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || selectedClipIds.length === 0) return;
    const targetId = selectedClipIds[selectedClipIds.length - 1];
    const type = file.type.startsWith('image/') ? 'image' : 'video';
    await saveBlob(targetId, file);
    const url = URL.createObjectURL(file);
    updateClip(targetId, { src: url, type, name: file.name });
  };

  const handleExportProjectJson = () => {
    const project = exportProject();
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `remotion-timeline-project-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    toast.success('Project JSON exported');
  };

  const handleImportProjectJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const json = JSON.parse(await file.text()) as TimelineProjectJson;
      setPendingProjectImport({ fileName: file.name, project: json });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read that JSON file.';
      toast.error(message);
    }
  };

  const persistence = useSavedScenes({
    currentUser,
    isSceneLoading,
    isCapturingSceneThumbnail,
    pendingProjectImport,
    setPendingProjectImport,
    isFileMenuOpen,
    setIsFileMenuOpen,
    activeVideoClipAtCurrentFrame,
    isPlaying,
    currentFrame,
    fps,
    activeSceneThumbnailPreviewUrl,
  });
  const {
    isSaveSceneOpen,
    setIsSaveSceneOpen,
    isSceneLibraryOpen,
    setIsSceneLibraryOpen,
    savedSceneName,
    setSavedSceneName,
    savedScenes,
    setSavedScenes,
    isLoadingSavedScenes,
    setIsLoadingSavedScenes,
    savedScenesLoadError,
    setSavedScenesLoadError,
    isSavingScene,
    setIsSavingScene,
    loadingSavedSceneId,
    setLoadingSavedSceneId,
    deletingSavedSceneId,
    setDeletingSavedSceneId,
    pendingSavedSceneDelete,
    setPendingSavedSceneDelete,
    sceneSaveStatus,
    setSceneSaveStatus,
    autosaveStatus,
    autosaveMessage,
    loadSavedScenes,
    openSaveSceneModal,
    openSceneLibrary,
    sceneLibraryCountLabel,
    handleSaveScene,
    handleLoadSavedScene,
    handleTogglePublish,
    confirmSavedSceneDelete,
    handleDeleteSavedScene,
    uploadSceneThumbnail,
    getVideoBlobForClip,
  } = persistence;

  const handleCaptureCurrentFrameThumbnail = async () => {
    if (!activeScene || !activeVideoClipAtCurrentFrame || isPlaying || isCapturingSceneThumbnail) return;

    const capturedFrame = currentFrame;
    const capturedClip = activeVideoClipAtCurrentFrame;
    const capturedSceneId = activeScene.id;
    const savedSceneId = activeSavedSceneId;
    setIsCapturingSceneThumbnail(true);
    try {
      const runtimeClip = scenes
        .find(scene => scene.id === activeSceneId)
        ?.clips.find(clip => clip.id === capturedClip.id);
      const previewVideo = getPreviewVideoElementForClip(capturedClip.id);
      let thumbnail = previewVideo ? await captureVideoElementThumbnail(previewVideo) : null;

      if (!thumbnail) {
        const video = await getVideoBlobForClip(capturedClip, runtimeClip);

        if (!video) {
          throw new Error('No video media is available at the current frame.');
        }

        const targetTime = Math.max(0, (capturedFrame - capturedClip.startFrame) / fps);
        thumbnail = await captureVideoThumbnail(video, targetTime);
      }

      if (!thumbnail) {
        throw new Error('Unable to capture a thumbnail from this frame.');
      }

      await saveBlob(`${SCENE_THUMBNAIL_BLOB_PREFIX}-${capturedSceneId}`, thumbnail);
      const localThumbnailUrl = URL.createObjectURL(thumbnail);
      setSceneThumbnailPreviewUrls(previous => ({ ...previous, [capturedSceneId]: localThumbnailUrl }));
      setCurrentFrame(capturedFrame);

      const hostedThumbnailUrl = await uploadSceneThumbnail(activeScene.name, thumbnail);
      setSceneThumbnailPreviewUrls(previous => ({ ...previous, [capturedSceneId]: hostedThumbnailUrl }));

      const thumbnailSavedSceneId = savedSceneId || findMatchingSavedSceneId(savedScenes, activeScene, savedSceneName);

      if (thumbnailSavedSceneId) {
        const response = await fetch(`/api/scenes/${thumbnailSavedSceneId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ thumbnailUrl: hostedThumbnailUrl }),
        });
        const result = await response.json().catch(() => ({})) as { scene?: SavedSceneSummary; error?: string };

        if (!response.ok || !result.scene) {
          throw new Error(result.error || 'Thumbnail captured locally, but could not update the saved scene.');
        }

        const updatedScene = result.scene;
        setSavedScenes(previous => previous.map(scene => (
          scene.id === thumbnailSavedSceneId ? { ...updatedScene, thumbnailUrl: hostedThumbnailUrl } : scene
        )));
        setActiveSavedSceneId(thumbnailSavedSceneId);
      }

      toast.success('Scene thumbnail saved to public/timeline-thumbnails');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to capture thumbnail.';
      toast.error(message);
    } finally {
      setCurrentFrame(capturedFrame);
      setSceneSaveStatus(null);
      setIsCapturingSceneThumbnail(false);
    }
  };

  const appendPendingProjectImport = () => {
    if (!pendingProjectImport) return;
    importProjectIntoCurrent(pendingProjectImport.project);
    setActiveSavedSceneId(null);
    setActiveSavedScenePublished(false);

    const currentParams = new URLSearchParams(window.location.search);
    currentParams.delete('sceneId');
    router.replace(`${pathname}?${currentParams.toString()}`);

    setPendingProjectImport(null);
    setActiveTab('scenes');
    toast.success('Imported into current project without changing existing work');
  };

  const replaceWithPendingProjectImport = () => {
    if (!pendingProjectImport) return;
    importProject(pendingProjectImport.project);
    setActiveSavedSceneId(pendingProjectImport.savedSceneId || null);
    setActiveSavedScenePublished(!!pendingProjectImport.isPublished);

    const currentParams = new URLSearchParams(window.location.search);
    if (pendingProjectImport.savedSceneId) {
      currentParams.set('sceneId', pendingProjectImport.savedSceneId);
    } else {
      currentParams.delete('sceneId');
    }
    router.replace(`${pathname}?${currentParams.toString()}`);

    setPendingProjectImport(null);
    setActiveTab('scenes');
    toast.success('Opened imported JSON as project');
  };

  const getRenderGroupOptions = React.useCallback((): RenderGroupOption[] => {
    return tracks
      .filter(track => !track.parentId)
      .map(parent => {
        const trackIds = tracks.filter(track => track.parentId === parent.id).map(track => track.id);
        return {
          id: parent.id,
          name: parent.name,
          trackIds,
          clipCount: clips.filter(clip => trackIds.includes(clip.trackId)).length,
        };
      });
  }, [clips, tracks]);

  const createRenderProject = async (group?: RenderGroupOption) => {
    const project = exportProject();
    const runtimeClipSrcById = new Map(
      scenes.flatMap(scene => scene.clips.map(clip => [clip.id, clip.src] as const))
    );
    const runtimeCharacterImageById = new Map(
      characters.map(character => [character.id, character.image] as const)
    );
    const scenesWithMedia = await Promise.all(project.scenes.map(async (scene) => ({
      ...scene,
      tracks: group
        ? scene.tracks.filter(track => track.id === group.id || group.trackIds.includes(track.id))
        : scene.tracks,
      clips: await Promise.all(scene.clips.map(async (clip) => {
        const blob = await loadBlob(clip.id);
        const renderSrc = blob
          ? await blobToDataUrl(blob)
          : await runtimeSrcToRenderSrc(runtimeClipSrcById.get(clip.id) || clip.src);

        let thumbnailUrl = clip.thumbnailUrl;
        if (clip.type === 'note' && (clip.name === "Analysis" || clip.tags?.includes("Analysis") || clip.name.toLowerCase().includes("beat"))) {
          const thumbBlob = await loadBlob(`beat-thumb-${clip.id}`);
          if (thumbBlob) {
            thumbnailUrl = await blobToDataUrl(thumbBlob);
          }
        }

        if (!renderSrc && thumbnailUrl === clip.thumbnailUrl) return clip;

        return {
          ...clip,
          ...(renderSrc ? { src: renderSrc } : {}),
          thumbnailUrl,
        };
      })).then(sceneClips => (
        group ? sceneClips.filter(clip => group.trackIds.includes(clip.trackId)) : sceneClips
      )),
    })));

    const charactersWithMedia = await Promise.all(project.characters.map(async (character) => {
      const blob = await loadBlob(`char-${character.id}`);
      const runtimeImage = runtimeCharacterImageById.get(character.id) || character.image;
      const image = blob
        ? await blobToDataUrl(blob)
        : await runtimeSrcToRenderSrc(typeof runtimeImage === 'string' ? runtimeImage : undefined);

      if (!image) return character;

      return {
        ...character,
        image,
      };
    }));

    return {
      project: {
        ...project,
        scenes: scenesWithMedia,
        characters: charactersWithMedia,
      },
    };
  };

  const handleRenderProject = async () => {
    if (isRendering) return;

    const groups = getRenderGroupOptions();
    if (groups.length > 1) {
      setRenderGroupOptions(groups);
      return;
    }

    await renderProject(groups[0]);
  };

  const renderProject = async (group?: RenderGroupOption) => {
    if (isRendering) return;

    setIsRendering(true);
    try {
      toast.loading(group ? `Rendering ${group.name}...` : 'Rendering MP4...', { id: 'render-project' });
      const inputProps = await createRenderProject(group);
      const response = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputProps),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Render failed.');
      }

      const link = document.createElement('a');
      link.href = result.url;
      link.download = result.fileName || 'timeline-render.mp4';
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('MP4 render ready', { id: 'render-project' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to render MP4.';
      toast.error(message, { id: 'render-project' });
    } finally {
      setIsRendering(false);
    }
  };



  React.useEffect(() => {
    if (!isFileMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!fileMenuRef.current?.contains(event.target as Node)) {
        setIsFileMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFileMenuOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFileMenuOpen]);

  React.useEffect(() => {
    if (!activeTab && !selectedClip) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (activeTab) {
        if (sidePanelRef.current?.contains(target)) return;
        setActiveTab(null);
        return;
      }

      if (clipPropertiesPanelRef.current?.contains(target)) return;
      setSelectedClipIds([]);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [activeTab, selectedClip, setSelectedClipIds]);

  const renderSidePanel = () => {
    if (!activeTab) return null;
    const panelActiveScene = scenes.find(scene => scene.id === activeSceneId) || scenes[0];

    const title = {
      scenes: 'Scenes',
      characters: 'Characters',
      locations: 'Locations',
      settings: 'Project Settings',
      analyze: 'AI Video Analysis',
      directory: 'Project Directory'
    }[activeTab];

    return (
      <motion.aside
        ref={sidePanelRef}
        initial={{ x: '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: '-100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed inset-y-0 left-0 w-72 bg-[#111114] border-r border-zinc-800 z-[100] flex flex-col shadow-[20px_0_50px_rgba(0,0,0,0.5)]"
      >
        <div className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0">
          <h3 className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">{title}</h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-white"
            onClick={() => setActiveTab(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'scenes' && (
            <ScenesSidePanel
              scenes={scenes}
              panelActiveScene={panelActiveScene}
              activeSceneId={activeSceneId}
              previewSceneIds={previewSceneIds}
              addScene={addScene}
              updateScene={updateScene}
              reorderScenes={reorderScenes}
              setActiveScene={setActiveScene}
              deleteScene={deleteScene}
              togglePreviewScene={togglePreviewScene}
            />
          )}

          {activeTab === 'characters' && (
             <CharactersPanel />
          )}

          {activeTab === 'locations' && (
             <div className="p-8 flex flex-col items-center justify-center text-center gap-4 opacity-50">
               <MapPin className="w-12 h-12 text-zinc-700" />
               <div className="space-y-1">
                 <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Global Locations</h4>
                 <p className="text-[10px] text-zinc-600 leading-relaxed max-w-[200px]">Define environmental settings and local assets.</p>
               </div>
             </div>
          )}

          {activeTab === 'analyze' && (
            <AnalysisSidePanel
              selectedVideoFile={selectedVideoFile}
              setSelectedVideoFile={setSelectedVideoFile}
              videoObjectURL={videoObjectURL}
              setVideoObjectURL={setVideoObjectURL}
              isAnalyzing={isAnalyzing}
              analysisProgress={analysisProgress}
              analysisLogs={analysisLogs}
              setAnalysisLogs={setAnalysisLogs}
              isAnalysisComplete={isAnalysisComplete}
              setIsAnalysisComplete={setIsAnalysisComplete}
              setVideoDuration={setVideoDuration}
              analysisModelChoice={analysisModelChoice}
              setAnalysisModelChoice={setAnalysisModelChoice}
              enabledGraphLayers={enabledGraphLayers}
              setEnabledGraphLayers={setEnabledGraphLayers}
              storyAnalyzePlotPoints={storyAnalyzePlotPoints}
              setStoryAnalyzePlotPoints={setStoryAnalyzePlotPoints}
              storyAnalyzeStakes={storyAnalyzeStakes}
              setStoryAnalyzeStakes={setStoryAnalyzeStakes}
              storyAnalyzeConfrontation={storyAnalyzeConfrontation}
              setStoryAnalyzeConfrontation={setStoryAnalyzeConfrontation}
              graphTracksInActiveScene={graphTracksInActiveScene}
              runVideoAnalysis={runVideoAnalysis}
              pendingAnalysisProject={pendingAnalysisProject}
              setPendingAnalysisProject={setPendingAnalysisProject}
              showDevJson={showDevJson}
              setShowDevJson={setShowDevJson}
              setAnalysisProgress={setAnalysisProgress}
              importProjectIntoCurrent={importProjectIntoCurrent}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsSidePanel
              previewSceneMode={previewSceneMode}
              setPreviewSceneMode={setPreviewSceneMode}
              previewGroupLayout={previewGroupLayout}
              setPreviewGroupLayout={setPreviewGroupLayout}
              previewMediaLayout={previewMediaLayout}
              setPreviewMediaLayout={setPreviewMediaLayout}
              analyticsOverlayStyle={analyticsOverlayStyle}
              setAnalyticsOverlayStyle={setAnalyticsOverlayStyle}
              showNoteOverlayIcons={showNoteOverlayIcons}
              setShowNoteOverlayIcons={setShowNoteOverlayIcons}
              tracks={tracks}
              updateTrack={updateTrack}
              deleteTrack={deleteTrack}
            />
          )}

          {activeTab === 'directory' && (
            <DirectorySidePanel
              activeSceneLaunchBeatId={board.sceneLaunchBeatPath[board.sceneLaunchBeatPath.length - 1] || null}
              directoryExpandedIds={directoryExpandedIds}
              setDirectoryExpandedIds={setDirectoryExpandedIds}
              sceneLaunchBeats={board.sceneLaunchBeats}
              sceneLaunchGridOrder={board.sceneLaunchGridOrder}
              sceneLaunchMediaItems={board.sceneLaunchMediaItems}
              setSceneLaunchBeatPath={board.setSceneLaunchBeatPath}
              openBeatDetail={board.openBeatDetail}
              pendingMoveItem={pendingMoveItem}
              setPendingMoveItem={setPendingMoveItem}
              onSelectMoveTarget={handleSelectMoveTarget}
              onCancelMove={handleCancelMove}
            />
          )}

        </div>
      </motion.aside>
    );
  };

  const isPublicAnalysis = pathname === '/analysis' && sceneIdParam && activeSavedScenePublished;
  const isGated = !currentUser && !isPublicAnalysis;
  const showAutosaveIndicator = Boolean(activeSavedSceneId && currentUser && currentUser.role !== 'viewer');
  const autosaveToneClass = cn(
    autosaveStatus === 'error'
      ? 'border-red-500/25 bg-red-500/10 text-red-300'
      : autosaveStatus === 'saved'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
        : autosaveStatus === 'saving' || autosaveStatus === 'pending'
          ? 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300'
          : 'border-zinc-800 bg-zinc-950/60 text-zinc-500'
  );

  if (isAuthChecking || isGated || isSceneLoading) {
    return (
      <div className="workbench-shell flex flex-col h-screen w-screen bg-[#0a0a0b] items-center justify-center text-zinc-300 font-sans relative overflow-hidden">
        {/* Background Decorative Glow */}
        <div className="absolute top-[-10%] left-[-20%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-br from-indigo-600/10 via-transparent to-transparent blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-20%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-tl from-violet-600/10 via-transparent to-transparent blur-3xl pointer-events-none" />

        <div className="flex flex-col items-center gap-4 z-10">
          <div className="w-12 h-12 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-sans font-black text-base leading-none shadow-lg shadow-indigo-500/20 animate-pulse select-none">S</div>
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">
              {isAuthChecking
                ? "Verifying Session..."
                : isGated
                  ? "Redirecting..."
                  : "Loading Project..."}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const buildPathToBeat = (beatId: string, beats: Array<{ id: string; childIds: string[] }>): string[] => {
    if (beatId === '__root__' || beatId === 'root' || beatId === 'trash') {
      return beatId === 'trash' ? ['trash'] : [];
    }
    const path: string[] = [beatId];
    let currentId = beatId;
    let iterations = 0;
    while (iterations < 100) {
      const parent = beats.find(b => b.childIds && b.childIds.includes(currentId));
      if (parent) {
        path.unshift(parent.id);
        currentId = parent.id;
        iterations++;
      } else {
        break;
      }
    }
    return path;
  };

  const handleDropOnDirectory = (dragKey: string) => {
    const [type, id] = dragKey.split(':');
    if ((type === 'media' || type === 'collection') && id) {
      setPendingMoveItem({ type: type as 'media' | 'collection', id });
      setOriginalBeatPath(board.sceneLaunchBeatPath);
      setActiveTab('directory');
      toast.info('Click on a collection to add it to', { id: 'move-target-toast' });
    }
  };

  const handleSelectMoveTarget = (targetBeatId: string) => {
    if (!pendingMoveItem) return;
    const { type, id } = pendingMoveItem;

    const targetBeat = board.sceneLaunchBeats.find(b => b.id === targetBeatId);
    const targetName = targetBeatId === 'trash' ? 'Trash' : targetBeat ? targetBeat.name : 'Scene Board';

    console.log('[Move Target Selection] Clicked target:', targetBeatId, 'for item:', pendingMoveItem);

    // Immediately update the main grid preview to show the selected target collection's contents
    const targetPath = buildPathToBeat(targetBeatId, board.sceneLaunchBeats);
    board.setSceneLaunchBeatPath(targetPath);

    let hasConfirmed = false;
    const toastId = toast(`Confirm Move`, {
      description: `Move this ${type} to "${targetName}"?`,
      duration: 12000,
      action: {
        label: 'Confirm',
        onClick: () => {
          hasConfirmed = true;
          console.log('[Move Confirmed] Invoking moveSceneLaunchItemToTargetCollection with:', `${type}:${id}`, targetBeatId);
          board.moveSceneLaunchItemToTargetCollection(`${type}:${id}`, targetBeatId);
          setPendingMoveItem(null);
          setOriginalBeatPath(null);
          toast.dismiss(toastId);
        },
      },
      onDismiss: () => {
        if (!hasConfirmed) {
          handleCancelMove();
        }
      },
      onAutoClose: () => {
        if (!hasConfirmed) {
          handleCancelMove();
        }
      }
    });
  };

  return (
    <div className="workbench-shell flex flex-col h-screen bg-[#0a0a0b] text-zinc-300 font-sans overflow-hidden">
      <input
        ref={projectImportInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportProjectJson}
      />

      <AnimatePresence>
        {isSaveSceneOpen && (
          <SaveSceneModal
            activeSceneThumbnailPreviewUrl={activeSceneThumbnailPreviewUrl}
            savedSceneName={savedSceneName}
            setSavedSceneName={setSavedSceneName}
            isSavingScene={isSavingScene}
            sceneSaveStatus={sceneSaveStatus}
            isPlaying={isPlaying}
            isCapturingSceneThumbnail={isCapturingSceneThumbnail}
            hasActiveVideoClipAtCurrentFrame={Boolean(activeVideoClipAtCurrentFrame)}
            onClose={() => setIsSaveSceneOpen(false)}
            onSubmit={handleSaveScene}
            onCaptureCurrentFrameThumbnail={() => void handleCaptureCurrentFrameThumbnail()}
          />
        )}

        {isSceneLibraryOpen && (
          <SceneLibraryModal
            savedScenes={savedScenes}
            savedScenesLoadError={savedScenesLoadError}
            isLoadingSavedScenes={isLoadingSavedScenes}
            loadingSavedSceneId={loadingSavedSceneId}
            deletingSavedSceneId={deletingSavedSceneId}
            currentUser={currentUser}
            onClose={() => setIsSceneLibraryOpen(false)}
            onRefresh={() => void loadSavedScenes()}
            onLoadSavedScene={(scene) => void handleLoadSavedScene(scene)}
            onConfirmDelete={confirmSavedSceneDelete}
          />
        )}

        {isAuthModalOpen && (
          <AuthModal
            authMode={authMode}
            setAuthMode={setAuthMode}
            authUsername={authUsername}
            setAuthUsername={setAuthUsername}
            authPassword={authPassword}
            setAuthPassword={setAuthPassword}
            authLoading={authLoading}
            authError={authError}
            setAuthError={setAuthError}
            onClose={() => setIsAuthModalOpen(false)}
            onSubmit={handleAuthSubmit}
          />
        )}

        {isAdminModalOpen && (
          <AdminUsersModal
            allUsers={allUsers}
            currentUserId={currentUser?.id}
            isLoadingUsers={isLoadingUsers}
            onClose={() => setIsAdminModalOpen(false)}
            onUpdateUserRole={(userId, role) => void handleUpdateUserRole(userId, role)}
          />
        )}

        <EditorConfirmations
          pendingSavedSceneDelete={pendingSavedSceneDelete}
          deletingSavedSceneId={deletingSavedSceneId}
          pendingProjectImport={pendingProjectImport}
          setPendingSavedSceneDelete={setPendingSavedSceneDelete}
          setPendingProjectImport={setPendingProjectImport}
          setIsSceneLibraryOpen={setIsSceneLibraryOpen}
          onDeleteSavedScene={() => void handleDeleteSavedScene()}
          onAppendPendingProjectImport={appendPendingProjectImport}
          onReplaceWithPendingProjectImport={replaceWithPendingProjectImport}
        />


        {renderGroupOptions && (
          <RenderGroupSelectionModal
            renderGroupOptions={renderGroupOptions}
            isRendering={isRendering}
            onClose={() => setRenderGroupOptions(null)}
            onRenderGroup={(group) => {
              setRenderGroupOptions(null);
              void renderProject(group);
            }}
          />
        )}
      </AnimatePresence>

      <EditorHeaderRail
        fileMenuRef={fileMenuRef}
        projectImportInputRef={projectImportInputRef}
        isFileMenuOpen={isFileMenuOpen}
        setIsFileMenuOpen={setIsFileMenuOpen}
        currentUser={currentUser}
        activeSavedSceneId={activeSavedSceneId}
        activeSavedScenePublished={activeSavedScenePublished}
        savedScenesCount={savedScenes.length}
        savedScenesLoadError={savedScenesLoadError}
        sceneLibraryCountLabel={sceneLibraryCountLabel}
        showAutosaveIndicator={showAutosaveIndicator}
        autosaveToneClass={autosaveToneClass}
        autosaveStatus={autosaveStatus}
        autosaveMessage={autosaveMessage}
        workspaceViewMode={workspaceViewMode}
        onOpenSaveScene={openSaveSceneModal}
        onTogglePublish={handleTogglePublish}
        onExportProject={handleExportProjectJson}
        onOpenSceneLibrary={openSceneLibrary}
        onNavigateEditor={() => {
          const sId = activeSavedSceneId ? `?sceneId=${activeSavedSceneId}` : '';
          router.push('/editor' + sId);
        }}
        onNavigateAnalysis={() => {
          if (activeSavedSceneId) {
            router.push(`/analysis?sceneId=${activeSavedSceneId}`);
          } else {
            router.push('/analysis/new');
          }
        }}
        onOpenAdmin={() => {
          void handleLoadUsers();
          setIsAdminModalOpen(true);
        }}
        onLogout={handleLogout}
        onOpenLogin={() => {
          setAuthMode('login');
          setAuthError('');
          setIsAuthModalOpen(true);
        }}
      />

      {/* Main Content Pane */}
      <main className="flex-1 flex overflow-hidden relative">
        <AnimatePresence>
          {renderSidePanel()}
        </AnimatePresence>

        {/* Selected Clip Properties Panel */}
        <AnimatePresence>
          {selectedClip && !activeTab && (
            <motion.aside
             ref={clipPropertiesPanelRef}
             key={selectedClip.id}
             initial={{ x: '-100%' }}
             animate={{ x: 0 }}
             exit={{ x: '-100%' }}
             transition={{ type: 'spring', damping: 25, stiffness: 200 }}
             className="fixed inset-y-0 left-0 w-72 bg-[#111114] border-r border-zinc-800 z-[100] flex flex-col shadow-[20px_0_50px_rgba(0,0,0,0.5)]"
            >
              <div className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0">
                <h3 className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">Clip Properties</h3>
                <Button
                 variant="ghost"
                 size="icon"
                 className="h-7 w-7 text-zinc-500 hover:text-white"
                 onClick={() => setSelectedClipIds([])}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <ClipPropertiesPanel
                selectedClip={selectedClip}
                tracks={tracks}
                updateClip={updateClip}
                addClip={addClip}
                handleFileUpload={handleFileUpload}
                deleteClip={deleteClip}
                moveClipToFirst={moveClipToFirst}
                moveClipToLast={moveClipToLast}
              />
            </motion.aside>
          )}
        </AnimatePresence>

        <EditorSidebarRail
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isDraggingItem={isDraggingSceneLaunchItem}
          onDropItem={handleDropOnDirectory}
        />

        {/* Editor Workspace */}
        <div ref={workspaceRef} className="flex-1 flex flex-col overflow-hidden relative">
          {showSceneLaunchView ? (
            <SceneLaunchWorkspace
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              openSceneLibrary={openSceneLibrary}
              aspectRatio={aspectRatio}
              setAspectRatio={setAspectRatio}
              scenes={scenes}
              activeSceneId={activeSceneId}
              updateScene={updateScene}
              deleteScene={deleteScene}
              addScene={addScene}
              setActiveScene={setActiveScene}
              updateClip={updateClip}
              handleAddClip={handleAddClip}
              isDraggingItem={isDraggingSceneLaunchItem}
              onDropItem={handleDropOnDirectory}
              board={board}
            />
          ) : (
          <>
          {/* Upper Split: Preview Area (PERSISTENT & SHARED) */}
          {workspaceViewMode !== 'analysis' && (
            <>
              <div
                className="flex min-h-0 overflow-hidden"
                style={{ flexBasis: `${previewPanelPercent}%` }}
              >
                 <Preview
                   showSceneMuteControls={workspaceViewMode === 'review'}
                   showPreviewTagUi={workspaceViewMode === 'review' ? reviewShowPreviewTagUi : true}
                   useTagOverlayPresentation={workspaceViewMode === 'review'}
                 />
              </div>

              <PreviewResizeDivider
                previewPanelPercent={previewPanelPercent}
                onPointerDown={handleResizePointerDown}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onKeyDown={handleResizeKeyDown}
              />
            </>
          )}

          {/* Shared Persistent Playback Toolbar Row */}
          <TooltipProvider>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept={pendingType === 'video' ? 'video/*' : 'image/*'}
              onChange={handleFileChange}
            />
            <div className="relative z-30 flex h-12 items-center justify-between border-b border-zinc-800 bg-[#111114] px-4 shrink-0">
              {/* Left aligned block */}
              {workspaceViewMode === 'review' ? (
                <div className="flex min-w-0 flex-1 items-center gap-3 pr-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                    {reviewContentMode === 'notes' ? 'Notes' : 'Dialog'} Timeline
                  </div>
                  <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 shrink-0">
                    {(['notes', 'dialog'] as const).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setReviewContentMode(mode)}
                        className={cn(
                          "inline-flex h-6 items-center gap-1.5 rounded px-2 text-[9px] font-black uppercase tracking-widest transition-colors",
                          reviewContentMode === mode
                            ? "bg-indigo-500 text-white shadow"
                            : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                        )}
                      >
                        {mode === 'notes' ? <StickyNote className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
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
              )}

              {/* Centered Playback Block (100% PERSISTENT & STATIONARY) */}
              {workspaceViewMode !== 'analysis' && (
                <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger
                      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 text-zinc-500 hover:text-zinc-300")}
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
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 min-w-14 justify-center border-zinc-800 bg-[#0a0a0b] px-2 font-mono text-[10px] font-bold text-zinc-300 hover:bg-zinc-900 hover:text-white")}
                    >
                      {playbackRate.toFixed(playbackRate % 1 === 0 ? 0 : 2)}x
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-28 bg-[#111114] border-zinc-800 text-zinc-300 z-50">
                      <div className="px-2 py-1 text-[9px] uppercase tracking-widest text-zinc-500 font-bold select-none cursor-default">Speed</div>
                      {[0.25, 0.5, 0.75, 1, 1.25, 1.5].map((rate) => (
                        <DropdownMenuItem
                          key={rate}
                          onClick={() => setPlaybackRate(rate)}
                          className="justify-between font-mono text-xs focus:bg-zinc-800 focus:text-white"
                        >
                          {rate.toFixed(rate % 1 === 0 ? 0 : 2)}x
                          {playbackRate === rate && <span className="text-indigo-300">Ã¢â‚¬Â¢</span>}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div className="flex items-center gap-3 ml-4">
                    <span className="text-sm font-mono text-indigo-400 font-bold tabular-nums">
                      {workspaceViewMode === "review" ? formatReviewTime(currentFrame, fps) : formatTimelineTime(currentFrame, fps)}
                    </span>
                    <div className="h-4 w-px bg-zinc-800" />
                    <span className="text-[10px] text-zinc-600 font-mono tracking-widest uppercase">
                       {currentFrame} / {totalDuration} FR
                    </span>
                  </div>
                </div>
              )}

              {/* Right aligned block */}
              {workspaceViewMode !== 'analysis' && (
                workspaceViewMode === 'review' ? (
                <div className="flex flex-1 items-center justify-end gap-4 pl-4">
                  <div role="group" aria-label="Preview overlays" className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-0.5 shrink-0">
                    <button
                      type="button"
                      aria-label="Tags and note/graph overlays on previews"
                      aria-pressed={reviewShowPreviewTagUi}
                      title="Tags and note/graph overlays on previews"
                      onClick={() => setReviewShowPreviewTagUi(!reviewShowPreviewTagUi)}
                      className={cn(
                        "inline-flex h-6 items-center gap-1.5 rounded px-2 text-[9px] font-black uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70",
                        reviewShowPreviewTagUi
                          ? "bg-indigo-500/20 text-indigo-100"
                          : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                      )}
                    >
                      <Tags className="h-3.5 w-3.5" />
                      Tags
                    </button>
                    <button
                      type="button"
                      aria-label="Dialog on previews"
                      aria-pressed={showDialogPreviewUi}
                      title="Dialog on previews"
                      onClick={() => setShowDialogPreviewUi(!showDialogPreviewUi)}
                      className={cn(
                        "inline-flex h-6 items-center gap-1.5 rounded px-2 text-[9px] font-black uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70",
                        showDialogPreviewUi
                          ? "bg-indigo-500/20 text-indigo-100"
                          : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                      )}
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Dialog
                    </button>
                  </div>

                  <div className="h-4 w-px bg-zinc-800 shrink-0" />

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Time scale</span>
                    <Slider
                      className="w-24 cursor-pointer"
                      value={[verticalTimeScale]}
                      min={0.5}
                      max={4}
                      step={0.25}
                      aria-label="Vertical timeline time scale"
                      onValueChange={(val) => {
                        const newValue = Array.isArray(val) ? val[0] : val;
                        setVerticalTimeScale(newValue);
                      }}
                    />
                    <span className="w-10 text-right font-mono text-[10px] font-bold text-zinc-400">
                      {verticalTimeScale.toFixed(2)}x
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-end gap-4 pl-4">
                  <PreviewFilterMenu
                    noteTagFilter={noteTagFilter}
                    showStarredNoteOverlaysOnly={showStarredNoteOverlaysOnly}
                    showDialogPreviewUi={showDialogPreviewUi}
                    setShowDialogPreviewUi={setShowDialogPreviewUi}
                    showSceneTitleUi={showSceneTitleUi}
                    setShowSceneTitleUi={setShowSceneTitleUi}
                    previewMediaLayout={previewMediaLayout}
                    setPreviewMediaLayout={setPreviewMediaLayout}
                    compactNoteOverlays={compactNoteOverlays}
                    setCompactNoteOverlays={setCompactNoteOverlays}
                    setShowStarredNoteOverlaysOnly={setShowStarredNoteOverlaysOnly}
                    graphLayers={graphLayers}
                    visibleGraphLayerCount={visibleGraphLayerCount}
                    toggleTrackDisable={toggleTrackDisable}
                    noteTags={noteTags}
                    activeFilterCount={activeFilterCount}
                    setNoteTagFilter={setNoteTagFilter}
                    enabledNoteTagSet={enabledNoteTagSet}
                    noteTagCounts={noteTagCounts}
                    toggleNoteTag={toggleNoteTag}
                    filterSummaryLabel={filterSummaryLabel}
                    selectedFilterLabels={selectedFilterLabels}
                  />
                  <div className="h-4 w-px bg-zinc-800" />

                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger
                        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 text-zinc-500 hover:text-zinc-300")}
                        onClick={() => setZoom(Math.max(2, zoom - 1))}
                      >
                        <ZoomOut className="h-4 w-4" />
                      </TooltipTrigger>
                      <TooltipContent>Zoom Out</TooltipContent>
                    </Tooltip>

                    <Slider
                      className="w-20 cursor-pointer"
                      value={[zoom]}
                      min={2}
                      max={18}
                      step={1}
                      aria-label="Timeline horizontal zoom"
                      onValueChange={(val) => {
                        const newValue = Array.isArray(val) ? val[0] : val;
                        setZoom(newValue);
                      }}
                    />

                    <Tooltip>
                      <TooltipTrigger
                        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 text-zinc-500 hover:text-zinc-300")}
                        onClick={() => setZoom(Math.min(18, zoom + 1))}
                      >
                        <ZoomIn className="h-4 w-4" />
                      </TooltipTrigger>
                      <TooltipContent>Zoom In</TooltipContent>
                    </Tooltip>
                  </div>

                  <div className="h-4 w-px bg-zinc-800 mx-1" />

                  <Tooltip>
                    <TooltipTrigger
                      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 text-zinc-500 hover:text-red-400 hover:bg-red-900/10 transition-colors disabled:opacity-50")}
                      disabled={selectedClipIds.length === 0}
                      onClick={() => selectedClipIds.forEach(id => deleteClip(id))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </TooltipTrigger>
                    <TooltipContent>Delete Selection</TooltipContent>
                  </Tooltip>

                  <div className="h-4 w-px bg-zinc-800 mx-1" />

                  <Button
                    size="sm"
                    className="h-8 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest rounded shadow-lg shadow-indigo-900/40 transition-all disabled:opacity-60"
                    disabled={isRendering}
                    onClick={handleRenderProject}
                  >
                    {isRendering ? (
                      <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5 mr-2" />
                    )}
                    {isRendering ? 'Rendering' : 'Render'}
                  </Button>

                  <div className="h-4 w-px bg-zinc-800 mx-1" />

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 gap-2 bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500 hover:text-white")}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Item
                      <ChevronDown className="h-3 w-3 opacity-50" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 bg-[#111114] border-zinc-800 text-zinc-300 z-50">
                      <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-bold select-none cursor-default">Media Assets</div>
                      <DropdownMenuItem onClick={() => handleAddClipClick('video')} className="focus:bg-zinc-800 focus:text-white gap-2">
                        <Video className="h-4 w-4" /> Video Layer
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAddClipClick('image')} className="focus:bg-zinc-800 focus:text-white gap-2">
                        <ImageIcon className="h-4 w-4" /> Image/Graphic
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-zinc-800" />
                      <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-bold select-none cursor-default">Storyboard elements</div>
                      <DropdownMenuItem onClick={() => handleAddClipClick('dialog')} className="focus:bg-zinc-800 focus:text-white gap-2">
                        <MessageSquare className="h-4 w-4" /> Dialogue Bubble
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAddClipClick('note')} className="focus:bg-zinc-800 focus:text-white gap-2">
                        <StickyNote className="h-4 w-4" /> Director Note
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            )}
            </div>
          </TooltipProvider>

          {/* Lower Split: Swappable Timeline Content */}
          {workspaceViewMode === 'analysis' ? (
            <AnalysisWorkspace
              selectedVideoFile={selectedVideoFile}
              setSelectedVideoFile={setSelectedVideoFile}
              videoObjectURL={videoObjectURL}
              setVideoObjectURL={setVideoObjectURL}
              isAnalyzing={isAnalyzing}
              analysisProgress={analysisProgress}
              analysisLogs={analysisLogs}
              isAnalysisComplete={isAnalysisComplete}
              setIsAnalysisComplete={setIsAnalysisComplete}
              videoDuration={videoDuration}
              setVideoDuration={setVideoDuration}
              analysisModelChoice={analysisModelChoice}
              setAnalysisModelChoice={setAnalysisModelChoice}
              enabledGraphLayers={enabledGraphLayers}
              setEnabledGraphLayers={setEnabledGraphLayers}
              storyAnalyzePlotPoints={storyAnalyzePlotPoints}
              setStoryAnalyzePlotPoints={setStoryAnalyzePlotPoints}
              storyAnalyzeStakes={storyAnalyzeStakes}
              setStoryAnalyzeStakes={setStoryAnalyzeStakes}
              storyAnalyzeConfrontation={storyAnalyzeConfrontation}
              setStoryAnalyzeConfrontation={setStoryAnalyzeConfrontation}
              runVideoAnalysis={runVideoAnalysis}
              onOpenScriptEditor={openScriptEditorForClip}
              handleCaptureCurrentFrameThumbnail={handleCaptureCurrentFrameThumbnail}
              isCapturingSceneThumbnail={isCapturingSceneThumbnail}
              activeVideoClipAtCurrentFrame={activeVideoClipAtCurrentFrame}
              isPlaying={isPlaying}
              isReadOnly={!currentUser || currentUser.role === 'viewer'}
            />
          ) : workspaceViewMode === 'review' ? (
            <ReviewWorkspace
              onOpenScriptEditor={openScriptEditorForClip}
              showPreviewTagUi={reviewShowPreviewTagUi}
              setShowPreviewTagUi={setReviewShowPreviewTagUi}
              contentMode={reviewContentMode}
              setContentMode={setReviewContentMode}
              verticalTimeScale={verticalTimeScale}
              setVerticalTimeScale={setVerticalTimeScale}
            />
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <TimelineRoot />
            </div>
          )}
          </>
          )}
        </div>
      </main>

      <EditorFooterStatusBar
        activeSceneNumber={scenes.findIndex(scene => scene.id === activeSceneId) + 1}
        sceneCount={scenes.length}
      />
      <AnimatePresence>
        {scriptEditorClip && (scriptEditorClip.type === 'dialog' || scriptEditorClip.type === 'note') && (
          <ScriptClipEditorModal
            selectedClip={scriptEditorClip}
            clips={clips}
            tracks={tracks}
            characters={characters}
            fps={fps}
            updateClip={updateClip}
            addClip={addClip}
            onClose={() => setScriptEditorClipId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}


export function Editor() {
  return <EditorInner />;
}
