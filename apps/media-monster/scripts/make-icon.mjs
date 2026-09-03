/**
 * Generate `app/icon.svg` from the media monster's own geometry.
 *
 * WHY A GENERATOR AND NOT A HAND-DRAWN FILE. The creature is a CSS drawing —
 * `media-monster-mark.tsx` builds its fur from a masked
 * `repeating-conic-gradient` and its eye from nested circles — and the numbers
 * there are quoted against a 1em box. Re-typing those into path data by eye is
 * how a logo and its favicon drift apart. This reads the same ratios, in the
 * same units, and emits the paths; changing a number here changes the drawing
 * rather than requiring it to be redrawn.
 *
 * WHAT IS DELIBERATELY NOT FAITHFUL, and all of it for the same reason — a
 * favicon is 16 pixels on a browser tab, so anything under about a pixel wide
 * is not detail, it is noise:
 *
 *   - THE ANTENNAE ARE GONE. See the note above `CX` — they cost ~30% of the
 *     box's height and drew a smudge. Removing them is what lets the body fill
 *     the frame.
 *   - THE FUR IS GONE, and the body is a plain circle. Also above `CX`.
 *   - THE COLOURS ARE sRGB, not oklch. See the palette note.
 *
 * Everything else is the source's: the body/eye/pupil ratios, the foot
 * proportions, the glint's position, and the palette's actual values.
 *
 * Run: node scripts/make-icon.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The source's palette, RESOLVED TO sRGB — and the resolving is the point.
 *
 * `media-monster-mark.tsx` quotes these as `oklch()`, which is right there: it
 * renders in a browser that supports CSS Color 4, and the wider gamut is what
 * the sage was picked in. A FAVICON IS NOT THAT. It is handed to whatever
 * rasterises tab icons, and an unparseable `fill` does not fail loudly — SVG's
 * `fill` defaults to BLACK, so the creature would come back as a black blob on
 * exactly the surfaces that could not parse it, and would look perfect
 * everywhere I could check.
 *
 * MEASURED rather than converted by formula: each `oklch()` was assigned to a
 * canvas `fillStyle` and the pixel read back, which is the same conversion the
 * browser does when it paints the component. The first attempt at this read
 * `getComputedStyle().color` instead and got nonsense — Chrome preserves the
 * `oklch()` string there rather than resolving it, so the numbers being parsed
 * as rgb were the oklch components.
 *
 *   SAGE           oklch(0.86 0.17 128)   #b0e562
 *   CREAM          oklch(0.96 0.02 95)    #f6f2e3
 *   PUPIL          oklch(0.27 0.03 145)   #1d2a1d
 *   ANTENNA_STALK  oklch(0.70 0.18 45)    #f6722b
 *   ANTENNA_KNOB   oklch(0.89 0.08 48)    #ffccad
 *
 * If the mark's palette moves, re-measure — do not hand-edit one side.
 */
const SAGE = "#b0e562";
const CREAM = "#f6f2e3";
const PUPIL = "#1d2a1d";
/** The source's ANTENNA_KNOB value. Named for what it still paints. */
const FEET = "#ffccad";

/**
 * NO ANTENNAE, AND THAT IS WHY THE CREATURE IS BIG.
 *
 * The mark has two, and at icon size they cost far more than they draw. A
 * stalk is 0.055em wide — about one antialiased column at 16px — so it renders
 * as a faint smudge, while the SPACE it needs above the head is real: the
 * antennae reached ~30% of the box's height and forced the body down to a
 * radius of 29. Dropping them buys all of that back, and the body goes to 40 —
 * a 90% increase in the area of the thing anyone can actually see.
 *
 * The creature stays recognisable because the antennae were never what
 * identified it. The one eye, the fuzz, and the terracotta feet are; the source
 * itself ships an `antennae={false}` variant for exactly this reason, and says
 * removing them is "genuinely free" because the head is a circle either way.
 *
 * FEET KEPT. They are the bookend the source's palette note is about — the same
 * pale terracotta at the bottom that the antenna knobs used to carry at the
 * top — and with the knobs gone they are the only thing left that is not sage
 * or eye. They also give the silhouette a flat bottom, which is what stops a
 * plain circle reading as a dot.
 *
 * NO FUR EITHER, AND THE BODY IS A PLAIN CIRCLE. An earlier pass drew the
 * source's fur as 16 wedges reaching 14% past the body, on the reasoning that a
 * ring a few pixels thick needs deeper spikes to read as fuzzy. It reads as a
 * sea urchin instead: the mark's own fringe is fine and soft, and anything
 * coarse enough to survive 16px is coarse enough to be a different creature.
 * The circle is what the monster actually looks like, so the circle is what the
 * icon is.
 */
const CX = 50;
/**
 * Sized so the drawing touches both edges of the box.
 *
 * Solved rather than nudged. The body now reaches `BODY_R` above the centre
 * (nothing sticks out past it) and the feet reach `BODY_R * (1 + 0.55 * 0.408)`
 * below, so filling `[2, 98]` means `2 + 2.224 * BODY_R = 98` and BODY_R is
 * 43.2. Rounded to 43, with the centre following.
 *
 * Dropping the fur is worth 3 units of radius on its own — the spikes were
 * occupying the margin the body now uses.
 *
 * The 2 units of margin are not decoration: a mark that runs to the exact edge
 * of its viewBox gets clipped by the rounding some platforms apply to tab
 * icons.
 */
const CY = 45;
const BODY_R = 43;

/** The source's ratios: eye 0.64 of a 0.98 body, pupil 0.39 of the same. */
const EYE_R = BODY_R * (0.64 / 0.98);
const PUPIL_R = BODY_R * (0.39 / 0.98);

const round = (n) => Math.round(n * 100) / 100;

/** Feet: the source's 0.38 x 0.2 em pair, as a proportion of the body. */
const FOOT_W = round(BODY_R * 2 * (0.38 / 0.98));
const FOOT_H = round(BODY_R * 2 * (0.2 / 0.98));
const FOOT_Y = round(CY + BODY_R - FOOT_H * 0.45);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="Media Monster">
  <title>Media Monster</title>
  <!-- Feet first: the body overlaps them, which is what makes the creature
       sit ON something rather than float above it. -->
  <rect x="${round(CX - FOOT_W - 1)}" y="${FOOT_Y}" width="${FOOT_W}" height="${FOOT_H}" rx="${round(FOOT_H / 2)}" fill="${FEET}" />
  <rect x="${round(CX + 1)}" y="${FOOT_Y}" width="${FOOT_W}" height="${FOOT_H}" rx="${round(FOOT_H / 2)}" fill="${FEET}" />
  <!-- The body. A PLAIN CIRCLE — see the note above CX. -->
  <circle cx="${CX}" cy="${CY}" r="${BODY_R}" fill="${SAGE}" />
  <circle cx="${CX}" cy="${CY}" r="${round(EYE_R)}" fill="${CREAM}" />
  <circle cx="${CX}" cy="${CY}" r="${round(PUPIL_R)}" fill="${PUPIL}" />
  <!-- The glint. Upper-left, because that is where the source puts it and it
       is what stops the eye reading as a hole. -->
  <circle cx="${round(CX - PUPIL_R * 0.38)}" cy="${round(CY - PUPIL_R * 0.42)}" r="${round(PUPIL_R * 0.3)}" fill="${CREAM}" />
</svg>
`;

const out = fileURLToPath(new URL("../app/icon.svg", import.meta.url));
writeFileSync(out, svg, "utf8");
console.log(`wrote ${out} (${svg.length} bytes)`);
