import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

// EXPLORATION (play-less, story-local): how should the source-window overview
// behave when a video trimmed FROM THE START is the FIRST item in the strip?
//
// The production overview anchors its filmstrip at `clipLeft - trimIn*pps`.
// For the first item clipLeft is the strip's scroll origin (0), so the anchor
// goes NEGATIVE and the trimmed-in "room" (the dim + earlier source frames)
// falls left of the origin, where the scroll container clips it and can't
// scroll to it. These rows put the SAME first-item-trimmed clip under four
// layout strategies, at a fixed scroll position (the natural state for a first
// item), so we can compare. Drag the trim-in slider to sweep, including
// trim-in = 0 (no issue). Nothing here touches the real component.

const frames = [
  new URL("./fixtures/dog-tracking-2s.png", import.meta.url).href,
  new URL("./fixtures/dog-exit-4s.png", import.meta.url).href,
] as const;
const neighborSrcs = [
  new URL("./fixtures/clip-field.jpg", import.meta.url).href,
  new URL("./fixtures/clip-lineup.png", import.meta.url).href,
] as const;

const PPS = 32; // px per second
const FULL = 10; // source length of the first-item video
const TRIM_OUT = 1; // fixed, to keep the comparison about trim-IN
const FRAME = 48; // square thumbnail size (= strip height)
const VIEWPORT = 520; // visible strip width (the "scroll viewport")
const GUTTER = 4 * PPS; // left padding for the gutter strategy (max reveal)

type StripMode = "clipped" | "overflow" | "gutter" | "decoupled";

/** A square-frame source filmstrip with the dim room + amber showing-window,
 *  mirroring the production TrimOverviewStrip look. Positioned by `left`
 *  (content-space), sized to the full source. */
function Overview({ trimIn, left }: { trimIn: number; left: number }) {
  const fullWidth = FULL * PPS;
  const showing = Math.max(0, FULL - trimIn - TRIM_OUT);
  const trimInWidth = trimIn * PPS;
  const windowWidth = showing * PPS;
  const count = Math.max(1, Math.ceil(fullWidth / FRAME));
  return (
    <div
      className="absolute top-0 h-12 overflow-hidden rounded-md"
      style={{ width: fullWidth, transform: `translateX(${left}px)` }}
    >
      <div className="flex h-full w-full">
        {Array.from({ length: count }).map((_, i) => (
          <img
            key={i}
            src={frames[i % frames.length]}
            alt=""
            draggable={false}
            style={{ width: FRAME }}
            className="h-full shrink-0 border-r border-black/60 object-cover last:border-r-0"
          />
        ))}
      </div>
      <div className="absolute inset-y-0 left-0 bg-background/60" style={{ width: trimInWidth }} />
      <div className="absolute inset-y-0 right-0 bg-background/60" style={{ width: TRIM_OUT * PPS }} />
      <div
        className="absolute inset-y-0 rounded-sm border-2 border-amber-300 bg-amber-300/10 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
        style={{ width: windowWidth, transform: `translateX(${trimInWidth}px)` }}
      >
        <span className="absolute inset-y-0 left-0 w-2 rounded-l-sm bg-amber-200/90" />
        <span className="absolute inset-y-0 right-0 w-2 rounded-r-sm bg-amber-200/90" />
      </div>
    </div>
  );
}

/** The clip row: the first-item video (bright, width = showing) then two
 *  neighbor images, laid out from `originLeft`. */
function Clips({ trimIn, originLeft }: { trimIn: number; originLeft: number }) {
  const showing = Math.max(0, FULL - trimIn - TRIM_OUT);
  const clips = [
    { w: showing * PPS, src: frames[0], vid: true, label: "VIDEO" },
    { w: 4 * PPS, src: neighborSrcs[0], vid: false, label: "" },
    { w: 3 * PPS, src: neighborSrcs[1], vid: false, label: "" },
  ];
  let x = originLeft;
  return (
    <>
      {clips.map((c, i) => {
        const left = x;
        x += c.w + 8;
        return (
          <div
            key={i}
            className={`absolute bottom-0 h-16 overflow-hidden rounded-md ${
              c.vid ? "ring-2 ring-amber-300" : "ring-1 ring-border"
            }`}
            style={{ width: c.w, transform: `translateX(${left}px)` }}
          >
            <img src={c.src} alt="" draggable={false} className="h-full w-full object-cover" />
            {c.label && (
              <span className="absolute top-1 left-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-bold text-amber-300">
                {c.label}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

function StripRow({ mode, trimIn }: { mode: StripMode; trimIn: number }) {
  // Per strategy: where the clip origin sits, where the overview anchors, and
  // whether the viewport clips the overflow.
  const clipLeft = mode === "gutter" ? GUTTER : 0;
  const overviewLeft =
    mode === "decoupled"
      ? clipLeft // pin the strip's left to the origin; window floats over source
      : clipLeft - trimIn * PPS; // production formula (goes negative at index 0)
  const clipOverflow = mode === "overflow" ? "visible" : "hidden";

  return (
    // The band above holds the overview (h-12) + gap; the clip row is h-16.
    <div className="relative" style={{ height: 48 + 8 + 64 }}>
      {/* extra left space so the "overflow" strategy has somewhere to spill */}
      <div
        className="absolute top-0 bottom-0"
        style={{ left: 0, width: VIEWPORT, overflow: clipOverflow as "hidden" | "visible" }}
      >
        <div className="absolute top-0 right-0 left-0" style={{ height: 48 }}>
          <Overview trimIn={trimIn} left={overviewLeft} />
        </div>
        <Clips trimIn={trimIn} originLeft={clipLeft} />
      </div>
    </div>
  );
}

const ROWS: { mode: StripMode; label: string; hint: string }[] = [
  {
    mode: "clipped",
    label: "A — Current (clipped)",
    hint: "anchor goes negative; the trimmed-in room is left of the origin and is CLIPPED — unreachable.",
  },
  {
    mode: "overflow",
    label: "B — Overflow left of origin",
    hint: "let the transient overview spill left of the strip; the room + earlier frames become visible.",
  },
  {
    mode: "gutter",
    label: "C — Left gutter",
    hint: "reserve padding at the strip start so the overview fits inside; all clips shift right.",
  },
  {
    mode: "decoupled",
    label: "D — Pin strip to origin (window floats)",
    hint: "show the whole source from the origin; the amber window sits at its true trim position, NOT on the clip's left edge (alignment traded for visibility).",
  },
];

function FirstItemTrimComparison() {
  const [trimIn, setTrimIn] = useState(3);
  const maxIn = FULL - TRIM_OUT - 1;
  const showing = FULL - trimIn - TRIM_OUT;

  return (
    <div className="max-w-3xl text-foreground">
      <h2 className="text-base font-semibold">
        First-item video trimmed from the start — layout comparison
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        The highlighted VIDEO is the FIRST clip (full {FULL}s, trim-out {TRIM_OUT}s). As you add
        trim-IN, the overview&apos;s trimmed room wants to sit left of the strip&apos;s start. Compare
        how each strategy handles that.
      </p>

      <div className="sticky top-2 z-40 mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-border bg-card p-3 text-xs shadow-sm">
        <label className="flex items-center gap-2">
          Trim-in
          <input
            type="range"
            min={0}
            max={maxIn}
            step={0.5}
            value={trimIn}
            onChange={(e) => setTrimIn(Number(e.target.value))}
          />
          <span className="w-10 tabular-nums">{trimIn.toFixed(1)}s</span>
        </label>
        <span className="tabular-nums text-muted-foreground">
          showing <span className="font-semibold text-foreground">{showing.toFixed(1)}s</span> · room
          left {trimIn.toFixed(1)}s
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-6">
        {ROWS.map((row) => (
          <div key={row.mode} className="border-t border-border pt-4 first:border-t-0">
            <div className="mb-2">
              <span className="text-sm font-semibold">{row.label}</span>
              <span className="ml-2 text-xs text-muted-foreground">{row.hint}</span>
            </div>
            {/* pl reserves room so strategy B's leftward spill is visible on-page */}
            <div className="pl-24">
              <StripRow mode={row.mode} trimIn={trimIn} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "UI/DndCollectionsFirstItemTrim",
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Play-less: a visual comparison playground, not an assertion suite. */
export const CompareStrategies: Story = {
  render: () => <FirstItemTrimComparison />,
};
