"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { isUnsavedProjectPlaceholder } from "../timeline-documents";
import type { TimelineClip, TimelineDocument } from "../types";

type TimelinePersistenceProviderOptions = {
  applyClipsNow: (clips: TimelineClip[]) => void;
  canPersistTimeline: boolean;
  clips: TimelineClip[];
  getTimelineDocument: (id: string) => TimelineDocument | null;
  latestClipsRef: RefObject<TimelineClip[]>;
  localEditVersionRef: RefObject<number>;
  emitTimelineUpdate: (timelineId: string, document?: TimelineDocument) => void;
  persistedTimelineTitle?: string;
  registerTimelineDocument: (
    document: TimelineDocument,
    options?: { persist?: boolean },
  ) => TimelineDocument;
  setPersistedTimelineTitle: (title?: string) => void;
  timelineId?: string;
  timelineTitle?: string;
};

export function useTimelinePersistenceProvider({
  applyClipsNow,
  canPersistTimeline,
  clips,
  getTimelineDocument,
  latestClipsRef,
  localEditVersionRef,
  emitTimelineUpdate,
  persistedTimelineTitle,
  registerTimelineDocument,
  setPersistedTimelineTitle,
  timelineId,
  timelineTitle,
}: TimelinePersistenceProviderOptions) {
  const [timelineLoadError, setTimelineLoadError] = useState<string | null>(null);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const saveBaselineRef = useRef<string | null>(null);
  const hydratedTimelineIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!canPersistTimeline) {
      setIsLoadingTimeline(false);
      return;
    }
    if (!timelineId) return;

    let isCurrent = true;
    const loadStartedAtLocalEditVersion = localEditVersionRef.current ?? 0;

    const loadTimelineDocument = async () => {
      setIsLoadingTimeline(true);
      setTimelineLoadError(null);

      try {
        const response = await fetch(
          `/api/timelines/${encodeURIComponent(timelineId)}`,
          {
            cache: "no-store",
          },
        );
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
          setTimelineLoadError(
            "Timeline response did not include a saved document.",
          );
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
          emitTimelineUpdate(resolvedDocument.id, resolvedDocument);
          if (!shouldKeepLocalClips) {
            const loadedClips = result.document.clips.map((clip) => ({ ...clip }));
            latestClipsRef.current = loadedClips;
            applyClipsNow(loadedClips);
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
        emitTimelineUpdate(result.document.id, result.document);
        const loadedClips = result.document.clips.map((clip) => ({ ...clip }));
        latestClipsRef.current = loadedClips;
        applyClipsNow(loadedClips);
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
            error instanceof Error
              ? error.message
              : "Unable to load the saved timeline.",
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
  }, [
    applyClipsNow,
    canPersistTimeline,
    emitTimelineUpdate,
    latestClipsRef,
    localEditVersionRef,
    registerTimelineDocument,
    setPersistedTimelineTitle,
    timelineId,
  ]);

  useEffect(() => {
    if (!canPersistTimeline) return;
    const thisTimelineId = timelineId || "";
    if (!thisTimelineId) return;

    const document = getTimelineDocument(thisTimelineId);
    if (document) {
      if (clips.length === 0 && document.clips.length > 0) return;

      registerTimelineDocument(
        {
          ...document,
          clips,
        },
        { persist: false },
      );
    }
  }, [
    canPersistTimeline,
    clips,
    getTimelineDocument,
    registerTimelineDocument,
    timelineId,
  ]);

  useEffect(() => {
    if (!canPersistTimeline) return;
    const thisTimelineId = timelineId || "";
    if (!thisTimelineId || hydratedTimelineIdRef.current !== thisTimelineId) {
      return;
    }

    const document = getTimelineDocument(thisTimelineId);
    if (clips.length === 0 && document?.clips.length) return;

    const documentSnapshot: TimelineDocument = {
      id: thisTimelineId,
      title: persistedTimelineTitle || timelineTitle || thisTimelineId,
      description: document?.description,
      clips,
    };
    if (isUnsavedProjectPlaceholder(documentSnapshot)) return;

    const serialized = JSON.stringify(documentSnapshot);
    if (serialized === saveBaselineRef.current) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/timelines/${encodeURIComponent(thisTimelineId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ document: documentSnapshot }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error(await response.text());
        }
        saveBaselineRef.current = serialized;
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn(
            `Failed to autosave timeline "${thisTimelineId}" to Firebase`,
            error,
          );
        }
      }
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    canPersistTimeline,
    clips,
    getTimelineDocument,
    persistedTimelineTitle,
    timelineId,
    timelineTitle,
  ]);

  return {
    isLoadingTimeline,
    timelineLoadError,
  };
}
