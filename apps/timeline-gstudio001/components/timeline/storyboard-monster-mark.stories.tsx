import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { StoryboardMonsterMark, STORYBOARD_MONSTER_ACCENT } from "./storyboard-monster-mark";

// The creature in the rail's wordmark.
//
// WHY THIS EXISTS AS A STORY. Every judgement this drawing has ever needed —
// are the feet visible on the rail's black, is the band separate from the
// crown, does the eye still read at 15px — is a judgement made by LOOKING, and
// it was being made by hand-injecting clones into the running app each time.
// The two sizes below are the two the sidebar actually renders, and the blown-up
// one is where a colour or a geometry change is legible before it ships.
//
// The rail's own ground, not Storybook's, because half the decisions here are
// contrast decisions against exactly this value.
const RAIL_BG = "#0a0a0a";

function Plate({
  children,
  label,
}: Readonly<{ children: React.ReactNode; label: string }>) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex min-h-[132px] items-center justify-center">{children}</div>
      <span className="font-mono text-[11px] text-white/70">{label}</span>
    </div>
  );
}

const meta = {
  title: "Timeline/StoryboardMonsterMark",
  component: StoryboardMonsterMark,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div
        className="flex items-end gap-9 rounded-xl p-10 text-[19px]"
        style={{ background: RAIL_BG }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StoryboardMonsterMark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The two sizes the rail renders, side by side, at the rail's 19px type size. */
export const RailSizes: Story = {
  args: { scale: 1.1 },
  render: () => (
    <>
      <Plate label="in the word (1.1)">
        <StoryboardMonsterMark scale={1.1} />
      </Plate>
      <Plate label="alone, collapsed (1.6)">
        <StoryboardMonsterMark scale={1.6} />
      </Plate>
    </>
  ),
  play: async ({ canvasElement }) => {
    const marks = Array.from(canvasElement.querySelectorAll("[data-storyboard-monster]"));
    expect(marks).toHaveLength(2);
    const [inWord, alone] = marks as [Element, Element];
    // The collapsed mark is the bigger of the two — the rail loses the word, so
    // the creature has to carry the corner on its own. A regression that swaps
    // or equalises the scales is invisible in a screenshot diff of one state.
    expect(inWord.getBoundingClientRect().width).toBeLessThan(
      alone.getBoundingClientRect().width,
    );
    // Both feet, both eyes' worth of parts, and the hat — the drawing is only
    // ever wrong by a piece going missing.
    expect(alone.querySelectorAll("[data-monster-foot]")).toHaveLength(2);
    expect(alone.querySelector("[data-monster-pupil]")).toBeTruthy();
    expect(alone.querySelector("[data-monster-hat]")).toBeTruthy();
  },
};

/** Big enough to judge the hat's band against its crown, and the egg's stretch. */
export const BlownUp: Story = {
  args: { scale: 1 },
  render: () => (
    <Plate label="7x">
      <span className="text-[7em]">
        <StoryboardMonsterMark scale={1} />
      </span>
    </Plate>
  ),
};

/**
 * The mark beside the word it belongs to, in the wordmark's own colour.
 *
 * Not a duplicate of the sidebar's lockup — that one is a flex row of revealed
 * letters mid-animation. This is the static relationship the colours were
 * chosen for: band and letters sharing one token, creature standing on the line.
 */
export const InTheWordmark: Story = {
  args: { scale: 1.1 },
  render: () => (
    <span
      className="flex items-center font-[family-name:var(--font-caprasimo)] text-[19px] text-white"
      style={{ lineHeight: 1 }}
    >
      storyboard&nbsp;
      <span style={{ color: STORYBOARD_MONSTER_ACCENT }}>
        m
        <StoryboardMonsterMark scale={1.1} />
        nster
      </span>
    </span>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText(/storyboard/)).toBeTruthy();
    expect(canvasElement.querySelector("[data-storyboard-monster]")).toBeTruthy();
  },
};
