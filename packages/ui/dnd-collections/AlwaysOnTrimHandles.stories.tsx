import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

// EXPLORATION, AND A RECORD OF WHAT WAS REJECTED. What a strip looks like
// when trim handles are on EVERY media
// clip instead of only the selected one. Three treatments in the same strip,
// stacked so the difference is a vertical comparison rather than a memory test.
// Story-local until one is chosen and promoted, same as TrimReadouts.
//
// WHY THIS IS NOT A MOCK OF THE HANDLES. The hit-zone geometry and the shipped
// handle pixels are copied verbatim from the real ones — `HIT_ZONE` from
// `trim-handles.tsx`, `SHIPPED_INK` from the app's `GraphTrimHandle` — because
// a comparison against a re-typed control is a comparison with an extra
// variable in it. Only the third treatment is new.
//
// The strip geometry is real too: clips are laid out at `seconds * PPS`, flush
// against each other the way strip mode packs them, so a handle's share of its
// clip is the share it would actually have.

/** px per second — the trim playground's scale, and the app's 100% zoom. */
const PPS = 50;

/** The real hit zone, from `TrimHandles`. 8px, above the card, ew-resize. */
const HIT_ZONE = "absolute inset-y-0 z-20 w-2 cursor-ew-resize";

/**
 * THE TOUCH TARGET, grown without growing the ink.
 *
 * 8px is a pointer-fine number. Every touch control in this app is sized with
 * `[@media(pointer:coarse)]:h-11` — 44px, the platform minimum — and the anchor
 * menu already grows a target past its visual with an `after:` pseudo rather
 * than by inflating the thing you can see (`graph-anchor-menu.tsx`). Same
 * technique here: the grip stays a grip, the reachable area becomes a thumb.
 *
 * IT GROWS INWARD, over the clip, and it has to. Flush clips in a strip share
 * an edge, so a target that overhung outward would sit on top of the next
 * clip's — and on video, whose left handle is right there, the two would be
 * the same pixels arguing about which one you meant.
 */
const TOUCH_TARGET =
  "after:absolute after:inset-y-0 after:right-0 after:content-[''] " +
  "after:w-2 [@media(pointer:coarse)]:after:w-11";

/**
 * The shipped ink, from the app's `GraphTrimHandle`: a solid blue-500 slab at
 * 95% with a dark grip line. It is `blue-500` because it is the SELECTION
 * colour, and the comment there says why — handles only ever appeared on a
 * selected card, so wearing selection's colour tied them to it.
 */
const SHIPPED_INK =
  "flex h-full w-full items-center justify-center bg-blue-500 opacity-95";

const CLIPS = [
  { name: "Street", seconds: 8, src: new URL("./fixtures/clip-field.jpg", import.meta.url).href },
  { name: "Van interior", seconds: 7.7, src: new URL("./fixtures/clip-chop.jpg", import.meta.url).href },
  { name: "Food cart", seconds: 3.1, src: new URL("./fixtures/clip-lineup.png", import.meta.url).href },
  { name: "Doorway", seconds: 3, src: new URL("./fixtures/clip-portrait.png", import.meta.url).href },
  // The short ones are the point of the cutoff, so the strip has to contain
  // some. 1.2s at PPS 50 is 60px; 0.6s is 30px, which is under four handles.
  { name: "Insert", seconds: 1.2, src: new URL("./fixtures/dog-exit-4s.png", import.meta.url).href },
  { name: "Flash", seconds: 0.6, src: new URL("./fixtures/dog-tracking-2s.png", import.meta.url).href },
] as const;

/**
 * THE CUTOFF, expressed as a ratio rather than a pixel width.
 *
 * The hit zone is a fixed 8px, so what a handle costs is entirely a function of
 * how wide its clip is: 2% of a 400px clip and 27% of a 30px one. The question
 * is never "is this clip short" but "how much of it would stop being clip", so
 * the threshold is written as the largest share the handles may take.
 *
 * A quarter is the line here: at 25% a clip still has three quarters of itself
 * left to grab, drag and look at. Images carry one handle and video two, so the
 * same ratio yields two different pixel cutoffs — which is correct, and is the
 * thing a fixed `minWidth` would get wrong.
 */
const MAX_HANDLE_SHARE = 0.25;
const HANDLE_PX = 8;

function handlesFit(seconds: number, sides: number): boolean {
  const width = seconds * PPS;
  return (sides * HANDLE_PX) / width <= MAX_HANDLE_SHARE;
}

/**
 * TRIED AND DROPPED — kept because the reason it lost is the useful part.
 *
 * A quiet rule at rest that became a solid amber grip under the pointer. It
 * read well on a desktop and did not survive "what about iPad": a hover reveal
 * has no trigger on a touch screen, so the affordance would simply never
 * arrive there. What shipped instead is one always-visible treatment that is
 * the same on both — see `GraphTrimHandle`.
 *
 * THE HIT ZONE DOES NOT CHANGE, and that is the whole idea. What made the naive
 * version loud was not the target size, it was the ink filling it — eight
 * pixels of saturated blue on every clip edge, six times over. Ink and target
 * are separate concerns: the affordance can be discoverable without being the
 * loudest thing in the strip, the way an editor's trim edges are.
 *
 * AMBER, NOT BLUE, because always-on and selection-coloured cannot both be
 * true. Blue means "selected" everywhere else in this app — the card ring, the
 * check, the count — so painting every clip's edge blue spends the one colour
 * that had a job. Amber was the handles' colour before selection moved to blue
 * and was dropped for reading as a second accent ON a selected card; that
 * objection is exactly backwards once handles are no longer selection-scoped,
 * because now they NEED an identity that is not selection's.
 */
const PROPOSED_INK =
  "flex h-full w-full items-center justify-center rounded-[1px] " +
  // At rest: a 2px hairline centred in the 8px zone, low contrast.
  "bg-white/25 " +
  // Approaching the clip brings it up; over the handle itself commits to amber.
  "transition-[background-color,opacity] duration-150 " +
  "group-hover/clip:bg-amber-400/60 hover:!bg-amber-400";

function Clip({
  name,
  seconds,
  src,
  treatment,
  selected,
  onSelect,
}: {
  name: string;
  seconds: number;
  src: string;
  treatment: "today" | "naive" | "proposed" | "touch";
  selected: boolean;
  onSelect: () => void;
}) {
  const width = seconds * PPS;
  // Images have one edge (duration); this strip is all images, which is also
  // what made the naive version read as a divider rather than a pair of grips.
  const sides = 1;
  const shown =
    treatment === "today"
      ? selected
      : treatment === "naive"
        ? true
        // TOUCH KEEPS THE SELECTION GATE, and that is the recommendation
        // rather than a limitation. A 44px target is a quarter of a 3s clip
        // and more than half of a 1.2s one, so "always on" and "reachable by
        // thumb" cannot both hold across a strip. Selection is already an
        // explicit tap on touch, so gating on it means exactly one clip at a
        // time carries thumb-sized targets — no neighbour collisions, and the
        // user has said which clip they mean before the targets appear.
        : treatment === "touch"
          ? selected
          : handlesFit(seconds, sides);

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ width }}
      className={[
        "group/clip relative h-20 shrink-0 overflow-hidden rounded-md",
        selected ? "ring-2 ring-blue-500" : "ring-1 ring-white/10",
      ].join(" ")}
    >
      <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
      <span className="absolute bottom-0.5 left-1 rounded bg-black/70 px-1 text-[9px] text-white tabular-nums">
        {name}
      </span>
      <span className="absolute right-2.5 bottom-0.5 rounded bg-black/70 px-1 text-[9px] text-white tabular-nums">
        {seconds.toFixed(2)}s
      </span>
      {shown && (
        <span
          className={`${HIT_ZONE} right-0 ${treatment === "touch" ? TOUCH_TARGET : ""}`}
          aria-hidden="true"
        >
          <span
            className={
              treatment === "proposed" || treatment === "touch"
                ? PROPOSED_INK
                : `${SHIPPED_INK} rounded-r-md`
            }
          >
            {treatment === "proposed" || treatment === "touch" ? (
              <span className="h-6 w-0.5 rounded bg-current opacity-70" />
            ) : (
              <span className="h-4 w-0.5 rounded bg-black/60" />
            )}
          </span>
        </span>
      )}
    </button>
  );
}

function Strip({
  label,
  note,
  treatment,
}: {
  label: string;
  note: string;
  treatment: "today" | "naive" | "proposed" | "touch";
}) {
  const [selected, setSelected] = useState<string | null>("Van interior");
  return (
    <section className="flex flex-col gap-1.5">
      <header className="flex items-baseline gap-2">
        <h3 className="text-xs font-semibold tracking-wide uppercase">{label}</h3>
        <p className="text-[11px] text-zinc-400">{note}</p>
      </header>
      <div className="flex gap-px overflow-hidden rounded-md bg-[#18181b] p-px">
        {CLIPS.map((clip) => (
          <Clip
            key={clip.name}
            {...clip}
            treatment={treatment}
            selected={selected === clip.name}
            onSelect={() => setSelected(selected === clip.name ? null : clip.name)}
          />
        ))}
      </div>
    </section>
  );
}

const meta = {
  title: "dnd-collections/AlwaysOnTrimHandles",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The three side by side. Click a clip to select it — the first strip only
 * grows a handle then, which is the behaviour being compared against.
 *
 * Hover a clip in the third strip: the hairline comes up under the pointer and
 * commits to amber on the handle itself. That is the part a screenshot cannot
 * show and the reason this is a story rather than an image.
 */
export const ThreeTreatments: Story = {
  render: () => (
    <div className="flex flex-col gap-6 rounded-lg bg-[#0b0b0d] p-4 text-zinc-200">
      <Strip
        label="A · today"
        note="handles only on the selected clip — select one to see it"
        treatment="today"
      />
      <Strip
        label="B · always on, as-is"
        note="the shipped blue slab on every clip: six bars, and selection loses its colour"
        treatment="naive"
      />
      <Strip
        label="C · always on, proposed"
        note="same 8px target, quiet at rest, amber on hover, hidden where it would cost more than a quarter of the clip"
        treatment="proposed"
      />
      <p className="max-w-[70ch] text-[11px] text-zinc-400">
        The last two clips are 1.2s and 0.6s — 60px and 30px at this scale. In
        B they carry the same 8px bar as the 400px clip, which is 13% and 27% of
        them. In C the 0.6s clip drops its handle entirely: below a quarter of
        the clip the handle stops being an edge and starts being the clip.
      </p>
    </div>
  ),
};

/**
 * B alone, at the size the strip actually renders. Kept as its own story
 * because the objection to it is cumulative — one blue bar is unremarkable and
 * six in a row are a pattern, which only reads at full width.
 */
export const NaiveAlwaysOn: Story = {
  render: () => (
    <div className="rounded-lg bg-[#0b0b0d] p-4 text-zinc-200">
      <Strip
        label="always on, as-is"
        note="every clip wearing the selection colour"
        treatment="naive"
      />
    </div>
  ),
};

/** C alone, for judging the resting state without B beside it to react against. */
export const ProposedAlwaysOn: Story = {
  render: () => (
    <div className="rounded-lg bg-[#0b0b0d] p-4 text-zinc-200">
      <Strip
        label="always on, proposed"
        note="hover a clip"
        treatment="proposed"
      />
    </div>
  ),
};
