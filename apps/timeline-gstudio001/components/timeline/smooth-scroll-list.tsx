"use client";

import type React from "react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import {
  DEFAULT_PIXELS_PER_SECOND,
  ITEM_HEIGHTS,
  MIN_WIDTH,
  TIMELINE_ITEM_TOP,
  TIMELINE_LEADING_PADDING_SECONDS,
  type ItemSize,
  VIDEO_SOURCES,
} from "./constants";
import { useTimelineClipState } from "./hooks/use-timeline-clip-state";
import { useTimelineInteractions } from "./hooks/use-timeline-interactions";
import { useTimelineLayout } from "./hooks/use-timeline-layout";
import { useTimelineMediaDuration } from "./hooks/use-timeline-media-duration";
import { useTimelineOverhang } from "./hooks/use-timeline-overhang";
import { useTimelineScrollState } from "./hooks/use-timeline-scroll-state";
import { useTimelineZoom } from "./hooks/use-timeline-zoom";
import { TimelineOverhangHint } from "./timeline-overhang-hint";
import { TimelineToolbar } from "./timeline-toolbar";
import {
  getTimelineGridContentHeight,
  getTimelineGridMetrics,
} from "./timeline-grid";
import { TimelineViewport } from "./timeline-viewport";
import {
  appendTimelineViewStateToHref,
  type TimelineViewState,
} from "./timeline-view-state";
import { Folder } from "lucide-react";
import { startTimelineFadeNavigation } from "./timeline-route-fade";
import type { TimelineClip, TimelineDocument } from "./types";
import { reindexAndPackClips } from "./hooks/use-timeline-clips";
import {
  getTimelineDocument,
  addClipToCollection,
  createCollectionTimelineDocument,
  registerTimelineDocument,
  syncParentCollections,
} from "@/lib/timeline-documents";
import { uploadTimelineMedia } from "@/lib/timeline-media-client";

export interface SmoothScrollListProps
  extends React.HTMLAttributes<HTMLDivElement> {
  collectionHrefPrefix?: string;
  initialClips?: TimelineClip[];
  initialViewState?: Partial<TimelineViewState & { hierarchyMode?: boolean }>;
  itemCount?: number;
  onOpenCollection?: (timelineId: string) => void;
  timelineId?: string;
  timelineTitle?: string;
  viewportWidth?: number | string;
  width?: number | string;
  pixelsPerSecond?: number;
  syncMediaDuration?: boolean;
  isChildTimeline?: boolean;
  hierarchyMode?: boolean;
  disablePersistence?: boolean;
}

export function SmoothScrollList({
  collectionHrefPrefix = "/timeline",
  initialClips,
  initialViewState,
  itemCount = 1000,
  onOpenCollection,
  timelineId,
  timelineTitle,
  viewportWidth,
  width: _deprecatedWidth,
  pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND,
  syncMediaDuration = true,
  isChildTimeline = false,
  hierarchyMode: propHierarchyMode,
  disablePersistence = false,
  className,
  style,
  ...props
}: SmoothScrollListProps) {
  const router = useRouter();
  const parentRef = useRef<HTMLDivElement>(null);
  const safeItemCount = initialClips
    ? initialClips.length
    : Math.max(0, Math.floor(itemCount));
  const resolvedViewportWidth = viewportWidth ?? "100%";
  const initialScrollLeft = TIMELINE_LEADING_PADDING_SECONDS * 100;
  const timelineResetKey = useMemo(
    () =>
      initialClips
        ? (timelineId ?? initialClips.map((clip) => clip.id).join("|"))
        : `generated:${safeItemCount}`,
    [initialClips, safeItemCount, timelineId],
  );

  const [thumbnailMode, setThumbnailMode] = useState(
    initialViewState?.thumbnailMode ?? false,
  );
  const [hierarchyMode, setHierarchyMode] = useState(
    initialViewState?.hierarchyMode ?? propHierarchyMode ?? false,
  );
  const [childCollectionsExpanded, setChildCollectionsExpanded] = useState(false);
  const [persistedTimelineTitle, setPersistedTimelineTitle] = useState(timelineTitle);
  const [mediaUploadError, setMediaUploadError] = useState<string | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const saveBaselineRef = useRef<string | null>(null);
  const hydratedTimelineIdRef = useRef<string | null>(null);
  const latestClipsRef = useRef<TimelineClip[]>([]);
  const localEditVersionRef = useRef(0);

  const [prevPropHierarchyMode, setPrevPropHierarchyMode] = useState(propHierarchyMode);
  if (propHierarchyMode !== prevPropHierarchyMode) {
    setPrevPropHierarchyMode(propHierarchyMode);
    if (propHierarchyMode !== undefined) {
      setHierarchyMode(propHierarchyMode);
    }
  }

  useEffect(() => {
    setPersistedTimelineTitle(timelineTitle);
  }, [timelineTitle]);

  const [gridMode, setGridMode] = useState(
    initialViewState?.gridMode ?? false,
  );
  const [itemSize, setItemSize] = useState<ItemSize>(
    initialViewState?.itemSize ?? "md",
  );
  const [manualOverhangScroll, setManualOverhangScroll] = useState(
    initialViewState?.manualOverhangScroll ?? true,
  );
  const [showPlayBarArea, setShowPlayBarArea] = useState(
    initialViewState?.showPlayBarArea ?? true,
  );
  const [showPassiveFilmstrips, setShowPassiveFilmstrips] = useState(
    initialViewState?.showPassiveFilmstrips ?? false,
  );

  const itemTop = showPlayBarArea ? TIMELINE_ITEM_TOP : 0;
  const itemHeight = ITEM_HEIGHTS[itemSize];
  const thumbnailWidth = (itemHeight * 16) / 9;

  const scrollState = useTimelineScrollState({
    initialScrollLeft,
    parentRef,
  });

  const gridModeEnabled = thumbnailMode && gridMode;
  const gridMetrics = useMemo(
    () =>
      getTimelineGridMetrics({
        enabled: gridModeEnabled,
        fallbackItemWidth: thumbnailWidth,
        itemHeight,
        itemTop,
        itemCount: safeItemCount,
        viewportWidth: scrollState.viewportClientWidth,
      }),
    [
      gridModeEnabled,
      itemHeight,
      itemTop,
      safeItemCount,
      scrollState.viewportClientWidth,
      thumbnailWidth,
    ],
  );
  const effectiveThumbnailWidth = gridModeEnabled
    ? gridMetrics.itemWidth
    : thumbnailWidth;
  const timelineHeight = gridModeEnabled
    ? getTimelineGridContentHeight(gridMetrics, itemTop)
    : itemHeight + itemTop;

  const clipState = useTimelineClipState({
    initialClips,
    itemCount: safeItemCount,
    parentRef,
    pendingScrollLeftRef: scrollState.pendingScrollLeftRef,
    resetKey: timelineResetKey,
    setScrollLeft: scrollState.setScrollLeft,
  });

  useEffect(() => {
    latestClipsRef.current = clipState.clips;
  }, [clipState.clips]);

  const markLocalEdit = useCallback(() => {
    localEditVersionRef.current += 1;
  }, []);

  const applyLocalClipsNow = useCallback(
    (nextClips: TimelineClip[]) => {
      markLocalEdit();
      latestClipsRef.current = nextClips;
      clipState.applyClipsNow(nextClips);
    },
    [clipState.applyClipsNow, markLocalEdit],
  );

  useEffect(() => {
    if (disablePersistence) return;
    if (!timelineId) return;

    let isCurrent = true;
    const loadStartedAtLocalEditVersion = localEditVersionRef.current;

    const loadTimelineDocument = async () => {
      try {
        const response = await fetch(`/api/timelines/${encodeURIComponent(timelineId)}`, {
          cache: "no-store",
        });
        if (!response.ok) return;

        const result = (await response.json().catch(() => ({}))) as {
          document?: TimelineDocument;
        };
        if (!isCurrent || !result.document || result.document.id !== timelineId) return;

        setPersistedTimelineTitle(result.document.title);
        saveBaselineRef.current = JSON.stringify({
          id: result.document.id,
          title: result.document.title,
          description: result.document.description,
          clips: result.document.clips,
        });
        hydratedTimelineIdRef.current = timelineId;

        if (localEditVersionRef.current !== loadStartedAtLocalEditVersion) {
          registerTimelineDocument({
            ...result.document,
            clips: latestClipsRef.current,
          });
          return;
        }

        registerTimelineDocument(result.document);
        clipState.applyClipsNow(result.document.clips);
        saveBaselineRef.current = JSON.stringify({
          id: result.document.id,
          title: result.document.title,
          description: result.document.description,
          clips: result.document.clips,
        });
        hydratedTimelineIdRef.current = timelineId;
      } catch (error) {
        console.warn(`Failed to load timeline "${timelineId}" from Firebase`, error);
      }
    };

    void loadTimelineDocument();

    return () => {
      isCurrent = false;
    };
  }, [clipState.applyClipsNow, disablePersistence, timelineId]);

  const selectedClip = useMemo(() => {
    if (clipState.selectedIndex === null) return null;
    return (
      clipState.clips.find(
        (clip) => clip.index === clipState.selectedIndex,
      ) ?? null
    );
  }, [clipState.clips, clipState.selectedIndex]);
  const selectedVideoClip =
    selectedClip?.kind === "video" || selectedClip?.kind === "collection" || selectedClip?.kind === "image" ? selectedClip : null;

  const childCollections = useMemo(() => {
    if (!hierarchyMode || !thumbnailMode) return [];
    return clipState.clips.filter((c) => c.kind === "collection");
  }, [clipState.clips, hierarchyMode, thumbnailMode]);

  const handleOpenCollection = useCallback(
    (nextTimelineId: string, href: string) => {
      if (onOpenCollection) {
        onOpenCollection(nextTimelineId);
        return;
      }

      startTimelineFadeNavigation({
        navigate: () => router.push(href),
      });
    },
    [onOpenCollection, router],
  );

  const handleThumbnailModeChange = useCallback((enabled: boolean) => {
    setThumbnailMode(enabled);
    if (!enabled) {
      setGridMode(false);
    }
  }, []);

  const zoom = useTimelineZoom({
    clips: clipState.clips,
    initialZoom: initialViewState?.zoom ?? pixelsPerSecond,
    parentRef,
    prevScrollLeftRef: scrollState.prevScrollLeftRef,
    selectedIndex: clipState.selectedIndex,
    setScrollLeft: scrollState.setScrollLeft,
    thumbnailMode,
    thumbnailWidth: effectiveThumbnailWidth,
  });

  const getCollectionHref = useCallback(
    (nextTimelineId: string) => {
      const basePath = collectionHrefPrefix.replace(/\/$/, "");
      const href = `${basePath}/${encodeURIComponent(nextTimelineId)}`;

      return appendTimelineViewStateToHref(href, {
        thumbnailMode,
        gridMode,
        itemSize,
        manualOverhangScroll,
        showPlayBarArea,
        showPassiveFilmstrips,
        zoom: zoom.zoomLevel,
      });
    },
    [
      collectionHrefPrefix,
      gridMode,
      itemSize,
      manualOverhangScroll,
      showPlayBarArea,
      showPassiveFilmstrips,
      thumbnailMode,
      zoom.zoomLevel,
    ],
  );

  const minDuration = MIN_WIDTH / zoom.safePixelsPerSecond;
  const handleClipDurationLoad = useTimelineMediaDuration({
    itemHeight,
    pixelsPerSecond: zoom.safePixelsPerSecond,
    setClips: clipState.setClips,
  });

  const handleDropFiles = useCallback(
    async (insertIndex: number, files: File[]) => {
      setMediaUploadError(null);
      setIsUploadingMedia(true);
      setUploadProgress(10);

      // Start a smooth fake progress incrementer
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) return prev;
          return prev + Math.random() * 5;
        });
      }, 300);

      try {
        const getMediaDuration = (file: File): Promise<number> => {
          return new Promise((resolve) => {
            if (file.type.startsWith("video/")) {
              const video = document.createElement("video");
              video.preload = "metadata";
              const sourceUrl = URL.createObjectURL(file);
              const cleanup = () => {
                URL.revokeObjectURL(sourceUrl);
                video.removeAttribute("src");
                video.load();
              };
              video.onloadedmetadata = () => {
                const duration =
                  Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 5;
                cleanup();
                resolve(duration);
              };
              video.onerror = () => {
                cleanup();
                resolve(5); // fallback
              };
              video.src = sourceUrl;
            } else {
              resolve(4); // default duration for images
            }
          });
        };

        const newClipResults: Array<{ clip: TimelineClip | null; error?: string }> =
          await Promise.all(files.map(async (file, idx) => {
          const isVideo = file.type.startsWith("video/");
          const isImage = file.type.startsWith("image/");
          if (!isVideo && !isImage) return { clip: null };

          const duration = await getMediaDuration(file);
          const uniqueId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          let hostedMedia: Awaited<ReturnType<typeof uploadTimelineMedia>>;

          try {
            hostedMedia = await uploadTimelineMedia(file.name, file);
          } catch (error) {
            console.warn(`Failed to upload "${file.name}" to hosted media storage`, error);
            return {
              clip: null,
              error: `"${file.name}" was not added because it could not be uploaded to hosted media storage.`,
            };
          }

          if (isVideo && !hostedMedia.thumbnailUrl) {
            return {
              clip: null,
              error: `"${file.name}" was not added because a video thumbnail could not be saved.`,
            };
          }

          if (isVideo) {
            const clipDuration = Math.min(12, duration);
            return {
              clip: {
                id: uniqueId,
                index: insertIndex + idx,
                kind: "video",
                src: hostedMedia.url,
                poster: hostedMedia.thumbnailUrl,
                alt: file.name,
                aspect: 16 / 9,
                trackIndex: 0,
                startTime: 0,
                duration: clipDuration,
                sourceDuration: duration,
                trimIn: 0,
                trimOut: Math.max(0, duration - clipDuration),
              } as TimelineClip,
            };
          } else {
            return {
              clip: {
                id: uniqueId,
                index: insertIndex + idx,
                kind: "image",
                src: hostedMedia.url,
                alt: file.name,
                aspect: 16 / 9,
                trackIndex: 0,
                startTime: 0,
                duration: 4,
                sourceDuration: 4,
                trimIn: 0,
                trimOut: 0,
              } as TimelineClip,
            };
          }
        }));

        const firstUploadError = newClipResults.find((result) => result.error)?.error;
        if (firstUploadError) {
          setMediaUploadError(firstUploadError);
        }

        const newClips = newClipResults
          .map((result) => result.clip)
          .filter(
            (clip): clip is TimelineClip => clip !== null
          );

        if (newClips.length === 0) return;

        const nextClips = [...clipState.clips];
        nextClips.splice(insertIndex, 0, ...newClips);

        const packedClips = reindexAndPackClips(nextClips);
        applyLocalClipsNow(packedClips);
      } finally {
        clearInterval(progressInterval);
        setUploadProgress(100);
        setTimeout(() => {
          setIsUploadingMedia(false);
          setUploadProgress(0);
        }, 500);
      }
    },
    [applyLocalClipsNow, clipState],
  );

  const handleDropClip = useCallback(
    (insertIndex: number, clip: TimelineClip, sourceTimelineId: string) => {
      const thisTimelineId = timelineId || "";

      if (sourceTimelineId === thisTimelineId) {
        // Reordering within the same timeline
        const sourceIndex = clipState.clips.findIndex((c) => c.id === clip.id);
        if (sourceIndex === -1) return;

        const nextClips = [...clipState.clips];
        const [removed] = nextClips.splice(sourceIndex, 1);

        // Adjust target index if inserting after the source position
        let targetIndex = insertIndex;
        if (sourceIndex < insertIndex) {
          targetIndex = insertIndex - 1;
        }

        nextClips.splice(targetIndex, 0, removed);
        const packed = reindexAndPackClips(nextClips);

        // Update document registry synchronously to avoid race conditions
        const doc = getTimelineDocument(thisTimelineId);
        if (doc) {
          doc.clips = packed;
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("gstudio-timeline-update", {
                detail: { timelineId: thisTimelineId },
              })
            );
          }
          syncParentCollections(thisTimelineId, packed);
        }

        applyLocalClipsNow(packed);
      } else {
        // Dragged from another timeline to this timeline
        // 1. Insert clip locally
        const isAssetLibrarySource = sourceTimelineId === "asset-library";
        const nextClips = [...clipState.clips];
        const newClip = {
          ...clip,
          id: isAssetLibrarySource
            ? `${clip.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            : clip.id,
          index: insertIndex,
        };

        nextClips.splice(insertIndex, 0, newClip);
        const packed = reindexAndPackClips(nextClips);

        // Update document registry synchronously to avoid race conditions
        const doc = getTimelineDocument(thisTimelineId);
        if (doc) {
          doc.clips = packed;
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("gstudio-timeline-update", {
                detail: { timelineId: thisTimelineId },
              })
            );
          }
          syncParentCollections(thisTimelineId, packed);
        }

        applyLocalClipsNow(packed);

        // 2. Notify the source timeline to remove it. Assets are copied, not moved.
        if (!isAssetLibrarySource) {
          window.dispatchEvent(
            new CustomEvent("timeline-clip-moved", {
              detail: {
                clipId: clip.id,
                sourceTimelineId,
                targetTimelineId: thisTimelineId,
              },
            })
          );
        }
      }
    },
    [applyLocalClipsNow, clipState, timelineId],
  );

  const handleDropSidebarClip = useCallback(
    (insertIndex: number, type: "collection" | "image" | "video") => {
      const uniqueId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      let newClip: TimelineClip;

      if (type === "collection") {
        const childId = `timeline-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        createCollectionTimelineDocument(childId, "New Collection");
        newClip = {
          id: uniqueId,
          index: insertIndex,
          kind: "collection",
          title: "New Collection",
          childTimelineId: childId,
          itemCount: 0,
          duration: 3,
          sourceDuration: 3,
          trimIn: 0,
          trimOut: 0,
          alt: "New Collection",
          aspect: 16 / 9,
          trackIndex: 0,
          startTime: 0,
        };
      } else if (type === "image") {
        newClip = {
          id: uniqueId,
          index: insertIndex,
          kind: "image",
          src: `https://picsum.photos/seed/${uniqueId}/360/200`,
          alt: "New Image",
          aspect: 16 / 9,
          trackIndex: 0,
          startTime: 0,
          duration: 4,
          sourceDuration: 4,
          trimIn: 0,
          trimOut: 0,
        };
      } else {
        // video
        newClip = {
          id: uniqueId,
          index: insertIndex,
          kind: "video",
          src: VIDEO_SOURCES[0],
          alt: "New Video",
          aspect: 16 / 9,
          trackIndex: 0,
          startTime: 0,
          duration: 5,
          sourceDuration: 12,
          trimIn: 0,
          trimOut: 7,
        };
      }

      const nextClips = [...clipState.clips];
      nextClips.splice(insertIndex, 0, newClip);

      const packedClips = reindexAndPackClips(nextClips);
      const thisTimelineId = timelineId || "";
      const doc = getTimelineDocument(thisTimelineId);
      if (doc) {
        doc.clips = packedClips;
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("gstudio-timeline-update", {
              detail: { timelineId: thisTimelineId },
            })
          );
        }
        syncParentCollections(thisTimelineId, packedClips);
      }
      applyLocalClipsNow(packedClips);
    },
    [applyLocalClipsNow, clipState, timelineId],
  );

  const handleDropClipIntoCollection = useCallback(
    (clip: TimelineClip, targetCollectionTimelineId: string, sourceTimelineId: string) => {
      const isAssetLibrarySource = sourceTimelineId === "asset-library";
      addClipToCollection(
        targetCollectionTimelineId,
        isAssetLibrarySource
          ? {
              ...clip,
              id: `${clip.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            }
          : clip,
      );

      // Notify source timeline to remove it. Assets are copied, not moved.
      if (!isAssetLibrarySource) {
        window.dispatchEvent(
          new CustomEvent("gstudio-clip-remove", {
            detail: { clipId: clip.id, timelineId: sourceTimelineId },
          })
        );
      }
    },
    []
  );

  const handleDropSidebarClipIntoCollection = useCallback(
    (type: "collection" | "image" | "video", targetCollectionTimelineId: string) => {
      const uniqueId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      let newClip: any = {
        id: uniqueId,
        kind: type,
        aspect: 16 / 9,
        trackIndex: 0,
        startTime: 0,
        duration: type === "collection" ? 3 : type === "image" ? 4 : 5,
        sourceDuration: type === "collection" ? 3 : type === "image" ? 4 : 12,
        trimIn: 0,
        trimOut: type === "collection" ? 0 : type === "image" ? 0 : 7,
      };

      if (type === "collection") {
        const childId = `timeline-${Date.now()}`;
        createCollectionTimelineDocument(childId, "Nested Collection");
        newClip = {
          ...newClip,
          title: "Nested Collection",
          alt: "Nested Collection",
          childTimelineId: childId,
          itemCount: 0,
          previewItems: [],
        };
      } else if (type === "image") {
        newClip.title = "New Image";
        newClip.alt = "New Image";
        newClip.src = `https://picsum.photos/seed/${uniqueId}/360/200`;
      } else {
        newClip.title = "New Video";
        newClip.alt = "New Video";
        newClip.src = VIDEO_SOURCES[0];
      }

      addClipToCollection(targetCollectionTimelineId, newClip);
    },
    []
  );

  useEffect(() => {
    if (disablePersistence) return;
    const thisTimelineId = timelineId || "";
    if (thisTimelineId) {
      const doc = getTimelineDocument(thisTimelineId);
      if (doc) {
        doc.clips = clipState.clips;
      }
    }
  }, [clipState.clips, timelineId]);

  useEffect(() => {
    const thisTimelineId = timelineId || "";
    if (!thisTimelineId || hydratedTimelineIdRef.current !== thisTimelineId) return;

    const doc = getTimelineDocument(thisTimelineId);
    const documentSnapshot: TimelineDocument = {
      id: thisTimelineId,
      title: persistedTimelineTitle || timelineTitle || thisTimelineId,
      description: doc?.description,
      clips: clipState.clips,
    };
    const serialized = JSON.stringify(documentSnapshot);
    if (serialized === saveBaselineRef.current) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/timelines/${encodeURIComponent(thisTimelineId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document: documentSnapshot }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        saveBaselineRef.current = serialized;
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn(`Failed to autosave timeline "${thisTimelineId}" to Firebase`, error);
        }
      }
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [clipState.clips, disablePersistence, persistedTimelineTitle, timelineId, timelineTitle]);

  useEffect(() => {
    const handleTimelineUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<{ timelineId: string }>;
      if (customEvent.detail.timelineId === timelineId) {
        const doc = getTimelineDocument(timelineId);
        if (doc) {
          clipState.applyClipsNow(doc.clips);
        }
      }
    };

    const handleClipRemove = (e: Event) => {
      const customEvent = e as CustomEvent<{ clipId: string; timelineId: string }>;
      const thisTimelineId = timelineId || "";
      if (customEvent.detail.timelineId === thisTimelineId) {
        const doc = getTimelineDocument(thisTimelineId);
        if (doc) {
          const nextClips = doc.clips.filter((c) => c.id !== customEvent.detail.clipId);
          const packed = reindexAndPackClips(nextClips);
          
          doc.clips = packed;
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("gstudio-timeline-update", {
                detail: { timelineId: thisTimelineId },
              })
            );
          }
          syncParentCollections(thisTimelineId, packed);
          applyLocalClipsNow(packed);
        }
      }
    };

    const handleClipMoved = (e: Event) => {
      const customEvent = e as CustomEvent<{
        clipId: string;
        sourceTimelineId: string;
        targetTimelineId: string;
      }>;
      const { clipId, sourceTimelineId, targetTimelineId } = customEvent.detail;
      const thisTimelineId = timelineId || "";

      if (sourceTimelineId === thisTimelineId && targetTimelineId !== thisTimelineId) {
        const doc = getTimelineDocument(thisTimelineId);
        if (doc) {
          const nextClips = doc.clips.filter((c) => c.id !== clipId);
          const packed = reindexAndPackClips(nextClips);
          
          doc.clips = packed;
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("gstudio-timeline-update", {
                detail: { timelineId: thisTimelineId },
              })
            );
          }
          syncParentCollections(thisTimelineId, packed);
          applyLocalClipsNow(packed);
        }
      }
    };

    window.addEventListener("gstudio-timeline-update", handleTimelineUpdate);
    window.addEventListener("gstudio-clip-remove", handleClipRemove);
    window.addEventListener("timeline-clip-moved", handleClipMoved);
    return () => {
      window.removeEventListener("gstudio-timeline-update", handleTimelineUpdate);
      window.removeEventListener("gstudio-clip-remove", handleClipRemove);
      window.removeEventListener("timeline-clip-moved", handleClipMoved);
    };
  }, [applyLocalClipsNow, clipState, timelineId]);


  const interactions = useTimelineInteractions({
    parentRef,
    clips: clipState.clips,
    safePixelsPerSecond: zoom.safePixelsPerSecond,
    minDuration,
    thumbnailMode,
    thumbnailWidth: effectiveThumbnailWidth,
    gridMetrics,
    itemTop,
    setScrollLeft: scrollState.setScrollLeft,
    setSelectedIndex: clipState.setSelectedIndex,
    setScrubPreview: clipState.setScrubPreview,
    scheduleClips: clipState.scheduleClips,
    applyClipsNow: clipState.applyClipsNow,
    pendingScrollLeftRef: scrollState.pendingScrollLeftRef,
    timelineId,
  });

  const overhang = useTimelineOverhang({
    activeFilmStripEdit: interactions.activeFilmStripEdit,
    activeResize: interactions.activeResize,
    clipsLength: clipState.clips.length,
    isFilmStripEditing: interactions.isFilmStripEditing,
    isResizing: interactions.isResizing,
    isUnfreezing: interactions.isUnfreezing,
    manualOverhangScroll,
    parentRef,
    pixelsPerSecond: zoom.safePixelsPerSecond,
    prevScrollLeftRef: scrollState.prevScrollLeftRef,
    scrollLeft: scrollState.scrollLeft,
    selectedVideoClip: showPlayBarArea ? selectedVideoClip : null,
    setScrollLeft: scrollState.setScrollLeft,
    thumbnailMode,
    thumbnailWidth: effectiveThumbnailWidth,
  });

  const layout = useTimelineLayout({
    clips: clipState.clips,
    closingOverhangOffset: overhang.closingOverhangOffset,
    firstOverhang: overhang.firstOverhang,
    isResizing: interactions.isResizing,
    lastOverhang: overhang.lastOverhang,
    pixelsPerSecond: zoom.safePixelsPerSecond,
    scrollLeft: scrollState.scrollLeft,
    scrollTop: gridModeEnabled ? scrollState.pageScrollTop : scrollState.scrollTop,
    gridMetrics,
    itemTop,
    thumbnailMode,
    thumbnailWidth: effectiveThumbnailWidth,
    viewportClientHeight: gridModeEnabled
      ? scrollState.pageViewportHeight
      : scrollState.viewportClientHeight,
    viewportClientWidth: scrollState.viewportClientWidth,
  });

  useEffect(() => {
    const currentInteractions = interactions;
    return () => {
      currentInteractions.stopInertia();
      currentInteractions.cleanupWindowDragListeners();
      scrollState.cleanupScrollFrame();
      clipState.cleanupClipFrames();
    };
    // These callbacks are stable; cleanup should only register once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div
        {...props}
        data-testid="timeline-editor"
        data-timeline-id={timelineId ?? ""}
        data-timeline-title={timelineTitle ?? ""}
        data-selected-index={clipState.selectedIndex ?? ""}
        data-zoom={zoom.safePixelsPerSecond}
        data-thumbnail-mode={thumbnailMode}
        data-grid-mode={gridModeEnabled}
        data-grid-columns={gridMetrics.columnsPerPage}
        data-grid-rows={gridMetrics.rowsPerPage}
        data-playbar-area={showPlayBarArea}
        data-passive-filmstrips={showPassiveFilmstrips}
        data-item-count={clipState.clips.length}
        data-first-overhang={overhang.firstOverhang}
        data-last-overhang={overhang.lastOverhang}
        data-reordering={interactions.isReordering}
        data-reorder-target-index={interactions.reorderPreview?.targetIndex ?? ""}
        data-timeline-width={layout.timelineWidth}
        data-viewport-width={scrollState.viewportClientWidth}
        data-scroll-top={
          gridModeEnabled ? scrollState.pageScrollTop : scrollState.scrollTop
        }
        data-viewport-height={
          gridModeEnabled
            ? scrollState.pageViewportHeight
            : scrollState.viewportClientHeight
        }
        data-timeline-height={timelineHeight}
        data-max-scroll={Math.max(
          0,
          layout.timelineWidth - scrollState.viewportClientWidth,
        )}
        data-max-scroll-top={Math.max(
          0,
          timelineHeight -
            (gridModeEnabled
              ? scrollState.pageViewportHeight
              : scrollState.viewportClientHeight),
        )}
        className={cn(
          "box-border grid w-full max-w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 font-sans shadow-2xl",
          className,
        )}
        style={{
          width: "100%",
          maxWidth: "min(100%, calc(100vw - 2rem))",
          minWidth: 0,
          boxSizing: "border-box",
          ...style,
        }}
      >
        <TimelineToolbar
          itemSize={itemSize}
          manualOverhangScroll={manualOverhangScroll}
          showPlayBarArea={showPlayBarArea}
          showPassiveFilmstrips={showPassiveFilmstrips}
          title={persistedTimelineTitle}
          gridMode={gridModeEnabled}
          onItemSizeChange={setItemSize}
          onGridModeChange={setGridMode}
          onManualOverhangScrollChange={setManualOverhangScroll}
          onPlayBarAreaChange={setShowPlayBarArea}
          onPassiveFilmstripsChange={setShowPassiveFilmstrips}
          onThumbnailModeChange={handleThumbnailModeChange}
          onZoomChange={zoom.handleZoomChange}
          thumbnailMode={thumbnailMode}
          zoomLevel={zoom.zoomLevel}
          timelineId={timelineId}
          hierarchyMode={hierarchyMode}
          onHierarchyModeChange={setHierarchyMode}
          hasChildCollections={childCollections.length > 0}
          childCollectionsExpanded={childCollectionsExpanded}
          onToggleChildCollections={() => setChildCollectionsExpanded(!childCollectionsExpanded)}
        />

        {mediaUploadError && (
          <div
            role="status"
            className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
          >
            {mediaUploadError}
          </div>
        )}

        {isUploadingMedia && (
          <div className="flex flex-col gap-2 rounded-lg border border-sky-500/35 bg-sky-950/20 px-4 py-3 shadow-lg select-none">
            <div className="flex items-center justify-between text-xs font-medium text-sky-200">
              <div className="flex items-center gap-2">
                <svg className="animate-spin h-3.5 w-3.5 text-sky-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Uploading media to timeline...</span>
              </div>
              <span className="font-semibold">{Math.round(uploadProgress)}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-sky-500 transition-all duration-300 ease-out shadow-[0_0_8px_rgba(56,189,248,0.6)]"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className="relative w-full max-w-full min-w-0">
          <TimelineViewport
            closingOverhangOffset={overhang.closingOverhangOffset}
            firstOverhang={overhang.firstOverhang}
            handleClipDurationLoad={
              syncMediaDuration ? handleClipDurationLoad : undefined
            }
            handleScroll={scrollState.handleScroll}
            hasClips={clipState.clips.length > 0}
            interactions={interactions}
            isClosingOverhang={overhang.isClosingOverhang}
            isResizingFirstClipLeft={overhang.isResizingFirstClipLeft}
            isZooming={zoom.isZooming}
            itemHeight={itemHeight}
            itemTop={itemTop}
            manualOverhangScroll={manualOverhangScroll}
            getCollectionHref={getCollectionHref}
            onOpenCollection={handleOpenCollection}
            parentRef={parentRef}
            pixelsPerSecond={zoom.safePixelsPerSecond}
            prevFirstOverhang={overhang.prevFirstOverhangRef.current}
            resolvedViewportWidth={resolvedViewportWidth}
            scrubPreview={clipState.scrubPreview}
            scrollLeft={scrollState.scrollLeft}
            scrollTop={
              gridModeEnabled ? scrollState.pageScrollTop : scrollState.scrollTop
            }
            selectedIndex={clipState.selectedIndex}
            selectedVideoClip={showPlayBarArea ? selectedVideoClip : null}
            showPlayBarArea={showPlayBarArea}
            showPassiveFilmstrips={showPassiveFilmstrips}
            gridMetrics={gridMetrics}
            thumbnailMode={thumbnailMode}
            thumbnailWidth={effectiveThumbnailWidth}
            timelineHeight={timelineHeight}
            timelineWidth={layout.timelineWidth}
            visibleClips={layout.visibleClips}
            onDropFiles={handleDropFiles}
            onDropClip={handleDropClip}
            onDropSidebarClip={handleDropSidebarClip}
            onDropClipIntoCollection={handleDropClipIntoCollection}
            onDropSidebarClipIntoCollection={handleDropSidebarClipIntoCollection}
            timelineId={timelineId}
          />

          {overhang.hasOffscreenOverhang && (
            <TimelineOverhangHint onClick={overhang.scrollToOverhang} />
          )}
        </div>
      </div>

      {childCollections.length > 0 && childCollectionsExpanded && (
        <div className="flex flex-col gap-5 pl-20 border-l border-zinc-800/80 mt-0 w-full max-w-full min-w-0">
          {childCollections.map((col) => {
            const doc = getTimelineDocument(col.childTimelineId);
            return (
              <SmoothScrollList
                key={`hierarchy-${col.childTimelineId}`}
                timelineId={col.childTimelineId}
                timelineTitle={col.title}
                initialClips={doc ? doc.clips : []}
                initialViewState={{
                  thumbnailMode: true,
                  itemSize: "sm",
                  gridMode: false,
                  showPlayBarArea: showPlayBarArea,
                  showPassiveFilmstrips: showPassiveFilmstrips,
                }}
                isChildTimeline={true}
                syncMediaDuration={syncMediaDuration}
                hierarchyMode={hierarchyMode}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
