import type {
  CollectionTimelineClip,
  MediaTimelineClip,
  TimelineClip,
} from "../types";

export const storyVideoSrc =
  "https://res.cloudinary.com/demo/video/upload/dog.mp4";

export const storyVideoPoster =
  "https://res.cloudinary.com/demo/video/upload/so_0,w_480,h_270,c_fill,q_auto,f_jpg/dog.jpg";

export const imageClip: MediaTimelineClip = {
  id: "img-1",
  index: 0,
  kind: "image",
  src: "https://picsum.photos/seed/timeline-1/400/200",
  alt: "Sample image",
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 0,
  duration: 3,
  sourceDuration: 3,
  trimIn: 0,
  trimOut: 0,
};

export const videoClip: MediaTimelineClip = {
  id: "vid-1",
  index: 1,
  kind: "video",
  src: storyVideoSrc,
  poster: storyVideoPoster,
  alt: "Sample video",
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 3,
  duration: 5,
  sourceDuration: 10,
  trimIn: 2,
  trimOut: 3,
};

export const collectionClip: CollectionTimelineClip = {
  id: "collection-1",
  index: 2,
  kind: "collection",
  title: "Scene Selects",
  childTimelineId: "scene-selects",
  itemCount: 12,
  previewItems: [
    {
      id: "preview-video",
      kind: "video",
      src: storyVideoSrc,
      poster: storyVideoPoster,
      alt: "Opening shot",
    },
    {
      id: "preview-image",
      kind: "image",
      src: "https://picsum.photos/seed/timeline-collection-middle/320/180",
      alt: "Middle insert",
    },
    {
      id: "preview-last",
      kind: "image",
      src: "https://picsum.photos/seed/timeline-collection-last/320/180",
      alt: "Closing frame",
    },
  ],
  alt: "Scene Selects collection",
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 9,
  duration: 4,
  sourceDuration: 4,
  trimIn: 0,
  trimOut: 0,
};

export const emptyCollectionClip: CollectionTimelineClip = {
  ...collectionClip,
  id: "collection-empty",
  title: "Empty Collection",
  itemCount: 0,
  previewItems: [],
};

export const timelineClips: TimelineClip[] = [
  imageClip,
  videoClip,
  collectionClip,
];
