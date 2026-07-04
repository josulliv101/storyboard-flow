"use client";

import { useEffect, type RefObject } from "react";

import type { TimelineClip } from "../types";

type TimelineKeyboardShortcutsProps = {
  displayClipsRef: RefObject<TimelineClip[]>;
  onMoveClipToTrash: (clip: TimelineClip) => Promise<void>;
  selectedIndex: number | null;
  sourceClips: TimelineClip[];
  timelineId?: string;
};

export function TimelineKeyboardShortcuts({
  displayClipsRef,
  onMoveClipToTrash,
  selectedIndex,
  sourceClips,
  timelineId,
}: TimelineKeyboardShortcutsProps) {
  useEffect(() => {
    const handleGlobalKeyDown = async (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedIndex === null) return;

      const thisTimelineId = timelineId || "";
      const selectedViewClip = displayClipsRef.current.find(
        (clip) => clip.index === selectedIndex,
      );

      if (
        selectedViewClip?.viewRole ||
        selectedViewClip?.viewSourceTimelineId !== thisTimelineId
      ) {
        event.preventDefault();
        return;
      }

      const sourceClipId =
        selectedViewClip?.viewSourceClipId ?? selectedViewClip?.id;
      const selectedClip = sourceClips.find((clip) => clip.id === sourceClipId);
      if (!selectedClip) return;

      event.preventDefault();
      await onMoveClipToTrash(selectedClip);
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    displayClipsRef,
    onMoveClipToTrash,
    selectedIndex,
    sourceClips,
    timelineId,
  ]);

  return null;
}
