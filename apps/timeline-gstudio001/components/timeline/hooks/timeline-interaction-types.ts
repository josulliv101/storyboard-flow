import type { TimelineClip, TrimScrubPreview } from "../types";

export type SetScrollLeft = (
  value: number | ((previous: number) => number),
) => void;

export type SetSelectedIndex = (
  value:
    | number
    | null
    | ((previous: number | null) => number | null),
) => void;

export type SetScrubPreview = (value: TrimScrubPreview | null) => void;

export type WindowDragCoordinator = {
  cleanup: () => void;
  setCleanup: (cleanup: (() => void) | null) => void;
};

export type TimelineInteractionSharedOptions = {
  applyClipsNow: (clips: TimelineClip[]) => void;
  clips: TimelineClip[];
  minDuration: number;
  parentRef: React.RefObject<HTMLDivElement | null>;
  pendingScrollLeftRef?: React.MutableRefObject<number | null>;
  safePixelsPerSecond: number;
  setScrollLeft: SetScrollLeft;
  setScrubPreview: SetScrubPreview;
  setSelectedIndex: SetSelectedIndex;
  setTrackTranslateX: React.Dispatch<React.SetStateAction<number>>;
  stopInertia: () => void;
  windowDrag: WindowDragCoordinator;
};
