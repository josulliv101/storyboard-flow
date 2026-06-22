import React from 'react';
import { 
  type SceneLaunchMediaItem, 
  usePreviewWheelSettings,
  type PreviewWheelLayoutData,
  type PreviewWheelPlaybackData,
  type PreviewWheelDragDropData,
  type PreviewWheelActions
} from './SceneLaunchPreviewWheelV3';
import { type GalleryScrubSnapshot } from './GalleryCanvasPreview';
import { TimelineRuler } from './TimelineRuler';
import { PreviewWheelMediaTile } from './PreviewWheelMediaTile';

const degreesToRadians = (value: number) => (value * Math.PI) / 180;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export interface PreviewWheelTrackItemProps {
  item: SceneLaunchMediaItem;
  index: number;
  items: SceneLaunchMediaItem[];
  layout: PreviewWheelLayoutData;
  playback: PreviewWheelPlaybackData;
  dragDrop: PreviewWheelDragDropData;
  actions: PreviewWheelActions;
}

export function PreviewWheelTrackItem({
  item,
  index,
  items,
  layout,
  playback,
  dragDrop,
  actions,
}: PreviewWheelTrackItemProps) {
  // Consume configurations from settings Context
  const {
    sizing,
    effect,
    thumbnailSize,
    disabledItemIds,
    collectionItemIds,
    collectionMultiCircleEnabled,
    isGaplessGallery,
    showRuler,
    showUniformRuler,
    rulerTickStep,
    rulerTop,
    hidePreview,
    selectedMediaId,
    itemSequenceThumbnails,
  } = usePreviewWheelSettings();

  // Destructure layout metrics
  const {
    uniformItemWidth,
    itemGap,
    itemStride,
    itemHeight,
    itemCenterY,
    viewportSize,
    itemWidths,
    itemCenterPositions,
    itemStartTimes,
    itemDurations,
    itemStartPixels,
    reorderItemCenterPositions,
    timelineOriginOffset,
    finalIndex,
    stripEndPixel,
    centeredIndex,
  } = layout;

  // Destructure playback parameters
  const {
    activePlayingMediaId,
    activePlayingElapsedSeconds,
    playbackSnapshotTime,
    scrubSnapshot,
    effectiveScrubSnapshot,
    renderedPlayheadX,
    playheadX,
    playbackTimeRef,
    skipNextSelectedAlignmentRef,
    setTrimOverlayMediaId,
    isPreviewPlaying,
  } = playback;

  // Destructure drag drop variables
  const {
    isDragging,
    isSnapping,
    isWheelMoving,
    dragRef,
    clickGuardRef,
    reorderPreview,
    collectionDropTargetId,
    snapCompletionRef,
    offset,
    offsetRef,
  } = dragDrop;

  // Destructure actions callbacks
  const {
    snapToIndex,
    setDirectPreviewMediaId,
    updateFastNavigation,
    setGridPlayheadRatio,
    onCenteredMediaChange,
    onCollectionOpen,
    getCollectionMediaItems,
    getCollectionDirectCount,
    renderSelectedItemOverlay,
    onSelectedItemDurationChange,
    beginDurationResize,
    handleDurationResizeKey,
    slideOnClick,
    selectItemsWhilePreviewHidden,
    syncPreviewToPlayhead,
  } = actions;

  const thumbnailItem = scrubSnapshot
    ? itemSequenceThumbnails?.[item.id]?.[scrubSnapshot.media.id] ?? item
    : item;
  const itemWidth = itemWidths[index] ?? uniformItemWidth;
  const itemCenterOffset = (reorderItemCenterPositions?.get(item.id) ?? itemCenterPositions[index] ?? 0) + offset;
  const offsetFromCenter = itemCenterOffset / itemStride;
  const absOffsetFromCenter = Math.abs(offsetFromCenter);
  const distance = Math.min(4, absOffsetFromCenter);
  const isActive = item.id === selectedMediaId;
  const itemDuration = itemDurations[index] ?? 0.5;
  const itemStartTime = itemStartTimes[index] ?? 0;
  const itemEndTime = itemStartTime + itemDuration;
  const progressTimelineTime = scrubSnapshot?.timelineTimeSeconds ?? 0;
  const isCurrentPlaying = activePlayingMediaId !== null && item.id === activePlayingMediaId;
  const itemElapsedSeconds = isCurrentPlaying
    ? activePlayingElapsedSeconds
    : clamp(
        progressTimelineTime - itemStartTime,
        0,
        itemDuration,
      );
  const itemProgress = itemDuration > 0
    ? clamp(itemElapsedSeconds / itemDuration, 0, 1)
    : 0;
  const isItemProgressPlaying = isCurrentPlaying
    ? isPreviewPlaying
    : isPreviewPlaying &&
      itemDuration > 0 &&
      progressTimelineTime >= itemStartTime &&
      progressTimelineTime < itemEndTime;
      
  let x = itemCenterOffset + layout.centerX; // centerX is inside layout
  let z = 0;
  let rotateY = 0;
  let translateY = 0;
  let scale = 1 - distance * 0.035;
  let opacity = Math.max(0.32, 1 - distance * 0.14);
  let brightness = Math.max(0.68, 1 - distance * 0.07);
  let shouldRender = absOffsetFromCenter < 4.2;

  if (effect === 'cylinder') {
    const angle = clamp(offsetFromCenter * 54 / 2, -54, 54);
    const angleRadians = degreesToRadians(angle);
    const radius = itemStride * 3.05;
    x = Math.sin(angleRadians) * radius + layout.centerX;
    z = (Math.cos(angleRadians) - 1) * radius * 0.72;
    rotateY = -angle;
    translateY = distance * 4;
    scale = 1 - distance * 0.04;
    opacity = Math.max(0.2, 1 - distance * 0.18);
    brightness = Math.max(0.62, 1 - distance * 0.08);
    shouldRender = absOffsetFromCenter < 3.35;
  } else if (effect === 'cylinder2') {
    const angle = clamp(offsetFromCenter * 20, -54, 54);
    const angleRadians = degreesToRadians(angle);
    const radius = itemStride * 2.9;
    const centeredItemWidth = itemWidths[centeredIndex] ?? uniformItemWidth;
    const minimumCenterSpacing = (itemWidth + centeredItemWidth) / 2 + itemGap;
    x = Math.sin(angleRadians) * radius;
    if (absOffsetFromCenter >= 0.5) {
      x =
        Math.sign(offsetFromCenter) *
        Math.max(
          Math.abs(x),
          minimumCenterSpacing +
            Math.max(0, absOffsetFromCenter - 1) * itemWidth * 0.74,
        );
    }
    x += layout.centerX;
    z = (Math.cos(angleRadians) - 1) * radius * 0.36;
    rotateY = -angle * 0.18;
    translateY = 0;
    scale = 1 - distance * 0.065;
    opacity = Math.max(0.16, 1 - distance * 0.22);
    brightness = Math.max(0.54, 1 - distance * 0.1);
    shouldRender = absOffsetFromCenter < 3.7;
  } else if (effect === 'coverflow') {
    x = itemCenterOffset * 0.82 + layout.centerX;
    z = -distance * 74;
    rotateY = clamp(offsetFromCenter * -36, -58, 58);
    translateY = distance * 5;
    scale = 1 - distance * 0.055;
    opacity = Math.max(0.3, 1 - distance * 0.15);
    brightness = Math.max(0.66, 1 - distance * 0.075);
  } else if (effect === 'gallery') {
    scale = 1;
    translateY = 0;
  } else if (effect === 'stack') {
    x = itemCenterOffset * 0.58 + layout.centerX;
    z = -distance * 96;
    rotateY = clamp(offsetFromCenter * -10, -20, 20);
    translateY = distance * 7;
    scale = 1 - distance * 0.08;
    opacity = Math.max(0.24, 1 - distance * 0.2);
    brightness = Math.max(0.58, 1 - distance * 0.1);
    shouldRender = absOffsetFromCenter < 4.8;
  }

  if (sizing === 'uniform') {
    opacity = 1;
    brightness = 1;
  }

  if (sizing === 'uniform' || effect === 'gallery') {
    shouldRender = true;
  }

  return (
    <React.Fragment>
      {showRuler && (sizing === 'duration' || (sizing === 'uniform' && showUniformRuler)) && (
        <TimelineRuler
          itemWidth={itemWidth}
          itemStartTime={itemStartTime}
          itemDuration={itemDuration}
          itemEndTime={itemEndTime}
          rulerTickStep={rulerTickStep}
          rulerTop={rulerTop}
          opacity={opacity}
          effect={effect}
          x={x}
          z={z}
          rotateY={rotateY}
          scale={scale}
          distance={distance}
          isLastItem={index === items.length - 1}
        />
      )}
      <PreviewWheelMediaTile
        item={item}
        index={index}
        thumbnailItem={thumbnailItem}
        isActive={isActive}
        disabled={disabledItemIds.includes(item.id)}
        isCollection={collectionItemIds.includes(item.id)}
        collectionMultiCircleEnabled={collectionMultiCircleEnabled}
        collectionMediaItems={getCollectionMediaItems(item.id)}
        collectionDirectCount={getCollectionDirectCount(item.id)}
        itemSequenceThumbnails={itemSequenceThumbnails}
        thumbnailSize={thumbnailSize}
        reorderPreviewActive={reorderPreview?.mediaId === item.id}
        brightness={brightness}
        opacity={opacity}
        x={x}
        translateY={translateY}
        z={z}
        rotateY={rotateY}
        scale={scale}
        shouldRender={shouldRender}
        itemProgress={itemProgress}
        isItemProgressPlaying={isItemProgressPlaying}
        progressTimelineTime={progressTimelineTime}
        layout={layout}
        playback={playback}
        dragDrop={dragDrop}
        actions={actions}
        onTransitionEnd={(event) => {
          const completion = snapCompletionRef.current;
          if (
            event.target === event.currentTarget &&
            event.propertyName === 'transform' &&
            completion?.mediaId === item.id
          ) {
            completion.finish();
          }
        }}
      />
    </React.Fragment>
  );
}
