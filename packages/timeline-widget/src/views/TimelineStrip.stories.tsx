import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";

import "../styles.css";
import { TimelineStrip } from "./TimelineStrip";
import type { TimelineClip } from "../types";

// The strip is PURE, so it renders here with no MCP host attached — which is
// the point: this is the only way to see the duration-sizing behaviour without
// a live bridge. Deterministic fixtures only; no Cloudinary, no network.

/**
 * Placeholder art as an inline data URI.
 *
 * Deliberately NOT a picsum/Cloudinary URL: stories may not call live APIs, and
 * a network fixture makes the strip's appearance depend on whether a request
 * happened to succeed. This renders identically every run, offline included.
 */
function frame(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
    <rect width="320" height="180" fill="hsl(${hue} 45% 62%)"/>
    <text x="160" y="98" font-family="sans-serif" font-size="22" fill="rgba(255,255,255,.92)"
      text-anchor="middle">${label}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const FRAME = frame("clip", 210);

function clip(overrides: Partial<TimelineClip> & { id: string }): TimelineClip {
  return {
    kind: "image",
    alt: "A clip",
    src: FRAME,
    duration: 5,
    ...overrides,
  };
}

/** Hue derived from the id rather than a running counter, so a card's colour
 *  depends only on the card — not on how many were built before it. */
function hueFor(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  return hash;
}

function collection(
  id: string,
  title: string,
  duration: number,
  itemCount = 3,
): TimelineClip {
  const hue = hueFor(id);
  return {
    id,
    kind: "collection",
    title,
    duration,
    itemCount,
    childTimelineId: `timeline-${id}`,
    previewItems: [{ kind: "image", src: frame(title, hue) }],
  };
}

/** The real "Foobar" project: a 1:44 collection beside a 3.5s still — a 30:1
 *  duration range, which is what broke the previous layout. */
const foobar: TimelineClip[] = [
  collection("heist", "Bank Heist", 40.868, 6),
  collection("new", "New Timeline", 9.12, 2),
  clip({ id: "still", alt: "Young man smiling in an alleyway", duration: 3.5 }),
  collection("fbi", "FBI Interview", 26.28, 4),
  collection("chase", "Car Chase", 11.687, 2),
  collection("test", "Test 002", 103.772, 5),
  collection("old", "My Old Timeline", 18.32, 2),
];

const meta = {
  title: "Timeline Widget/TimelineStrip",
  component: TimelineStrip,
  parameters: { layout: "padded" },
} satisfies Meta<typeof TimelineStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { clips: foobar },
};

/** The regression guard, visually: durations spanning 30:1 must stay visibly
 *  proportional instead of collapsing to equal-width cards. */
export const ExtremeDurationRange: Story = {
  args: {
    clips: [
      clip({ id: "tiny", alt: "Half a second", duration: 0.5 }),
      collection("huge", "Ten minute scene", 600, 40),
      clip({ id: "tiny-2", alt: "One second", duration: 1 }),
    ],
  },
};

/** Every clip the same length: the strip should read as uniform, not accidental. */
export const UniformDurations: Story = {
  args: {
    clips: [1, 2, 3, 4, 5].map((n) => clip({ id: `u${n}`, alt: `Clip ${n}`, duration: 6 })),
  },
};

export const SelectedClip: Story = {
  args: { clips: foobar, selectedClipId: "fbi" },
};

/** No poster anywhere — the placeholder must hold the card's shape. */
export const MissingPosters: Story = {
  args: {
    clips: [
      clip({ id: "no-src", alt: "No source at all", src: undefined, duration: 4 }),
      collection("empty", "Collection with no previews", 12, 0),
      clip({ id: "ok", alt: "Has a frame", duration: 8 }),
    ],
  },
};

/** The same frame repeated: cards must still be individually identifiable. */
export const RepeatedThumbnails: Story = {
  args: {
    clips: [1, 2, 3, 4].map((n) =>
      clip({ id: `r${n}`, alt: `Repeated frame ${n}`, src: FRAME, duration: n * 4 }),
    ),
  },
};

/** Long names are the reason the caption clamps to two lines rather than one. */
export const LongNames: Story = {
  args: {
    clips: [
      collection("long-1", "An extremely long collection name that will not fit", 30),
      clip({
        id: "long-2",
        alt: "Young_Black_man_smiling_alleyway_202606170902-1782651396988",
        duration: 3.5,
      }),
    ],
  },
};

/** Many items: the strip scrolls horizontally rather than wrapping. */
export const ManyClips: Story = {
  args: {
    clips: Array.from({ length: 30 }, (_, index) =>
      clip({
        id: `m${index}`,
        alt: `Clip ${index + 1}`,
        src: frame(`${index + 1}`, (index * 37) % 360),
        duration: 2 + (index % 7) * 5,
      }),
    ),
  },
};

export const Empty: Story = {
  args: { clips: [] },
};

/** Selection driven through the same path the app uses. */
export const Interactive: Story = {
  args: { clips: foobar },
  render: (args) => {
    const [selected, setSelected] = useState<string | null>(null);
    const [opened, setOpened] = useState<string | null>(null);
    return (
      <div>
        <TimelineStrip
          {...args}
          selectedClipId={selected}
          onSelect={(clip) => setSelected(clip.id ?? null)}
          onOpen={(clip) => setOpened(clip.title ?? clip.id ?? null)}
        />
        <p className="muted">
          selected: {selected ?? "none"} · opened: {opened ?? "none"}
        </p>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Anchored so it matches the CARD and not its "Open Bank Heist" button.
    await userEvent.click(canvas.getByRole("button", { name: /^Bank Heist,/ }));
    await expect(canvas.getByText(/selected: heist/)).toBeInTheDocument();

    // The Open affordance drills in rather than selecting.
    await userEvent.click(canvas.getByRole("button", { name: "Open FBI Interview" }));
    await expect(canvas.getByText(/opened: FBI Interview/)).toBeInTheDocument();
  },
};

/**
 * Disabled clips are MUTED, never dropped, and they keep their width — their
 * duration still shapes the strip. Dropping them would make this view disagree
 * with the app's board about what the timeline contains, which is the worst
 * outcome for an agent reading it. The "skipped" badge stays at full strength
 * so the reason is legible against the greyed artwork.
 */
export const DisabledClips: Story = {
  args: {
    clips: [
      clip({ id: "on-1", alt: "Plays", duration: 6 }),
      clip({ id: "off-1", alt: "Skipped", duration: 6, disabled: true }),
      collection("off-col", "Skipped scene", 20, 4),
      clip({ id: "on-2", alt: "Plays too", duration: 6 }),
    ].map((c) => (c.id === "off-col" ? { ...c, disabled: true } : c)),
  },
  play: async ({ canvasElement }) => {
    const muted = canvasElement.querySelectorAll(".clip--disabled");
    await expect(muted).toHaveLength(2);
    // Same slot as an enabled clip of the same duration: equal widths prove
    // the card was muted rather than collapsed.
    const cards = Array.from(canvasElement.querySelectorAll<HTMLElement>(".clip"));
    await expect(cards).toHaveLength(4);
    const first = cards[0].getBoundingClientRect().width;
    const second = cards[1].getBoundingClientRect().width;
    await expect(Math.abs(first - second)).toBeLessThan(1);
  },
};
