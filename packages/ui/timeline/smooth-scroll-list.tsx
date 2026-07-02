"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../lib/utils";

import {
  DEFAULT_PIXELS_PER_SECOND,
  ITEM_HEIGHTS,
  MIN_WIDTH,
  TIMELINE_LEADING_PADDING_SECONDS,
  CLIP_GAP_SECONDS,
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
import type {
  CollectionEndpoint,
  CollectionTimelineClip,
  TimelineClip,
  TimelineDocument,
} from "./types";
import { reindexAndPackClips } from "./hooks/use-timeline-clips";
import {
  getTimelineDocument,
  addClipToCollection,
  createCollectionTimelineDocument,
  registerTimelineDocument,
  syncParentCollections,
  getTimelinePath,
  getFolderPathFromTimelineId,
  decodeFolderPath,
  encodeFolderPath,
  getCollectionClipSourceDuration,
  isUnsavedProjectPlaceholder,
} from "./timeline-documents";

export type TimelineMediaUploadResult = {
  url: string;
  thumbnailUrl?: string;
};

export type UploadTimelineMedia = (
  filename: string,
  file: File,
  folderPath?: string,
) => Promise<TimelineMediaUploadResult>;

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
  onHierarchyModeChange?: (enabled: boolean) => void;
  thumbnailMode?: boolean;
  playheadTime?: number | null;
  onPlayheadTimeChange?: (
    time: number,
    clips?: TimelineClip[],
    activeClipId?: string,
  ) => void;
  previewLargeSurface?: boolean;
  disablePersistence?: boolean;
  onTimelineIdChange?: (newTimelineId: string) => void;
  titleMeta?: React.ReactNode;
  toolbarActions?: React.ReactNode;
  navigate?: (href: string) => void;
  persistenceReady?: boolean;
  userId?: string | null;
  uploadTimelineMedia?: UploadTimelineMedia;
}

function getInlineExpansionKey(parentKey: string, clipId: string) {
  return parentKey ? `${parentKey}/${clipId}` : clipId;
}

function getCollectionEndpointKey(
  collectionKey: string,
  endpoint: CollectionEndpoint,
) {
  return `${collectionKey}::${endpoint}`;
}

function getCollectionEndpointClip(
  collectionClip: CollectionTimelineClip,
  endpoint: CollectionEndpoint,
) {
  const childDoc = getTimelineDocument(collectionClip.childTimelineId);
  const childClips = childDoc?.clips ?? [];
  if (childClips.length === 0) return null;
  return endpoint === "first" ? childClips[0] : childClips[childClips.length - 1];
}

function buildInlineCollectionView({
  clips,
  expandedKeys,
  endpointKeys,
  timelineId,
}: {
  clips: TimelineClip[];
  expandedKeys: ReadonlySet<string>;
  endpointKeys: ReadonlySet<string>;
  timelineId: string;
}) {
  const displayClips: TimelineClip[] = [];
  let nextIndex = 0;
  let nextStartTime = TIMELINE_LEADING_PADDING_SECONDS;

  const appendDisplayClip = (clip: TimelineClip) => {
    displayClips.push({
      ...clip,
      index: nextIndex,
      startTime: nextStartTime,
    });
    nextIndex += 1;
    nextStartTime += clip.duration + CLIP_GAP_SECONDS;
  };

  const appendClip = (
    clip: TimelineClip,
    sourceTimelineId: string,
    parentKey: string,
    depth: number,
    viewOptions?: {
      endpoint?: CollectionEndpoint;
      idPrefix?: string;
      role?: TimelineClip["viewRole"];
      collectionAccentIndex?: number;
    },
  ) => {
    const sourceClipId = clip.viewSourceClipId ?? clip.id;
    const expansionKey =
      clip.kind === "collection"
        ? getInlineExpansionKey(parentKey, sourceClipId)
        : undefined;
    const appendCollectionEndpoint = (endpoint: CollectionEndpoint) => {
      if (clip.kind !== "collection" || !expansionKey) return;

      const endpointKey = getCollectionEndpointKey(expansionKey, endpoint);
      if (!endpointKeys.has(endpointKey)) return;

      const endpointClip = getCollectionEndpointClip(clip, endpoint);
      if (!endpointClip) return;

      appendClip(
        endpointClip,
        clip.childTimelineId,
        endpointKey,
        depth + 1,
        {
          endpoint,
          idPrefix: `inline-endpoint:${endpointKey}`,
          role: "collection-endpoint",
          collectionAccentIndex: viewOptions?.collectionAccentIndex,
        },
      );
    };

    appendCollectionEndpoint("first");

    if (clip.kind === "collection" && expansionKey && expandedKeys.has(expansionKey)) {
      appendDisplayClip({
        ...clip,
        id: `inline-collapse:${expansionKey}`,
        viewDepth: depth,
        viewExpansionKey: expansionKey,
        viewRole: "collection-collapse",
        viewCollectionAccentIndex: viewOptions?.collectionAccentIndex,
        viewSourceClipId: sourceClipId,
        viewSourceTimelineId: sourceTimelineId,
      });

      const childDoc = getTimelineDocument(clip.childTimelineId);
      let childCollectionAccentIndex = 0;
      childDoc?.clips.forEach((childClip) => {
        const collectionAccentIndex =
          childClip.kind === "collection" ? childCollectionAccentIndex++ : undefined;

        appendClip(
          {
            ...childClip,
            id: `inline:${expansionKey}:${childClip.id}`,
            viewDepth: depth + 1,
            viewExpansionKey:
              childClip.kind === "collection"
                ? getInlineExpansionKey(expansionKey, childClip.id)
                : undefined,
            viewRole: "expanded-child",
            viewCollectionAccentIndex: collectionAccentIndex,
            viewSourceClipId: childClip.id,
            viewSourceTimelineId: clip.childTimelineId,
          },
          clip.childTimelineId,
          expansionKey,
          depth + 1,
          { collectionAccentIndex },
        );
      });
      appendCollectionEndpoint("last");
      return;
    }

    appendDisplayClip({
      ...clip,
      id: viewOptions?.idPrefix ? `${viewOptions.idPrefix}:${sourceClipId}` : clip.id,
      viewDepth: depth,
      viewExpansionKey: expansionKey,
      viewSourceClipId: sourceClipId,
      viewSourceTimelineId: sourceTimelineId,
      viewEndpoint: viewOptions?.endpoint,
      viewRole: viewOptions?.role ?? (parentKey ? "expanded-child" : undefined),
      viewCollectionAccentIndex: viewOptions?.collectionAccentIndex ?? clip.viewCollectionAccentIndex,
    });

    appendCollectionEndpoint("last");
  };

  let rootCollectionAccentIndex = 0;
  clips.forEach((clip) => {
    const collectionAccentIndex =
      clip.kind === "collection" ? rootCollectionAccentIndex++ : undefined;

    appendClip(
      {
        ...clip,
        viewCollectionAccentIndex: collectionAccentIndex,
      },
      timelineId,
      "",
      0,
      { collectionAccentIndex },
    );
  });
  return displayClips;
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
  onHierarchyModeChange,
  thumbnailMode: propThumbnailMode,
  playheadTime,
  onPlayheadTimeChange,
  previewLargeSurface = false,
  disablePersistence = false,
  className,
  style,
  onTimelineIdChange,
  titleMeta,
  toolbarActions,
  navigate,
  persistenceReady = true,
  userId,
  uploadTimelineMedia,
  ...props
}: SmoothScrollListProps) {
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

  const [thumbnailModeState] = useState(
    initialViewState?.thumbnailMode ?? false,
  );
  const thumbnailMode = propThumbnailMode ?? thumbnailModeState;
  const [hierarchyModeState, setHierarchyModeState] = useState(
    initialViewState?.hierarchyMode ?? propHierarchyMode ?? false,
  );
  const setHierarchyMode = useCallback((value: boolean) => {
    setHierarchyModeState(value);
    if (onHierarchyModeChange) {
      onHierarchyModeChange(value);
    }
  }, [onHierarchyModeChange]);
  const hierarchyMode = hierarchyModeState;
  const [childCollectionsExpanded, setChildCollectionsExpanded] = useState(false);
  const [expandedCollectionKeys, setExpandedCollectionKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [exposedCollectionEndpointKeys, setExposedCollectionEndpointKeys] =
    useState<Set<string>>(() => new Set());
  const [inlineViewVersion, setInlineViewVersion] = useState(0);
  const [persistedTimelineTitle, setPersistedTimelineTitle] = useState(timelineTitle);
  const [timelineLoadError, setTimelineLoadError] = useState<string | null>(null);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [mediaUploadError, setMediaUploadError] = useState<string | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const canPersistTimeline = !disablePersistence && persistenceReady;
  const saveBaselineRef = useRef<string | null>(null);
  const hydratedTimelineIdRef = useRef<string | null>(null);
  const latestClipsRef = useRef<TimelineClip[]>([]);
  const latestDisplayClipsRef = useRef<TimelineClip[]>([]);
  const localEditVersionRef = useRef(0);

  const [prevPropHierarchyMode, setPrevPropHierarchyMode] = useState(propHierarchyMode);
  if (propHierarchyMode !== prevPropHierarchyMode) {
    setPrevPropHierarchyMode(propHierarchyMode);
    if (propHierarchyMode !== undefined) {
      setHierarchyModeState(propHierarchyMode);
    }
  }

  const [prevTimelineTitle, setPrevTimelineTitle] = useState(timelineTitle);
  if (timelineTitle !== prevTimelineTitle) {
    setPrevTimelineTitle(timelineTitle);
    setPersistedTimelineTitle(timelineTitle);
  }

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setPersistedTimelineTitle(newTitle);
      const thisTimelineId = timelineId || "";
      const doc = getTimelineDocument(thisTimelineId);
      if (doc) {
        doc.title = newTitle;
        registerTimelineDocument(doc, { persist: !disablePersistence });
        syncParentCollections(thisTimelineId, doc.clips);
      }
    },
    [timelineId, disablePersistence],
  );

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
    initialViewState?.showPlayBarArea ?? false,
  );
  const [showPassiveFilmstrips, setShowPassiveFilmstrips] = useState(
    initialViewState?.showPassiveFilmstrips ?? false,
  );

  const itemTop = 0;
  const itemHeight = ITEM_HEIGHTS[itemSize];
  const thumbnailWidth = (itemHeight * 16) / 9;

  const scrollState = useTimelineScrollState({
    initialScrollLeft,
    parentRef,
  });

  const clipState = useTimelineClipState({
    initialClips,
    itemCount: safeItemCount,
    parentRef,
    pendingScrollLeftRef: scrollState.pendingScrollLeftRef,
    resetKey: timelineResetKey,
    setScrollLeft: scrollState.setScrollLeft,
  });
  const timelineItemCount = clipState.clips.length;

  const gridModeEnabled = thumbnailMode && gridMode;
  const gridMetrics = useMemo(
    () =>
      getTimelineGridMetrics({
        enabled: gridModeEnabled,
        fallbackItemWidth: thumbnailWidth,
        itemHeight,
        itemTop,
        itemCount: timelineItemCount,
        viewportWidth: scrollState.viewportClientWidth,
      }),
    [
      gridModeEnabled,
      itemHeight,
      itemTop,
      timelineItemCount,
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

  const moveClipToTrash = useCallback(async (clipToTrash: TimelineClip) => {
    if (!userId) return;

    // 1. Remove the clip from the current timeline
    const nextClips = clipState.clips.filter((c) => c.id !== clipToTrash.id);
    const packedClips = reindexAndPackClips(nextClips);
    clipState.applyClipsNow(packedClips);
    clipState.setSelectedIndex(null);

    // Save current timeline to DB
    const thisTimelineId = timelineId || "";
    const doc = getTimelineDocument(thisTimelineId);
    if (doc) {
      doc.clips = packedClips;
      registerTimelineDocument(doc, { persist: !disablePersistence });
      syncParentCollections(thisTimelineId, doc.clips);
    }

    // 2. Fetch the trash timeline, append the clip, and save it!
    const trashId = `trash-${userId}`;
    try {
      const response = await fetch(`/api/timelines/${encodeURIComponent(trashId)}`);
      let trashDoc: TimelineDocument;
      if (response.ok) {
        const res = await response.json();
        trashDoc = res.document || { id: trashId, title: "Trash Bin", clips: [] };
      } else {
        trashDoc = { id: trashId, title: "Trash Bin", clips: [] };
      }

      // Add the clip to trash document clips
      const nextIndex = trashDoc.clips.length;
      let nextStartTime = 1;
      if (trashDoc.clips.length > 0) {
        const lastClip = trashDoc.clips[trashDoc.clips.length - 1];
        nextStartTime = lastClip.startTime + lastClip.duration + 1;
      }

      const trashedClip = {
        ...clipToTrash,
        index: nextIndex,
        startTime: nextStartTime,
      };

      trashDoc.clips.push(trashedClip);

      // Save trash document to Firestore
      await fetch(`/api/timelines/${encodeURIComponent(trashId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: {
            id: trashId,
            title: trashDoc.title,
            description: trashDoc.description || "",
            clips: trashDoc.clips,
          },
        }),
      });

      // Show a toast message!
      window.dispatchEvent(
        new CustomEvent("gstudio-toast", {
          detail: { message: `Moved "${(clipToTrash as any).title || clipToTrash.alt || "Clip"}" to Trash` }
        })
      );
    } catch (err) {
      console.error("Failed to move clip to trash:", err);
    }
  }, [clipState, timelineId, disablePersistence, userId]);

  useEffect(() => {
    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return; // Ignore if user is typing in an input
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (clipState.selectedIndex !== null) {
          const selectedViewClip = latestDisplayClipsRef.current.find(
            (c) => c.index === clipState.selectedIndex,
          );
          if (
            selectedViewClip?.viewRole ||
            selectedViewClip?.viewSourceTimelineId !== (timelineId || "")
          ) {
            e.preventDefault();
            return;
          }

          const sourceClipId = selectedViewClip?.viewSourceClipId ?? selectedViewClip?.id;
          const selectedClip = clipState.clips.find(c => c.id === sourceClipId);
          if (selectedClip) {
            e.preventDefault();
            await moveClipToTrash(selectedClip);
          }
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [clipState.selectedIndex, moveClipToTrash, timelineId]);

  const lastSelectedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (clipState.selectedIndex === null) {
      lastSelectedIndexRef.current = null;
      return;
    }

    if (clipState.selectedIndex !== lastSelectedIndexRef.current) {
      lastSelectedIndexRef.current = clipState.selectedIndex;
      const selectedClip = latestDisplayClipsRef.current.find(
        (c) => c.index === clipState.selectedIndex,
      );
      if (selectedClip && onPlayheadTimeChange) {
        onPlayheadTimeChange(
          selectedClip.startTime,
          latestDisplayClipsRef.current,
        );
      }
    }
  }, [clipState.selectedIndex, onPlayheadTimeChange]);

  useEffect(() => {
    if (!canPersistTimeline) {
      setIsLoadingTimeline(false);
      return;
    }
    if (!timelineId) return;

    let isCurrent = true;
    const loadStartedAtLocalEditVersion = localEditVersionRef.current;

    const loadTimelineDocument = async () => {
      setIsLoadingTimeline(true);
      setTimelineLoadError(null);

      try {
        const response = await fetch(`/api/timelines/${encodeURIComponent(timelineId)}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          if (isCurrent) {
            setTimelineLoadError(
              result.error ||
                `Timeline request failed with status ${response.status}.`,
            );
          }
          return;
        }

        const result = (await response.json().catch(() => ({}))) as {
          document?: TimelineDocument;
        };
        if (!isCurrent) return;
        if (!result.document) {
          setTimelineLoadError("Timeline response did not include a saved document.");
          return;
        }
        if (result.document.id !== timelineId) {
          setTimelineLoadError(
            `Timeline response returned "${result.document.id}" instead of "${timelineId}".`,
          );
          return;
        }

        setPersistedTimelineTitle(result.document.title);
        saveBaselineRef.current = JSON.stringify({
          id: result.document.id,
          title: result.document.title,
          description: result.document.description,
          clips: result.document.clips,
        });
        hydratedTimelineIdRef.current = timelineId;

        if (localEditVersionRef.current !== loadStartedAtLocalEditVersion) {
          const latestClips = latestClipsRef.current;
          const shouldKeepLocalClips =
            latestClips.length > 0 || result.document.clips.length === 0;
          const resolvedDocument = shouldKeepLocalClips
            ? {
                ...result.document,
                clips: latestClips,
              }
            : result.document;

          registerTimelineDocument(resolvedDocument);
          if (!shouldKeepLocalClips) {
            clipState.applyClipsNow(result.document.clips);
          }
          saveBaselineRef.current = JSON.stringify({
            id: resolvedDocument.id,
            title: resolvedDocument.title,
            description: resolvedDocument.description,
            clips: resolvedDocument.clips,
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
        setTimelineLoadError(null);
      } catch (error) {
        console.warn(`Failed to load timeline "${timelineId}" from Firebase`, error);
        if (isCurrent) {
          setTimelineLoadError(
            error instanceof Error ? error.message : "Unable to load the saved timeline.",
          );
        }
      } finally {
        if (isCurrent) {
          setIsLoadingTimeline(false);
        }
      }
    };

    void loadTimelineDocument();

    return () => {
      isCurrent = false;
    };
  }, [canPersistTimeline, clipState.applyClipsNow, timelineId]);

  const childCollections = useMemo(() => {
    if (!hierarchyMode) return [];
    return clipState.clips.filter((c) => c.kind === "collection");
  }, [clipState.clips, hierarchyMode]);

  const visibleExpandedCollectionKeys = useMemo(() => {
    const availableRootIds = new Set(
      clipState.clips
        .filter((clip) => clip.kind === "collection")
        .map((clip) => clip.id),
    );

    return new Set(
      Array.from(expandedCollectionKeys).filter((key) =>
        availableRootIds.has(key.split("::")[0].split("/")[0]),
      ),
    );
  }, [clipState.clips, expandedCollectionKeys]);

  const visibleExposedCollectionEndpointKeys = useMemo(() => {
    const availableRootIds = new Set(
      clipState.clips
        .filter((clip) => clip.kind === "collection")
        .map((clip) => clip.id),
    );

    return new Set(
      Array.from(exposedCollectionEndpointKeys).filter((key) =>
        availableRootIds.has(key.split("::")[0].split("/")[0]),
      ),
    );
  }, [clipState.clips, exposedCollectionEndpointKeys]);

  const handleToggleCollectionExpanded = useCallback((clip: CollectionTimelineClip) => {
    const expansionKey = clip.viewExpansionKey ?? clip.id;
    setExpandedCollectionKeys((current) => {
      const next = new Set(current);
      if (next.has(expansionKey)) {
        next.delete(expansionKey);
      } else {
        next.add(expansionKey);
      }
      return next;
    });
  }, []);

  const handleToggleCollectionEndpoint = useCallback(
    (clip: CollectionTimelineClip, endpoint: CollectionEndpoint) => {
      const expansionKey = clip.viewExpansionKey ?? clip.id;
      const endpointKey = getCollectionEndpointKey(expansionKey, endpoint);

      setExposedCollectionEndpointKeys((current) => {
        const next = new Set(current);
        if (next.has(endpointKey)) {
          next.delete(endpointKey);
        } else {
          next.add(endpointKey);
        }
        return next;
      });
    },
    [],
  );

  const handleRenameCollection = useCallback(
    (clip: CollectionTimelineClip, nextTitle: string) => {
      const title = nextTitle.trim().slice(0, 80);
      if (!title || title === clip.title) return;

      const currentTimelineId = timelineId || "";
      const sourceTimelineId = clip.viewSourceTimelineId ?? currentTimelineId;
      const sourceClipId = clip.viewSourceClipId ?? clip.id;
      const sourceDocument = getTimelineDocument(sourceTimelineId);

      if (sourceDocument) {
        const nextSourceClips = sourceDocument.clips.map((sourceClip) =>
          sourceClip.id === sourceClipId && sourceClip.kind === "collection"
            ? {
                ...sourceClip,
                title,
                alt: `${title} collection`,
              }
            : sourceClip,
        );
        registerTimelineDocument(
          {
            ...sourceDocument,
            clips: reindexAndPackClips(nextSourceClips),
          },
          { persist: !disablePersistence },
        );
      }

      const childDocument = getTimelineDocument(clip.childTimelineId);
      if (childDocument) {
        registerTimelineDocument(
          {
            ...childDocument,
            title,
          },
          { persist: !disablePersistence },
        );
        syncParentCollections(clip.childTimelineId, childDocument.clips);
      } else if (sourceDocument) {
        syncParentCollections(sourceTimelineId, sourceDocument.clips);
      }

      const currentDocument = getTimelineDocument(currentTimelineId);
      if (currentDocument) {
        applyLocalClipsNow(currentDocument.clips);
      } else {
        setInlineViewVersion((version) => version + 1);
      }
    },
    [applyLocalClipsNow, disablePersistence, timelineId],
  );

  const displayClips = useMemo(
    () => {
      if (inlineViewVersion < 0) return [];

      return buildInlineCollectionView({
        clips: clipState.clips,
        expandedKeys: visibleExpandedCollectionKeys,
        endpointKeys: visibleExposedCollectionEndpointKeys,
        timelineId: timelineId || "",
      });
    },
    [
      clipState.clips,
      inlineViewVersion,
      timelineId,
      visibleExpandedCollectionKeys,
      visibleExposedCollectionEndpointKeys,
    ],
  );

  useEffect(() => {
    latestDisplayClipsRef.current = displayClips;
  }, [displayClips]);

  const handleOpenCollection = useCallback(
    (nextTimelineId: string, href: string) => {
      if (onOpenCollection) {
        onOpenCollection(nextTimelineId);
        return;
      }

      startTimelineFadeNavigation({
        navigate: () => {
          if (navigate) {
            navigate(href);
            return;
          }

          window.location.assign(href);
        },
      });
    },
    [navigate, onOpenCollection],
  );

  const zoom = useTimelineZoom({
    clips: displayClips,
    initialZoom: initialViewState?.zoom ?? pixelsPerSecond,
    parentRef,
    prevScrollLeftRef: scrollState.prevScrollLeftRef,
    selectedIndex: clipState.selectedIndex,
    setScrollLeft: scrollState.setScrollLeft,
    thumbnailMode,
    thumbnailWidth: effectiveThumbnailWidth,
  });

  const adjustedClips = useMemo(() => {
    if (thumbnailMode) return displayClips;

    const gapInSeconds = 6 / zoom.safePixelsPerSecond;
    let currentStartTime = TIMELINE_LEADING_PADDING_SECONDS;
    return displayClips.map((clip) => {
      const duration = clip.kind === "collection"
        ? (effectiveThumbnailWidth / zoom.safePixelsPerSecond)
        : clip.duration;
      const playbackDuration = clip.kind === "collection"
        ? getCollectionClipSourceDuration(clip)
        : clip.duration;
      
      const adjClip = {
        ...clip,
        startTime: currentStartTime,
        duration,
        playbackStartTime: clip.startTime,
        playbackDuration,
      };
      
      currentStartTime += duration + gapInSeconds;
      return adjClip;
    });
  }, [displayClips, thumbnailMode, effectiveThumbnailWidth, zoom.safePixelsPerSecond]);
  const selectedDisplayClip = useMemo(() => {
    if (clipState.selectedIndex === null) return null;
    return (
      adjustedClips.find(
        (clip) => clip.index === clipState.selectedIndex,
      ) ?? null
    );
  }, [adjustedClips, clipState.selectedIndex]);
  const selectedVideoClip =
    selectedDisplayClip?.kind === "video" || selectedDisplayClip?.kind === "image" ? selectedDisplayClip : null;
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

  const handleClipDurationLoadSimple = useCallback(
    (index: number, duration: number) => {
      clipState.setClips((previousClips) => {
        const clip = previousClips.find((candidate) => candidate.index === index);
        if (!clip || clip.kind !== "video") return previousClips;
        if (Math.abs(clip.sourceDuration - duration) < 0.1) return previousClips;

        const nextClips = previousClips.map((candidate) => ({ ...candidate }));
        const clipIdx = previousClips.findIndex((candidate) => candidate.index === index);
        if (clipIdx !== -1) {
          nextClips[clipIdx] = { ...clip, sourceDuration: duration };
        }
        return nextClips;
      });
    },
    [clipState.setClips],
  );

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
          if (!uploadTimelineMedia) {
            return {
              clip: null,
              error: `"${file.name}" was not added because media uploads are not configured.`,
            };
          }

          let hostedMedia: Awaited<ReturnType<UploadTimelineMedia>>;

          // Compute folderPath for this timeline if it's the assets timeline or a nested collection
          let folderPath: string | undefined;
          const uploadUserId = userId || "default";
          const thisTimelineId = timelineId || "";
          if (thisTimelineId.startsWith("asset-library")) {
            folderPath = getFolderPathFromTimelineId(thisTimelineId, uploadUserId) || undefined;
          } else if (thisTimelineId && thisTimelineId !== "root" && !thisTimelineId.startsWith("project-")) {
            const pathSegments = getTimelinePath(thisTimelineId).map((s) => s.title);
            const doc = getTimelineDocument(thisTimelineId);
            if (doc) {
              pathSegments.push(doc.title);
            }
            folderPath = pathSegments.join("/");
          }

          try {
            hostedMedia = await uploadTimelineMedia(file.name, file, folderPath);
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
    [applyLocalClipsNow, clipState, timelineId, uploadTimelineMedia, userId],
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
        const isAssetLibrarySource = sourceTimelineId.startsWith("asset-library");
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
      const thisTimelineId = timelineId || "";
      const uniqueId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      let newClip: TimelineClip;

      if (type === "collection") {
        let childId = `timeline-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        
        if (thisTimelineId.startsWith("asset-library")) {
          const assetUserId = userId || "default";
          const currentFolderPath = getFolderPathFromTimelineId(thisTimelineId, assetUserId);
          const newCollectionId = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          const newFolderPath = currentFolderPath 
            ? `${currentFolderPath}/${newCollectionId}` 
            : newCollectionId;
          const encoded = encodeFolderPath(newFolderPath);
          childId = `asset-library-col-${assetUserId}-${encoded}`;
        }

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
      const isAssetLibrarySource = sourceTimelineId.startsWith("asset-library");
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
    if (!canPersistTimeline) return;
    const thisTimelineId = timelineId || "";
    if (thisTimelineId) {
      const doc = getTimelineDocument(thisTimelineId);
      if (doc) {
        doc.clips = clipState.clips;
      }
    }
  }, [canPersistTimeline, clipState.clips, timelineId]);

  useEffect(() => {
    if (!canPersistTimeline) return;
    const thisTimelineId = timelineId || "";
    if (!thisTimelineId || hydratedTimelineIdRef.current !== thisTimelineId) return;

    const doc = getTimelineDocument(thisTimelineId);
    const documentSnapshot: TimelineDocument = {
      id: thisTimelineId,
      title: persistedTimelineTitle || timelineTitle || thisTimelineId,
      description: doc?.description,
      clips: clipState.clips,
    };
    if (isUnsavedProjectPlaceholder(documentSnapshot)) return;

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
  }, [canPersistTimeline, clipState.clips, persistedTimelineTitle, timelineId, timelineTitle]);

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

  const applyTimelineViewClipsNow = useCallback(
    (nextViewClips: TimelineClip[]) => {
      if (!displayClips.some((clip) => clip.viewRole)) {
        applyLocalClipsNow(nextViewClips);
        return;
      }

      const previousById = new Map(
        displayClips.map((clip) => [clip.id, clip]),
      );
      const currentTimelineId = timelineId || "";
      let parentClips = clipState.clips;
      let parentChanged = false;
      let childChanged = false;

      const hasTimingChange = (previous: TimelineClip, next: TimelineClip) =>
        Math.abs(previous.duration - next.duration) > 0.0001 ||
        Math.abs(previous.sourceDuration - next.sourceDuration) > 0.0001 ||
        Math.abs(previous.trimIn - next.trimIn) > 0.0001 ||
        Math.abs(previous.trimOut - next.trimOut) > 0.0001;

      const copyTiming = (sourceClip: TimelineClip, viewClip: TimelineClip): TimelineClip => ({
        ...sourceClip,
        duration: viewClip.duration,
        sourceDuration: viewClip.sourceDuration,
        trimIn: viewClip.trimIn,
        trimOut: viewClip.trimOut,
      });

      nextViewClips.forEach((nextClip) => {
        if (nextClip.viewRole === "collection-collapse") return;

        const previousClip = previousById.get(nextClip.id);
        if (!previousClip || !hasTimingChange(previousClip, nextClip)) return;

        const sourceTimelineId = nextClip.viewSourceTimelineId ?? currentTimelineId;
        const sourceClipId = nextClip.viewSourceClipId ?? nextClip.id;

        if (sourceTimelineId === currentTimelineId) {
          parentClips = parentClips.map((clip) =>
            clip.id === sourceClipId ? copyTiming(clip, nextClip) : clip,
          );
          parentChanged = true;
          return;
        }

        const sourceDocument = getTimelineDocument(sourceTimelineId);
        if (!sourceDocument) return;

        const nextSourceClips = sourceDocument.clips.map((clip) =>
          clip.id === sourceClipId ? copyTiming(clip, nextClip) : clip,
        );
        const packedSourceClips = reindexAndPackClips(nextSourceClips);
        registerTimelineDocument(
          {
            ...sourceDocument,
            clips: packedSourceClips,
          },
          { persist: !disablePersistence },
        );
        syncParentCollections(sourceTimelineId, packedSourceClips);
        childChanged = true;
      });

      if (parentChanged) {
        const packedParentClips = reindexAndPackClips(parentClips);
        const doc = getTimelineDocument(currentTimelineId);
        if (doc) {
          registerTimelineDocument(
            {
              ...doc,
              clips: packedParentClips,
            },
            { persist: !disablePersistence },
          );
          syncParentCollections(currentTimelineId, packedParentClips);
        }
        applyLocalClipsNow(packedParentClips);
      } else if (childChanged) {
        setInlineViewVersion((version) => version + 1);
      }
    },
    [
      applyLocalClipsNow,
      clipState.clips,
      disablePersistence,
      displayClips,
      timelineId,
    ],
  );


  const interactions = useTimelineInteractions({
    parentRef,
    clips: displayClips,
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
    applyClipsNow: applyTimelineViewClipsNow,
    pendingScrollLeftRef: scrollState.pendingScrollLeftRef,
    timelineId,
  });

  const overhang = useTimelineOverhang({
    activeFilmStripEdit: interactions.activeFilmStripEdit,
    activeResize: interactions.activeResize,
    clipsLength: displayClips.length,
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
    clips: adjustedClips,
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
        data-item-count={displayClips.length}
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
          showPlayBarArea={showPlayBarArea}
          showPassiveFilmstrips={showPassiveFilmstrips}
          title={persistedTimelineTitle}
          gridMode={gridModeEnabled}
          onItemSizeChange={setItemSize}
          onGridModeChange={setGridMode}
          onPlayBarAreaChange={setShowPlayBarArea}
          onPassiveFilmstripsChange={setShowPassiveFilmstrips}
          onZoomChange={zoom.handleZoomChange}
          thumbnailMode={thumbnailMode}
          zoomLevel={zoom.zoomLevel}
          timelineId={timelineId}
          hierarchyMode={hierarchyMode}
          onHierarchyModeChange={setHierarchyMode}
          hasChildCollections={childCollections.length > 0}
          onTitleChange={
            timelineId && (timelineId.startsWith("timeline-") || timelineId.startsWith("asset-library-col-"))
              ? handleTitleChange
              : undefined
          }
          childCollectionsExpanded={childCollectionsExpanded}
          onToggleChildCollections={() => setChildCollectionsExpanded(!childCollectionsExpanded)}
          titleMeta={titleMeta}
          toolbarActions={toolbarActions}
        />

        {mediaUploadError && (
          <div
            role="status"
            className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
          >
            {mediaUploadError}
          </div>
        )}

        {isLoadingTimeline && (
          <div
            role="status"
            className="rounded-md border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-sm text-sky-100"
          >
            Loading saved timeline...
          </div>
        )}

        {timelineLoadError && (
          <div
            role="alert"
            className="rounded-md border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-sm text-rose-100"
          >
            Failed to load saved timeline: {timelineLoadError}
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
            collections={{
              expandedCollectionIds: visibleExpandedCollectionKeys,
              exposedCollectionEndpointIds: visibleExposedCollectionEndpointKeys,
              getCollectionHref,
              onOpenCollection: handleOpenCollection,
              onRenameCollection: handleRenameCollection,
              onToggleCollectionEndpoint: handleToggleCollectionEndpoint,
              onToggleCollectionExpanded: handleToggleCollectionExpanded,
            }}
            dropHandlers={{
              onDropClip: handleDropClip,
              onDropClipIntoCollection: handleDropClipIntoCollection,
              onDropFiles: handleDropFiles,
              onDropSidebarClip: handleDropSidebarClip,
              onDropSidebarClipIntoCollection: handleDropSidebarClipIntoCollection,
            }}
            frame={{
              handleScroll: scrollState.handleScroll,
              parentRef,
              resolvedViewportWidth,
              scrollLeft: scrollState.scrollLeft,
              scrollTop: gridModeEnabled
                ? scrollState.pageScrollTop
                : scrollState.scrollTop,
              timelineHeight,
              timelineWidth: layout.timelineWidth,
            }}
            interactions={interactions}
            isZooming={zoom.isZooming}
            layout={{
              gridMetrics,
              hasClips: displayClips.length > 0,
              itemHeight,
              itemTop,
              pixelsPerSecond: zoom.safePixelsPerSecond,
              thumbnailMode,
              thumbnailWidth: effectiveThumbnailWidth,
              visibleClips: layout.visibleClips,
            }}
            overhang={{
              closingOverhangOffset: overhang.closingOverhangOffset,
              firstOverhang: overhang.firstOverhang,
              isClosingOverhang: overhang.isClosingOverhang,
              isResizingFirstClipLeft: overhang.isResizingFirstClipLeft,
              manualOverhangScroll,
              prevFirstOverhang: overhang.prevFirstOverhangRef.current,
            }}
            playback={{
              onPlayheadTimeChange,
              playheadTime,
              previewLargeSurface,
              selectedVideoClip: showPlayBarArea ? selectedVideoClip : null,
              showPassiveFilmstrips,
              showPlayBarArea,
            }}
            selection={{
              handleClipDurationLoad: syncMediaDuration
                ? handleClipDurationLoad
                : handleClipDurationLoadSimple,
              scrubPreview: clipState.scrubPreview,
              selectedIndex: clipState.selectedIndex,
            }}
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
                  thumbnailMode,
                  itemSize: "sm",
                  gridMode: false,
                  showPlayBarArea: showPlayBarArea,
                  showPassiveFilmstrips: showPassiveFilmstrips,
                }}
                thumbnailMode={thumbnailMode}
                isChildTimeline={true}
                syncMediaDuration={syncMediaDuration}
                hierarchyMode={hierarchyMode}
                previewLargeSurface={previewLargeSurface}
                playheadTime={playheadTime}
                onPlayheadTimeChange={onPlayheadTimeChange}
              />
            );
          })}
        </div>
      )}

    </>
  );
}
