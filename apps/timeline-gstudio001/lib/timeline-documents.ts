import {
  CLIP_GAP_SECONDS,
  TIMELINE_LEADING_PADDING_SECONDS,
} from "@/components/timeline/constants";
import { createInitialClips } from "@/components/timeline/hooks/use-timeline-clips";
import type {
  CollectionTimelineClip,
  TimelineClip,
  TimelineDocument,
} from "@/components/timeline/types";

function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max);
}

type TimelinePageDocument = {
  id: string;
  title: string;
  description?: string;
  timelineIds: string[];
};

function cloneClipForDocument(documentId: string, clip: TimelineClip) {
  return {
    ...clip,
    id: `${documentId}-${clip.id}`,
    alt: `${clip.alt} (${documentId})`,
  };
}

function createMediaClips(documentId: string, count: number) {
  return createInitialClips(count, 100).map((clip) =>
    cloneClipForDocument(documentId, clip),
  );
}

function createCollectionClip({
  childTimelineId,
  duration,
  id,
  itemCount,
  previewItems,
  title,
}: {
  childTimelineId: string;
  duration: number;
  id: string;
  itemCount: number;
  previewItems: CollectionTimelineClip["previewItems"];
  title: string;
}): CollectionTimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    title,
    childTimelineId,
    itemCount,
    previewItems,
    alt: `${title} collection`,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
  };
}

function previewItemsFrom(clips: TimelineClip[]) {
  return clips
    .filter((clip) => clip.kind === "image" || clip.kind === "video")
    .slice(0, 3)
    .map((clip) => ({
      id: clip.id,
      kind: clip.kind,
      src: clip.src,
      poster: clip.poster,
      alt: clip.alt,
    }));
}

function packClips(clips: TimelineClip[]) {
  let nextStartTime = TIMELINE_LEADING_PADDING_SECONDS;

  return clips.map((clip, index) => {
    const nextClip = {
      ...clip,
      index,
      startTime: nextStartTime,
    };
    nextStartTime += nextClip.duration + CLIP_GAP_SECONDS;
    return nextClip;
  });
}

const sceneADetailsClips = createMediaClips("scene-a-details", 18);
const sceneBClips = createMediaClips("scene-b", 26);
const collectionBoardActOneClips = createMediaClips(
  "collection-board-act-one",
  12,
);
const collectionBoardActTwoClips = createMediaClips(
  "collection-board-act-two",
  16,
);
const collectionBoardActThreeClips = createMediaClips(
  "collection-board-act-three",
  14,
);

const sceneAClips = packClips([
  ...createMediaClips("scene-a", 5),
  createCollectionClip({
    id: "scene-a-nested-collection",
    title: "Close-up Inserts",
    childTimelineId: "scene-a-details",
    itemCount: sceneADetailsClips.length,
    duration: 2.8,
    previewItems: previewItemsFrom(sceneADetailsClips),
  }),
  ...createMediaClips("scene-a", 9).slice(5),
]);

const collectionBoardClips = packClips([
  createCollectionClip({
    id: "collection-board-act-one",
    title: "Act One Collections",
    childTimelineId: "collection-board-act-one",
    itemCount: collectionBoardActOneClips.length,
    duration: 3,
    previewItems: previewItemsFrom(collectionBoardActOneClips),
  }),
  createCollectionClip({
    id: "collection-board-act-two",
    title: "Act Two Collections",
    childTimelineId: "collection-board-act-two",
    itemCount: collectionBoardActTwoClips.length,
    duration: 3.2,
    previewItems: previewItemsFrom(collectionBoardActTwoClips),
  }),
  createCollectionClip({
    id: "collection-board-act-three",
    title: "Act Three Collections",
    childTimelineId: "collection-board-act-three",
    itemCount: collectionBoardActThreeClips.length,
    duration: 3.1,
    previewItems: previewItemsFrom(collectionBoardActThreeClips),
  }),
]);

const rootClips = packClips([
  ...createMediaClips("root", 4),
  createCollectionClip({
    id: "root-scene-a",
    title: "Scene A Selects",
    childTimelineId: "scene-a",
    itemCount: sceneAClips.length,
    duration: 3.1,
    previewItems: previewItemsFrom(sceneAClips),
  }),
  ...createMediaClips("root", 9).slice(4, 6),
  createCollectionClip({
    id: "root-collection-board",
    title: "Collection Board",
    childTimelineId: "collection-board",
    itemCount: collectionBoardClips.length,
    duration: 3.6,
    previewItems: [
      ...previewItemsFrom(collectionBoardActOneClips).slice(0, 1),
      ...previewItemsFrom(collectionBoardActTwoClips).slice(0, 1),
      ...previewItemsFrom(collectionBoardActThreeClips).slice(0, 1),
    ],
  }),
  ...createMediaClips("root", 9).slice(6, 7),
  createCollectionClip({
    id: "root-scene-b",
    title: "Scene B Assembly",
    childTimelineId: "scene-b",
    itemCount: sceneBClips.length,
    duration: 3.4,
    previewItems: previewItemsFrom(sceneBClips),
  }),
  ...createMediaClips("root", 12).slice(7),
]);

const promoClips = createMediaClips("promo", 36);
const archiveClips = createMediaClips("archive", 72);

const timelineDocuments: Record<string, TimelineDocument> = {
  root: {
    id: "root",
    title: "Root Timeline",
    description: "Top-level storyboard with nested timeline collections.",
    clips: rootClips,
  },
  "scene-a": {
    id: "scene-a",
    title: "Scene A Selects",
    description: "A nested scene timeline with another collection inside it.",
    clips: sceneAClips,
  },
  "scene-a-details": {
    id: "scene-a-details",
    title: "Close-up Inserts",
    description: "A deeper collection timeline reached from Scene A.",
    clips: sceneADetailsClips,
  },
  "scene-b": {
    id: "scene-b",
    title: "Scene B Assembly",
    description: "A separate nested collection timeline.",
    clips: sceneBClips,
  },
  "collection-board": {
    id: "collection-board",
    title: "Collection Board",
    description:
      "A collection timeline made only of other collection items.",
    clips: collectionBoardClips,
  },
  "collection-board-act-one": {
    id: "collection-board-act-one",
    title: "Act One Collections",
    description: "Media items inside the first collection-board branch.",
    clips: collectionBoardActOneClips,
  },
  "collection-board-act-two": {
    id: "collection-board-act-two",
    title: "Act Two Collections",
    description: "Media items inside the second collection-board branch.",
    clips: collectionBoardActTwoClips,
  },
  "collection-board-act-three": {
    id: "collection-board-act-three",
    title: "Act Three Collections",
    description: "Media items inside the third collection-board branch.",
    clips: collectionBoardActThreeClips,
  },
  promo: {
    id: "promo",
    title: "Promo Cut",
    description: "A standalone timeline loaded by a server component.",
    clips: promoClips,
  },
  archive: {
    id: "archive",
    title: "Archive Pulls",
    description: "A larger server-provided timeline for grid virtualization.",
    clips: archiveClips,
  },
  storyboard: {
    id: "storyboard",
    title: "Storyboard Workspace",
    description: "Your main storyboard preview timeline.",
    clips: rootClips.map((c) => ({ ...c })),
  },
  workbench: {
    id: "workbench",
    title: "Workbench Workspace",
    description: "Your workbench assembly timeline.",
    clips: sceneAClips.map((c) => ({ ...c })),
  },
};

const timelinePages: Record<string, TimelinePageDocument> = {
  single: {
    id: "single",
    title: "Single Timeline Page",
    description: "One server-selected timeline document.",
    timelineIds: ["root"],
  },
  three: {
    id: "three",
    title: "Three Timeline Page",
    description: "Three independent timeline components on the same page.",
    timelineIds: ["root", "promo", "archive"],
  },
};

export function getTimelineDocument(id: string) {
  return timelineDocuments[id] ?? null;
}

export function getTimelinePath(targetId: string): { id: string; title: string }[] {
  const path: { id: string; title: string }[] = [];
  
  let currentId = targetId;
  while (currentId && currentId !== "root") {
    let parentId: string | null = null;
    let parentTitle = "";
    
    for (const doc of Object.values(timelineDocuments)) {
      const hasChild = doc.clips.some(
        (clip) => clip.kind === "collection" && clip.childTimelineId === currentId
      );
      if (hasChild) {
        parentId = doc.id;
        parentTitle = doc.title;
        break;
      }
    }
    
    if (parentId) {
      path.unshift({ id: parentId, title: parentTitle });
      currentId = parentId;
    } else {
      break;
    }
  }
  
  return path;
}

export function syncParentCollections(collectionTimelineId: string, childClips: any[]) {
  let totalDuration = 3;
  if (childClips.length > 0) {
    const lastClip = childClips[childClips.length - 1];
    totalDuration = lastClip.startTime + lastClip.duration + TIMELINE_LEADING_PADDING_SECONDS;
  }

  for (const parentDoc of Object.values(timelineDocuments)) {
    let updated = false;
    parentDoc.clips = parentDoc.clips.map((c) => {
      if (c.kind === "collection" && c.childTimelineId === collectionTimelineId) {
        updated = true;
        return {
          ...c,
          itemCount: childClips.length,
          previewItems: previewItemsFrom(childClips),
          duration: totalDuration,
          sourceDuration: totalDuration,
        };
      }
      return c;
    });

    if (updated) {
      parentDoc.clips = packClips(parentDoc.clips);
      
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("gstudio-timeline-update", {
            detail: { timelineId: parentDoc.id },
          })
        );
      }
    }
  }
}

export function addClipToCollection(collectionTimelineId: string, clip: any) {
  const doc = timelineDocuments[collectionTimelineId];
  if (!doc) return null;

  // Create clean copy of the clip with a new unique ID
  const newClip = {
    ...clip,
    id: `${collectionTimelineId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
  };

  // Add and pack
  const nextClips = [...doc.clips, newClip];
  doc.clips = packClips(nextClips);

  // Sync parent collections
  syncParentCollections(collectionTimelineId, doc.clips);

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("gstudio-timeline-update", {
        detail: { timelineId: collectionTimelineId }
      })
    );
  }

  return newClip;
}

export function createCollectionTimelineDocument(id: string, title: string) {
  timelineDocuments[id] = {
    id,
    title,
    clips: [],
  };
  return timelineDocuments[id];
}

export function getCollectionFramePreview(collectionTimelineId: string, time: number) {
  const doc = timelineDocuments[collectionTimelineId];
  const childClips = doc ? doc.clips : [];
  
  if (childClips.length === 0) return null;

  let activeClip: any = null;
  let minDistance = Infinity;
  let nearestClip: any = null;

  for (const c of childClips) {
    const start = c.startTime;
    const end = c.startTime + c.duration;
    if (time >= start && time <= end) {
      activeClip = c;
      break;
    }
    
    // Find nearest clip to fill any gap smoothly
    const dist = Math.min(Math.abs(time - start), Math.abs(time - end));
    if (dist < minDistance) {
      minDistance = dist;
      nearestClip = c;
    }
  }

  const c = activeClip || nearestClip;
  if (c) {
    const start = c.startTime;
    const relativeOffset = clamp(time - start, 0, c.duration);
    const previewTime = c.kind === "video" ? (c as any).trimIn + relativeOffset : relativeOffset;
    return {
      id: c.id,
      kind: c.kind,
      src: (c as any).src,
      poster: (c as any).poster,
      alt: c.alt,
      previewTime,
      sourceDuration: (c as any).sourceDuration,
    };
  }
  
  return null;
}

export function getTimelinePage(id: string) {
  const page = timelinePages[id];
  if (!page) return null;

  return {
    id: page.id,
    title: page.title,
    description: page.description,
    timelines: page.timelineIds
      .map((timelineId) => timelineDocuments[timelineId])
      .filter((timeline): timeline is TimelineDocument => Boolean(timeline)),
  };
}
