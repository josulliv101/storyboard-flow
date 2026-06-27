import React from 'react';
import { Folder } from 'lucide-react';
import { type SceneLaunchMediaItem, VIDEO_PLACEHOLDER } from './SceneLaunchPreviewWheelV3';

export interface PreviewWheelCollectionThumbnailProps {
  collectionId: string;
  fallbackItem: SceneLaunchMediaItem;
  collectionMultiCircleEnabled: boolean;
  collectionMediaItems: SceneLaunchMediaItem[];
  collectionDirectCount: number;
  scrubSnapshot?: any;
  itemSequenceThumbnails?: Record<string, Record<string, SceneLaunchMediaItem>>;
  thumbnailSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export function PreviewWheelCollectionThumbnail({
  collectionId,
  fallbackItem,
  collectionMultiCircleEnabled,
  collectionMediaItems,
  collectionDirectCount,
  scrubSnapshot,
  itemSequenceThumbnails,
  thumbnailSize = 'md',
}: PreviewWheelCollectionThumbnailProps) {
  const isMultiCircle = collectionMultiCircleEnabled;
  const mainThumbnailItem = scrubSnapshot
    ? itemSequenceThumbnails?.[fallbackItem.id]?.[scrubSnapshot.media.id] ?? fallbackItem
    : fallbackItem;

  if (thumbnailSize === 'xs') {
    return (
      <>
        {mainThumbnailItem.type === 'video' ? (
          <img
            src={mainThumbnailItem.posterUrl || VIDEO_PLACEHOLDER}
            alt=""
            className="absolute inset-0 h-full w-full object-cover pointer-events-none"
          />
        ) : (
          <img
            src={mainThumbnailItem.previewUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover pointer-events-none"
          />
        )}
        <span className="pointer-events-none absolute left-1/2 top-1/2 z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-600/80 bg-zinc-950/90 text-[10px] font-black text-indigo-200 shadow-lg shadow-black/60">
          {collectionDirectCount}
        </span>
      </>
    );
  }

  if (isMultiCircle && collectionMediaItems.length > 0) {
    const first = collectionMediaItems[0];
    const last = collectionMediaItems[collectionMediaItems.length - 1];
    
    let longest = collectionMediaItems[0];
    let maxDur = -1;
    for (const m of collectionMediaItems) {
      const d = m.durationSeconds ?? 3;
      if (d > maxDur) {
        maxDur = d;
        longest = m;
      }
    }

    const durations = collectionMediaItems.map(m => m.durationSeconds ?? 3);
    const maxDuration = Math.max(...durations);
    const minDuration = Math.min(...durations);

    const getCircleSizePercent = (duration: number) => {
      return 45 + ((duration - minDuration) / (maxDuration - minDuration || 1)) * 25;
    };

    const renderCircle = (m: SceneLaunchMediaItem, left: string, top: string, role: string) => {
      const d = m.durationSeconds ?? 3;
      const size = getCircleSizePercent(d);
      const subThumbnail = scrubSnapshot
        ? itemSequenceThumbnails?.[m.id]?.[scrubSnapshot.media.id] ?? m
        : m;

      return (
        <div
          key={`${role}-${m.id}`}
          className="absolute rounded-full border border-zinc-600/50 shadow-lg overflow-hidden bg-zinc-950 flex items-center justify-center"
          style={{
            left,
            top,
            width: `${size}%`,
            height: `${size}%`,
            transform: 'translate(-50%, -50%)',
            zIndex: 10,
          }}
        >
          {subThumbnail.type === 'video' ? (
            <img src={subThumbnail.posterUrl || VIDEO_PLACEHOLDER} alt="" className="h-full w-full object-cover pointer-events-none" />
          ) : (
            <img src={subThumbnail.previewUrl} alt="" className="h-full w-full object-cover pointer-events-none" />
          )}
        </div>
      );
    };

    return (
      <div className="absolute inset-0 bg-zinc-900/40 p-1 select-none pointer-events-none flex items-center justify-center">
        <div className="h-[96%] aspect-square relative">
          {renderCircle(first, '50%', '18%', 'first')}
          {renderCircle(last, '78%', '67%', 'last')}
          {renderCircle(longest, '22%', '67%', 'longest')}

          <div
            className="absolute flex items-center justify-center bg-black/35 rounded-full"
            style={{
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 30,
            }}
          >
            <span className="flex min-w-10 h-10 px-2.5 items-center justify-center rounded-full bg-zinc-950 border border-zinc-700/80 text-sm font-black font-sans text-indigo-250 shadow-lg shadow-black/60">
              {collectionDirectCount}
            </span>
          </div>
        </div>
        <div className="absolute top-2 left-2 flex items-center justify-center rounded-full bg-black/60 p-1.5 text-indigo-300 border border-zinc-800/30 z-20">
          <Folder className="h-2.5 w-2.5" />
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-zinc-900/40 p-1 select-none pointer-events-none flex items-center justify-center">
      <div className="h-[96%] aspect-square relative flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border border-zinc-800 bg-zinc-900/80 translate-x-[6px] -translate-y-[6px] opacity-50 scale-[0.97] shadow-sm z-0" />
        <div className="absolute inset-0 rounded-full border border-zinc-800/80 bg-zinc-900/90 translate-x-[4px] -translate-y-[4px] opacity-75 scale-[0.98] shadow-sm z-[3]" />
        <div className="absolute inset-0 rounded-full border border-zinc-700 bg-zinc-800 translate-x-[2px] -translate-y-[2px] opacity-90 scale-[0.99] shadow-md z-[6]" />
        <div className="relative w-full h-full rounded-full border-2 border-zinc-600/70 shadow-lg overflow-hidden bg-zinc-950 z-10 flex items-center justify-center">
          {mainThumbnailItem.type === 'video' ? (
            <img
              src={mainThumbnailItem.posterUrl || VIDEO_PLACEHOLDER}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <img src={mainThumbnailItem.previewUrl} alt="" className="h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/35 z-20">
            <span className="flex min-w-10 h-10 px-2.5 items-center justify-center rounded-full bg-zinc-950 border border-zinc-700/80 text-sm font-black font-sans text-indigo-250 shadow-lg shadow-black/60">
              {collectionDirectCount}
            </span>
          </div>
        </div>
      </div>
      <div className="absolute top-2 left-2 flex items-center justify-center rounded-full bg-black/60 p-1.5 text-indigo-300 border border-zinc-800/30 z-20">
        <Folder className="h-2.5 w-2.5" />
      </div>
    </div>
  );
}
