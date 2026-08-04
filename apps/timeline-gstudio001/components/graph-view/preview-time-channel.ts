// The preview pane's TIME + AUDIO channel — pure state, no React, no DOM
// beyond localStorage.
//
// Extracted from graph-preview.tsx, which had grown past 2,200 lines. It also
// buys real coverage: this app's vitest cannot parse `.tsx` at all, so every
// line of this while it lived beside JSX was untestable by construction. The
// same reasoning already produced `graph-playhead-model.ts`.
//
// The channel sits ABOVE the preview pane's mount on purpose. Play state and
// audio level have to survive the pane toggling off and back on, and have to be
// settable before the pane exists — that is how "play turns the preview on and
// it is already playing" works.

/**
 * Where a live scrub's POINTER is, in the dragged surface's own content
 * coordinates — published alongside the time, and only while a drag is live.
 *
 * It exists because time alone cannot answer "where is the pointer". A
 * collection with no items occupies width on screen but contributes NO time,
 * so the whole of that card maps to one instant: `timeAt` returns the same
 * value across it, and `xAt` of that value can only come back to one edge.
 * Driven by time, the playhead jumps to the far side while the pointer is
 * still crossing — right for playback, where there is nothing to play, and
 * wrong for a drag, where the user is steering a position on screen.
 *
 * Scoped by `surfaceId` so only the surface being dragged follows the
 * pointer; every other playhead (sub-rows, the other layout) stays on the
 * clock, which is what keeps them in agreement with each other.
 */
export type PreviewScrubPosition = Readonly<{
  surfaceId: string;
  x: number;
  /** Grid only: a position there is a ROW as well as an offset. Absent for
   *  the strip, which is one line. */
  y?: number;
}>;

export type PreviewTimeChannel = Readonly<{
  get: () => number;
  set: (time: number) => void;
  subscribe: (listener: () => void) => () => void;
  /** The live scrub's pointer position, or null when nothing is being
   *  dragged. Changing it notifies the same listeners `set` does. */
  getScrub: () => PreviewScrubPosition | null;
  setScrub: (scrub: PreviewScrubPosition | null) => void;
  /** Play state, held here (above the preview pane's mount) so it survives the
   *  pane toggling off/on and can be driven before the pane exists — that's how
   *  "play turns the preview on and it's already playing" works. */
  isPlaying: () => boolean;
  setPlaying: (playing: boolean) => void;
  subscribePlaying: (listener: () => void) => () => void;
  /** Audio level, held here for the same reason play state is: it must survive
   *  the preview pane toggling off and back on. Volume is 0..1. */
  getVolume: () => number;
  setVolume: (volume: number) => void;
  isMuted: () => boolean;
  setMuted: (muted: boolean) => void;
  subscribeAudio: (listener: () => void) => () => void;
}>;

const AUDIO_PREFERENCE_KEY = "storyboard:preview-audio";

/** The preference is read once at channel construction and written on change.
 *  Persistence lives in the app, NOT in `packages/ui` — the surface takes
 *  volume/muted as props and stays framework-agnostic. */
function readStoredAudio(): { volume: number; muted: boolean } {
  if (typeof window === "undefined") return { volume: 1, muted: false };
  try {
    const raw = window.localStorage.getItem(AUDIO_PREFERENCE_KEY);
    if (!raw) return { volume: 1, muted: false };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { volume: 1, muted: false };
    const record = parsed as { volume?: unknown; muted?: unknown };
    const volume =
      typeof record.volume === "number" && Number.isFinite(record.volume)
        ? Math.min(1, Math.max(0, record.volume))
        : 1;
    return { volume, muted: record.muted === true };
  } catch {
    // A malformed or blocked store is not worth failing a preview over.
    return { volume: 1, muted: false };
  }
}

function writeStoredAudio(volume: number, muted: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUDIO_PREFERENCE_KEY, JSON.stringify({ volume, muted }));
  } catch {
    // Private mode / quota. The session still works, it just will not persist.
  }
}

export function createPreviewTimeChannel(): PreviewTimeChannel {
  let time = 0;
  let playing = false;
  let scrub: PreviewScrubPosition | null = null;
  const stored = readStoredAudio();
  let volume = stored.volume;
  let muted = stored.muted;
  const listeners = new Set<() => void>();
  const playListeners = new Set<() => void>();
  const audioListeners = new Set<() => void>();
  return {
    get: () => time,
    set: (next) => {
      time = next;
      for (const listener of listeners) listener();
    },
    getScrub: () => scrub,
    setScrub: (next) => {
      scrub = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isPlaying: () => playing,
    setPlaying: (next) => {
      if (playing === next) return;
      playing = next;
      for (const listener of playListeners) listener();
    },
    subscribePlaying: (listener) => {
      playListeners.add(listener);
      return () => {
        playListeners.delete(listener);
      };
    },
    getVolume: () => volume,
    setVolume: (next) => {
      const clamped = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0));
      if (volume === clamped) return;
      volume = clamped;
      writeStoredAudio(volume, muted);
      for (const listener of audioListeners) listener();
    },
    isMuted: () => muted,
    setMuted: (next) => {
      if (muted === next) return;
      muted = next;
      writeStoredAudio(volume, muted);
      for (const listener of audioListeners) listener();
    },
    subscribeAudio: (listener) => {
      audioListeners.add(listener);
      return () => {
        audioListeners.delete(listener);
      };
    },
  };
}
