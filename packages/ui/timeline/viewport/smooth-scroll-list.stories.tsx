import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";

import {
  createInitialTimelineDocuments,
  createTimelineDocumentsState,
  getTimelineDocumentFromState,
} from "../timeline-documents";
import { TimelineDocumentsProvider } from "../timeline-document-store";
import { createInitialClips } from "../hooks/use-timeline-clips";
import { SmoothScrollList } from "./smooth-scroll-list";
import type { TimelineClip } from "../types";

function createStoryMediaDataUri(label: string, hue: number) {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="hsl(${hue},70%,38%)"/>`,
    `<stop offset="1" stop-color="hsl(${(hue + 52) % 360},75%,18%)"/>`,
    `</linearGradient></defs>`,
    `<rect width="480" height="270" fill="url(#g)"/>`,
    `<circle cx="394" cy="58" r="42" fill="rgba(255,255,255,0.18)"/>`,
    `<rect x="28" y="176" width="320" height="22" rx="11" fill="rgba(255,255,255,0.18)"/>`,
    `<rect x="28" y="210" width="210" height="16" rx="8" fill="rgba(255,255,255,0.12)"/>`,
    `<text x="28" y="74" fill="white" font-family="Arial, sans-serif" font-size="34" font-weight="700">${label}</text>`,
    `</svg>`,
  ].join("");

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function withDeterministicStoryMedia(clips: TimelineClip[]): TimelineClip[] {
  return clips.map((clip) => {
    const mediaSrc = createStoryMediaDataUri(
      `${clip.kind === "video" ? "Video" : "Image"} ${clip.index}`,
      (clip.index * 37 + (clip.kind === "video" ? 210 : 135)) % 360,
    );

    if (clip.kind === "video") {
      return {
        ...clip,
        poster: mediaSrc,
      };
    }

    if (clip.kind === "image") {
      return {
        ...clip,
        src: mediaSrc,
      };
    }

    return {
      ...clip,
      previewItems: clip.previewItems?.map((item, itemIndex) => ({
        ...item,
        poster:
          item.kind === "video"
            ? createStoryMediaDataUri(
                `Preview ${clip.index}.${itemIndex}`,
                (clip.index * 37 + itemIndex * 29 + 210) % 360,
              )
            : item.poster,
        src:
          item.kind === "image"
            ? createStoryMediaDataUri(
                `Preview ${clip.index}.${itemIndex}`,
                (clip.index * 37 + itemIndex * 29 + 135) % 360,
              )
            : item.src,
      })),
    };
  });
}

function createSmoothScrollStoryClips(itemCount: number): TimelineClip[] {
  return withDeterministicStoryMedia(createInitialClips(itemCount, 100));
}

const storyTimelineDocuments = createInitialTimelineDocuments();
for (const id of Object.keys(storyTimelineDocuments)) {
  storyTimelineDocuments[id] = {
    ...storyTimelineDocuments[id],
    clips: withDeterministicStoryMedia(storyTimelineDocuments[id].clips),
  };
}
const storyTimelineState = createTimelineDocumentsState(storyTimelineDocuments);

function getStoryTimelineDocument(id: string) {
  return getTimelineDocumentFromState(storyTimelineState, id);
}

const meta = {
  title: "UI/Timeline/viewport/SmoothScrollList",
  component: SmoothScrollList,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <main className="min-h-screen bg-zinc-950 p-8 text-white">
        <TimelineDocumentsProvider initialState={storyTimelineState}>
          <Story />
        </TimelineDocumentsProvider>
      </main>
    ),
  ],
  args: {
    initialClips: createSmoothScrollStoryClips(12),
    itemCount: 12,
    onPlayheadTimeChange: fn(),
    pixelsPerSecond: 100,
    viewportWidth: "100%",
    syncMediaDuration: false,
    disablePersistence: true,
    navigate: fn(),
  },
} satisfies Meta<typeof SmoothScrollList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CollectionTimeline: Story = {
  args: {
    initialClips: withDeterministicStoryMedia(getStoryTimelineDocument("root")?.clips ?? []),
    itemCount: getStoryTimelineDocument("root")?.clips.length ?? 0,
    initialViewState: {
      showPlayBarArea: true,
      thumbnailMode: true,
    },
    syncMediaDuration: false,
    timelineId: "root",
  },
};

/**
 * Clicking the first thumbnail of a collection tile exposes the first child
 * clip as a separate adjacent item to the LEFT of the collection in the
 * timeline row.
 */
export const CollectionFirstEndpointExposed: Story = {
  args: {
    initialClips: withDeterministicStoryMedia(getStoryTimelineDocument("root")?.clips ?? []),
    itemCount: getStoryTimelineDocument("root")?.clips.length ?? 0,
    initialViewState: {
      showPlayBarArea: true,
      thumbnailMode: true,
    },
    syncMediaDuration: false,
    timelineId: "root",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Click the "first item" endpoint button on the collection tile.
    const firstEndpointBtn = await canvas.findByRole("button", {
      name: "Scene A Selects first item",
    });
    await userEvent.click(firstEndpointBtn);

    // The first child clip from the child timeline now appears as a separate
    // adjacent item to the LEFT of the collection (data-view-endpoint="first").
    await waitFor(() => {
      const endpointClip = canvasElement.querySelector(
        '[data-view-endpoint="first"]',
      );
      expect(endpointClip).toBeTruthy();
      expect(
        endpointClip?.querySelector('[data-testid="collection-endpoint-accent-bar"]'),
      ).toBeTruthy();
      const linkMarker = canvasElement.querySelector(
        '[data-testid="timeline-collection-endpoint-link"][data-endpoint="first"]',
      );
      expect(linkMarker).toBeTruthy();
    });

    await userEvent.click(
      await canvas.findByRole("button", {
        name: "Hide first collection endpoint",
      }),
    );

    await waitFor(() => {
      expect(
        canvasElement.querySelector('[data-view-endpoint="first"]'),
      ).toBeNull();
      expect(
        canvasElement.querySelector(
          '[data-testid="timeline-collection-endpoint-link"][data-endpoint="first"]',
        ),
      ).toBeNull();
    });
  },
};

/**
 * Clicking the last thumbnail of a collection tile exposes the last child
 * clip as a separate adjacent item to the RIGHT of the collection in the
 * timeline row.
 */
export const CollectionLastEndpointExposed: Story = {
  args: {
    initialClips: withDeterministicStoryMedia(getStoryTimelineDocument("root")?.clips ?? []),
    itemCount: getStoryTimelineDocument("root")?.clips.length ?? 0,
    initialViewState: {
      showPlayBarArea: true,
      thumbnailMode: true,
    },
    syncMediaDuration: false,
    timelineId: "root",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Click the "last item" endpoint button on the collection tile.
    const lastEndpointBtn = await canvas.findByRole("button", {
      name: "Scene A Selects last item",
    });
    await userEvent.click(lastEndpointBtn);

    // The last child clip appears to the RIGHT with the matching accent bar.
    await waitFor(() => {
      const endpointClip = canvasElement.querySelector(
        '[data-view-endpoint="last"]',
      );
      expect(endpointClip).toBeTruthy();
      expect(
        endpointClip?.querySelector('[data-testid="collection-endpoint-accent-bar"]'),
      ).toBeTruthy();
      const linkMarker = canvasElement.querySelector(
        '[data-testid="timeline-collection-endpoint-link"][data-endpoint="last"]',
      );
      expect(linkMarker).toBeTruthy();
    });

    await userEvent.click(
      await canvas.findByRole("button", {
        name: "Hide last collection endpoint",
      }),
    );

    await waitFor(() => {
      expect(
        canvasElement.querySelector('[data-view-endpoint="last"]'),
      ).toBeNull();
      expect(
        canvasElement.querySelector(
          '[data-testid="timeline-collection-endpoint-link"][data-endpoint="last"]',
        ),
      ).toBeNull();
    });
  },
};

export const CollectionSelectedShowsPlayBar: Story = {
  args: {
    initialClips: withDeterministicStoryMedia(getStoryTimelineDocument("root")?.clips ?? []),
    itemCount: getStoryTimelineDocument("root")?.clips.length ?? 0,
    initialViewState: {
      showPlayBarArea: true,
      thumbnailMode: true,
    },
    syncMediaDuration: false,
    timelineId: "root",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const collectionClip = await canvas.findByTestId("timeline-clip-0");

    await userEvent.click(collectionClip);

    const filmstrip = await canvas.findByTestId("timeline-source-filmstrip");
    await expect(filmstrip).toBeVisible();
    await expect(filmstrip).toHaveAttribute("data-clip-index", "0");
  },
};

export const ThumbnailMode: Story = {
  args: {
    initialViewState: {
      thumbnailMode: true,
    },
  },
};

/** Play-less e2e twin: the real-mouse Playwright suite must not race an
 *  auto-running play() (its synthetic pointer events kill a concurrent real
 *  drag), so it selects clips itself on this fixture. */
export const PlayBarPlayground: Story = {
  args: {
    initialViewState: {
      showPlayBarArea: true,
    },
  },
};

export const FirstClipSelectedAtTimelineStart: Story = {
  args: {
    initialViewState: {
      showPlayBarArea: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const clip = await canvas.findByTestId("timeline-clip-0");
    await userEvent.click(clip);
    await expect(clip).toHaveAttribute("data-selected", "true");
    await expect(clip).toHaveAttribute("data-start-time", "0");
    await expect(canvas.getByTestId("timeline-source-filmstrip")).toBeVisible();
  },
};

export const FirstClipSelectedWithThumbnailOverhang: Story = {
  args: {
    initialViewState: {
      showPlayBarArea: true,
      thumbnailMode: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const clip = await canvas.findByTestId("timeline-clip-0");
    await userEvent.click(clip);

    await expect(clip).toHaveAttribute("data-selected", "true");
    await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-thumbnail-mode", "true");
    await expect(canvas.getByTestId("timeline-source-filmstrip")).toBeVisible();
  },
};

export const LastClipSelectedAtTimelineEnd: Story = {
  args: {
    initialViewState: {
      showPlayBarArea: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const viewport = canvas.getByTestId("timeline-scroll-viewport");
    fireEvent.scroll(viewport, { target: { scrollLeft: 2400 } });

    await waitFor(async () => {
      await expect(canvas.getByTestId("timeline-clip-11")).toBeVisible();
    });

    const clip = canvas.getByTestId("timeline-clip-11");
    await userEvent.click(clip);
    await expect(clip).toHaveAttribute("data-selected", "true");
    await expect(canvas.getByTestId("timeline-source-filmstrip")).toHaveAttribute("data-clip-index", "11");
  },
};

export const LastClipSelectedWithThumbnailOverhang: Story = {
  args: {
    initialViewState: {
      showPlayBarArea: true,
      thumbnailMode: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const viewport = canvas.getByTestId("timeline-scroll-viewport");
    fireEvent.scroll(viewport, { target: { scrollLeft: 3200 } });

    await waitFor(async () => {
      await expect(canvas.getByTestId("timeline-clip-11")).toBeVisible();
    });

    const clip = canvas.getByTestId("timeline-clip-11");
    await userEvent.click(clip);
    await expect(clip).toHaveAttribute("data-selected", "true");
    await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-thumbnail-mode", "true");
    await expect(canvas.getByTestId("timeline-source-filmstrip")).toHaveAttribute("data-clip-index", "11");
  },
};

export const ZoomedOut: Story = {
  args: {
    pixelsPerSecond: 20,
  },
};

export const ZoomedIn: Story = {
  args: {
    pixelsPerSecond: 250,
  },
};

export const Empty: Story = {
  args: {
    initialClips: [],
    itemCount: 0,
  },
};

export const HundredClips: Story = {
  args: {
    initialClips: createSmoothScrollStoryClips(100),
    itemCount: 100,
  },
};

export const VirtualizedThousandClips: Story = {
  args: {
    initialClips: createSmoothScrollStoryClips(1000),
    itemCount: 1000,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-item-count", "1000");
  },
};

export const VirtualizedThousandClipsThumbnail: Story = {
  args: {
    initialClips: createSmoothScrollStoryClips(1000),
    itemCount: 1000,
    initialViewState: {
      thumbnailMode: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-item-count", "1000");
    await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-thumbnail-mode", "true");
  },
};

export const MultipleTimelines: Story = {
  render: (args) => (
    <div className="grid gap-16">
      <SmoothScrollList
        {...args}
        initialClips={createSmoothScrollStoryClips(1000)}
        itemCount={1000}
      />
      <SmoothScrollList
        {...args}
        initialClips={createSmoothScrollStoryClips(1000)}
        itemCount={1000}
      />
    </div>
  ),
};

export const MultipleTimelinesThumbnail: Story = {
  render: (args) => (
    <div className="grid gap-16">
      <SmoothScrollList
        {...args}
        initialClips={createSmoothScrollStoryClips(1000)}
        itemCount={1000}
        initialViewState={{ thumbnailMode: true }}
      />
      <SmoothScrollList
        {...args}
        initialClips={createSmoothScrollStoryClips(1000)}
        itemCount={1000}
        initialViewState={{ thumbnailMode: true }}
      />
    </div>
  ),
};

