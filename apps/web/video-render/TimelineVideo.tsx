import React from 'react';
import {
  AbsoluteFill,
  Img,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  Video,
} from 'remotion';
import { getGraphColor, getGraphDisplayLabel, getGraphShortLabel, type GraphColor } from '../lib/graph-style';
import {
  getAnimatedGridLayout,
  getClipVisualState,
  getCssVisualStyle,
  LAYOUT_TRANSITION_FRAMES,
  type RenderClip,
  type RenderClipType,
} from '../lib/render-layout';

type ClipType = RenderClipType;

interface TimelineClip extends RenderClip {
  id: string;
  name: string;
  description?: string;
  type: ClipType;
  startFrame: number;
  duration: number;
  trackId: string;
  color?: string;
  characterId?: string;
  character?: string;
  src?: string;
  linkedGraphTrackIds?: string[];
  animationMode?: 'all' | 'entrance' | 'exit' | 'none';
  animationDirection?: 'left' | 'right' | 'top' | 'bottom' | 'center';
  layoutOrder?: number;
  layoutType?: 'grid' | 'overlay';
  anchorPoint?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'top' | 'bottom' | 'left' | 'right';
}

interface Character {
  id: string;
  name: string;
  image?: string;
}

interface TimelineTrack {
  id: string;
  name: string;
  parentId?: string;
  showDialogGridItem?: boolean;
  notePlacement?: 'dialog' | 'graph';
  graphUiLayout?: 'grid' | 'column' | 'column-many';
  type?: 'media' | 'graph';
  graph?: {
    type?: 'line' | 'bar';
    label: string;
    shortLabel?: string;
    min: number;
    max: number;
    increment?: number;
    barIntervalSeconds?: number;
    showValue?: boolean;
    noteDurationSeconds?: number;
    color?: string;
    points: Array<{ frame: number; value: number; note?: string; tag?: string }>;
  };
}

interface Scene {
  id: string;
  name: string;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
}

export interface TimelineRenderProject {
  scenes: Scene[];
  characters: Character[];
  activeSceneId: string;
  disabledTrackIds?: string[];
  config?: {
    aspectRatio?: '16:9' | '21:9' | '1:1' | '9:16';
    fps?: number;
    dedicatedDialogPanel?: boolean;
    analyticsOverlayStyle?: 'compact' | 'analysis';
  };
}

export interface TimelineVideoProps {
  [key: string]: unknown;
  project: TimelineRenderProject;
}

const colorMap: Record<string, string> = {
  'bg-indigo-600': '#4f46e5',
  'bg-zinc-600': '#52525b',
  'bg-purple-600': '#9333ea',
  'bg-orange-600': '#ea580c',
  'bg-emerald-600': '#059669',
  'bg-blue-600': '#2563eb',
  'bg-red-600': '#dc2626',
};

type AspectRatio = NonNullable<TimelineRenderProject['config']>['aspectRatio'];

export const getRenderDimensions = (aspectRatio: AspectRatio) => {
  if (aspectRatio === '21:9') return { width: 2520, height: 1080 };
  if (aspectRatio === '1:1') return { width: 1080, height: 1080 };
  if (aspectRatio === '9:16') return { width: 1080, height: 1920 };
  return { width: 1920, height: 1080 };
};

export const getRenderDuration = (project: TimelineRenderProject) => {
  const scene = project.scenes.find((item) => item.id === project.activeSceneId) || project.scenes[0];
  const lastFrame = scene?.clips.reduce((max, clip) => Math.max(max, clip.startFrame + clip.duration), 0) || 0;
  return Math.max(1, lastFrame);
};

const getCharacterName = (clip: TimelineClip, characters: Character[]) => {
  if (clip.characterId) {
    const character = characters.find((item) => item.id === clip.characterId);
    return character?.name || clip.character;
  }

  return clip.character;
};

const getCharacterImage = (clip: TimelineClip, characters: Character[]) => {
  if (!clip.characterId) return undefined;
  return characters.find((item) => item.id === clip.characterId)?.image;
};

const getDialogSpeakerKey = (clip: TimelineClip) => clip.characterId || clip.character || 'dialog-speaker';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const easeOutQuart = (value: number) => 1 - Math.pow(1 - clamp01(value), 4);

const formatGraphValue = (value: number) => value.toFixed(1);

const getGraphValueAtFrame = (
  graph: { type?: 'line' | 'bar'; min: number; points: Array<{ frame: number; value: number }> },
  frame: number
) => {
  const points = [...graph.points].sort((a, b) => a.frame - b.frame);
  if (graph.type !== 'line') {
    return points.filter((point) => point.frame <= frame).at(-1)?.value ?? graph.min;
  }

  const previous = points.filter((point) => point.frame <= frame).at(-1);
  const next = points.find((point) => point.frame > frame);
  if (!previous) return next?.value ?? graph.min;
  if (!next) return previous.value;

  const span = Math.max(1, next.frame - previous.frame);
  const progress = clamp01((frame - previous.frame) / span);
  return previous.value + (next.value - previous.value) * progress;
};

const getAnimatedGraphValueAtFrame = (
  graph: { min: number; max: number; points: Array<{ frame: number; value: number }> },
  frame: number,
  animationFrames: number
) => {
  const points = [...graph.points].sort((a, b) => a.frame - b.frame);
  const currentPointIndex = points.findLastIndex((point) => point.frame <= frame);
  const currentPoint = currentPointIndex >= 0 ? points[currentPointIndex] : undefined;
  const previousValue = currentPointIndex > 0 ? points[currentPointIndex - 1].value : graph.min;
  const currentValue = currentPoint?.value ?? graph.min;
  const progress = currentPoint ? easeOutQuart((frame - currentPoint.frame) / animationFrames) : 1;
  const displayValue = previousValue + (currentValue - previousValue) * progress;
  const valueRange = Math.max(1, graph.max - graph.min);

  return {
    displayValue,
    progress: clamp01((displayValue - graph.min) / valueRange),
  };
};

const shouldShowGraphValue = (graph: { label: string; showValue?: boolean }) => (
  graph.showValue ?? /\btension\b/i.test(graph.label)
);

const getGraphDisplayDuration = (graphTracks: TimelineTrack[], fps: number) => {
  const lastGraphFrame = graphTracks.reduce((maxFrame, track) => {
    const graph = track.graph;
    if (!graph) return maxFrame;
    const barIntervalFrames = Math.max(1, Math.round((graph.barIntervalSeconds ?? 0.5) * fps));
    const trackLastFrame = graph.points.reduce((lastFrame, point) => (
      Math.max(lastFrame, point.frame + (graph.type === 'bar' ? barIntervalFrames : 0))
    ), 0);
    return Math.max(maxFrame, trackLastFrame);
  }, 0);

  return Math.max(1, lastGraphFrame);
};

type GraphNoteRenderItem = {
  id: string;
  label: string;
  note: string;
  tag: string;
  frame: number;
  color: GraphColor;
  lingerFrames: number;
};

type GraphValueRenderItem = {
  id: string;
  label: string;
  displayValue: number;
  progress: number;
  color: GraphColor;
};

const NOTE_RENDER_COLOR: GraphColor = {
  fill: 'rgba(217,119,6,0.20)',
  marker: '#92400e',
  accent: '#fcd34d',
  badge: '#92400e',
  border: 'rgba(252,211,77,0.34)',
  line: '#d97706',
  label: '#fcd34d',
};

const getRenderClipNotes = (clips: TimelineClip[]) => clips
  .filter((clip) => clip.type === 'note')
  .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id))
  .map((clip) => ({
    id: clip.id,
    label: 'Note',
    note: clip.description?.trim() || clip.name,
    tag: 'note',
    frame: clip.startFrame,
    color: NOTE_RENDER_COLOR,
    lingerFrames: clip.duration,
    opacity: 1,
    top: 0,
    offsetY: 0,
  }));

const getGraphNotesAtFrame = (
  tracks: TimelineTrack[],
  frame: number,
  fps: number
): GraphNoteRenderItem[] => tracks
  .flatMap((track, graphIndex) => {
    const graph = track.graph!;
    const graphColor = getGraphColor(graph, graphIndex);
    const noteLingerFrames = getGraphNoteDurationFrames(graph, fps);
    return [...graph.points]
      .sort((a, b) => a.frame - b.frame)
      .filter((point) => point.note?.trim() && frame >= point.frame && frame < point.frame + noteLingerFrames)
      .map((point) => ({
        id: `${track.id}-${point.frame}`,
        label: getGraphShortLabel(graph),
        note: point.note!.trim(),
        tag: point.tag?.trim() || 'note',
        frame: point.frame,
        color: graphColor,
        lingerFrames: noteLingerFrames,
      }));
  })
  .sort((a, b) => a.frame - b.frame || a.label.localeCompare(b.label));

const getGraphNoteDurationFrames = (graph: { noteDurationSeconds?: number }, fps: number) => (
  Math.max(1, Math.round((Number.isFinite(graph.noteDurationSeconds) ? graph.noteDurationSeconds! : 3) * fps))
);

const getGraphNoteHeight = (note: string, width: number) => {
  const textWidth = Math.max(160, width - 32);
  const estimatedCharsPerLine = Math.max(16, Math.floor(textWidth / 12));
  const lineCount = Math.max(1, Math.ceil(note.length / estimatedCharsPerLine));
  return 48 + lineCount * 28;
};

const getTopGraphNotePositions = (notes: GraphNoteRenderItem[], width: number) => {
  const gap = 12;
  const positions = new Map<string, number>();
  let top = 0;

  notes.forEach((note) => {
    positions.set(note.id, top);
    top += getGraphNoteHeight(note.note, width) + gap;
  });

  return positions;
};

const getRenderGraphNotes = (
  graphTracks: TimelineTrack[],
  frame: number,
  fps: number,
  stackWidth: number
) => {
  const noteFadeFrames = Math.max(1, Math.round(fps * 0.16));
  const noteLayoutFrames = Math.max(1, Math.round(fps * 0.22));
  const activeGraphNotes = getGraphNotesAtFrame(graphTracks, frame, fps);
  const latestGraphNoteLayoutChangeFrame = graphTracks
    .flatMap((track) => {
      const graph = track.graph!;
      const noteLingerFrames = getGraphNoteDurationFrames(graph, fps);
      return graph.points
        .filter((point) => point.note?.trim())
        .flatMap((point) => [point.frame, point.frame + noteLingerFrames]);
    })
    .filter((changeFrame) => changeFrame <= frame && frame - changeFrame < noteLayoutFrames)
    .reduce((latest, changeFrame) => Math.max(latest, changeFrame), -1);
  const baselineGraphNotes = latestGraphNoteLayoutChangeFrame >= 0
    ? getGraphNotesAtFrame(graphTracks, Math.max(0, latestGraphNoteLayoutChangeFrame - 1), fps)
    : activeGraphNotes;
  const activeGraphNotePositions = getTopGraphNotePositions(activeGraphNotes, stackWidth);
  const baselineGraphNotePositions = getTopGraphNotePositions(baselineGraphNotes, stackWidth);
  const layoutProgress = latestGraphNoteLayoutChangeFrame >= 0
    ? easeOutQuart((frame - latestGraphNoteLayoutChangeFrame) / noteLayoutFrames)
    : 1;
  const exitingGraphNotes = graphTracks
    .flatMap((track, graphIndex) => {
      const graph = track.graph!;
      const graphColor = getGraphColor(graph, graphIndex);
      const noteLingerFrames = getGraphNoteDurationFrames(graph, fps);
      return graph.points
        .filter((point) => {
          const noteEndFrame = point.frame + noteLingerFrames;
          return point.note?.trim() && frame >= noteEndFrame && frame < noteEndFrame + noteFadeFrames;
        })
        .map((point) => ({
          id: `${track.id}-${point.frame}`,
          label: getGraphShortLabel(graph),
          note: point.note!.trim(),
          tag: point.tag?.trim() || 'note',
          frame: point.frame,
          color: graphColor,
          lingerFrames: noteLingerFrames,
        }));
    })
    .sort((a, b) => a.frame - b.frame || a.label.localeCompare(b.label));
  const activeGraphNoteIds = new Set(activeGraphNotes.map((note) => note.id));

  return [
    ...activeGraphNotes.map((note) => {
      const enterProgress = easeOutQuart((frame - note.frame) / noteFadeFrames);
      const targetTop = activeGraphNotePositions.get(note.id) ?? 0;
      const previousTop = baselineGraphNotePositions.get(note.id) ?? targetTop - 8;

      return {
        ...note,
        opacity: Math.min(1, enterProgress),
        top: previousTop + (targetTop - previousTop) * layoutProgress,
        offsetY: (1 - enterProgress) * 18,
      };
    }),
    ...exitingGraphNotes
      .filter((note) => !activeGraphNoteIds.has(note.id))
      .map((note) => {
        const exitProgress = easeOutQuart((frame - note.frame - note.lingerFrames) / noteFadeFrames);
        const lastActiveFrame = note.frame + note.lingerFrames - 1;
        const lastActiveNotes = getGraphNotesAtFrame(graphTracks, lastActiveFrame, fps);
        const lastActivePositions = getTopGraphNotePositions(lastActiveNotes, stackWidth);

        return {
          ...note,
          opacity: 1 - exitProgress,
          top: lastActivePositions.get(note.id) ?? 0,
          offsetY: 18 * exitProgress,
        };
      }),
  ];
};

const GraphValueBadges = ({ items }: { items: GraphValueRenderItem[] }) => {
  if (items.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      gap: 10,
      left: 14,
      maxWidth: 'calc(100% - 28px)',
      overflow: 'hidden',
      position: 'absolute',
      top: 14,
      zIndex: 50,
    }}>
      {items.map((item) => (
        <div key={item.id} style={{
          alignItems: 'center',
          background: 'rgba(0,0,0,0.75)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 8,
          boxShadow: '0 18px 42px rgba(0,0,0,0.38)',
          display: 'flex',
          maxWidth: 320,
          overflow: 'hidden',
          padding: 6,
        }}>
          <div style={{
            alignItems: 'center',
            background: item.color.badge,
            border: '1px solid rgba(255,255,255,0.22)',
            borderRadius: 4,
            color: '#ffffff',
            display: 'flex',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 24,
            fontWeight: 950,
            fontVariantNumeric: 'tabular-nums',
            height: 56,
            justifyContent: 'center',
            width: 60,
          }}>
            {formatGraphValue(item.displayValue)}
          </div>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minWidth: 120,
            overflow: 'hidden',
            padding: '4px 8px',
          }}>
            <div style={{
              color: '#ffffff',
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: 1.8,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>
              {item.label}
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 999,
              height: 10,
              overflow: 'hidden',
              position: 'relative',
              width: '100%',
            }}>
              <div style={{
                background: `linear-gradient(90deg, ${item.color.badge}, ${item.color.accent})`,
                borderRadius: 999,
                boxShadow: `0 0 14px ${item.color.border}`,
                bottom: 0,
                left: 0,
                position: 'absolute',
                top: 0,
                width: `${item.progress * 100}%`,
              }} />
              <div style={{
                background: '#ffffff',
                borderRadius: 999,
                boxShadow: `0 0 10px ${item.color.accent}`,
                height: 6,
                left: `calc(${item.progress * 100}% - 3px)`,
                opacity: item.progress > 0 ? 1 : 0,
                position: 'absolute',
                top: 1,
                width: 6,
              }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const CompactTopGraphOverlay = ({
  frame,
  fps,
  graphTracks,
  totalDuration,
  graphUiLayout = 'grid',
}: {
  frame: number;
  fps: number;
  graphTracks: TimelineTrack[];
  totalDuration: number;
  graphUiLayout?: TimelineTrack['graphUiLayout'];
}) => {
  const valueTracks = graphTracks.filter((track) => shouldShowGraphValue(track.graph!));
  if (valueTracks.length === 0) return null;
  const useColumnLayout = graphUiLayout === 'column' || graphUiLayout === 'column-many';

  return (
    <div style={{
      bottom: useColumnLayout ? 0 : undefined,
      left: 0,
      padding: 8,
      position: 'absolute',
      top: 0,
      overflow: useColumnLayout ? 'visible' : undefined,
      width: useColumnLayout ? '16.6667%' : '50%',
      zIndex: 50,
    }}>
      <div style={{
        alignContent: useColumnLayout ? 'flex-start' : undefined,
        display: 'flex',
        flexDirection: useColumnLayout ? 'column' : 'row',
        flexWrap: 'wrap',
        gap: 8,
        height: useColumnLayout ? '100%' : undefined,
        overflow: useColumnLayout ? 'visible' : undefined,
        width: '100%',
      }}>
        {valueTracks.map((track, graphIndex) => {
          const graph = track.graph!;
          const graphColor = getGraphColor(graph, graphIndex);
          const graphValue = getGraphValueAtFrame(graph, frame);
          const duration = Math.min(Math.max(1, totalDuration), getGraphDisplayDuration([track], fps));
          const currentProgress = Math.min(frame, duration) / duration;
          const valueRange = Math.max(1, graph.max - graph.min);
          const sourcePoints = graph.points.length
            ? [...graph.points].sort((a, b) => a.frame - b.frame)
            : [{ frame: 0, value: Math.max(graph.min, Math.min(graph.max, 0)) }];
          const isBarGraph = graph.type === 'bar';
          const barIntervalFrames = Math.max(1, Math.round((graph.barIntervalSeconds ?? 0.5) * fps));
          const segments = sourcePoints.map((point, index) => ({
            ...point,
            endFrame: isBarGraph ? point.frame + barIntervalFrames : sourcePoints[index + 1]?.frame ?? duration,
          }));

          return (
            <div key={track.id} style={{
              alignItems: 'stretch',
              background: 'rgba(0,0,0,0.45)',
              border: '1px solid rgba(192,132,252,0.15)',
              borderRadius: 5,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: useColumnLayout ? 'column' : 'row',
              flex: useColumnLayout ? '0 0 auto' : '0 0 calc(50% - 4px)',
              gap: useColumnLayout ? 4 : 0,
              maxWidth: useColumnLayout ? '100%' : 'calc(50% - 4px)',
              minWidth: 0,
              overflow: 'hidden',
              padding: useColumnLayout ? 5 : 3,
              position: useColumnLayout ? 'relative' : undefined,
              width: useColumnLayout ? '100%' : undefined,
            }}>
              {useColumnLayout && (
                <div style={{
                  alignItems: 'center',
                  background: graphColor.badge,
                  border: '1px solid rgba(255,255,255,0.22)',
                  borderRadius: 3,
                  color: '#ffffff',
                  display: 'flex',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: 9,
                  fontWeight: 950,
                  fontVariantNumeric: 'tabular-nums',
                  height: 20,
                  justifyContent: 'center',
                  minWidth: 28,
                  paddingLeft: 4,
                  paddingRight: 4,
                  position: 'absolute',
                  right: 4,
                  top: 4,
                }}>
                  {formatGraphValue(graphValue)}
                </div>
              )}
              {useColumnLayout && (
                <div style={{
                  color: graphColor.accent,
                  fontSize: 8,
                  fontWeight: 900,
                  letterSpacing: 1.5,
                  overflow: 'hidden',
                  textAlign: 'left',
                  textOverflow: 'ellipsis',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  paddingRight: 36,
                  width: '100%',
                }}>
                  {getGraphDisplayLabel(graph)}
                </div>
              )}
              <div style={{
                alignItems: 'stretch',
                display: 'flex',
                gap: 6,
                minWidth: 0,
                width: '100%',
              }}>
              {!useColumnLayout && (
                <div style={{
                  alignItems: 'center',
                  background: graphColor.badge,
                  border: '1px solid rgba(255,255,255,0.22)',
                  borderRadius: 3,
                  color: '#ffffff',
                  display: 'flex',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: 20,
                  fontWeight: 950,
                  fontVariantNumeric: 'tabular-nums',
                  height: 58,
                  justifyContent: 'center',
                  width: 58,
                }}>
                  {formatGraphValue(graphValue)}
                </div>
              )}
              <div style={{
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                gap: 3,
                minWidth: 0,
                padding: useColumnLayout ? '2px 0' : '2px 8px',
              }}>
                {!useColumnLayout && <div style={{
                  color: graphColor.accent,
                  fontSize: 10,
                  fontWeight: 900,
                  letterSpacing: 1.8,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}>
                  {getGraphDisplayLabel(graph)}
                </div>}
                <div style={{
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: 4,
                  height: useColumnLayout ? 20 : 16,
                  overflow: 'visible',
                  position: 'relative',
                  width: '100%',
                }}>
                  <div style={{
                    bottom: 0,
                    left: useColumnLayout ? 0 : 4,
                    overflow: 'visible',
                    position: 'absolute',
                    right: useColumnLayout ? 0 : 4,
                    top: 0,
                  }}>
                    {segments.map((segment, index) => {
                    if (segment.frame >= duration) return null;
                    const segmentEndFrame = Math.min(segment.endFrame, duration);
                    const left = (segment.frame / duration) * 100;
                    const segmentWidth = ((segmentEndFrame - segment.frame) / duration) * 100;
                    const markerLeft = isBarGraph ? left + segmentWidth / 2 : left;
                    const top = 100 - ((segment.value - graph.min) / valueRange) * 100;
                    const nextSegment = !isBarGraph ? segments[index + 1] : undefined;
                    const nextLeft = nextSegment ? (nextSegment.frame / duration) * 100 : left;
                    const nextTop = nextSegment ? 100 - ((nextSegment.value - graph.min) / valueRange) * 100 : top;

                    return (
                      <React.Fragment key={`${segment.frame}-${index}`}>
                        {isBarGraph ? (
                          <div style={{
                            background: graphColor.fill,
                            bottom: 0,
                            left: `${left}%`,
                            position: 'absolute',
                            top: `${top}%`,
                            width: `calc(${segmentWidth}% + 1px)`,
                          }} />
                        ) : nextSegment ? (
                          <svg style={{ height: '100%', inset: 0, overflow: 'visible', position: 'absolute', width: '100%' }} preserveAspectRatio="none">
                            <line
                              x1={`${left}%`}
                              y1={`${top}%`}
                              x2={`${nextLeft}%`}
                              y2={`${nextTop}%`}
                              stroke={graphColor.line}
                              strokeWidth="2"
                              vectorEffect="non-scaling-stroke"
                            />
                          </svg>
                        ) : null}
                        <div
                          style={{
                            background: graphColor.line,
                            border: '1px solid rgba(0,0,0,0.62)',
                            borderRadius: 999,
                            boxShadow: `0 0 7px ${graphColor.border}`,
                            height: 7,
                            left: `${markerLeft}%`,
                            position: 'absolute',
                            top: `${top}%`,
                            transform: 'translate(-50%, -50%)',
                            width: 7,
                          }}
                        />
                      </React.Fragment>
                    );
                  })}
                  </div>
                  <div style={{
                    background: '#ffffff',
                    bottom: 0,
                    boxShadow: '0 0 10px rgba(255,255,255,0.7)',
                    left: useColumnLayout
                      ? `${currentProgress * 100}%`
                      : `calc(${currentProgress * 100}% + ${4 - 8 * currentProgress}px)`,
                    position: 'absolute',
                    top: 0,
                    width: 1,
                  }} />
                </div>
              </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const RenderAnalysisOverlay = ({
  activeDialogs,
  frame,
  fps,
  graphNotes,
  graphTracks,
  totalDuration,
}: {
  activeDialogs: TimelineClip[];
  frame: number;
  fps: number;
  graphNotes: ReturnType<typeof getRenderClipNotes>;
  graphTracks: TimelineTrack[];
  totalDuration: number;
}) => {
  if (graphTracks.length === 0 && graphNotes.length === 0 && activeDialogs.length === 0) return null;

  const metrics = graphTracks.slice(0, 4).map((track, graphIndex) => {
    const graph = track.graph!;
    return {
      track,
      graph,
      color: getGraphColor(graph, graphIndex),
      value: getGraphValueAtFrame(graph, frame),
      duration: Math.min(Math.max(1, totalDuration), getGraphDisplayDuration([track], fps)),
    };
  });
  const analysisText = graphNotes[0]?.note || activeDialogs[0]?.description || activeDialogs[0]?.name || 'Live narrative signals are updating across the active scene.';
  const detectedEvents = activeDialogs.map((dialog) => dialog.description?.trim() || dialog.name).slice(0, 2);
  const storyElements = graphNotes.slice(0, 2).map((note) => note.note);
  const metricShifts = metrics.filter((item) => shouldShowGraphValue(item.graph)).slice(0, 4);

  return (
    <div style={{
      bottom: 0,
      color: '#ffffff',
      fontFamily: 'Arial, Helvetica, sans-serif',
      left: 0,
      overflow: 'hidden',
      position: 'absolute',
      right: 0,
      top: 0,
      zIndex: 70,
    }}>
      <div style={{
        background: 'radial-gradient(circle at 25% 45%, transparent 0, rgba(0,0,0,0.04) 30%, rgba(0,0,0,0.7) 100%)',
        bottom: 0,
        left: 0,
        position: 'absolute',
        right: 0,
        top: 0,
      }} />
      {metrics.length > 0 && (
        <div style={{
          background: 'rgba(9,9,13,0.9)',
          boxShadow: '0 28px 80px rgba(0,0,0,0.52)',
          left: '3%',
          padding: 28,
          position: 'absolute',
          top: '3%',
          width: '25%',
        }}>
          <div style={{ color: '#64748b', fontSize: 23, fontWeight: 900, letterSpacing: 5, marginBottom: 26, textTransform: 'uppercase' }}>
            Core Narrative Metrics
          </div>
          {metrics.map(({ track, graph, color, value, duration }) => {
            const points = graph.points.length ? [...graph.points].sort((a, b) => a.frame - b.frame) : [{ frame: 0, value: graph.min }];
            const valueRange = Math.max(1, graph.max - graph.min);

            return (
              <div key={track.id} style={{ marginBottom: 28 }}>
                <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ color: '#64748b', fontSize: 20, fontWeight: 900, letterSpacing: 6, overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{graph.label}</span>
                  <span style={{ color: color.accent, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 24, fontWeight: 950 }}>{formatGraphValue(value)}</span>
                </div>
                <div style={{ background: 'rgba(0,0,0,0.58)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, height: 70, overflow: 'hidden', position: 'relative' }}>
                  {[25, 50, 75].map((top) => (
                    <div key={top} style={{ borderTop: '1px dashed rgba(255,255,255,0.1)', left: 8, position: 'absolute', right: 8, top: `${top}%` }} />
                  ))}
                  <svg style={{ bottom: 8, left: 8, overflow: 'visible', position: 'absolute', right: 8, top: 8, width: 'calc(100% - 16px)', height: 'calc(100% - 16px)' }} preserveAspectRatio="none">
                    <polyline
                      fill="none"
                      points={points.map((point) => {
                        const x = Math.max(0, Math.min(100, (point.frame / duration) * 100));
                        const y = 100 - ((point.value - graph.min) / valueRange) * 100;
                        return `${x},${Math.max(0, Math.min(100, y))}`;
                      }).join(' ')}
                      stroke={color.line}
                      strokeWidth="4"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{
        background: 'rgba(9,9,13,0.93)',
        borderLeft: '4px solid #f59e0b',
        bottom: '3%',
        boxShadow: '0 28px 90px rgba(0,0,0,0.58)',
        boxSizing: 'border-box',
        padding: '34px 42px',
        position: 'absolute',
        right: '3%',
        top: '3%',
        width: '58%',
      }}>
        <div style={{ color: '#f8fafc', fontSize: 30, fontWeight: 950, letterSpacing: 5, textTransform: 'uppercase' }}>Vector Analysis</div>
        <div style={{ color: '#94a3b8', fontSize: 24, fontStyle: 'italic', fontWeight: 700, lineHeight: 1.45, marginTop: 24, maxHeight: 104, overflow: 'hidden' }}>
          &quot;{analysisText}&quot;
        </div>
        <div style={{ background: 'rgba(255,255,255,0.1)', height: 1, margin: '28px 0' }} />
        <div style={{ display: 'grid', gap: 40, gridTemplateColumns: '1.1fr 0.9fr', height: 'calc(100% - 206px)', overflow: 'hidden' }}>
          <div style={{ minWidth: 0, overflow: 'hidden' }}>
            <div style={{ color: '#64748b', fontSize: 22, fontWeight: 950, letterSpacing: 4, marginBottom: 26, textTransform: 'uppercase' }}>Metric Shifts & Analysis</div>
            {(metricShifts.length ? metricShifts : metrics.slice(0, 1)).map(({ track, graph, color, value }) => (
              <div key={track.id} style={{ borderLeft: `4px solid ${color.line}`, marginBottom: 28, paddingLeft: 20 }}>
                <div style={{ color: color.accent, fontSize: 20, fontWeight: 950, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                  {graph.label}: {formatGraphValue(value)}
                </div>
                <div style={{ color: '#cbd5e1', fontSize: 21, fontWeight: 700, lineHeight: 1.25, marginTop: 12, maxHeight: 82, overflow: 'hidden' }}>
                  {graph.points.filter((point) => point.frame <= frame).at(-1)?.note || `${graph.label} is currently tracking at ${formatGraphValue(value)} across the active beat.`}
                </div>
              </div>
            ))}
          </div>
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', minWidth: 0, overflow: 'hidden', paddingLeft: 40 }}>
            <div style={{ color: '#64748b', fontSize: 22, fontWeight: 950, letterSpacing: 4, marginBottom: 24, textTransform: 'uppercase' }}>Detected Events</div>
            {(detectedEvents.length ? detectedEvents : ['Monitoring active scene events']).map((event, index) => (
              <div key={`${event}-${index}`} style={{ color: '#cbd5e1', display: 'flex', fontSize: 21, fontWeight: 700, gap: 18, lineHeight: 1.3, marginBottom: 18 }}>
                <span style={{ color: '#f59e0b' }}>▶</span>
                <span>{event}</span>
              </div>
            ))}
            <div style={{ background: 'rgba(255,255,255,0.1)', height: 1, margin: '32px 0' }} />
            <div style={{ color: '#64748b', fontSize: 22, fontWeight: 950, letterSpacing: 4, marginBottom: 24, textTransform: 'uppercase' }}>Story Elements</div>
            {(storyElements.length ? storyElements : graphNotes.map((note) => note.note).slice(0, 1)).map((item, index) => (
              <div key={`${item}-${index}`} style={{ color: '#cbd5e1', fontSize: 21, fontWeight: 700, lineHeight: 1.3, marginBottom: 18 }}>
                <div style={{ color: '#f59e0b', fontSize: 20, fontWeight: 950, letterSpacing: 1.5, marginBottom: 10, textTransform: 'uppercase' }}>▲ Analysis</div>
                <div>{item}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const getColor = (clip: TimelineClip) => {
  if (!clip.color) return '#000000';
  return colorMap[clip.color] || clip.color;
};

const getParentGrid = (count: number) => {
  if (count <= 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
  if (count === 2) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
  if (count === 3) return { gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr' };
  return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
};

const getPanelAspect = (aspectRatio: string) => {
  if (aspectRatio === '21:9') return '21 / 9';
  return '16 / 9';
};

const dialogPanelSplit = {
  detail: { bottom: 0, boxSizing: 'border-box' as const, left: '66.6667%', overflow: 'hidden' as const, position: 'absolute' as const, top: 0, width: '33.3333%' },
  visual: { bottom: 0, left: 0, position: 'absolute' as const, top: 0, width: '66.6667%' },
};
const fullPanelVisual = { bottom: 0, left: 0, position: 'absolute' as const, top: 0, width: '100%' };

const getAnchorStyle = (anchor?: TimelineClip['anchorPoint']): React.CSSProperties => {
  const offset = 24;
  switch (anchor) {
    case 'top-left':
      return { top: offset, left: offset };
    case 'top-right':
      return { top: offset, right: offset };
    case 'bottom-left':
      return { bottom: offset, left: offset };
    case 'bottom-right':
      return { bottom: offset, right: offset };
    case 'top':
      return { top: offset, left: '50%', transform: 'translateX(-50%)' };
    case 'bottom':
      return { bottom: offset, left: '50%', transform: 'translateX(-50%)' };
    case 'left':
      return { left: offset, top: '50%', transform: 'translateY(-50%)' };
    case 'right':
      return { right: offset, top: '50%', transform: 'translateY(-50%)' };
    case 'center':
    default:
      return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  }
};

const EmptyInput = () => (
  <div style={{
    alignItems: 'center',
    background: 'rgba(255,255,255,0.01)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: 4,
    color: '#27272a',
    display: 'flex',
    fontFamily: 'monospace',
    fontSize: 18,
    height: '100%',
    justifyContent: 'center',
    letterSpacing: 4,
    textTransform: 'uppercase',
    width: '100%',
  }}>
    No Input
  </div>
);

const Media = ({ clip }: { clip: TimelineClip }) => {
  if (!clip.src) return null;

  if (clip.type === 'video') {
    return <Video src={clip.src} muted style={{ height: '100%', inset: 0, objectFit: 'cover', position: 'absolute', width: '100%' }} />;
  }

  if (clip.type === 'image') {
    return <Img src={clip.src} style={{ height: '100%', inset: 0, objectFit: 'cover', position: 'absolute', width: '100%' }} />;
  }

  return null;
};

const ClipCard = ({
  clip,
  characters,
  isSingle,
  durationInFrames,
}: {
  clip: TimelineClip;
  characters: Character[];
  isSingle: boolean;
  durationInFrames?: number;
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - clip.startFrame;
  const animation = getCssVisualStyle(getClipVisualState(clip, localFrame));
  const characterName = getCharacterName(clip, characters);
  const characterImage = getCharacterImage(clip, characters);
  const hasMedia = Boolean(clip.src && clip.type !== 'dialog');
  const showLabel = clip.type !== 'image';

  return (
    <Sequence from={clip.startFrame} durationInFrames={durationInFrames || clip.duration}>
      <div style={{
        ...animation,
        alignItems: 'center',
        background: '#000000',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 4,
        boxShadow: 'inset 0 2px 16px rgba(255,255,255,0.04)',
        display: 'flex',
        height: '100%',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}>
        <div style={{ background: getColor(clip), inset: 0, opacity: 0.4, position: 'absolute' }} />
        <div style={{
          background: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.22), transparent 55%)',
          filter: 'blur(26px)',
          inset: '-20%',
          opacity: 0.2,
          position: 'absolute',
          transform: 'rotate(12deg)',
        }} />
        {hasMedia && <Media clip={clip} />}
        {showLabel && (
          <div style={{
            alignItems: 'center',
            background: hasMedia ? 'linear-gradient(to top, rgba(0,0,0,0.92), rgba(0,0,0,0.54), transparent)' : undefined,
            bottom: hasMedia ? 0 : undefined,
            color: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            left: hasMedia ? 0 : undefined,
            maxWidth: hasMedia ? '100%' : '82%',
            padding: hasMedia ? 22 : 32,
            position: hasMedia ? 'absolute' : 'relative',
            right: hasMedia ? 0 : undefined,
            textAlign: 'center',
            textShadow: '0 8px 24px rgba(0,0,0,0.7)',
            zIndex: 2,
          }}>
            {clip.type === 'dialog' && characterImage && (
              <Img
                src={characterImage}
                style={{
                  border: '1px solid rgba(255,255,255,0.22)',
                  borderRadius: 999,
                  boxShadow: '0 12px 36px rgba(0,0,0,0.38)',
                  height: isSingle ? 96 : 54,
                  marginBottom: 12,
                  objectFit: 'cover',
                  width: isSingle ? 96 : 54,
                }}
              />
            )}
            {clip.type === 'dialog' && characterName && (
              <div style={{
                background: '#ffffff',
                borderRadius: 4,
                color: '#000000',
                fontSize: isSingle ? 20 : 12,
                fontWeight: 900,
                letterSpacing: 2,
                marginBottom: 10,
                padding: '4px 10px',
                textTransform: 'uppercase',
              }}>
                {characterName}
              </div>
            )}
            <div style={{
              fontSize: isSingle ? 84 : 28,
              fontWeight: 950,
              letterSpacing: -2,
              lineHeight: 0.95,
              textTransform: 'uppercase',
            }}>
              {clip.name}
            </div>
            {clip.description && (
              <div style={{
                color: '#a1a1aa',
                fontSize: isSingle ? 24 : 15,
                lineHeight: 1.35,
                marginTop: 14,
                maxWidth: 420,
              }}>
                {clip.description}
              </div>
            )}
          </div>
        )}
      </div>
    </Sequence>
  );
};

const OverlayClip = ({ clip, characters }: { clip: TimelineClip; characters: Character[] }) => {
  const frame = useCurrentFrame();
  const localFrame = frame - clip.startFrame;
  const animation = getCssVisualStyle(getClipVisualState(clip, localFrame));
  const characterName = getCharacterName(clip, characters);
  const characterImage = getCharacterImage(clip, characters);
  const anchorStyle = getAnchorStyle(clip.anchorPoint);

  return (
    <Sequence from={clip.startFrame} durationInFrames={clip.duration}>
      <div style={{
        ...anchorStyle,
        opacity: animation.opacity,
        filter: animation.filter,
        background: clip.type === 'dialog' ? 'rgba(0,0,0,0.72)' : '#000000',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 5,
        boxShadow: '0 18px 50px rgba(0,0,0,0.42)',
        color: '#ffffff',
        minWidth: 220,
        maxWidth: '80%',
        overflow: 'hidden',
        padding: clip.type === 'dialog' ? '14px 26px' : 0,
        position: 'absolute',
        textAlign: 'center',
        zIndex: 10,
      }}>
        {clip.type !== 'dialog' && (
          <div style={{ aspectRatio: '16 / 9', height: 260, position: 'relative', width: 420 }}>
            <div style={{ background: getColor(clip), inset: 0, opacity: 0.4, position: 'absolute' }} />
            <Media clip={clip} />
          </div>
        )}
        {clip.type === 'dialog' && (
          <>
            {characterImage && (
              <Img
                src={characterImage}
                style={{
                  border: '1px solid rgba(255,255,255,0.22)',
                  borderRadius: 999,
                  boxShadow: '0 10px 28px rgba(0,0,0,0.38)',
                  height: 56,
                  margin: '0 auto 10px',
                  objectFit: 'cover',
                  width: 56,
                }}
              />
            )}
            {characterName && (
              <div style={{ color: '#a1a1aa', fontSize: 14, fontWeight: 800, letterSpacing: 1.5, marginBottom: 4, textTransform: 'uppercase' }}>
                {characterName}
              </div>
            )}
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>{clip.name}</div>
          </>
        )}
      </div>
    </Sequence>
  );
};

const RenderBottomMessages = ({
  characters,
  dialogs,
  fps,
  frame,
  graphNotes,
  multilineDialogs = false,
}: {
  characters: Character[];
  dialogs: TimelineClip[];
  fps: number;
  frame: number;
  graphNotes: ReturnType<typeof getRenderGraphNotes>;
  multilineDialogs?: boolean;
}) => {
  if (dialogs.length === 0 && graphNotes.length === 0) return null;

  return (
    <div style={{
      alignItems: 'center',
      bottom: 18,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      left: 18,
      pointerEvents: 'none',
      position: 'absolute',
      right: 18,
      textAlign: 'left',
      zIndex: 60,
    }}>
      {graphNotes.map((item) => (
        <div key={item.id} style={{
          background: 'rgba(0,0,0,0.80)',
          border: `1px solid ${item.color.border}`,
          borderRadius: 8,
          boxShadow: '0 18px 42px rgba(0,0,0,0.38)',
          color: '#ffffff',
          maxWidth: 820,
          opacity: item.opacity,
          padding: '10px 16px',
          transform: `translateY(${item.offsetY}px)`,
          width: '94%',
        }}>
          <div style={{ alignItems: 'flex-start', display: 'flex', gap: 12 }}>
            <div style={{
              alignItems: 'center',
              background: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.16)',
              borderRadius: 5,
              color: item.color.accent,
              display: 'flex',
              flexShrink: 0,
              height: 28,
              justifyContent: 'center',
              width: 28,
            }}>
              <svg viewBox="0 0 16 16" style={{ height: 18, width: 18 }} fill="none">
                <path d="M4 2.5h6.5L13 5v8.5H4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M10.5 2.5V5H13M6 7.5h4M6 10h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ color: '#ffffff', flex: 1, fontSize: 22, fontWeight: 700, lineHeight: 1.18, minWidth: 0, overflowWrap: 'break-word' }}>
              {item.note}
            </div>
          </div>
        </div>
      ))}
      {dialogs.map((dialog) => {
        const characterImage = getCharacterImage(dialog, characters);
        const characterName = getCharacterName(dialog, characters);
        const dialogVisualStyle = getCssVisualStyle(getClipVisualState(dialog, frame - dialog.startFrame));
        const enterProgress = easeOutQuart((frame - dialog.startFrame) / Math.max(1, Math.round(fps * 0.18)));
        const exitProgress = easeOutQuart((dialog.startFrame + dialog.duration - frame) / Math.max(1, Math.round(fps * 0.18)));
        const opacity = Math.min(dialogVisualStyle.opacity ?? 1, enterProgress, exitProgress);
        const exitOffset = (1 - exitProgress) * 18;
        const enterOffset = (1 - enterProgress) * 18;

        return (
          <div key={`${getDialogSpeakerKey(dialog)}-${dialog.id}`} style={{
            alignItems: 'center',
            background: 'rgba(0,0,0,0.72)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            boxShadow: '0 18px 42px rgba(0,0,0,0.38)',
            color: '#ffffff',
            display: 'flex',
            gap: 18,
            maxWidth: 820,
            opacity,
            padding: '10px 16px',
            transform: `translateY(${Math.max(enterOffset, exitOffset)}px) scale(${0.98 + Math.min(enterProgress, exitProgress) * 0.02})`,
            width: '94%',
          }}>
            <div style={{ alignItems: 'center', display: 'flex', flexShrink: 0, gap: 10 }}>
              {characterImage ? (
                <Img
                  src={characterImage}
                  style={{
                    border: '1px solid rgba(255,255,255,0.22)',
                    borderRadius: 999,
                    boxShadow: '0 14px 42px rgba(0,0,0,0.42)',
                    height: 52,
                    objectFit: 'cover',
                    width: 52,
                  }}
                />
              ) : (
                <div style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 999,
                  boxShadow: '0 14px 42px rgba(0,0,0,0.42)',
                  height: 52,
                  width: 52,
                }} />
              )}
              {characterName && (
                <div style={{
                  background: '#ffffff',
                  borderRadius: 4,
                  color: '#000000',
                  fontSize: 11,
                  fontWeight: 900,
                  letterSpacing: 1.8,
                  maxWidth: 132,
                  overflow: 'hidden',
                  padding: '4px 8px',
                  textOverflow: 'ellipsis',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}>
                  {characterName}
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                color: '#ffffff',
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: -0.2,
                lineHeight: 1.16,
                overflow: multilineDialogs ? undefined : 'hidden',
                overflowWrap: multilineDialogs ? 'break-word' : undefined,
                textOverflow: multilineDialogs ? undefined : 'ellipsis',
                whiteSpace: multilineDialogs ? 'normal' : 'nowrap',
              }}>
                {dialog.name}
              </div>
              {dialog.description && (
                <div style={{
                  color: '#d4d4d8',
                  fontSize: 19,
                  lineHeight: 1.25,
                  marginTop: 4,
                  overflow: multilineDialogs ? undefined : 'hidden',
                  overflowWrap: multilineDialogs ? 'break-word' : undefined,
                  textOverflow: multilineDialogs ? undefined : 'ellipsis',
                  whiteSpace: multilineDialogs ? 'normal' : 'nowrap',
                }}>
                  {dialog.description}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const RenderTopNotes = ({
  graphNotes,
  top,
  align = 'center',
}: {
  graphNotes: ReturnType<typeof getRenderGraphNotes>;
  top: number;
  align?: 'center' | 'right';
}) => {
  if (graphNotes.length === 0) return null;

  return (
    <div style={{
      alignItems: align === 'right' ? 'stretch' : 'center',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      left: align === 'right' ? undefined : 18,
      pointerEvents: 'none',
      position: 'absolute',
      right: align === 'right' ? 8 : 18,
      textAlign: 'left',
      top,
      width: align === 'right' ? 'calc(50% - 12px)' : undefined,
      zIndex: 58,
    }}>
      {graphNotes.map((item) => (
        <div key={item.id} style={{
          background: 'rgba(0,0,0,0.80)',
          border: `1px solid ${item.color.border}`,
          borderRadius: align === 'right' ? 5 : 8,
          boxSizing: 'border-box',
          boxShadow: '0 18px 42px rgba(0,0,0,0.38)',
          color: '#ffffff',
          height: align === 'right' ? 64 : undefined,
          maxWidth: align === 'right' ? undefined : 820,
          opacity: item.opacity,
          overflow: 'hidden',
          padding: align === 'right' ? 3 : '10px 16px',
          transform: `translateY(${item.offsetY}px)`,
          width: align === 'right' ? '100%' : '94%',
        }}>
          <div style={{ alignItems: align === 'right' ? 'center' : 'flex-start', display: 'flex', gap: align === 'right' ? 8 : 12, height: '100%', padding: align === 'right' ? '0 8px' : undefined }}>
            <div style={{
              alignItems: 'center',
              background: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.16)',
              borderRadius: 5,
              color: item.color.accent,
              display: 'flex',
              flexShrink: 0,
              height: align === 'right' ? 58 : 28,
              justifyContent: 'center',
              width: align === 'right' ? 58 : 28,
            }}>
              <svg viewBox="0 0 16 16" style={{ height: align === 'right' ? 24 : 18, width: align === 'right' ? 24 : 18 }} fill="none">
                <path d="M4 2.5h6.5L13 5v8.5H4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M10.5 2.5V5H13M6 7.5h4M6 10h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{
              color: '#ffffff',
              display: align === 'right' ? '-webkit-box' : undefined,
              flex: 1,
              fontSize: align === 'right' ? 20 : 22,
              fontWeight: 700,
              lineHeight: align === 'right' ? 1.15 : 1.18,
              minWidth: 0,
              overflow: align === 'right' ? 'hidden' : undefined,
              overflowWrap: 'break-word',
              WebkitBoxOrient: align === 'right' ? 'vertical' : undefined,
              WebkitLineClamp: align === 'right' ? 2 : undefined,
            }}>
              {item.note}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export const TimelineVideo = ({ project }: TimelineVideoProps) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const scene = project.scenes.find((item) => item.id === project.activeSceneId) || project.scenes[0];
  const aspectRatio = project.config?.aspectRatio || '16:9';
  const useAnalysisOverlay = project.config?.analyticsOverlayStyle === 'analysis';
  const disabledTrackIds = project.disabledTrackIds || [];
  const activeClips = scene.clips.filter((clip) => frame >= clip.startFrame && frame < clip.startFrame + clip.duration);
  const enabledParents = scene.tracks.filter((track) => !track.parentId && !disabledTrackIds.includes(track.id));
  const hasDialogGridItemGroups = enabledParents.some((parent) => parent.showDialogGridItem);

  if (hasDialogGridItemGroups) {
    const fps = project.config?.fps || 30;
    const graphValueAnimationFrames = Math.max(1, Math.round(fps * 0.38));
    const getVisualTrackIdsForParent = (parentId: string) => scene.tracks
      .filter((track) => (
        track.parentId === parentId &&
        track.type !== 'graph' &&
        !disabledTrackIds.includes(track.id)
      ))
      .map((track) => track.id);
    const parentHasVisualContent = (parentId: string) => {
      const visualTrackIds = getVisualTrackIdsForParent(parentId);
      return scene.clips.some((clip) => (
        clip.type !== 'dialog' &&
        clip.type !== 'note' &&
        visualTrackIds.includes(clip.trackId)
      ));
    };
    const visualParents = enabledParents.filter((parent) => parentHasVisualContent(parent.id));
    const firstDialogGridParentIndex = visualParents.findIndex((parent) => parent.showDialogGridItem);
    const graphOnlyParentIds = enabledParents
      .filter((parent) => !parentHasVisualContent(parent.id))
      .map((parent) => parent.id);
    const detachedGraphTrackIds = scene.tracks
      .filter((track) => (
        track.type === 'graph' &&
        track.graph &&
        track.parentId &&
        graphOnlyParentIds.includes(track.parentId) &&
        !disabledTrackIds.includes(track.id)
      ))
      .map((track) => track.id);
    const estimatedGroupWidth = visualParents.length <= 1
      ? width - 64
      : (width - 64) / Math.min(visualParents.length, 3);
    const estimatedDetailWidth = estimatedGroupWidth / 3;
    const visualGroups = visualParents.map((parent, parentIndex) => {
      const groupTrackIds = scene.tracks
        .filter((track) => track.parentId === parent.id && !disabledTrackIds.includes(track.id))
        .map((track) => track.id);
      const graphTrackIds = parent.showDialogGridItem && parentIndex === firstDialogGridParentIndex
        ? [...groupTrackIds, ...detachedGraphTrackIds]
        : groupTrackIds;
      const groupVisualTrackIds = getVisualTrackIdsForParent(parent.id);
      const groupGraphTracks = scene.tracks.filter((track) => (
        track.type === 'graph' &&
        track.graph &&
        graphTrackIds.includes(track.id)
      ));
      const graphDuration = getGraphDisplayDuration(groupGraphTracks, fps);
      const activeGraphNotes = getGraphNotesAtFrame(groupGraphTracks, frame, fps);
      const activeNotes = activeClips.filter((clip) => clip.type === 'note' && groupVisualTrackIds.includes(clip.trackId));

      return {
        id: parent.id,
        activeDialogs: activeClips
          .filter((clip) => clip.type === 'dialog' && groupVisualTrackIds.includes(clip.trackId))
          .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id)),
        activeGraphNoteIds: new Set(activeGraphNotes.map((note) => note.id)),
        activeGraphValues: groupGraphTracks
          .map((track, graphIndex) => ({
            id: track.id,
            label: getGraphDisplayLabel(track.graph!),
            ...getAnimatedGraphValueAtFrame(track.graph!, frame, graphValueAnimationFrames),
            color: getGraphColor(track.graph!, graphIndex),
          }))
          .filter((_, index) => shouldShowGraphValue(groupGraphTracks[index].graph!)),
        graphTracks: groupGraphTracks,
        groupTrackIds,
        groupDuration: graphDuration,
        graphUiLayout: (parent.graphUiLayout === 'column' || parent.graphUiLayout === 'column-many' ? 'column' : 'grid') as TimelineTrack['graphUiLayout'],
        notePlacement: parent.notePlacement === 'graph' ? 'graph' : 'dialog',
        renderGraphNotes: getRenderClipNotes(activeNotes),
        showDialogGridItem: !!parent.showDialogGridItem,
        visualGridClips: getAnimatedGridLayout(
          scene.clips.filter((clip) => clip.type !== 'dialog' && clip.type !== 'note' && groupVisualTrackIds.includes(clip.trackId)),
          frame,
          groupVisualTrackIds
        ),
      };
    });

    return (
      <AbsoluteFill style={{ background: '#050505', color: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div style={{
          display: 'grid',
          gap: 14,
          height,
          padding: 32,
          width,
          ...getParentGrid(visualGroups.length),
        }}>
          {visualGroups.length === 0 ? (
            <div style={{
              alignItems: 'center',
              color: '#27272a',
              display: 'flex',
              fontFamily: 'monospace',
              fontSize: 24,
              justifyContent: 'center',
              letterSpacing: 5,
              textTransform: 'uppercase',
            }}>
              No Output
            </div>
          ) : visualGroups.map((group) => {
            const visualPanelStyle = group.showDialogGridItem && !useAnalysisOverlay ? dialogPanelSplit.visual : fullPanelVisual;

            return (
            <div key={group.id} style={{ alignItems: 'center', display: 'flex', height: '100%', justifyContent: 'center', minHeight: 0, minWidth: 0, position: 'relative', width: '100%' }}>
              <div style={{
                aspectRatio: getPanelAspect(aspectRatio),
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: 6,
                boxShadow: '0 28px 80px rgba(0,0,0,0.42)',
                maxHeight: '100%',
                maxWidth: '100%',
                overflow: 'hidden',
                position: 'relative',
                width: '100%',
              }}>
                <div style={visualPanelStyle}>
                  {group.visualGridClips.length === 0 ? (
                    <div style={{ height: '100%', width: '100%' }}>
                      <EmptyInput />
                    </div>
                  ) : group.visualGridClips.map(({ clip, rect }) => (
                    <div
                      key={clip.id}
                      style={{
                        height: `${rect.height}%`,
                        left: `${rect.left}%`,
                        minHeight: 0,
                        minWidth: 0,
                        padding: 3,
                        position: 'absolute',
                        top: `${rect.top}%`,
                        width: `${rect.width}%`,
                      }}
                    >
                      <ClipCard
                        clip={clip}
                        characters={project.characters}
                        durationInFrames={clip.duration + LAYOUT_TRANSITION_FRAMES}
                        isSingle={group.visualGridClips.length === 1}
                      />
                    </div>
                  ))}
                  {useAnalysisOverlay ? (
                    <RenderAnalysisOverlay
                      activeDialogs={group.activeDialogs}
                      frame={frame}
                      fps={fps}
                      graphNotes={group.renderGraphNotes}
                      graphTracks={group.graphTracks}
                      totalDuration={group.groupDuration}
                    />
                  ) : group.showDialogGridItem ? (
                    <GraphValueBadges items={group.activeGraphValues} />
                  ) : (
                    <CompactTopGraphOverlay
                      frame={frame}
                      fps={fps}
                      graphTracks={group.graphTracks}
                      totalDuration={group.groupDuration}
                      graphUiLayout={group.graphUiLayout}
                    />
                  )}
                  {!useAnalysisOverlay && group.notePlacement === 'graph' && (
                    <RenderTopNotes
                      graphNotes={group.renderGraphNotes}
                      top={8}
                      align="right"
                    />
                  )}
                  {!useAnalysisOverlay && <RenderBottomMessages
                    characters={project.characters}
                    dialogs={group.activeDialogs}
                    fps={fps}
                    frame={frame}
                    graphNotes={group.notePlacement === 'graph' ? [] : group.renderGraphNotes}
                    multilineDialogs={!group.showDialogGridItem}
                  />}
                </div>

                {group.showDialogGridItem && !useAnalysisOverlay && (
                <div style={dialogPanelSplit.detail}>
                  <div style={{
                    alignItems: 'flex-start',
                    background: 'rgba(0,0,0,0.75)',
                    border: '1px solid rgba(192,132,252,0.22)',
                    borderRadius: 4,
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    height: '100%',
                    justifyContent: 'center',
                    maxWidth: '100%',
                    minWidth: 0,
                    overflow: 'hidden',
                    padding: 6,
                    position: 'relative',
                    textAlign: 'center',
                    width: '100%',
                  }}>
                    {group.graphTracks.length > 0 && (
                      <div style={{ maxWidth: '100%', minWidth: 0, overflow: 'hidden', position: 'relative', width: '100%' }}>
                        {group.graphTracks.map((track, graphIndex) => {
                      const graph = track.graph!;
                      const graphColor = getGraphColor(graph, graphIndex);
                      const graphHasValueAxis = shouldShowGraphValue(graph);
                      const valueRange = Math.max(1, graph.max - graph.min);
                      const sourcePoints = graph.points.length ? [...graph.points].sort((a, b) => a.frame - b.frame) : [{ frame: 0, value: graph.min }];
                      const duration = getGraphDisplayDuration([track], fps);
                      const segments = sourcePoints.map((point, index) => ({
                        ...point,
                        endFrame: sourcePoints[index + 1]?.frame ?? duration,
                      }));

                      return (
                        <div key={track.id} style={{
                          background: 'rgba(0,0,0,0.4)',
                          border: '1px solid rgba(192,132,252,0.15)',
                          borderRadius: 8,
                          boxSizing: 'border-box',
                          height: graphHasValueAxis ? 126 : 60,
                          marginTop: 10,
                          maxWidth: '100%',
                          minWidth: 0,
                          overflow: 'hidden',
                          padding: '8px 8px',
                          position: 'relative',
                          width: '100%',
                        }}>
                          <div style={{
                            alignItems: 'baseline',
                            color: graphColor.accent,
                            display: 'flex',
                            fontSize: graphHasValueAxis ? 16 : 14,
                            fontWeight: 900,
                            gap: 8,
                            letterSpacing: 2.5,
                            marginBottom: 8,
                            minWidth: 0,
                            overflow: 'hidden',
                            textTransform: 'uppercase',
                          }}>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getGraphDisplayLabel(graph)}</span>
                            {graphHasValueAxis && (
                              <span style={{
                                color: '#71717a',
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                fontSize: 11,
                                letterSpacing: 0,
                              }}>
                                ({graph.min}-{graph.max})
                              </span>
                            )}
                          </div>
                          <div style={{
                            background: 'rgba(255,255,255,0.03)',
                            borderRadius: 5,
                            height: graphHasValueAxis ? 72 : 18,
                            marginLeft: 0,
                            overflow: 'visible',
                            position: 'relative',
                          }}>
                            <div style={{ bottom: 0, left: 4, overflow: 'visible', position: 'absolute', right: 4, top: 0 }}>
                            {segments.map((segment, index) => {
                              if (segment.frame >= duration) return null;
                              const segmentEndFrame = Math.min(segment.endFrame, duration);
                              const left = (segment.frame / duration) * 100;
                              const lineWidth = ((segmentEndFrame - segment.frame) / duration) * 100;
                              const top = graphHasValueAxis ? 100 - ((segment.value - graph.min) / valueRange) * 100 : 50;
                              return (
                                <div key={`${segment.frame}-${index}`}>
                                  <div
                                    style={{
                                      background: graphColor.fill,
                                      bottom: graphHasValueAxis ? 0 : undefined,
                                      height: graphHasValueAxis ? undefined : 2,
                                      left: `${left}%`,
                                      position: 'absolute',
                                      top: graphHasValueAxis ? `${top}%` : 'calc(50% - 1px)',
                                      width: `calc(${lineWidth}% + 1px)`,
                                    }}
                                  />
                                  <div
                                    style={{
                                      background: graphColor.line,
                                      border: '1px solid rgba(0,0,0,0.62)',
                                      borderRadius: 999,
                                      boxShadow: `0 0 9px ${graphColor.border}`,
                                      height: 8,
                                      left: `${left}%`,
                                      position: 'absolute',
                                      top: `clamp(4px, ${top}%, calc(100% - 4px))`,
                                      transform: 'translate(-50%, -50%)',
                                      width: 8,
                                    }}
                                  />
                                </div>
                              );
                          })}
                          </div>
                          <div style={{
                            background: '#ffffff',
                            bottom: 0,
                            boxShadow: '0 0 12px rgba(255,255,255,0.7)',
                            left: `calc(${(Math.min(frame, duration) / duration) * 100}% + ${4 - 8 * (Math.min(frame, duration) / duration)}px)`,
                            position: 'absolute',
                            top: 0,
                            width: 2,
                          }} />
                        </div>
                      </div>
                    );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  const parentGroups = scene.tracks
    .filter((track) => !track.parentId && !disabledTrackIds.includes(track.id))
    .map((parent) => {
      const childTracks = scene.tracks
        .filter((track) => track.parentId === parent.id && !disabledTrackIds.includes(track.id));
      const childTrackIds = childTracks.map((track) => track.id);
      const clipsInGroup = activeClips.filter((clip) => childTrackIds.includes(clip.trackId));
      const animatedGridClips = getAnimatedGridLayout(scene.clips, frame, childTrackIds);
      const graphTracks = childTracks.filter((track) => track.type === 'graph' && track.graph);
      const graphDuration = getGraphDisplayDuration(graphTracks, project.config?.fps || 30);

      return {
        ...parent,
        gridClips: animatedGridClips,
        activeGridClips: clipsInGroup
          .filter((clip) => clip.layoutType !== 'overlay')
          .sort((a, b) => (a.layoutOrder || 0) - (b.layoutOrder || 0)),
        graphTracks,
        groupDuration: graphDuration,
        graphUiLayout: (parent.graphUiLayout === 'column' || parent.graphUiLayout === 'column-many' ? 'column' : 'grid') as TimelineTrack['graphUiLayout'],
        overlayClips: clipsInGroup.filter((clip) => clip.layoutType === 'overlay' && clip.type !== 'dialog' && clip.type !== 'note'),
        activeDialogs: clipsInGroup
          .filter((clip) => clip.layoutType === 'overlay' && clip.type === 'dialog')
          .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id)),
        notePlacement: parent.notePlacement === 'graph' ? 'graph' : 'dialog',
        renderGraphNotes: getRenderClipNotes(clipsInGroup),
      };
    });

  return (
    <AbsoluteFill style={{ background: '#050505', color: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <div style={{
        display: 'grid',
        gap: 14,
        height,
        padding: 32,
        width,
        ...getParentGrid(parentGroups.length),
      }}>
        {parentGroups.length === 0 ? (
          <div style={{
            alignItems: 'center',
            color: '#27272a',
            display: 'flex',
            fontFamily: 'monospace',
            fontSize: 24,
            justifyContent: 'center',
            letterSpacing: 5,
            textTransform: 'uppercase',
          }}>
            No Output
          </div>
        ) : parentGroups.map((group) => (
          <div key={group.id} style={{ alignItems: 'center', display: 'flex', height: '100%', justifyContent: 'center', minHeight: 0, minWidth: 0, position: 'relative', width: '100%' }}>
            <div style={{
              aspectRatio: getPanelAspect(aspectRatio),
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: 6,
              boxShadow: '0 28px 80px rgba(0,0,0,0.42)',
              maxHeight: '100%',
              maxWidth: '100%',
              overflow: 'hidden',
              position: 'relative',
              width: '100%',
            }}>
              <div style={{ height: '100%', position: 'relative', width: '100%' }}>
                {group.activeGridClips.length === 0 && group.gridClips.length === 0 ? (
                  <EmptyInput />
                ) : group.gridClips.map(({ clip, rect }) => (
                  <div
                    key={clip.id}
                    style={{
                      height: `${rect.height}%`,
                      left: `${rect.left}%`,
                      minHeight: 0,
                      minWidth: 0,
                      padding: 3,
                      position: 'absolute',
                      top: `${rect.top}%`,
                      width: `${rect.width}%`,
                    }}
                  >
                    <ClipCard
                      clip={clip}
                      characters={project.characters}
                      durationInFrames={clip.duration + LAYOUT_TRANSITION_FRAMES}
                      isSingle={parentGroups.length === 1 && group.activeGridClips.length === 1}
                    />
                  </div>
                ))}
                {useAnalysisOverlay ? (
                  <RenderAnalysisOverlay
                    activeDialogs={group.activeDialogs}
                    frame={frame}
                    fps={project.config?.fps || 30}
                    graphNotes={group.renderGraphNotes}
                    graphTracks={group.graphTracks}
                    totalDuration={group.groupDuration}
                  />
                ) : (
                  <CompactTopGraphOverlay
                    frame={frame}
                    fps={project.config?.fps || 30}
                    graphTracks={group.graphTracks}
                    totalDuration={group.groupDuration}
                    graphUiLayout={group.graphUiLayout}
                  />
                )}
                {!useAnalysisOverlay && group.notePlacement === 'graph' && (
                  <RenderTopNotes
                    graphNotes={group.renderGraphNotes}
                    top={8}
                    align="right"
                  />
                )}
              </div>
              {!useAnalysisOverlay && <RenderBottomMessages
                characters={project.characters}
                dialogs={group.activeDialogs}
                fps={project.config?.fps || 30}
                frame={frame}
                graphNotes={group.notePlacement === 'graph' ? [] : group.renderGraphNotes}
                multilineDialogs
              />}
              {group.overlayClips.map((clip) => (
                <OverlayClip key={clip.id} clip={clip} characters={project.characters} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
