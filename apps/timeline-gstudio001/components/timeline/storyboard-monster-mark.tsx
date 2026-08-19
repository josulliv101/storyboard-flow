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
 * The word "monster" in the rail's lockup.
 *
 * TAILWIND'S `blue-400`, RESOLVED, and deliberately not the source's colour.
 * The design document paints the word in `--color-accent-300`, the same pale
 * terracotta as the hat band. That reads beautifully in the document and makes
 * the wordmark a stranger in this app: the projects list already labels itself
 * `text-blue-400`, so that blue is what the product calls a heading, and the
 * rail's wordmark was the last place still speaking the logo's private dialect.
 *
 * Written as the resolved value rather than the class because it is consumed as
 * an inline `color` on a span inside the lockup, not as a utility. If the app's
 * blue ever moves this has to move with it by hand — the PAIRING is the point,
 * not the number.
 *
 * The hat keeps its own terracotta (`HAT_BAND` below). One token in the source,
 * two here on purpose: the hat belongs to the creature, the word belongs to the
 * product.
 */
export const STORYBOARD_MONSTER_ACCENT = "oklch(0.707 0.165 254.624)";
/**
 * The crown and the brim.
 *
 * STANDS OFF THE SOURCE'S RAMP ON PURPOSE. The document paints both from
 * `--color-accent` with `--color-accent-300` as the band — a darker hat wearing
 * a lighter stripe, which is right on its own pale ground. On the rail's
 * near-black it is not: a 0.62-lightness crown sits closer to the rail than to
 * the 0.86 sage body directly beneath it, so the hat reads as a shadow ON the
 * creature rather than as something the creature is wearing. Collapsed, where
 * the whole mark is 22px and the crown about 8, it half-disappeared.
 *
 * So the pair is lifted TOGETHER and the contrast between them is what is
 * preserved, not the absolute values: crown to 0.70 with the chroma pushed to
 * hold its identity against the sage, band to 0.89 so it stays the lighter
 * stripe the source drew. Raising only the crown would have closed the gap to
 * the band and flattened the hat into one shape, which is the failure the old
 * comment here was guarding against from the other direction.
 *
 * The wordmark no longer follows the hat at all — see
 * `STORYBOARD_MONSTER_ACCENT`. It is the product's blue now, on the same black
 * but at 19px with letterforms, which is a different legibility problem from an
 * 8px crown and was already solved.
 */
const HAT = "oklch(0.70 0.18 45)";
/** The band. Lighter than the crown by more than the source needed — see above.
 *  Still terracotta, so the hat stays one object rather than two stacked ones. */
const HAT_BAND = "oklch(0.89 0.08 48)";
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
 * WHERE THE CREATURE IS LOOKING WHEN NOTHING IS HAPPENING.
 *
 * At rest it watches the breadcrumb — the back arrow and project name at the
 * top of the board, which is the thing a reader arriving at this corner is
 * about to use. Measured rather than guessed, in both rail states: from the
 * eye's centre to the project title is +161px x by -2px y with the rail open
 * and +155 by -3 collapsed. Both are within a degree of straight right, so the
 * gaze does NOT need to flip with the rail — a fact worth writing down, because
 * "it must need to mirror when it collapses" is the obvious wrong assumption.
 *
 * IT IS A POSITION, NOT A TRANSFORM, and that is the whole reason it composes.
 * The aim and the settle in `globals.css` are transforms, so they read as
 * deltas from wherever the pupil sits — the eye still throws itself along the
 * jump and still comes home to `translate(0, 0)`, which now means "back to
 * watching the breadcrumb" instead of "dead centre". Putting the gaze in the
 * transform would have meant every keyframe carrying it too.
 *
 * ONLY WHEN THE RAIL IS COLLAPSED. Open, the creature stands inside the word —
 * it IS the "o" of "monster" — and a letterform with its counter shoved to one
 * side stops being a letter. So it looks front and centre there, the way the
 * source draws it, and turns its head only once the word is gone and it is
 * alone in the corner with nothing left to be part of.
 *
 * THE WHOLE RANGE IS ABOUT 2.7px, which is why this number is larger than
 * "slightly" sounds. The pupil can travel (0.64 - 0.39) / 2 = 0.125em before it
 * reaches the white's rim, and on the collapsed mark that is 2.7px end to end.
 * At 60% of it the gaze is about 1.6px — the smallest offset that survives
 * rounding at this size. Anything genuinely subtle here is simply invisible.
 *
 * NO VERTICAL COMPONENT, because the measurement did not ask for one: the
 * breadcrumb sits within a degree of level with the eye in both rail states. A
 * tilt would be invention dressed as observation, and the glint already keeps
 * the eye from reading flat.
 *
 * It composes cleanly with the jump, and only because it is collapsed-only: the
 * aim in `globals.css` throws the pupil 26% of its own width ALONG travel, and
 * the creature only ever ARRIVES collapsed by travelling left — so the aim
 * subtracts from a rightward gaze rather than stacking onto it, and the pupil
 * never reaches the rim. The eye white keeps its `overflow: hidden` regardless:
 * a pupil cannot leave an eye, and the next person to touch these numbers
 * should not have to rediscover that.
 */
/* The numbers themselves are in `globals.css` — see the note above. Centred is
   (0.64 - 0.39) / 2 = 0.125em, and the breadcrumb gaze adds 0.075em to it. */

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
 *  `sw-foot-settle` in globals.css. The marker also carries WHICH foot: the two
 *  splay apart in flight, which needs a side, and counting `:nth-child` past the
 *  fur and the body to work it out would break the next time a part is added. */
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
 * The hat, as TWO nested groups — and the split is load-bearing.
 *
 * The outer one holds no transform of its own. That is what lets `globals.css`
 * own the hat's motion: an inline `transform` beats any stylesheet rule, so a
 * hat whose resting tilt lives on the animated element cannot be animated from
 * CSS at all. The outer group therefore expresses DELTAS from rest — the lag,
 * the jam-down, the bounce — and rest is simply no transform.
 *
 * The inner one carries turn 34's fixed -14deg cock. Keeping the tilt on the
 * group rather than on each piece is turn 28's point: crown, brim and band stay
 * registered to each other however far it leans.
 *
 * BOTH pivot about the same low origin, down at the brim line where the hat
 * touches the head, so it swings where it actually rests instead of about its
 * own middle. That one number is why the brim stays on the fur through a lean
 * that would otherwise lift it clear.
 */
const HAT_GROUP: React.CSSProperties = {
  position: "absolute",
  left: 0,
  width: "1em",
  height: "1em",
  // Raised by exactly what the body grew, so the brim keeps the same purchase
  // on the fur that turn 34 drew it with.
  top: `${-BODY_LIFT}em`,
  transformOrigin: "50% 72%",
};

/** Turn 34's fixed cock, held off the animated element — see above. */
const HAT_TILT: React.CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "1em",
  height: "1em",
  transform: "rotate(-14deg)",
  transformOrigin: "50% 72%",
};

export function StoryboardMonsterMark({
  scale = 1,
  gaze = "ahead",
  hat = true,
}: Readonly<{
  scale?: number;
  /** Where the pupil rests. `"ahead"` is the source's centred eye, which is what
   *  the wordmark needs; `"breadcrumb"` turns it toward the board's header and
   *  belongs to the collapsed rail. See the GAZE_X note above. */
  gaze?: "ahead" | "breadcrumb";
  /**
   * Whether the creature wears its hat. Turn 34's direction, so `true` by
   * default.
   *
   * Removing it is genuinely free: the hat is its own absolutely-positioned
   * layer above the body, and every rule that animates it in `globals.css` —
   * the flight pose, `sw-hat-settle`, the reduced-motion guard — keys off
   * `[data-monster-hat]`, so with nothing rendered they match nothing and do
   * nothing. No orphaned animation, no layout shift.
   *
   * ONE JUDGEMENT CALL COMES WITH IT, and it is deliberately not made here: the
   * body was stretched into an egg (`BODY_H` 1.12 against a source width of
   * 0.98) specifically to open headroom between the eye and the brim. Bare, the
   * head reads a little tall. The geometry is left identical so this prop is
   * purely additive — see the `WithoutTheHat` story to judge whether a hatless
   * creature also wants `BODY_H` back toward 0.98.
   */
  hat?: boolean;
}>) {
  // THE GAZE TRAVELS AS A CUSTOM PROPERTY, which is the one channel a stylesheet
  // can still take back. Written as an inline `left` it worked everywhere and
  // could be overridden nowhere — inline beats any rule — so the pre-jump look
  // in `globals.css` silently did nothing. Written only in `globals.css` it was
  // overridable but invisible in Storybook, which loads its own Tailwind entry
  // and never sees the app's stylesheet; the mark's own story failed on it.
  //
  // A custom property set HERE and read by the pupil's `left` below satisfies
  // both: the component still owns its resting positions and renders correctly
  // anywhere, and `globals.css` re-declares the property ON THE PUPIL for the
  // flight pose, where a value set directly on the element beats one inherited
  // from this ancestor.
  return (
    <span
      data-storyboard-monster=""
      data-monster-gaze={gaze}
      // The growth between rail states. Everything about the creature is sized
      // off its own font-size, so animating that one property scales the whole
      // drawing — fur, eye, glint, hat and feet together.
      className="transition-[font-size] duration-200 motion-reduce:transition-none"
      style={{
        // Read by the pupil's `left`, and re-declared by the flight pose — see
        // the note above.
        ["--monster-gaze-x" as string]:
          gaze === "breadcrumb" ? "0.075em" : "0em",
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
        {/* THE CROWN OF THE HEAD, and the only way this drawing can BEND.
            Every transform is affine, so no amount of rotating or skewing turns
            an ellipse into a banana — it maps ellipses to ellipses. A curve
            needs geometry, and a view transition freezes the geometry, so it
            has to be here rather than in a keyframe.

            This is a second ellipse in the SAME sage, sitting entirely inside
            the body at rest and therefore invisible. Lean it over the body's
            base and the union of the two is a curve: it juts out on the leading
            side above the midpoint while the body's own outline still shows
            below and behind, which is exactly the shape of a head arcing over
            feet that have not moved.

            Narrower than the body on purpose. Same width would put its widest
            point outside the body's own edge at that height — the body is
            0.98 x 1.12, so at this ellipse's centre the body has only about
            0.92 of width to give — and the crown would show as a bulge at rest
            rather than hiding. */}
        <span
          data-monster-crown=""
          style={{
            position: "absolute",
            left: `${(BODY_W - 0.9) / 2}em`,
            top: 0,
            width: "0.9em",
            height: "0.74em",
            borderRadius: "999px",
            background: SAGE,
            // Pivots where it meets the body it grows out of, so leaning it
            // swings the top and leaves the join alone.
            transformOrigin: "50% 100%",
          }}
        />
        {/* eye white — marked because the WHOLE eye turns before a jump, not
            just the pupil sliding inside a fixed one. See the departure pose in
            globals.css. */}
        <span
          data-monster-eye=""
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
            // A PUPIL CANNOT LEAVE THE EYE. With the resting gaze offset added
            // to the settle's own excursion, the far edge of the pupil reaches
            // about half a pixel past the white and would otherwise be drawn on
            // the sage. Clipping it to the circle is both the fix and what
            // actually happens to an eye looking hard to one side.
            overflow: "hidden",
          }}
        >
          {/* pupil */}
          <span
            data-monster-pupil=""
            style={{
              position: "absolute",
              // Centred is (0.64 - 0.39) / 2: the pupil is 0.39em inside a
              // 0.64em eye. The gaze rides on top as a custom property.
              left: "calc(0.125em + var(--monster-gaze-x, 0em))",
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
      <span data-monster-foot="left" style={foot("0.08em")} />
      <span data-monster-foot="right" style={foot("0.55em")} />
      {hat ? (
        <span data-monster-hat="" style={HAT_GROUP}>
          <span style={HAT_TILT}>
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
                clipPath:
                  "polygon(0 100%, 0 34%, 22% 8%, 50% 26%, 78% 8%, 100% 34%, 100% 100%)",
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
            {/* The band. */}
            <span
              style={{
                position: "absolute",
                left: "0.23em",
                top: "0.01em",
                width: "0.54em",
                height: "0.08em",
                background: HAT_BAND,
              }}
            />
          </span>
        </span>
      ) : null}
    </span>
  );
}
