"use client";

import { useMemo, useState } from "react";
import {
  MediaStrip,
  MediaStripBoard,
  applyTimelineItemCommand,
  asCollectionId,
  createCollectionTimelineItem,
  createImageTimelineItem,
  createVideoTimelineItem,
  type CollectionId,
  type TimelineCollection,
  type TimelineItem,
  type TimelineItemCommand,
  type TimelineItemId,
} from "@storyboard/ui/media-strip";
import { dndKitMediaStripDndAdapter } from "@storyboard/ui/media-strip/adapters/dnd-kit-adapter";

import type {
  RoutedMediaCollection,
  RoutedMediaStripItem,
} from "../lib/collections";

type DemoMediaStripProps = Readonly<{
  activeCollectionId: string;
  collections: readonly RoutedMediaCollection[];
}>;

function createTimelineItem(
  item: RoutedMediaStripItem,
  collectionSizes: ReadonlyMap<string, number>
): TimelineItem {
  const result = (() => {
    if (item.kind === "image") {
      return createImageTimelineItem(item);
    }

    if (item.kind === "video") {
      return createVideoTimelineItem(item);
    }

    return createCollectionTimelineItem({
      ...item,
      itemCount: collectionSizes.get(item.collectionId) ?? 0,
    });
  })();

  if (!result.ok) {
    throw new Error(`Invalid demo media item: ${JSON.stringify(result.error)}`);
  }

  return result.value;
}

function buildCollections(
  collections: readonly RoutedMediaCollection[]
): ReadonlyMap<CollectionId, TimelineCollection> {
  const collectionSizes = new Map<string, number>(
    collections.map((collection) => [collection.id, collection.items.length])
  );

  return new Map<CollectionId, TimelineCollection>(
    collections.map((collection) => {
      const id = asCollectionId(collection.id);
      return [
        id,
        {
          id,
          name: collection.name,
          items: collection.items.map((item) =>
            createTimelineItem(item, collectionSizes)
          ),
        },
      ];
    })
  );
}

export function DemoMediaStrip(props: DemoMediaStripProps) {
  const initialCollections = useMemo(
    () => buildCollections(props.collections),
    [props.collections]
  );
  const collectionId = useMemo(
    () => asCollectionId(props.activeCollectionId),
    [props.activeCollectionId]
  );
  const visibleCollectionIds = useMemo(() => [collectionId], [collectionId]);
  const [collectionsById, setCollectionsById] = useState(initialCollections);
  const [selectedIds, setSelectedIds] = useState<readonly TimelineItemId[]>([]);
  const activeCollection = collectionsById.get(collectionId);

  if (!activeCollection) {
    throw new Error(`Missing active collection: ${props.activeCollectionId}`);
  }

  const handleMoveItem = (command: TimelineItemCommand) => {
    setCollectionsById((current) =>
      applyTimelineItemCommand({
        collectionsById: current,
        command,
      })
    );
  };

  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-3">
      <MediaStripBoard
        collectionsById={collectionsById}
        dndAdapter={dndKitMediaStripDndAdapter}
        visibleCollectionIds={visibleCollectionIds}
        onMoveItem={handleMoveItem}
      >
        <MediaStrip
          collectionId={collectionId}
          heading={activeCollection.name}
          selectedIds={selectedIds}
          onSelectionChange={(selection) => setSelectedIds(selection.selectedIds)}
          thumbnailVariant="sequence"
        />
      </MediaStripBoard>
    </div>
  );
}
