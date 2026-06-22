import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { PreviewWheelMediaTile } from './PreviewWheelMediaTile';
import { 
  type SceneLaunchMediaItem, 
  PreviewWheelSettingsContext 
} from './SceneLaunchPreviewWheelV3';

const createColorPlaceholder = (color: string, label: string) => {
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225"><rect width="100%" height="100%" fill="${encodeURIComponent(color)}"/><text x="50%" y="50%" fill="%23fff" font-family="sans-serif" font-weight="black" font-size="24" text-anchor="middle" dominant-baseline="middle">${encodeURIComponent(label)}</text></svg>`;
};

const mockMedia: SceneLaunchMediaItem = {
  id: 'item-1',
  clipId: 'c1',
  name: 'Ocean Coast',
  type: 'image',
  previewUrl: createColorPlaceholder('#3b82f6', 'Ocean Coast'),
};

const mockCollectionMedia: SceneLaunchMediaItem = {
  id: 'collection-1',
  clipId: 'c2',
  name: 'Nature B-Rolls',
  type: 'image',
  previewUrl: createColorPlaceholder('#c084fc', 'Folder Thumbnail'),
};

const mockLayout = {
  uniformItemWidth: 200,
  itemGap: 16,
  itemStride: 216,
  itemHeight: 120,
  itemCenterY: 60,
  centerX: 250,
  viewportSize: { width: 500, height: 250 },
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
  title: 'UI/WheelPicker/PreviewWheelMediaTile',
  component: PreviewWheelMediaTile,
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
        <div className="relative h-64 w-[500px] bg-zinc-950 border border-zinc-800 rounded flex items-center justify-center">
          <Story />
        </div>
      </PreviewWheelSettingsContext.Provider>
    ),
  ],
} satisfies Meta<typeof PreviewWheelMediaTile>;

export default meta;

type Story = StoryObj<typeof meta>;

export const StandardImageTile: Story = {
  args: {
    item: mockMedia,
    index: 0,
    thumbnailItem: mockMedia,
    isActive: false,
    disabled: false,
    isCollection: false,
    collectionMultiCircleEnabled: false,
    collectionMediaItems: [],
    collectionDirectCount: 0,
    reorderPreviewActive: false,
    brightness: 1,
    opacity: 1,
    x: 0,
    translateY: 0,
    z: 0,
    rotateY: 0,
    scale: 1,
    shouldRender: true,
    itemProgress: 0,
    isItemProgressPlaying: false,
    progressTimelineTime: 0,
    layout: mockLayout,
    playback: mockPlayback,
    dragDrop: mockDragDrop,
    actions: mockActions,
    onTransitionEnd: () => {},
  },
};

export const ActiveVideoTileWithProgress: Story = {
  args: {
    ...StandardImageTile.args,
    item: {
      ...mockMedia,
      type: 'video',
      durationSeconds: 10,
    },
    isActive: true,
    itemProgress: 0.45,
    isItemProgressPlaying: true,
    progressTimelineTime: 4.5,
  },
};

export const ConcentricCircleFolderTile: Story = {
  args: {
    ...StandardImageTile.args,
    item: mockCollectionMedia,
    isCollection: true,
  },
};
