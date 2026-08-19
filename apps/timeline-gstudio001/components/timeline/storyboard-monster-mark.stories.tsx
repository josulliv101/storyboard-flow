import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import {
  StoryboardMonsterMark,
  STORYBOARD_MONSTER_ACCENT,
} from "./storyboard-monster-mark";

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
      <div className="flex min-h-[132px] items-center justify-center">
        {children}
      </div>
      <span className="font-mono text-[11px] text-white/70">{label}</span>
    </div>
  );
}

/**
 * Poses one rendered hat by writing straight to its style.
 *
 * A callback ref rather than a prop, because the component deliberately does
 * not take one: the hat's transform belongs to the stylesheet, and adding a
 * prop so a story could set it would put a second owner on the same property.
 */
function hatPose(transform: string) {
  return (node: HTMLElement | null) => {
    const hat = node?.querySelector<HTMLElement>("[data-monster-hat]");
    if (hat) hat.style.transform = transform;
  };
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
      <Plate label="in the word (1.1, looking ahead)">
        <StoryboardMonsterMark scale={1.1} gaze="ahead" />
      </Plate>
      <Plate label="alone, collapsed (1.6, at the breadcrumb)">
        <StoryboardMonsterMark scale={1.6} gaze="breadcrumb" />
      </Plate>
    </>
  ),
  play: async ({ canvasElement }) => {
    const marks = Array.from(
      canvasElement.querySelectorAll("[data-storyboard-monster]"),
    );
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
    // The two states differ by where the eye rests, and the difference is about
    // 1.6px — small enough that only a measurement can tell whether the prop is
    // still wired. In the word the pupil must be CENTRED, because the creature
    // is the letter's counter there.
    const pupilOffset = (mark: Element) => {
      const pupil = mark.querySelector("[data-monster-pupil]");
      if (!pupil) return NaN;
      const white = pupil.parentElement;
      if (!white) return NaN;
      const p = pupil.getBoundingClientRect();
      const w = white.getBoundingClientRect();
      return p.x + p.width / 2 - (w.x + w.width / 2);
    };
    expect(Math.abs(pupilOffset(inWord))).toBeLessThan(0.5);
    expect(pupilOffset(alone)).toBeGreaterThan(0.5);
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
    expect(
      canvasElement.querySelector("[data-storyboard-monster]"),
    ).toBeTruthy();
  },
};

/**
 * The hat's four poses across a jump, laid out side by side.
 *
 * The motion itself lives in `globals.css` (`sw-hat-settle`) and only runs
 * inside a real view transition, which a story cannot stage. What a story CAN
 * do is hold each pose still, which is the only way to see whether the jam
 * actually presses the brim into the head rather than detaching it — the one
 * failure a 640ms animation hides by being fast.
 *
 * The transforms are the keyframes' own values at `--sw-hop-dir: 1`. If they
 * drift from the stylesheet this story stops describing the animation, which is
 * the trade for being able to look at it at all.
 */
export const HatPoses: Story = {
  args: { scale: 1 },
  render: () => (
    <>
      {(
        [
          ["rest", "none"],
          ["in flight (drag)", "translateY(-0.035em) rotate(-3deg)"],
          ["the jam", "translateY(0.042em) rotate(3.5deg)"],
          ["rebound", "translateY(-0.02em) rotate(-1.8deg)"],
        ] as const
      ).map(([label, transform]) => (
        <Plate key={label} label={label}>
          <span className="text-[4em]" ref={hatPose(transform)}>
            <StoryboardMonsterMark scale={1} />
          </span>
        </Plate>
      ))}
    </>
  ),
  play: async ({ canvasElement }) => {
    const hats = canvasElement.querySelectorAll("[data-monster-hat]");
    expect(hats).toHaveLength(4);
    const y = (n: Element) => n.getBoundingClientRect().top;
    const [rest, flight, jam] = Array.from(hats) as [Element, Element, Element];
    // The jam is BELOW rest and the flight pose is ABOVE it. Signs, not
    // magnitudes: a keyframe edit that inverts the bounce is the regression
    // worth catching, and it is invisible in a still screenshot.
    expect(y(flight)).toBeLessThan(y(rest));
    expect(y(jam)).toBeGreaterThan(y(rest));
  },
};

/**
 * Hatted and bare, side by side, at the size the rail actually renders.
 *
 * The prop is free to use — every rule that animates the hat keys off
 * `[data-monster-hat]`, so with nothing rendered they match nothing. What this
 * story exists to show is the thing the prop CANNOT decide for you: the body
 * was stretched into an egg to open headroom between the eye and the brim, and
 * with the brim gone that headroom reads as a tall head. Whether a permanently
 * hatless creature wants `BODY_H` back toward the source's 0.98 is a judgement
 * to make by looking, which is what these two are for.
 */
export const WithoutTheHat: Story = {
  args: { scale: 1.6 },
  render: () => (
    <>
      <Plate label="with the hat">
        <StoryboardMonsterMark scale={1.6} />
      </Plate>
      <Plate label="hat={false}">
        <StoryboardMonsterMark scale={1.6} hat={false} />
      </Plate>
      <Plate label="bare, blown up">
        <span className="text-[4em]">
          <StoryboardMonsterMark scale={1} hat={false} />
        </span>
      </Plate>
    </>
  ),
  play: async ({ canvasElement }) => {
    const marks = Array.from(
      canvasElement.querySelectorAll("[data-storyboard-monster]"),
    );
    expect(marks).toHaveLength(3);
    const [hatted, bare] = marks as [Element, Element];
    expect(hatted.querySelector("[data-monster-hat]")).toBeTruthy();
    expect(bare.querySelector("[data-monster-hat]")).toBeNull();
    // Everything else is untouched — the hat is its own layer, so dropping it
    // must not move the body, the eye or the feet.
    expect(bare.querySelectorAll("[data-monster-foot]")).toHaveLength(2);
    expect(bare.querySelector("[data-monster-eye]")).toBeTruthy();
    expect(
      Math.abs(
        hatted.getBoundingClientRect().height -
          bare.getBoundingClientRect().height,
      ),
    ).toBeLessThan(0.5);
  },
};
