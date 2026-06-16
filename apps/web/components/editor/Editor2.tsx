'use client';

import React from 'react';
import { Loader2, MapPin, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';

import { Button } from '@storyboard/ui';
import { useTimeline, type ClipType, type TimelineProjectJson } from '@/lib/timeline-context';
import { CharactersPanel } from './CharactersPanel';
import { DirectorySidePanel } from './DirectorySidePanel';
import { SceneLibraryModal } from './SceneLibraryModal';
import { SceneLaunchWorkspace } from './scene-launch/SceneLaunchWorkspace';
import { useSceneLaunchBoard } from './scene-launch/useSceneLaunchBoard';
import { ScenesSidePanel } from './ScenesSidePanel';
import { SettingsSidePanel } from './SettingsSidePanel';
import type { SavedSceneSummary } from './saved-scene-utils';
import type { SidebarTab } from './EditorSidebarRail';

export function Editor2() {
  const {
    aspectRatio,
    setAspectRatio,
    currentFrame,
    addClip,
    updateClip,
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
    previewSceneIds,
    togglePreviewScene,
    previewGroupLayout,
    setPreviewGroupLayout,
    previewSceneMode,
    setPreviewSceneMode,
    previewMediaLayout,
    setPreviewMediaLayout,
    analyticsOverlayStyle,
    setAnalyticsOverlayStyle,
    showNoteOverlayIcons,
    setShowNoteOverlayIcons,
    currentUser,
    importProjectIntoCurrent,
  } = useTimeline();

  const activeScene = scenes.find(scene => scene.id === activeSceneId) || scenes[0];
  const [activeTab, setActiveTab] = React.useState<SidebarTab>(null);
  const [directoryExpandedIds, setDirectoryExpandedIds] = React.useState<Set<string>>(new Set(['__root__']));
  const [pendingMoveItem, setPendingMoveItem] = React.useState<{ type: 'media' | 'collection'; id: string } | null>(null);
  const [originalBeatPath, setOriginalBeatPath] = React.useState<string[] | null>(null);
  const [isDraggingSceneLaunchItem, setIsDraggingSceneLaunchItem] = React.useState(false);
  const [isSceneLibraryOpen, setIsSceneLibraryOpen] = React.useState(false);
  const [savedScenes, setSavedScenes] = React.useState<SavedSceneSummary[]>([]);
  const [savedScenesLoadError, setSavedScenesLoadError] = React.useState<string | null>(null);
  const [isLoadingSavedScenes, setIsLoadingSavedScenes] = React.useState(false);
  const [loadingSavedSceneId, setLoadingSavedSceneId] = React.useState<string | null>(null);
  const [deletingSavedSceneId, setDeletingSavedSceneId] = React.useState<string | null>(null);

  const sidePanelRef = React.useRef<HTMLElement | null>(null);

  const handleAddClip = React.useCallback((
    type: ClipType,
    character?: string,
    file?: File,
    customId?: string,
    customDurationSeconds?: number,
  ) => {
    const clipId = customId || `clip-${Math.random().toString(36).slice(2, 11)}`;
    let trackId = 'track-1';
    let color = 'bg-indigo-600';
    let name = file ? file.name : 'New Clip';

    if (type === 'video') {
      trackId = tracks.find(track => track.name.includes('Video'))?.id || 'track-1';
      color = 'bg-zinc-600';
    } else if (type === 'image') {
      trackId = tracks.find(track => track.name.includes('Images'))?.id || 'track-4';
      color = 'bg-zinc-600';
    } else if (type === 'dialog') {
      trackId = tracks.find(track => track.name.includes('Dialog'))?.id || 'track-3';
      color = 'bg-purple-600';
      name = character ? `Line for ${character}` : 'Dialog';
    } else if (type === 'note') {
      trackId = tracks.find(track => track.name.includes('Dialog'))?.id || 'track-3';
      color = 'bg-amber-600';
      name = 'Note';
    }

    addClip({
      id: clipId,
      name,
      type,
      startFrame: currentFrame,
      duration: customDurationSeconds !== undefined
        ? Math.round(customDurationSeconds * 30)
        : type === 'video'
          ? 150
          : 60,
      trackId,
      color,
      character,
    }, file);

    return clipId;
  }, [addClip, currentFrame, tracks]);

  const board = useSceneLaunchBoard({
    activeScene,
    scenes,
    updateScene,
    handleAddClip,
    updateClip,
  });

  React.useEffect(() => {
    const handleDragStart = (event: DragEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.id?.startsWith('grid-item-')) {
        setIsDraggingSceneLaunchItem(true);
      }
    };
    const handleDragEnd = () => setIsDraggingSceneLaunchItem(false);

    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('dragend', handleDragEnd);
    return () => {
      document.removeEventListener('dragstart', handleDragStart);
      document.removeEventListener('dragend', handleDragEnd);
    };
  }, []);

  const handleCancelMove = React.useCallback(() => {
    if (!pendingMoveItem) return;
    if (originalBeatPath !== null) {
      board.setSceneLaunchBeatPath(originalBeatPath);
      setOriginalBeatPath(null);
    }
    setPendingMoveItem(null);
    toast.info('Move operation cancelled');
  }, [board, originalBeatPath, pendingMoveItem]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && pendingMoveItem) {
        handleCancelMove();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCancelMove, pendingMoveItem]);

  React.useEffect(() => {
    if (activeTab !== 'directory' && pendingMoveItem) {
      handleCancelMove();
    }
  }, [activeTab, handleCancelMove, pendingMoveItem]);

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || !activeTab) return;
      if (sidePanelRef.current?.contains(target)) return;
      setActiveTab(null);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [activeTab]);

  const loadSavedScenes = React.useCallback(async () => {
    setIsLoadingSavedScenes(true);
    setSavedScenesLoadError(null);
    try {
      const response = await fetch('/api/scenes', { cache: 'no-store' });
      const result = await response.json().catch(() => ({})) as { scenes?: SavedSceneSummary[]; error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Unable to load recent scenes.');
      }
      setSavedScenes(result.scenes || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load recent scenes.';
      setSavedScenesLoadError(message);
      toast.error(message);
    } finally {
      setIsLoadingSavedScenes(false);
    }
  }, []);

  const openSceneLibrary = React.useCallback(() => {
    setIsSceneLibraryOpen(true);
    void loadSavedScenes();
  }, [loadSavedScenes]);

  const handleLoadSavedScene = async (scene: SavedSceneSummary) => {
    if (loadingSavedSceneId || deletingSavedSceneId) return;

    setLoadingSavedSceneId(scene.id);
    try {
      const response = await fetch(`/api/scenes/${scene.id}`, { cache: 'no-store' });
      const result = await response.json().catch(() => ({})) as {
        scene?: SavedSceneSummary & { project: TimelineProjectJson };
        error?: string;
      };
      if (!response.ok || !result.scene) {
        throw new Error(result.error || 'Unable to load the saved scene.');
      }
      importProjectIntoCurrent(result.scene.project);
      setIsSceneLibraryOpen(false);
      toast.success(`Loaded "${result.scene.name}"`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load the saved scene.';
      toast.error(message);
    } finally {
      setLoadingSavedSceneId(null);
    }
  };

  const handleConfirmDeleteSavedScene = async (scene: SavedSceneSummary) => {
    if (!currentUser || currentUser.role === 'viewer') {
      toast.error('Log in as an editor or admin to delete scenes.');
      return;
    }
    if (!window.confirm(`Delete "${scene.name}" from the scene library?`)) return;

    setDeletingSavedSceneId(scene.id);
    try {
      const response = await fetch(`/api/scenes/${scene.id}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Unable to delete the saved scene.');
      }
      setSavedScenes(previous => previous.filter(savedScene => savedScene.id !== scene.id));
      toast.success('Saved scene deleted');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete the saved scene.';
      toast.error(message);
    } finally {
      setDeletingSavedSceneId(null);
    }
  };

  const buildPathToBeat = (beatId: string, beats: Array<{ id: string; childIds: string[] }>): string[] => {
    if (beatId === '__root__' || beatId === 'root' || beatId === 'trash') {
      return beatId === 'trash' ? ['trash'] : [];
    }

    const path: string[] = [beatId];
    let currentId = beatId;
    let iterations = 0;
    while (iterations < 100) {
      const parent = beats.find(beat => beat.childIds?.includes(currentId));
      if (!parent) break;
      path.unshift(parent.id);
      currentId = parent.id;
      iterations += 1;
    }
    return path;
  };

  const handleDropOnDirectory = (dragKey: string) => {
    const [type, id] = dragKey.split(':');
    if ((type === 'media' || type === 'collection') && id) {
      setPendingMoveItem({ type, id });
      setOriginalBeatPath(board.sceneLaunchBeatPath);
      setActiveTab('directory');
      toast.info('Click on a collection to add it to', { id: 'move-target-toast' });
    }
  };

  const handleSelectMoveTarget = (targetBeatId: string) => {
    if (!pendingMoveItem) return;

    const { type, id } = pendingMoveItem;
    const targetBeat = board.sceneLaunchBeats.find(beat => beat.id === targetBeatId);
    const targetName = targetBeatId === 'trash' ? 'Trash' : targetBeat?.name || 'Scene Board';
    const targetPath = buildPathToBeat(targetBeatId, board.sceneLaunchBeats);
    board.setSceneLaunchBeatPath(targetPath);

    let hasConfirmed = false;
    const toastId = toast('Confirm Move', {
      description: `Move this ${type} to "${targetName}"?`,
      duration: 12000,
      action: {
        label: 'Confirm',
        onClick: () => {
          hasConfirmed = true;
          board.moveSceneLaunchItemToTargetCollection(`${type}:${id}`, targetBeatId);
          setPendingMoveItem(null);
          setOriginalBeatPath(null);
          toast.dismiss(toastId);
        },
      },
      onDismiss: () => {
        if (!hasConfirmed) handleCancelMove();
      },
      onAutoClose: () => {
        if (!hasConfirmed) handleCancelMove();
      },
    });
  };

  const renderSidePanel = () => {
    if (!activeTab) return null;
    const panelActiveScene = scenes.find(scene => scene.id === activeSceneId) || scenes[0];
    const title = {
      scenes: 'Scenes',
      characters: 'Characters',
      locations: 'Locations',
      settings: 'Project Settings',
      analyze: 'AI Video Analysis',
      directory: 'Project Directory',
    }[activeTab];

    return (
      <motion.aside
        ref={sidePanelRef}
        initial={{ x: '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: '-100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed inset-y-0 left-0 z-[100] flex w-72 flex-col border-r border-zinc-800 bg-[#111114] shadow-[20px_0_50px_rgba(0,0,0,0.5)]"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">{title}</h3>
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

          {activeTab === 'characters' && <CharactersPanel />}

          {activeTab === 'locations' && (
            <div className="flex flex-col items-center justify-center gap-4 p-8 text-center opacity-50">
              <MapPin className="h-12 w-12 text-zinc-700" />
              <div className="space-y-1">
                <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Global Locations</h4>
                <p className="max-w-[200px] text-[10px] leading-relaxed text-zinc-600">Define environmental settings and local assets.</p>
              </div>
            </div>
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

  if (!activeScene) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0b] text-zinc-300">
        <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="workbench-shell flex h-screen flex-col overflow-hidden bg-[#0a0a0b] font-sans text-zinc-300">
      <main className="relative flex flex-1 overflow-hidden">
        <AnimatePresence>{renderSidePanel()}</AnimatePresence>
        <div className="relative flex min-w-0 flex-1">
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
            headerVariant="prompt"
          />
        </div>
      </main>

      <AnimatePresence>
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
            onConfirmDelete={(scene) => void handleConfirmDeleteSavedScene(scene)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
