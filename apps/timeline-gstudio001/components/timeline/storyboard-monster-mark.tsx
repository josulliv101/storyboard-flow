/**
 * The storyboard monster — the creature that sits in the "o" of "monster".
 *
 * Ported from the logo design document's TURN 34 ("28c hat, denim feet"), its
 * latest direction: the same one-eyed fuzzball, now in a pinched-crown hat and
 * standing on denim-blue feet. It is drawn in CSS rather than SVG, exactly as
 * the source is: a masked `repeating-conic-gradient` makes the fur spikes, the
 * eye is four nested circles, and the hat is three boxes — a clip-path crown, a
 * pill brim and a band — inside one rotated group.
 *
 * THE GEOMETRY IS THE SOURCE'S, VERBATIM. Turn 34 re-expresses the drawing
 * against a 1em box where earlier turns used 0.72em; every inner number is the
 * old one times 1/0.72, so the creature itself did not change size, only the
 * unit it is quoted in. Keeping the source's numbers rather than re-deriving
 * them is what lets the next turn be diffed against this file.
 *
 * WHICH IS WHY `scale` IS FOLDED INTO THE FONT-SIZE AT 0.72. `scale` keeps
 * meaning what it has always meant to the callers — 1.1 in the word, 1.6 alone
 * in the rail — and the 0.72 converts that expectation into turn 34's basis.
 * Drop it and every call site silently grows by 39%.
 *
 * COLOURS: the file gives two as literals and the rest as design-system tokens
 * it does not ship — `_ds/organic-…/styles.css` is not in the export, and the
 * document renders black-on-black without it, so there are no frames to sample
 * either. The sage and the feet below are therefore the source's own values;
 * the cream, the pupil and the hat are matched to those tokens' roles in the
 * ramp and are the three worth checking against the real palette.
 */

/** The source's literal, unchanged since turn 9: fur and body. */
const SAGE = "oklch(0.86 0.17 128)";
/** `--color-bg`: the eye white and the glint. A warm off-white. */
const CREAM = "oklch(0.96 0.02 95)";
/** `--color-accent-2-900`: the pupil, near-black. */
const PUPIL = "oklch(0.27 0.03 145)";
/**
 * `--color-accent-300`: pale terracotta.
 *
 * The word "monster" AND the hat band are this one token in the source, which
 * is what ties the hat to the wordmark. Export it so the lockup cannot drift
 * from the creature.
 */
export const STORYBOARD_MONSTER_ACCENT = "oklch(0.78 0.10 45)";
/**
 * `--color-accent`: the crown and the brim.
 *
 * The base step of the ramp that `STORYBOARD_MONSTER_ACCENT` is the 300 of, so
 * it has to sit deeper and stronger than the band it carries — level with it
 * and the band disappears into the crown, leaving the hat one flat shape. It
 * also has to clear the rail's own ~0.19 lightness, the constraint that already
 * killed two candidate foot colours.
 */
const HAT = "oklch(0.62 0.16 42)";
/**
 * The source's literal denim (turn 32, kept by turn 34).
 *
 * Arrived at by elimination, and the reasoning is worth keeping because it
 * applies to anything drawn under the body: terracotta is the same value as the
 * word the creature stands in, so the feet read as part of the letters; cream is
 * the brightest thing in the rail, so the feet end up louder than the eye they
 * belong to; and anything near-black vanishes outright — the feet sit BELOW the
 * body, against the rail rather than against the sage, so there is nothing
 * behind them to separate from. They are also about 4px tall here, and a small
 * shape needs MORE contrast than a large one, not less.
 */
const FEET = "oklch(0.68 0.115 245)";

/**
 * THE BODY IS AN EGG, not the source's circle.
 *
 * Turn 34 draws it round at 0.98em square. Stretched a seventh taller and
 * anchored at the bottom — the feet have to stay where they stand — it gains
 * headroom between the eye and the brim, which is the difference between a
 * creature wearing a hat and a creature with a hat resting on its eyeball.
 *
 * Everything that has to follow the shape derives from these three numbers: the
 * fur collar, the eye's vertical centring, and the lift the hat needs so it
 * still sits on the head rather than sinking into it.
 */
const BODY_W = 0.98;
const BODY_H = 1.12;
/** Bottom edge pinned where the round body had it (0.99em), top pulled up. */
const BODY_TOP = 0.99 - BODY_H;
/** How much taller than the source, and so how far the hat rides up with it. */
const BODY_LIFT = BODY_H - BODY_W;

/**
 * The fur ring: a conic gradient of spikes, masked to an annulus.
 *
 * IT RENDERS NOTHING, AND THAT IS THE SOURCE'S OWN BEHAVIOUR — left verbatim
 * rather than "fixed", because the fix is not ours to make.
 *
 * The document reads its stops as shares of the fur BOX: 35%–50% of 1.38em is a
 * ring from 0.483em to 0.69em, starting at the body's edge (0.49em radius) and
 * reaching 0.2em past it. CSS resolves them against the GRADIENT's radius
 * instead, and an unsized `circle` is farthest-corner — so the ring lands
 * roughly 0.36em–0.51em and sits under the body, which is painted after it.
 * Measured on this build: at a 133px mark the fur box is 184px, its gradient
 * radius 130px, and the ring falls at 45.6–65px against a body radius of
 * 65.2px.
 *
 * Re-expressing it as `ellipse closest-side` with 71%/100% DOES produce the
 * document's intended geometry, and the result is a starburst — 0.2em of spike
 * on a 0.49em body is a 40% overhang, which reads as a sun, not as fur. At rail
 * size the honest range is worse: a collar small enough to read as fuzz is
 * about 1px and invisible, which is presumably why every legibility turn in the
 * document (16, 17) solves smallness with the glint and never with the fur.
 *
 * So the creature is smooth, here and in the document. Worth raising against
 * the source rather than papering over locally — the element is kept so that a
 * later turn changing the ratios brings the fur back on its own.
 */

const FUR_MASK =
  "radial-gradient(circle at 50% 50%, transparent 0 35%, #000 35% 50%, transparent 50%)";

const FUR: React.CSSProperties = {
  position: "absolute",
  // Held a uniform 0.2em outside the body on every side, tracking the egg the
  // way the source held it around the circle. Nothing shows today (above), but
  // a box that has drifted out of register with the body is a worse starting
  // point for whoever picks the fur back up.
  left: "-0.19em",
  top: `${BODY_TOP - 0.2}em`,
  width: `${BODY_W + 0.4}em`,
  height: `${BODY_H + 0.4}em`,
  background: `repeating-conic-gradient(from 0deg, ${SAGE} 0deg 11deg, transparent 11deg 22deg)`,
  WebkitMaskImage: FUR_MASK,
  maskImage: FUR_MASK,
};

/** Marked so the settle can move the feet after the body has stopped — see
 *  `sw-foot-settle` in globals.css. */
const foot = (left: string): React.CSSProperties => ({
  position: "absolute",
  left,
  bottom: "-0.1em",
  width: "0.38em",
  height: "0.2em",
  background: FEET,
  borderRadius: "999px",
});

/**
 * The hat, as one rotated group.
 *
 * The tilt is on the GROUP rather than on each piece, so crown, brim and band
 * stay registered to each other however far it is cocked — turn 28's whole
 * point. The origin sits low, down at the brim line, so the hat pivots where it
 * touches the head instead of swinging about its own middle; that is what keeps
 * the brim resting on the fur rather than lifting off it.
 */
const HAT_GROUP: React.CSSProperties = {
  position: "absolute",
  left: 0,
  width: "1em",
  height: "1em",
  // Raised by exactly what the body grew, so the brim keeps the same purchase
  // on the fur that turn 34 drew it with.
  top: `${-BODY_LIFT}em`,
  transform: "rotate(-14deg)",
  transformOrigin: "50% 72%",
};

export function StoryboardMonsterMark({ scale = 1 }: Readonly<{ scale?: number }>) {
  return (
    <span
      data-storyboard-monster=""
      // The growth between rail states. Everything about the creature is sized
      // off its own font-size, so animating that one property scales the whole
      // drawing — fur, eye, glint, hat and feet together.
      className="transition-[font-size] duration-200 motion-reduce:transition-none"
      style={{
        display: "inline-block",
        width: "1em",
        height: "1em",
        // Never let the lockup's flex row squeeze the drawing; it has no text of
        // its own to establish a min-content width.
        flex: "none",
        lineHeight: 1,
        // The creature's own box drives its parts, so one number scales the
        // whole drawing without touching the geometry below. See the 0.72 note
        // in the header: it converts `scale` into turn 34's 1em basis.
        fontSize: `${scale * 0.72}em`,
        // NAMED FOR THE VIEW TRANSITION. Collapsing the rail does not move this
        // element, it re-lays it out — inline in the word, then alone and
        // larger — so there is nothing for a normal transition to animate
        // between. A name lets the browser snapshot both and interpolate; the
        // hop itself is styled in `globals.css`.
        viewTransitionName: "sw-monster",
        // NUDGED, NOT BASELINE-ALIGNED. The lockup is a flex row, and the
        // pieces around this are `RevealedLetters` — `display: grid`, so they
        // can only be flex items and the whole row is laid out by flex, not by
        // inline text. `align-self: baseline` on an item with no text of its
        // own resolves to its bottom margin edge and threw the creature to the
        // top of the 72px row. Centring it and dropping it by a fraction of its
        // own size is what puts the body on the line and the feet just under
        // it, which is where the source drawing sits inside the "o".
        position: "relative",
        top: `${0.14 * scale}em`,
      }}
    >
      <span style={FUR} />
      <span
        style={{
          position: "absolute",
          left: "0.01em",
          top: `${BODY_TOP}em`,
          width: `${BODY_W}em`,
          height: `${BODY_H}em`,
          borderRadius: "999px",
          background: SAGE,
        }}
      >
        {/* eye white */}
        <span
          style={{
            position: "absolute",
            left: "0.17em",
            // CENTRED IN THE EGG, not held at the source's 0.17em. Keeping that
            // number would have pinned the eye to the top of a taller head and
            // spent the whole stretch below it, where nothing needed the room.
            top: `${(BODY_H - 0.64) / 2}em`,
            width: "0.64em",
            height: "0.64em",
            borderRadius: "999px",
            background: CREAM,
          }}
        >
          {/* pupil */}
          <span
            data-monster-pupil=""
            style={{
              position: "absolute",
              left: "0.125em",
              top: "0.125em",
              width: "0.39em",
              height: "0.39em",
              borderRadius: "999px",
              background: PUPIL,
            }}
          >
            {/* the glint — the document's turn 17 exists for this one dot, and
                it is the first thing to disappear at small sizes */}
            <span
              style={{
                position: "absolute",
                left: "0.05em",
                top: "0.05em",
                width: "0.14em",
                height: "0.14em",
                borderRadius: "999px",
                background: CREAM,
              }}
            />
          </span>
        </span>
      </span>
      <span data-monster-foot="" style={foot("0.08em")} />
      <span data-monster-foot="" style={foot("0.55em")} />
      <span data-monster-hat="" style={HAT_GROUP}>
        {/* The pinched crown. The polygon dents the top twice — up one side, a
            dip in the middle, up the other — which is the whole difference
            between a cowboy hat and a bucket. */}
        <span
          style={{
            position: "absolute",
            left: "0.23em",
            top: "-0.3em",
            width: "0.54em",
            height: "0.42em",
            background: HAT,
            clipPath: "polygon(0 100%, 0 34%, 22% 8%, 50% 26%, 78% 8%, 100% 34%, 100% 100%)",
          }}
        />
        {/* The brim, wider than the head so it overlaps the fur on both sides —
            turn 27's rule, and the reason the hat sits ON the creature instead
            of hovering above it. */}
        <span
          style={{
            position: "absolute",
            left: "-0.02em",
            top: "0.08em",
            width: "1.04em",
            height: "0.16em",
            background: HAT,
            borderRadius: "999px",
          }}
        />
        {/* The band, in the wordmark's own colour. */}
        <span
          style={{
            position: "absolute",
            left: "0.23em",
            top: "0.01em",
            width: "0.54em",
            height: "0.08em",
            background: STORYBOARD_MONSTER_ACCENT,
          }}
        />
      </span>
    </span>
  );
}
