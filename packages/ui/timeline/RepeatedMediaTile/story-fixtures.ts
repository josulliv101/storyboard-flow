import type {
  CollectionTimelineClip,
  MediaTimelineClip,
  TimelineClip,
} from "../types";

export function createStoryMediaDataUri(label: string, hue: number) {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">`,
    `<defs>`,
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="hsl(${hue},68%,34%)"/>`,
    `<stop offset="1" stop-color="hsl(${(hue + 44) % 360},72%,16%)"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect width="480" height="270" fill="url(#bg)"/>`,
    `<circle cx="390" cy="68" r="44" fill="rgba(255,255,255,0.16)"/>`,
    `<rect x="28" y="170" width="304" height="22" rx="11" fill="rgba(255,255,255,0.18)"/>`,
    `<rect x="28" y="206" width="196" height="16" rx="8" fill="rgba(255,255,255,0.12)"/>`,
    `<text x="28" y="78" fill="white" font-family="Arial, sans-serif" font-size="34" font-weight="700">${label}</text>`,
    `</svg>`,
  ].join("");

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const storyVideoSrc =
  "https://res.cloudinary.com/demo/video/upload/dog.mp4";

export const storyVideoPoster = createStoryMediaDataUri("Video", 215);
export const storyImageSrc = createStoryMediaDataUri("Image", 145);

export const imageClip: MediaTimelineClip = {
  id: "img-1",
  index: 0,
  kind: "image",
  src: storyImageSrc,
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
      src: createStoryMediaDataUri("Middle", 165),
      alt: "Middle insert",
    },
    {
      id: "preview-last",
      kind: "image",
      src: createStoryMediaDataUri("Last", 185),
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
