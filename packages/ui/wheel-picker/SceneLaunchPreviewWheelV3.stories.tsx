import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { 
  SceneLaunchPreviewWheelV3, 
  type SceneLaunchMediaItem, 
  type SceneLaunchPreviewWheelV3Effect, 
  type SceneLaunchPreviewWheelV3Sizing,
  type PreviewWheelUtilityAction
} from './SceneLaunchPreviewWheelV3';

// Helper to create colorful SVG image data URIs for offline-capable, instant-loading stories
const createColorPlaceholder = (color: string, label: string) => {
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225"><rect width="100%" height="100%" fill="${encodeURIComponent(color)}"/><text x="50%" y="50%" fill="%23fff" font-family="sans-serif" font-weight="black" font-size="24" text-anchor="middle" dominant-baseline="middle">${encodeURIComponent(label)}</text></svg>`;
};

const initialItems: SceneLaunchMediaItem[] = [
  {
    id: 'item-1',
    clipId: 'clip-1',
    name: 'Desert Timelapse',
    type: 'video',
    previewUrl: 'https://remotion.media/video.mp4',
    posterUrl: createColorPlaceholder('#f59e0b', 'Desert (Video)'),
    durationSeconds: 5,
    trimStartSeconds: 0,
    mediaDurationSeconds: 15,
  },
  {
    id: 'item-2',
    clipId: 'clip-2',
    name: 'Ocean Waves',
    type: 'image',
    previewUrl: createColorPlaceholder('#3b82f6', 'Ocean Waves (Image)'),
    durationSeconds: 3,
  },
  {
    id: 'item-3',
    clipId: 'clip-3',
    name: 'Forest Flight',
    type: 'video',
    previewUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    posterUrl: createColorPlaceholder('#10b981', 'Forest (Video)'),
    durationSeconds: 8,
    trimStartSeconds: 2,
    mediaDurationSeconds: 15,
  },
  {
    id: 'collection-1',
    clipId: 'clip-coll-1',
    name: 'Nature Sub-folder',
    type: 'image',
    previewUrl: createColorPlaceholder('#c084fc', 'Folder Collection'),
    durationSeconds: 10,
  },
  {
    id: 'item-4',
    clipId: 'clip-4',
    name: 'City Lights',
    type: 'video',
    previewUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    posterUrl: createColorPlaceholder('#6366f1', 'City (Video)'),
    durationSeconds: 6,
    trimStartSeconds: 0,
    mediaDurationSeconds: 14,
  },
  {
    id: 'item-5',
    clipId: 'clip-5',
    name: 'Mountain Peak',
    type: 'image',
    previewUrl: createColorPlaceholder('#8b5cf6', 'Mountain (Image)'),
    durationSeconds: 4,
  }
];

const itemSequences: Record<string, SceneLaunchMediaItem[]> = {
  'collection-1': [
    {
      id: 'nested-1',
      clipId: 'clip-n1',
      name: 'Nested Stream',
      type: 'video',
      previewUrl: 'https://remotion.media/video.mp4',
      posterUrl: createColorPlaceholder('#14b8a6', 'Stream (Nested Video)'),
      durationSeconds: 4,
      trimStartSeconds: 1,
      mediaDurationSeconds: 10,
    },
    {
      id: 'nested-2',
      clipId: 'clip-n2',
      name: 'Nested Leaf',
      type: 'image',
      previewUrl: createColorPlaceholder('#a855f7', 'Leaf (Nested Image)'),
      durationSeconds: 3,
    }
  ]
};

const itemSequenceThumbnails: Record<string, Record<string, SceneLaunchMediaItem>> = {
  'collection-1': {
    'nested-1': {
      id: 'nested-1',
      clipId: 'clip-n1',
      name: 'Nested Stream',
      type: 'video',
      previewUrl: 'https://remotion.media/video.mp4',
      posterUrl: createColorPlaceholder('#14b8a6', 'Stream'),
    },
    'nested-2': {
      id: 'nested-2',
      clipId: 'clip-n2',
      name: 'Nested Leaf',
      type: 'image',
      previewUrl: createColorPlaceholder('#a855f7', 'Leaf'),
    }
  }
};

const allCollections = [
  {
    id: 'collection-1',
    name: 'Nature Sub-folder',
    gridOrder: [
      { id: 'nested-1', type: 'media' },
      { id: 'nested-2', type: 'media' }
    ]
  }
];

const getRecursiveMediaItems = (collection: any): SceneLaunchMediaItem[] => {
  if (collection.id === 'collection-1') {
    return itemSequences['collection-1'] || [];
  }
  return [];
};

type StoryProps = React.ComponentProps<typeof SceneLaunchPreviewWheelV3>;

function WheelPickerStoryFrame(props: Partial<StoryProps>) {
  const [items, setItems] = React.useState<SceneLaunchMediaItem[]>(initialItems);
  const [selectedMediaId, setSelectedMediaId] = React.useState<string>('item-1');
  const [effect, setEffect] = React.useState<SceneLaunchPreviewWheelV3Effect>(props.effect ?? 'gallery');
  const [sizing, setSizing] = React.useState<SceneLaunchPreviewWheelV3Sizing>(props.sizing ?? 'uniform');
  const [durationScale, setDurationScale] = React.useState<number>(props.durationScale ?? 1);
  const [disabledItemIds, setDisabledItemIds] = React.useState<string[]>([]);
  const [isPreviewPlaying, setIsPreviewPlaying] = React.useState<boolean>(false);
  const [loopPreviewPlayback, setLoopPreviewPlayback] = React.useState<boolean>(false);
  const [timelineWrapped, setTimelineWrapped] = React.useState<boolean>(props.timelineWrapped ?? false);
  const [gridView, setGridView] = React.useState<boolean>(props.gridView ?? false);
  const [activePlayingMediaId, setActivePlayingMediaId] = React.useState<string | null>(null);
  const [activePlayingElapsedSeconds, setActivePlayingElapsedSeconds] = React.useState<number>(0);
  
  // Trimming states
  const activeItem = React.useMemo(() => {
    const nested = itemSequences['collection-1']?.find(i => i.id === selectedMediaId);
    if (nested) return nested;
    return items.find(i => i.id === selectedMediaId);
  }, [items, selectedMediaId]);
  
  const [trimDuration, setTrimDuration] = React.useState<number | undefined>(undefined);
  const [trimStart, setTrimStart] = React.useState<number | undefined>(undefined);
  
  React.useEffect(() => {
    if (activeItem) {
      setTrimDuration(activeItem.durationSeconds);
      setTrimStart(activeItem.trimStartSeconds ?? 0);
    }
  }, [selectedMediaId, activeItem]);

  const handleCenteredMediaChange = (id: string) => {
    setSelectedMediaId(id);
    props.onCenteredMediaChange?.(id);
  };

  const handleItemsReorder = (draggedId: string, targetId: string, position: 'before' | 'after') => {
    setItems(current => {
      const next = [...current];
      const draggedIndex = next.findIndex(i => i.id === draggedId);
      if (draggedIndex < 0) return current;
      const [draggedItem] = next.splice(draggedIndex, 1);
      
      const targetIndex = next.findIndex(i => i.id === targetId);
      if (targetIndex < 0) return current;
      
      const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
      next.splice(insertIndex, 0, draggedItem);
      return next;
    });
    props.onItemsReorder?.(draggedId, targetId, position);
  };

  const handleItemMoveIntoCollection = (draggedId: string, targetCollectionId: string) => {
    console.log(`Move ${draggedId} into ${targetCollectionId}`);
    props.onItemMoveIntoCollection?.(draggedId, targetCollectionId);
  };

  const handleUtilityDrop = (action: PreviewWheelUtilityAction, draggedId: string) => {
    console.log(`Utility Drop: ${action} on ${draggedId}`);
    if (action === 'trash') {
      setItems(current => current.filter(i => i.id !== draggedId));
    } else if (action === 'disable') {
      setDisabledItemIds(current => 
        current.includes(draggedId) 
          ? current.filter(id => id !== draggedId) 
          : [...current, draggedId]
      );
    }
    props.onUtilityDrop?.(action, draggedId);
  };

  // Playback timer simulation
  React.useEffect(() => {
    if (!isPreviewPlaying) {
      setActivePlayingMediaId(null);
      setActivePlayingElapsedSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      setActivePlayingElapsedSeconds(prev => {
        const next = prev + 0.1;
        const limit = activeItem?.durationSeconds ?? 5;
        if (next > limit) {
          return 0;
        }
        return next;
      });
      setActivePlayingMediaId(selectedMediaId);
    }, 100);

    return () => clearInterval(interval);
  }, [isPreviewPlaying, selectedMediaId, activeItem]);

  return (
    <div className="flex h-[600px] w-full flex-col overflow-hidden bg-zinc-950 text-white select-none rounded-lg border border-zinc-800">
      {/* Settings bar at the top */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-900/60 px-6 py-3 text-xs font-semibold">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <span>Effect:</span>
            <select
              value={effect}
              onChange={e => setEffect(e.target.value as SceneLaunchPreviewWheelV3Effect)}
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-bold text-white focus:outline-none"
            >
              <option value="gallery">Gallery (Flat)</option>
              <option value="cylinder">Cylinder 3D</option>
              <option value="cylinder2">Cylinder 2 3D</option>
              <option value="coverflow">Coverflow 3D</option>
              <option value="stack">Stack 3D</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span>Sizing:</span>
            <select
              value={sizing}
              onChange={e => setSizing(e.target.value as SceneLaunchPreviewWheelV3Sizing)}
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-bold text-white focus:outline-none"
            >
              <option value="uniform">Uniform</option>
              <option value="duration">Duration Proportional</option>
            </select>
          </label>
          {sizing === 'duration' && (
            <label className="flex items-center gap-2">
              <span>Zoom Scale:</span>
              <input
                type="range"
                min="0.5"
                max="2.5"
                step="0.1"
                value={durationScale}
                onChange={e => setDurationScale(Number(e.target.value))}
                className="w-20 accent-indigo-500"
              />
              <span className="w-8 font-mono">{durationScale.toFixed(1)}x</span>
            </label>
          )}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={gridView}
              onChange={e => setGridView(e.target.checked)}
              className="accent-indigo-500"
            />
            <span>Grid Layout</span>
          </label>
          {gridView && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={timelineWrapped}
                onChange={e => setTimelineWrapped(e.target.checked)}
                className="accent-indigo-500"
              />
              <span>Wrap Rows</span>
            </label>
          )}
        </div>
      </div>

      {/* Component Area */}
      <div className="flex-1 min-h-0 relative">
        <SceneLaunchPreviewWheelV3
          items={items}
          itemSequences={itemSequences}
          itemSequenceThumbnails={itemSequenceThumbnails}
          collectionItemIds={['collection-1']}
          collectionMultiCircleEnabled={true}
          allCollections={allCollections}
          getRecursiveMediaItems={getRecursiveMediaItems}
          selectedMediaId={selectedMediaId}
          onCenteredMediaChange={handleCenteredMediaChange}
          effect={effect}
          sizing={sizing}
          durationScale={durationScale}
          disabledItemIds={disabledItemIds}
          selectedItemDurationSeconds={trimDuration}
          selectedItemTrimStartSeconds={trimStart}
          onSelectedItemDurationChange={(dur, start) => {
            setTrimDuration(dur);
            setTrimStart(start);
          }}
          onSelectedItemDurationChangeEnd={(dur, start) => {
            setItems(current =>
              current.map(i =>
                i.id === selectedMediaId
                  ? { ...i, durationSeconds: dur, trimStartSeconds: start }
                  : i,
              ),
            );
          }}
          onItemsReorder={handleItemsReorder}
          onItemMoveIntoCollection={handleItemMoveIntoCollection}
          onUtilityDrop={handleUtilityDrop}
          gridView={gridView}
          timelineWrapped={timelineWrapped}
          onTimelineWrappedChange={setTimelineWrapped}
          isPreviewPlaying={isPreviewPlaying}
          loopPreviewPlayback={loopPreviewPlayback}
          onTogglePlayback={() => setIsPreviewPlaying(p => !p)}
          onToggleLoop={() => setLoopPreviewPlayback(l => !l)}
          activePlayingMediaId={activePlayingMediaId}
          activePlayingElapsedSeconds={activePlayingElapsedSeconds}
          renderSelectedItemOverlay={(item) => (
            <div className="absolute top-2 right-2 rounded bg-indigo-600/80 px-1.5 py-0.5 text-[9px] font-black uppercase text-white backdrop-blur">
              {item.type} selected
            </div>
          )}
          renderGalleryTrimOverlay={(item) => (
            <div className="flex items-center justify-between rounded bg-zinc-900/90 px-3 py-1.5 text-[9px] font-black uppercase border border-zinc-800 text-zinc-300">
              <span>Trim Start: {trimStart?.toFixed(1)}s</span>
              <span className="text-zinc-500">|</span>
              <span>Trimmed: {trimDuration?.toFixed(1)}s</span>
            </div>
          )}
          {...props}
        />
      </div>
    </div>
  );
}

const meta = {
  title: 'UI/WheelPicker/SceneLaunchPreviewWheelV3',
  component: WheelPickerStoryFrame,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof WheelPickerStoryFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DefaultGallery: Story = {
  render: () => <WheelPickerStoryFrame effect="gallery" sizing="uniform" />,
};

export const Cylinder3D: Story = {
  render: () => <WheelPickerStoryFrame effect="cylinder" sizing="uniform" />,
};

export const Coverflow3D: Story = {
  render: () => <WheelPickerStoryFrame effect="coverflow" sizing="uniform" />,
};

export const Stack3D: Story = {
  render: () => <WheelPickerStoryFrame effect="stack" sizing="uniform" />,
};

export const DurationProportional: Story = {
  render: () => <WheelPickerStoryFrame effect="gallery" sizing="duration" durationScale={1.2} />,
};

export const GridLayout: Story = {
  render: () => <WheelPickerStoryFrame gridView={true} timelineWrapped={true} />,
};
