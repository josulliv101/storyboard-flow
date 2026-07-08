export type RoutedMediaStripItem =
  | Readonly<{
      id: string;
      kind: "image";
      name: string;
      src: string;
      posterSrcs?: readonly string[];
      startTimeSeconds: number;
      durationSeconds: number;
    }>
  | Readonly<{
      id: string;
      kind: "video";
      name: string;
      src: string;
      posterSrcs?: readonly string[];
      startTimeSeconds: number;
      sourceDurationSeconds: number;
      trimInSeconds: number;
      trimOutSeconds: number;
    }>
  | Readonly<{
      id: string;
      kind: "collection";
      name: string;
      collectionId: string;
      startTimeSeconds: number;
      durationSeconds: number;
    }>;

export type RoutedMediaCollection = Readonly<{
  id: string;
  name: string;
  deck: string;
  notes: string;
  items: readonly RoutedMediaStripItem[];
}>;

export const DEFAULT_COLLECTION_ID = "assembly";

type GeneratedMediaItemsInput = Readonly<{
  prefix: string;
  label: string;
  count: number;
  startAtSeconds: number;
}>;

function createGeneratedMediaItems({
  prefix,
  label,
  count,
  startAtSeconds,
}: GeneratedMediaItemsInput): readonly RoutedMediaStripItem[] {
  return Array.from({ length: count }, (_, index): RoutedMediaStripItem => {
    const itemNumber = index + 1;
    const paddedNumber = String(itemNumber).padStart(3, "0");
    const seed = `${prefix}-${paddedNumber}`;
    const startTimeSeconds = startAtSeconds + index * 5;

    if (index % 3 === 1) {
      return {
        id: `${seed}-image`,
        kind: "image",
        name: `${label} still ${paddedNumber}`,
        src: `https://picsum.photos/seed/${seed}-image/1280/720`,
        posterSrcs: [`https://picsum.photos/seed/${seed}-poster/640/360`],
        startTimeSeconds,
        durationSeconds: 3 + (index % 5),
      };
    }

    const trimInSeconds = index % 4;
    const trimOutSeconds = (index + 2) % 5;
    const sourceDurationSeconds = 12 + (index % 11);

    return {
      id: `${seed}-video`,
      kind: "video",
      name: `${label} clip ${paddedNumber}`,
      src: `https://picsum.photos/seed/${seed}-video/1280/720`,
      posterSrcs: [
        `https://picsum.photos/seed/${seed}-a/640/360`,
        `https://picsum.photos/seed/${seed}-b/640/360`,
        `https://picsum.photos/seed/${seed}-c/640/360`,
      ],
      startTimeSeconds,
      sourceDurationSeconds,
      trimInSeconds,
      trimOutSeconds,
    };
  });
}

export const MEDIA_COLLECTIONS = [
  {
    id: "assembly",
    name: "Assembly",
    deck: "Primary cut",
    notes:
      "Opening coverage is assembled, detail inserts are parked, and the transition pass is ready for timing review.",
    items: [
      {
        id: "opening-shot",
        kind: "video",
        name: "Opening shot",
        src: "https://picsum.photos/seed/opening-shot/1280/720",
        posterSrcs: [
          "https://picsum.photos/seed/opening-shot-a/640/360",
          "https://picsum.photos/seed/opening-shot-b/640/360",
          "https://picsum.photos/seed/opening-shot-c/640/360",
        ],
        startTimeSeconds: 0,
        sourceDurationSeconds: 18,
        trimInSeconds: 2,
        trimOutSeconds: 3,
      },
      {
        id: "location-detail",
        kind: "image",
        name: "Location detail",
        src: "https://picsum.photos/seed/location-detail/1280/720",
        posterSrcs: ["https://picsum.photos/seed/location-detail-poster/640/360"],
        startTimeSeconds: 13,
        durationSeconds: 5,
      },
      {
        id: "character-beat",
        kind: "video",
        name: "Character beat",
        src: "https://picsum.photos/seed/character-beat/1280/720",
        posterSrcs: [
          "https://picsum.photos/seed/character-beat-a/640/360",
          "https://picsum.photos/seed/character-beat-b/640/360",
          "https://picsum.photos/seed/character-beat-c/640/360",
          "https://picsum.photos/seed/character-beat-d/640/360",
        ],
        startTimeSeconds: 18,
        sourceDurationSeconds: 24,
        trimInSeconds: 4,
        trimOutSeconds: 6,
      },
      {
        id: "b-roll-folder",
        kind: "collection",
        name: "B-roll selects",
        collectionId: "b-roll-selects",
        startTimeSeconds: 32,
        durationSeconds: 8,
      },
      {
        id: "sound-folder",
        kind: "collection",
        name: "Sound design",
        collectionId: "sound-design",
        startTimeSeconds: 40,
        durationSeconds: 7,
      },
      {
        id: "transition-pass",
        kind: "video",
        name: "Transition pass",
        src: "https://picsum.photos/seed/transition-pass/1280/720",
        posterSrcs: [
          "https://picsum.photos/seed/transition-pass-a/640/360",
          "https://picsum.photos/seed/transition-pass-b/640/360",
        ],
        startTimeSeconds: 47,
        sourceDurationSeconds: 14,
        trimInSeconds: 1,
        trimOutSeconds: 2,
      },
      ...createGeneratedMediaItems({
        prefix: "assembly-virtual",
        label: "Assembly virtualized",
        count: 180,
        startAtSeconds: 59,
      }),
    ],
  },
  {
    id: "b-roll-selects",
    name: "B-roll Selects",
    deck: "Nested collection",
    notes:
      "Texture shots, room details, and quick inserts that can be pulled into the main assembly when a beat needs air.",
    items: [
      {
        id: "street-light",
        kind: "image",
        name: "Street light",
        src: "https://picsum.photos/seed/street-light/1280/720",
        startTimeSeconds: 0,
        durationSeconds: 4,
      },
      {
        id: "window-pass",
        kind: "video",
        name: "Window pass",
        src: "https://picsum.photos/seed/window-pass/1280/720",
        posterSrcs: [
          "https://picsum.photos/seed/window-pass-a/640/360",
          "https://picsum.photos/seed/window-pass-b/640/360",
        ],
        startTimeSeconds: 4,
        sourceDurationSeconds: 15,
        trimInSeconds: 3,
        trimOutSeconds: 4,
      },
      {
        id: "hands-insert",
        kind: "image",
        name: "Hands insert",
        src: "https://picsum.photos/seed/hands-insert/1280/720",
        posterSrcs: ["https://picsum.photos/seed/hands-insert-poster/640/360"],
        startTimeSeconds: 12,
        durationSeconds: 5,
      },
      {
        id: "hallway-drift",
        kind: "video",
        name: "Hallway drift",
        src: "https://picsum.photos/seed/hallway-drift/1280/720",
        posterSrcs: [
          "https://picsum.photos/seed/hallway-drift-a/640/360",
          "https://picsum.photos/seed/hallway-drift-b/640/360",
          "https://picsum.photos/seed/hallway-drift-c/640/360",
        ],
        startTimeSeconds: 17,
        sourceDurationSeconds: 19,
        trimInSeconds: 2,
        trimOutSeconds: 5,
      },
      ...createGeneratedMediaItems({
        prefix: "b-roll-virtual",
        label: "B-roll virtualized",
        count: 160,
        startAtSeconds: 29,
      }),
    ],
  },
  {
    id: "sound-design",
    name: "Sound Design",
    deck: "Nested collection",
    notes:
      "Visual placeholders for tone, impact, and transition cues that travel with the edit while audio work is still rough.",
    items: [
      {
        id: "tone-bed",
        kind: "image",
        name: "Tone bed",
        src: "https://picsum.photos/seed/tone-bed/1280/720",
        startTimeSeconds: 0,
        durationSeconds: 6,
      },
      {
        id: "impact-hit",
        kind: "video",
        name: "Impact hit",
        src: "https://picsum.photos/seed/impact-hit/1280/720",
        posterSrcs: [
          "https://picsum.photos/seed/impact-hit-a/640/360",
          "https://picsum.photos/seed/impact-hit-b/640/360",
        ],
        startTimeSeconds: 6,
        sourceDurationSeconds: 8,
        trimInSeconds: 1,
        trimOutSeconds: 1,
      },
      {
        id: "room-tail",
        kind: "image",
        name: "Room tail",
        src: "https://picsum.photos/seed/room-tail/1280/720",
        startTimeSeconds: 12,
        durationSeconds: 5,
      },
      ...createGeneratedMediaItems({
        prefix: "sound-design-virtual",
        label: "Sound design virtualized",
        count: 140,
        startAtSeconds: 17,
      }),
    ],
  },
  {
    id: "revision-pulls",
    name: "Revision Pulls",
    deck: "Alternate route",
    notes:
      "Alternate takes and replacement inserts held outside the main assembly until the next review pass.",
    items: [
      {
        id: "alt-opening",
        kind: "video",
        name: "Alt opening",
        src: "https://picsum.photos/seed/alt-opening/1280/720",
        posterSrcs: [
          "https://picsum.photos/seed/alt-opening-a/640/360",
          "https://picsum.photos/seed/alt-opening-b/640/360",
        ],
        startTimeSeconds: 0,
        sourceDurationSeconds: 22,
        trimInSeconds: 5,
        trimOutSeconds: 6,
      },
      {
        id: "insert-card",
        kind: "image",
        name: "Insert card",
        src: "https://picsum.photos/seed/insert-card/1280/720",
        startTimeSeconds: 11,
        durationSeconds: 4,
      },
      {
        id: "reaction-hold",
        kind: "video",
        name: "Reaction hold",
        src: "https://picsum.photos/seed/reaction-hold/1280/720",
        posterSrcs: [
          "https://picsum.photos/seed/reaction-hold-a/640/360",
          "https://picsum.photos/seed/reaction-hold-b/640/360",
          "https://picsum.photos/seed/reaction-hold-c/640/360",
        ],
        startTimeSeconds: 15,
        sourceDurationSeconds: 16,
        trimInSeconds: 2,
        trimOutSeconds: 4,
      },
      ...createGeneratedMediaItems({
        prefix: "revision-pulls-virtual",
        label: "Revision virtualized",
        count: 120,
        startAtSeconds: 25,
      }),
    ],
  },
] satisfies readonly RoutedMediaCollection[];

export function getCollection(collectionId: string): RoutedMediaCollection | undefined {
  return MEDIA_COLLECTIONS.find((collection) => collection.id === collectionId);
}

export function getCollectionRuntimeSeconds(collection: RoutedMediaCollection): number {
  return collection.items.reduce((sum, item) => {
    if (item.kind === "video") {
      return sum + item.sourceDurationSeconds - item.trimInSeconds - item.trimOutSeconds;
    }
    return sum + item.durationSeconds;
  }, 0);
}
