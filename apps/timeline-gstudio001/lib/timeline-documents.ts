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
