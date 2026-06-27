import React from 'react';
import { createPortal } from 'react-dom';
import { CornerUpLeft, Trash2, Ban, FolderInput } from 'lucide-react';
import { cn } from '../lib/utils';
import { type SceneLaunchMediaItem, type PreviewWheelUtilityAction, type ReorderPreview, VIDEO_PLACEHOLDER } from './SceneLaunchPreviewWheelV3';
import { PreviewWheelCollectionThumbnail } from './PreviewWheelCollectionThumbnail';

export interface PreviewWheelReorderPortalProps {
  reorderPreview: ReorderPreview | null;
  items: SceneLaunchMediaItem[];
  collectionItemIds: string[];
  disabledItemIds: string[];
  utilityDropTarget: PreviewWheelUtilityAction | null;
  collectionMultiCircleEnabled: boolean;
  getCollectionMediaItems: (collectionId: string) => SceneLaunchMediaItem[];
  getCollectionDirectCount: (collectionId: string) => number;
  scrubSnapshot?: any;
  itemSequenceThumbnails?: Record<string, Record<string, SceneLaunchMediaItem>>;
  thumbnailSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  reorderGhostRef: React.RefObject<HTMLDivElement | null>;
  reorderGhostContentRef: React.RefObject<HTMLDivElement | null>;
}

export function PreviewWheelReorderPortal({
  reorderPreview,
  items,
  collectionItemIds,
  disabledItemIds,
  utilityDropTarget,
  collectionMultiCircleEnabled,
  getCollectionMediaItems,
  getCollectionDirectCount,
  scrubSnapshot,
  itemSequenceThumbnails,
  thumbnailSize = 'md',
  reorderGhostRef,
  reorderGhostContentRef,
}: PreviewWheelReorderPortalProps) {
  if (!reorderPreview || typeof document === 'undefined') {
    return null;
  }

  const item = items.find(candidate => candidate.id === reorderPreview.mediaId);
  if (!item) {
    return null;
  }

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-[310] grid w-[360px] grid-cols-4 gap-2 rounded-xl border border-zinc-700/90 bg-zinc-950/95 p-3 shadow-2xl shadow-black/70"
        style={{
          transform: `translate3d(${reorderPreview.trayX}px, ${reorderPreview.trayY}px, 0) translate(-50%, -100%)`,
        }}
      >
        {([
          ['parent', 'Parent', CornerUpLeft],
          ['trash', 'Trash', Trash2],
          ['disable', 'Disable', Ban],
          ['directory', 'Directory', FolderInput],
        ] as const).map(([action, label, Icon]) => (
          <div
            key={action}
            data-wheel-utility-target={action}
            className={cn(
              'flex h-16 min-w-0 flex-col items-center justify-center rounded-lg border border-dashed text-zinc-300 transition-colors',
              utilityDropTarget === action
                ? action === 'trash'
                  ? 'border-red-400 bg-red-500/25 text-red-100'
                  : action === 'disable'
                    ? 'border-amber-400 bg-amber-500/25 text-amber-100'
                    : 'border-indigo-400 bg-indigo-500/25 text-indigo-100'
                : 'border-zinc-700 bg-zinc-900/90',
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="mt-1.5 text-[9px] font-black uppercase tracking-wider">
              {action === 'disable' && disabledItemIds.includes(reorderPreview.mediaId) ? 'Enable' : label}
            </span>
          </div>
        ))}
      </div>
      <div
        ref={reorderGhostRef}
        aria-hidden="true"
        className="pointer-events-none fixed z-[300]"
        style={{
          left: 0,
          top: 0,
          width: reorderPreview.width,
          height: reorderPreview.height,
          transform: `translate3d(${reorderPreview.clientX}px, ${reorderPreview.clientY}px, 0) translate(-50%, -50%) scale(1.03)`,
          willChange: 'transform',
        }}
      >
        <div
          ref={reorderGhostContentRef}
          className="relative h-full w-full overflow-hidden rounded-md border-2 border-indigo-300 bg-zinc-900 shadow-2xl shadow-black/70 ring-2 ring-indigo-400/40"
          style={{ transformOrigin: 'center center', willChange: 'transform' }}
        >
          {collectionItemIds.includes(item.id) ? (
            <PreviewWheelCollectionThumbnail
              collectionId={item.id}
              fallbackItem={item}
              collectionMultiCircleEnabled={collectionMultiCircleEnabled}
              collectionMediaItems={getCollectionMediaItems(item.id)}
              collectionDirectCount={getCollectionDirectCount(item.id)}
              scrubSnapshot={scrubSnapshot}
              itemSequenceThumbnails={itemSequenceThumbnails}
              thumbnailSize={thumbnailSize}
            />
          ) : (
            item.type === 'video' ? (
              <img src={item.posterUrl || VIDEO_PLACEHOLDER} alt="" className="h-full w-full object-cover" />
            ) : (
              <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
            )
          )}
          <div className="absolute inset-0 bg-indigo-500/10" />
        </div>
      </div>
    </>,
    document.body,
  );
}
