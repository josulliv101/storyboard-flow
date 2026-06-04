export type RenderClipType = 'video' | 'image' | 'dialog' | 'note';

export interface RenderClip {
  id: string;
  name: string;
  description?: string;
  type: RenderClipType;
  startFrame: number;
  duration: number;
  trackId: string;
  color?: string;
  characterId?: string;
  character?: string;
  src?: string;
  linkedGraphTrackIds?: string[];
  tags?: string[];
  animationMode?: 'all' | 'entrance' | 'exit' | 'none';
  animationDirection?: 'left' | 'right' | 'top' | 'bottom' | 'center';
  layoutOrder?: number;
  layoutType?: 'grid' | 'overlay';
  anchorPoint?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'top' | 'bottom' | 'left' | 'right';
}

export interface RenderRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RenderVisualState {
  opacity: number;
  translateXPct: number;
  translateYPct: number;
  scale: number;
  blurPx: number;
}

export const LAYOUT_TRANSITION_FRAMES = 18;
const CLIP_TRANSITION_FRAMES = 15;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const progressBetween = (value: number, inputMin: number, inputMax: number) => {
  if (inputMax === inputMin) return value >= inputMax ? 1 : 0;
  return clamp((value - inputMin) / (inputMax - inputMin), 0, 1);
};

const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

const easeInCubic = (value: number) => value * value * value;

const easeInOutCubic = (value: number) => (
  value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2
);

const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;

export const getClipVisualState = (clip: RenderClip, localFrame: number): RenderVisualState => {
  if (clip.animationMode === 'none') {
    return { opacity: 1, translateXPct: 0, translateYPct: 0, scale: 1, blurPx: 0 };
  }

  const duration = Math.max(1, clip.duration);
  const entranceActive = clip.animationMode === undefined || clip.animationMode === 'all' || clip.animationMode === 'entrance';
  const exitActive = clip.animationMode === undefined || clip.animationMode === 'all' || clip.animationMode === 'exit';
  const enterProgress = entranceActive ? easeOutCubic(progressBetween(localFrame, 0, CLIP_TRANSITION_FRAMES)) : 1;
  const exitProgress = exitActive ? 1 - easeInCubic(progressBetween(localFrame, Math.max(0, duration - CLIP_TRANSITION_FRAMES), duration)) : 1;
  const progress = Math.min(enterProgress, exitProgress);
  const offset = (1 - progress) * 20;
  let translateXPct = 0;
  let translateYPct = 0;

  if (clip.animationDirection === 'left') translateXPct = -offset;
  if (clip.animationDirection === 'right') translateXPct = offset;
  if (clip.animationDirection === 'top') translateYPct = -offset;
  if (clip.animationDirection === 'bottom') translateYPct = offset;

  return {
    opacity: progress,
    translateXPct,
    translateYPct,
    scale: 0.96 + progress * 0.04,
    blurPx: (1 - progress) * 5,
  };
};

export const getCssVisualStyle = (visual: RenderVisualState) => ({
  opacity: visual.opacity,
  transform: `translate3d(${visual.translateXPct}%, ${visual.translateYPct}%, 0) scale(${visual.scale})`,
  filter: `blur(${visual.blurPx}px)`,
});

const getClipGridMetrics = (count: number) => {
  if (count <= 1) return { columns: 1, rows: 1 };
  if (count === 2) return { columns: 2, rows: 1 };
  if (count === 3) return { columns: 3, rows: 1 };
  if (count === 4) return { columns: 2, rows: 2 };
  return { columns: 3, rows: 2 };
};

const sortGridClips = <T extends RenderClip>(clips: T[]) => (
  clips
    .filter((clip) => clip.layoutType !== 'overlay')
    .sort((a, b) => (a.layoutOrder || 0) - (b.layoutOrder || 0))
);

const getGridClipsAtFrame = <T extends RenderClip>(clips: T[], frame: number, trackIds: string[]) => (
  sortGridClips(clips.filter((clip) => (
    trackIds.includes(clip.trackId) &&
    frame >= clip.startFrame &&
    frame < clip.startFrame + clip.duration
  )))
);

const getClipLayout = <T extends RenderClip>(clips: T[]) => {
  const metrics = getClipGridMetrics(clips.length);
  const cellWidth = 100 / metrics.columns;
  const cellHeight = 100 / metrics.rows;
  const layout = new Map<string, RenderRect>();

  clips.forEach((clip, index) => {
    const column = index % metrics.columns;
    const row = Math.floor(index / metrics.columns);

    layout.set(clip.id, {
      left: column * cellWidth,
      top: row * cellHeight,
      width: cellWidth,
      height: cellHeight,
    });
  });

  return layout;
};

const defaultRect = (rect?: RenderRect): RenderRect => rect || { left: 0, top: 0, width: 100, height: 100 };

const interpolateRect = (from: RenderRect, to: RenderRect, progress: number): RenderRect => ({
  left: lerp(from.left, to.left, progress),
  top: lerp(from.top, to.top, progress),
  width: lerp(from.width, to.width, progress),
  height: lerp(from.height, to.height, progress),
});

const getLatestLayoutEvent = <T extends RenderClip>(clips: T[], frame: number, trackIds: string[]) => {
  const events = clips
    .filter((clip) => clip.layoutType !== 'overlay' && trackIds.includes(clip.trackId))
    .flatMap((clip) => [clip.startFrame, clip.startFrame + clip.duration])
    .filter((eventFrame) => frame >= eventFrame && frame < eventFrame + LAYOUT_TRANSITION_FRAMES)
    .sort((a, b) => b - a);

  return events[0];
};

const getRenderableGridClips = <T extends RenderClip>(clips: T[], frame: number, trackIds: string[]) => (
  sortGridClips(clips.filter((clip) => (
    trackIds.includes(clip.trackId) &&
    frame >= clip.startFrame &&
    frame < clip.startFrame + clip.duration + LAYOUT_TRANSITION_FRAMES
  )))
);

export const getAnimatedGridLayout = <T extends RenderClip>(clips: T[], frame: number, trackIds: string[]) => {
  const eventFrame = getLatestLayoutEvent(clips, frame, trackIds);
  const currentLayout = getClipLayout(getGridClipsAtFrame(clips, frame, trackIds));
  const renderableClips = getRenderableGridClips(clips, frame, trackIds);

  if (eventFrame === undefined) {
    return renderableClips
      .filter((clip) => currentLayout.has(clip.id))
      .map((clip) => ({ clip, rect: defaultRect(currentLayout.get(clip.id)) }));
  }

  const beforeLayout = getClipLayout(getGridClipsAtFrame(clips, eventFrame - 1, trackIds));
  const afterLayout = getClipLayout(getGridClipsAtFrame(clips, eventFrame, trackIds));
  const progress = easeInOutCubic(progressBetween(frame - eventFrame, 0, LAYOUT_TRANSITION_FRAMES - 1));

  return renderableClips
    .filter((clip) => beforeLayout.has(clip.id) || afterLayout.has(clip.id))
    .map((clip) => {
      const before = beforeLayout.get(clip.id);
      const after = afterLayout.get(clip.id);

      return {
        clip,
        rect: interpolateRect(defaultRect(before || after), defaultRect(after || before), progress),
      };
    });
};
