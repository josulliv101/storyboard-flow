import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { PreviewWheelTrackItem } from './PreviewWheelTrackItem';
import { 
  type SceneLaunchMediaItem,
  PreviewWheelSettingsContext
} from './SceneLaunchPreviewWheelV3';

const createColorPlaceholder = (color: string, label: string) => {
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225"><rect width="100%" height="100%" fill="${encodeURIComponent(color)}"/><text x="50%" y="50%" fill="%23fff" font-family="sans-serif" font-weight="black" font-size="24" text-anchor="middle" dominant-baseline="middle">${encodeURIComponent(label)}</text></svg>`;
};

const mockItem: SceneLaunchMediaItem = {
  id: 'item-1',
  clipId: 'c1',
  name: 'Ocean Coast',
  type: 'video',
  previewUrl: 'https://remotion.media/video.mp4',
  posterUrl: createColorPlaceholder('#3b82f6', 'Ocean Coast'),
  durationSeconds: 5,
};

const mockItems = [mockItem];

const mockLayout = {
  uniformItemWidth: 200,
  itemGap: 16,
  itemStride: 216,
  itemHeight: 120,
  itemCenterY: 100,
  centerX: 250,
  viewportSize: { width: 500, height: 200 },
  itemWidths: [200],
  itemCenterPositions: [0],
  itemStartTimes: [0],
  itemDurations: [5],
  itemStartPixels: [0],
  reorderItemCenterPositions: null,
  timelineOriginOffset: 0,
  totalDurationSeconds: 5,
  finalIndex: 0,
  stripEndPixel: 200,
  centeredIndex: 0,
  indentOffset: 0,
  minOffset: 0,
  maxOffset: 200,
  isGaplessGallery: false,
};

const mockPlayback = {
  activePlayingMediaId: null,
  activePlayingElapsedSeconds: 0,
  playbackSnapshotTime: null,
  scrubSnapshot: null,
  effectiveScrubSnapshot: null,
  renderedPlayheadX: 250,
  playheadX: 250,
  playbackTimeRef: { current: 0 },
  skipNextSelectedAlignmentRef: { current: false },
  setTrimOverlayMediaId: () => {},
  isPreviewPlaying: false,
};

const mockDragDrop = {
  isDragging: false,
  isSnapping: false,
  isWheelMoving: false,
  dragRef: { current: { isDragging: false } as any },
  clickGuardRef: { current: false },
  reorderPreview: null,
  collectionDropTargetId: null,
  snapCompletionRef: { current: null },
  offset: 0,
  offsetRef: { current: 0 },
};

const mockActions = {
  snapToIndex: () => {},
  setDirectPreviewMediaId: () => {},
  updateFastNavigation: () => {},
  setGridPlayheadRatio: () => {},
  onCenteredMediaChange: () => {},
  onCollectionOpen: () => {},
  getCollectionMediaItems: () => [],
  getCollectionDirectCount: () => 0,
  slideOnClick: true,
  selectItemsWhilePreviewHidden: false,
  syncPreviewToPlayhead: false,
};

const meta = {
  title: 'UI/WheelPicker/PreviewWheelTrackItem',
  component: PreviewWheelTrackItem,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <PreviewWheelSettingsContext.Provider value={{
        sizing: 'uniform',
        effect: 'cylinder',
        thumbnailSize: 'md',
        disabledItemIds: [],
        collectionItemIds: [],
        collectionMultiCircleEnabled: false,
        isGaplessGallery: false,
        showRuler: true,
        showUniformRuler: true,
        rulerTickStep: 1,
        rulerTop: 10,
        hidePreview: false,
        selectedMediaId: 'item-1',
        itemSequenceThumbnails: {},
      }}>
        <div className="relative h-64 w-[500px] bg-zinc-950 border border-zinc-800 rounded flex items-center justify-center overflow-hidden">
          <Story />
        </div>
      </PreviewWheelSettingsContext.Provider>
    ),
  ],
} satisfies Meta<typeof PreviewWheelTrackItem>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    item: mockItem,
    index: 0,
    items: mockItems,
    layout: mockLayout,
    playback: mockPlayback,
    dragDrop: mockDragDrop,
    actions: mockActions,
  },
};

