import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import {
  StoryboardMonsterMark,
  STORYBOARD_MONSTER_ACCENT,
} from "./storyboard-monster-mark";

// The creature in the rail's wordmark.
//
// WHY THIS EXISTS AS A STORY. Every judgement this drawing has ever needed —
// are the feet visible on the rail's black, is a knob separate from its stalk,
// does the eye still read at 15px — is a judgement made by LOOKING, and
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
 * Poses one rendered pair of antennae by writing straight to the group.
 *
 * TWO CHANNELS, because the animation has two. `--sw-antenna-bend` is the whip:
 * it inherits down to the six chain segments, each of which turns by it, so the
 * turns compound into an arc. The transform is only the tracking offset that
 * keeps the pair rooted in a squashing head. Setting a `transform` alone — as
 * an earlier version of this story did — poses nothing at all now, because the
 * group stopped carrying the sway when the chain took it over.
 *
 * A callback ref rather than a prop, because the component deliberately does
 * not take one: both of these belong to the stylesheet, and adding a prop so a
 * story could set them would put a second owner on the same properties.
 */
function antennaPose(bend: string, transform: string) {
  return (node: HTMLElement | null) => {
    const pair = node?.querySelector<HTMLElement>("[data-monster-antennae]");
    if (!pair) return;
    pair.style.setProperty("--sw-antenna-bend", bend);
    pair.style.transform = transform;
  };
}

/**
 * The same, for the body's landing squash — a different element and a different
 * property, which is the entire point of the pair of them.
 *
 * IT POSES THE FUR TOO, because the shipped rule does: they are siblings, and
 * the fur's masked ring clears the body's silhouette by 0.05px at rail size, so
 * a squash the fur does not follow drops the head out from under it and bares
 * the starburst. Posing only the body here reproduced exactly that bug inside
 * the story, which is how this comment came to exist.
 */
function bodyPose(transform: string) {
  return (node: HTMLElement | null) => {
    for (const sel of ["[data-monster-body]", "[data-monster-fur]"]) {
      const el = node?.querySelector<HTMLElement>(sel);
      if (el) el.style.transform = transform;
    }
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
    // Both feet, both eyes' worth of parts, and the antennae — the drawing is
    // only ever wrong by a piece going missing.
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
    expect(alone.querySelector("[data-monster-antennae]")).toBeTruthy();
  },
};

/** Big enough to judge a knob against its stalk, and the lean of the pair. */
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
 * chosen for: knobs and feet sharing one token, creature standing on the line.
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
 * The four poses of a jump, laid out side by side — and BOTH parts at once.
 *
 * The motion itself lives in `globals.css` (`sw-antennae-settle` and
 * `sw-body-settle`) and only runs inside a real view transition, which a story
 * cannot stage. What a story CAN do is hold each pose still, which is the only
 * way to see the thing the two animations exist to say: the body takes the
 * landing and the antennae above it only sway. Side by side is also the only
 * way to catch the failure that matters — a stalk tearing out of a head that
 * squashed out from under it. The root is buried 0.05em, and one keyframe of
 * body squash moves the head's top further than that.
 *
 * The transforms are the keyframes' own values at `--sw-hop-dir: 1`. If they
 * drift from the stylesheet this story stops describing the animation, which is
 * the trade for being able to look at it at all.
 */
export const JumpPoses: Story = {
  args: { scale: 1 },
  render: () => (
    <>
      {(
        [
          ["rest", "0deg", "none", "none"],
          ["in flight (bent back)", "-10deg", "none", "scale(1, 1)"],
          [
            "the impact",
            "7deg",
            "translateY(0.098em)",
            "scale(1.1, 0.9)",
          ],
          [
            "rebound",
            "-3.5deg",
            "translateY(-0.049em)",
            "scale(0.96, 1.05)",
          ],
        ] as const
      ).map(([label, bend, track, body]) => (
        <Plate key={label} label={label}>
          <span
            className="text-[4em]"
            ref={(node) => {
              antennaPose(bend, track)(node);
              bodyPose(body)(node);
            }}
          >
            <StoryboardMonsterMark scale={1} />
          </span>
        </Plate>
      ))}
    </>
  ),
  play: async ({ canvasElement }) => {
    const marks = canvasElement.querySelectorAll("[data-storyboard-monster]");
    expect(marks).toHaveLength(4);
    const [restMark, flightMark, jamMark] = Array.from(marks) as [
      Element,
      Element,
      Element,
    ];
    const box = (n: Element) => n.getBoundingClientRect();
    const part = (mark: Element, sel: string) => {
      const n = mark.querySelector(sel);
      expect(n).toBeTruthy();
      return n!;
    };

    // THE IMPACT IS SHORTER AND WIDER THAN REST. Signs, not magnitudes: a
    // keyframe edit that inverts the squash is the regression worth catching,
    // and it is invisible in a still screenshot.
    const restBody = box(part(restMark, "[data-monster-body]"));
    const jamBody = box(part(jamMark, "[data-monster-body]"));
    expect(jamBody.height).toBeLessThan(restBody.height);
    expect(jamBody.width).toBeGreaterThan(restBody.width);

    // THE FUR GOES WITH IT, ABOUT THE SAME POINT. It clears the body by 0.05px
    // at rail size, so a fur that does not track the squash bares its starburst
    // above the head. Measuring both tops against the body's BOTTOM — the shared
    // scale origin — is what tests the origin rather than just the scale: the
    // ratio is 1.18 / 0.98 = 1.204 at rest and is preserved by any scale about
    // a correctly matched pair of origins, but not by a mismatched one.
    const reach = (mark: Element) => {
      const b = box(part(mark, "[data-monster-body]"));
      const f = box(part(mark, "[data-monster-fur]"));
      return (b.bottom - f.top) / (b.bottom - b.top);
    };
    expect(reach(restMark)).toBeCloseTo(1.204, 2);
    expect(reach(jamMark)).toBeCloseTo(reach(restMark), 2);

    // The knobs lead the arc, and the two poses throw them to OPPOSITE sides of
    // rest — the flight bends back behind the jump, the impact whips past it.
    // Measured against each mark's own left edge, since the plates differ in x.
    const knobOffset = (mark: Element) => {
      const k = box(part(mark, "[data-monster-knob]"));
      return k.x + k.width / 2 - box(mark).left;
    };
    expect(knobOffset(flightMark)).toBeLessThan(knobOffset(restMark));
    expect(knobOffset(jamMark)).toBeGreaterThan(knobOffset(restMark));

    // AND IT IS AN ARC, NOT A LEAN — the whole point of the chain. Each segment
    // turns by the same angle and they compound, so under a bend the top
    // segment must be turned further from vertical than the bottom one. A
    // single-bar stalk, or a chain that lost its nesting, fails here while
    // still passing the offset check above.
    const angleOf = (n: Element) => {
      const m = new DOMMatrix(getComputedStyle(n).transform);
      return Math.round(Math.atan2(m.b, m.a) * (180 / Math.PI));
    };
    const chain = part(flightMark, '[data-monster-antenna="left"]');
    const seg1 = chain.firstElementChild!;
    const seg2 = seg1.firstElementChild!;
    const seg3 = seg2.firstElementChild!;
    expect(angleOf(seg1)).toBe(-10);
    expect(angleOf(seg2)).toBe(-10);
    expect(angleOf(seg3)).toBe(-10);
    // Each is -10 in its PARENT's frame, so the tip is -30 from the mark's.
    const tipVsRoot =
      knobOffset(restMark) - knobOffset(flightMark);
    expect(tipVsRoot).toBeGreaterThan(0);
  },
};

/**
 * With and without the antennae, side by side, at the size the rail renders.
 *
 * The prop is free to use — every rule that animates them keys off
 * `[data-monster-antennae]`, so with nothing rendered they match nothing.
 *
 * AND IT NO LONGER RESHAPES THE HEAD, which is the part worth looking at here
 * and the part that changed with turn 54. The hat's version of this prop also
 * swapped an egg body (1.12 tall against a 0.98 width) for a round one, because
 * the egg existed to open headroom under a BRIM. Antennae leave the skull from
 * a point and need no clearance, so the body is the source's circle either way
 * and the only difference between these two is whether two stalks are drawn.
 */
export const WithoutTheAntennae: Story = {
  args: { scale: 1.6 },
  render: () => (
    <>
      <Plate label="with antennae">
        <StoryboardMonsterMark scale={1.6} />
      </Plate>
      <Plate label="antennae={false}">
        <StoryboardMonsterMark scale={1.6} antennae={false} />
      </Plate>
      <Plate label="bare, blown up">
        <span className="text-[4em]">
          <StoryboardMonsterMark scale={1} antennae={false} />
        </span>
      </Plate>
    </>
  ),
  play: async ({ canvasElement }) => {
    const marks = Array.from(
      canvasElement.querySelectorAll("[data-storyboard-monster]"),
    );
    expect(marks).toHaveLength(3);
    const [withPair, without] = marks as [Element, Element];
    expect(withPair.querySelector("[data-monster-antennae]")).toBeTruthy();
    expect(without.querySelector("[data-monster-antennae]")).toBeNull();
    // The parts all survive — the antennae are their own layer, so dropping
    // them must not cost the creature anything else.
    expect(without.querySelectorAll("[data-monster-foot]")).toHaveLength(2);
    expect(without.querySelector("[data-monster-eye]")).toBeTruthy();

    // AND THE HEAD IS THE SAME HEAD, which is the assertion this story exists
    // for now. The hat used to change the body's height by an eighth; the
    // antennae change nothing about it, so both boxes must match on BOTH axes.
    const a = withPair.querySelector("[data-monster-body]");
    const b = without.querySelector("[data-monster-body]");
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(b!.getBoundingClientRect().height).toBeCloseTo(
      a!.getBoundingClientRect().height,
      1,
    );
    expect(b!.getBoundingClientRect().width).toBeCloseTo(
      a!.getBoundingClientRect().width,
      1,
    );
  },
};
