'use client';

import React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useTimeline, type Scene, type TimelineProjectJson, type TimelineClip, type ClipType } from '@/lib/timeline-context';
import { getSuggestedSavedSceneName, type SavedSceneSummary, SCENE_THUMBNAIL_BLOB_PREFIX } from './saved-scene-utils';
import {
  localUpload,
  captureVideoElementThumbnail,
  captureVideoThumbnail,
  getPreviewVideoElementForClip,
} from './editor-media-utils';
import { loadBlob } from '@/lib/db';

interface UseSavedScenesParams {
  currentUser: any;
  isSceneLoading: boolean;
  isCapturingSceneThumbnail: boolean;
  pendingProjectImport: any;
  setPendingProjectImport: React.Dispatch<React.SetStateAction<any>>;
  isFileMenuOpen: boolean;
  setIsFileMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeVideoClipAtCurrentFrame: TimelineClip | undefined;
  isPlaying: boolean;
  currentFrame: number;
  fps: number;
  activeSceneThumbnailPreviewUrl: string | undefined;
}

export function useSavedScenes({
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
}: UseSavedScenesParams) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const {
    scenes,
    clips,
    tracks,
    activeSceneId,
    setActiveScene,
    setActiveSavedSceneId,
    activeSavedSceneId,
    activeSavedScenePublished,
    setActiveSavedScenePublished,
    importProjectIntoCurrent,
    updateClip,
    updateScene,
    exportProject,
    setSelectedClipIds,
  } = useTimeline();

  // Saved Scene Persistence States
  const [isSaveSceneOpen, setIsSaveSceneOpen] = React.useState(false);
  const [isSceneLibraryOpen, setIsSceneLibraryOpen] = React.useState(false);
  const [savedSceneName, setSavedSceneName] = React.useState('');
  const [savedScenes, setSavedScenes] = React.useState<SavedSceneSummary[]>([]);
  const [isLoadingSavedScenes, setIsLoadingSavedScenes] = React.useState(false);
  const [savedScenesLoadError, setSavedScenesLoadError] = React.useState<string | null>(null);
  const [sceneSaveStatus, setSceneSaveStatus] = React.useState<string | null>(null);
  const [isSavingScene, setIsSavingScene] = React.useState(false);
  const [loadingSavedSceneId, setLoadingSavedSceneId] = React.useState<string | null>(null);
  const [deletingSavedSceneId, setDeletingSavedSceneId] = React.useState<string | null>(null);
  const [pendingSavedSceneDelete, setPendingSavedSceneDelete] = React.useState<SavedSceneSummary | null>(null);

  // Autosave status
  const [autosaveStatus, setAutosaveStatus] = React.useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  const [autosaveMessage, setAutosaveMessage] = React.useState('Autosave ready');

  // Autosave Refs
  const lastAutosaveSnapshotRef = React.useRef<string | null>(null);
  const autosaveSceneIdRef = React.useRef<string | null>(null);

  const getAutosaveSnapshot = React.useCallback(() => {
    const project = exportProject();
    const comparableProject = { ...project, exportedAt: '' };
    return {
      project,
      serialized: JSON.stringify(comparableProject),
    };
  }, [exportProject]);

  // Synchronize autosave baseline on scene change
  React.useEffect(() => {
    if (!activeSavedSceneId || isSceneLoading) {
      autosaveSceneIdRef.current = null;
      lastAutosaveSnapshotRef.current = null;
      setAutosaveStatus('idle');
      setAutosaveMessage('Autosave ready');
      return;
    }

    if (autosaveSceneIdRef.current !== activeSavedSceneId) {
      autosaveSceneIdRef.current = activeSavedSceneId;
      lastAutosaveSnapshotRef.current = getAutosaveSnapshot().serialized;
      setAutosaveStatus('saved');
      setAutosaveMessage('Saved');
    }
  }, [activeSavedSceneId, getAutosaveSnapshot, isSceneLoading]);

  // Autosave execution loop
  React.useEffect(() => {
    if (
      !activeSavedSceneId ||
      isSceneLoading ||
      !currentUser ||
      currentUser.role === 'viewer' ||
      isSavingScene ||
      isCapturingSceneThumbnail
    ) {
      return;
    }

    const { project, serialized } = getAutosaveSnapshot();
    if (serialized === lastAutosaveSnapshotRef.current) return;

    const controller = new AbortController();
    setAutosaveStatus('pending');
    setAutosaveMessage('Autosave pending...');
    const timeoutId = window.setTimeout(async () => {
      try {
        setAutosaveStatus('saving');
        setAutosaveMessage('Autosaving...');
        const response = await fetch(`/api/scenes/${activeSavedSceneId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project }),
          signal: controller.signal,
        });
        const result = await response.json().catch(() => ({})) as { scene?: SavedSceneSummary; error?: string };

        if (!response.ok || !result.scene) {
          throw new Error(result.error || 'Autosave failed.');
        }

        lastAutosaveSnapshotRef.current = serialized;
        setSavedScenes(previous => previous.map(scene => (
          scene.id === activeSavedSceneId ? { ...scene, ...result.scene } : scene
        )));
        setAutosaveStatus('saved');
        setAutosaveMessage('Saved');
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Autosave scene error:', error);
        setAutosaveStatus('error');
        setAutosaveMessage('Autosave failed');
      }
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    activeSavedSceneId,
    currentUser,
    getAutosaveSnapshot,
    isCapturingSceneThumbnail,
    isSavingScene,
    isSceneLoading,
  ]);

  const loadSavedScenes = React.useCallback(async (options?: { silent?: boolean }) => {
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
      if (!options?.silent) {
        toast.error(message);
      }
    } finally {
      setIsLoadingSavedScenes(false);
    }
  }, []);

  const openSaveSceneModal = () => {
    const activeScene = scenes.find(scene => scene.id === activeSceneId) || scenes[0];
    setSavedSceneName(getSuggestedSavedSceneName(activeScene));
    setIsSaveSceneOpen(true);
  };

  const openSceneLibrary = () => {
    setIsSceneLibraryOpen(true);
    void loadSavedScenes();
  };

  const sceneLibraryCountLabel = isLoadingSavedScenes
    ? '...'
    : savedScenesLoadError
      ? '!'
      : String(savedScenes.length);

  const uploadSceneVideo = async (clipName: string, video: Blob) => {
    const fileName = (clipName || 'scene-video.mp4')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .slice(-100);
    const file = new File([video], fileName, { type: video.type || 'video/mp4' });
    setSceneSaveStatus(`Uploading ${fileName} (0%)`);
    const hostedVideo = await localUpload(fileName, file);
    setSceneSaveStatus(`Uploading ${fileName} (100%)`);

    return {
      videoUrl: `/api/scenes/media?pathname=${encodeURIComponent(hostedVideo.pathname)}`,
      thumbnailUrl: hostedVideo.thumbnailPathname
        ? `/api/scenes/media?pathname=${encodeURIComponent(hostedVideo.thumbnailPathname)}`
        : hostedVideo.thumbnailUrl,
    };
  };

  const uploadSceneThumbnail = React.useCallback(async (sceneName: string, thumbnail: Blob) => {
    const baseName = (sceneName || 'scene-thumbnail')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .slice(0, 80);
    const fileName = `${baseName || 'scene'}-thumbnail-${Date.now()}.jpg`;
    const file = new File([thumbnail], fileName, { type: 'image/jpeg' });
    setSceneSaveStatus(`Uploading scene thumbnail (${fileName})...`);
    const hostedImage = await localUpload(fileName, file);

    return `/api/scenes/media?pathname=${encodeURIComponent(hostedImage.pathname)}`;
  }, []);

  const getVideoBlobForClip = React.useCallback(async (clip: TimelineClip, runtimeClip?: TimelineClip) => {
    if (clip.src?.startsWith('http') || clip.src?.startsWith('/api/scenes/media?')) {
      const response = await fetch(clip.src);
      return response.blob();
    }

    const localBlob = await loadBlob(clip.id);
    if (localBlob) return localBlob;

    if (runtimeClip?.src?.startsWith('blob:')) {
      const response = await fetch(runtimeClip.src);
      return response.blob();
    }

    if (runtimeClip?.src) {
      const response = await fetch(runtimeClip.src);
      return response.blob();
    }

    return undefined;
  }, []);

  const handleSaveScene = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSavingScene) return;

    const project = exportProject();
    const activeScene = project.scenes.find(scene => scene.id === activeSceneId) || project.scenes[0];
    const runtimeScene = scenes.find(scene => scene.id === activeScene?.id);
    const name = savedSceneName.trim();

    if (!activeScene || !name) return;

    setIsSavingScene(true);
    setSceneSaveStatus('Preparing scene snapshot...');
    try {
      const portableClips = [];
      let thumbnailBlob: Blob | undefined = await loadBlob(`${SCENE_THUMBNAIL_BLOB_PREFIX}-${activeScene.id}`);

      for (const clip of activeScene.clips) {
        if (clip.type !== 'video') {
          portableClips.push(clip);
          continue;
        }

        const runtimeClip = runtimeScene?.clips.find(runtimeItem => runtimeItem.id === clip.id);
        let video: Blob | undefined;
        const isHostedVideo = clip.src?.startsWith('http') || clip.src?.startsWith('/api/scenes/media?');

        if (!thumbnailBlob && activeVideoClipAtCurrentFrame?.id === clip.id) {
          const previewVideo = getPreviewVideoElementForClip(clip.id);
          thumbnailBlob = previewVideo ? await captureVideoElementThumbnail(previewVideo) ?? undefined : undefined;
        }

        if (!thumbnailBlob || !isHostedVideo) {
          try {
            video = await getVideoBlobForClip(clip, runtimeClip);
          } catch {
            video = undefined;
          }
        }

        if (!thumbnailBlob && video) {
          thumbnailBlob = await captureVideoThumbnail(video) ?? undefined;
        }

        if (isHostedVideo) {
          portableClips.push(clip);
          continue;
        }

        if (!video && runtimeClip?.src) {
          portableClips.push({ ...clip, src: runtimeClip.src });
          continue;
        }

        if (!video) {
          portableClips.push(clip);
          continue;
        }

        const sanitizedClipName = (clip.name || 'scene-video.mp4').replace(/[^a-zA-Z0-9._-]/g, '-');
        const uploadedVideo = await uploadSceneVideo(sanitizedClipName, video);
        portableClips.push({
          ...clip,
          name: sanitizedClipName,
          src: uploadedVideo.videoUrl,
          thumbnailUrl: clip.thumbnailUrl || uploadedVideo.thumbnailUrl,
        });
      }

      if (!thumbnailBlob && activeScene.clips.some(clip => clip.type === 'video')) {
        throw new Error('Scene thumbnail was not saved because no video frame could be captured. Pause on a visible video frame, then try Save Scene again.');
      }

      const thumbnailUrl = thumbnailBlob
        ? await uploadSceneThumbnail(name, thumbnailBlob)
        : activeSceneThumbnailPreviewUrl;

      const sanitizedSceneName = (name || activeScene.name || 'scene-video.mp4').replace(/[^a-zA-Z0-9._-]/g, '-');
      const sceneSnapshot: TimelineProjectJson = {
        ...project,
        scenes: [{
          ...activeScene,
          name: sanitizedSceneName,
          thumbnailUrl,
          clips: portableClips,
          analysisReport: activeScene.analysisReport ? {
            ...activeScene.analysisReport,
            title: sanitizedSceneName
          } : undefined
        }],
        activeSceneId: activeScene.id,
        config: {
          ...project.config,
          previewSceneMode: 'active',
          previewSceneIds: [activeScene.id],
        },
      };

      setSceneSaveStatus('Saving scene snapshot...');
      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sanitizedSceneName, project: sceneSnapshot }),
      });
      const result = await response.json().catch(() => ({})) as { scene?: SavedSceneSummary; error?: string };
      if (!response.ok || !result.scene) {
        throw new Error(result.error || 'Unable to save the scene.');
      }
      const savedScene = result.scene;
      setSavedScenes(previous => [savedScene, ...previous.filter(sc => sc.id !== savedScene.id)]);
      setActiveSavedSceneId(savedScene.id);
      setActiveSavedScenePublished(!!savedScene.isPublished);

      const currentParams = new URLSearchParams(window.location.search);
      currentParams.set('sceneId', savedScene.id);
      router.replace(`${pathname}?${currentParams.toString()}`);

      toast.success('Scene and hosted video saved to your cloud library');
      setIsSaveSceneOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save the scene.';
      toast.error(message);
    } finally {
      setIsSavingScene(false);
      setSceneSaveStatus(null);
    }
  };

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
      setIsSceneLibraryOpen(false);
      setPendingProjectImport({
        fileName: `${result.scene.name} (cloud scene)`,
        project: result.scene.project,
        savedSceneId: scene.id,
        isPublished: !!result.scene.isPublished,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load the saved scene.';
      toast.error(message);
    } finally {
      setLoadingSavedSceneId(null);
    }
  };

  const handleTogglePublish = async () => {
    if (!activeSavedSceneId || currentUser?.role !== 'admin') return;

    const newPublishStatus = !activeSavedScenePublished;
    toast.loading(newPublishStatus ? 'Publishing scene...' : 'Unpublishing scene...', { id: 'publish-scene' });
    try {
      const response = await fetch(`/api/scenes/${activeSavedSceneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished: newPublishStatus }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update scene publication status.');
      }
      setActiveSavedScenePublished(newPublishStatus);
      toast.success(newPublishStatus ? 'Scene published successfully! It is now public.' : 'Scene unpublished.', { id: 'publish-scene' });
    } catch (err: any) {
      console.error('Error toggling publish:', err);
      toast.error(err.message || 'Failed to update publication status.', { id: 'publish-scene' });
    } finally {
      setIsFileMenuOpen(false);
    }
  };


  const confirmSavedSceneDelete = (scene: SavedSceneSummary) => {
    if (!currentUser || currentUser.role === 'viewer') {
      toast.error('You are in read-only viewer mode. Log in as an editor or admin to delete scenes.');
      return;
    }
    setIsSceneLibraryOpen(false);
    setPendingSavedSceneDelete(scene);
  };

  const handleDeleteSavedScene = async () => {
    if (!pendingSavedSceneDelete || deletingSavedSceneId) return;

    const scene = pendingSavedSceneDelete;
    setDeletingSavedSceneId(scene.id);
    try {
      const response = await fetch(`/api/scenes/${scene.id}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({})) as { deletedVideoCount?: number; error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Unable to delete the saved scene.');
      }

      setSavedScenes(previous => previous.filter(savedScene => savedScene.id !== scene.id));
      setActiveSavedSceneId(previous => previous === scene.id ? null : previous);
      setPendingSavedSceneDelete(null);
      setIsSceneLibraryOpen(true);
      toast.success(result.deletedVideoCount
        ? 'Saved analysis and hosted video deleted'
        : 'Saved analysis deleted');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete the saved scene.';
      toast.error(message);
    } finally {
      setDeletingSavedSceneId(null);
    }
  };

  const appendPendingProjectImport = () => {
    if (!pendingProjectImport) return;
    importProjectIntoCurrent(pendingProjectImport.project);
  };

  return {
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
    appendPendingProjectImport,
    isFileMenuOpen,
    setIsFileMenuOpen,
    uploadSceneThumbnail,
    getVideoBlobForClip,
  };
}
