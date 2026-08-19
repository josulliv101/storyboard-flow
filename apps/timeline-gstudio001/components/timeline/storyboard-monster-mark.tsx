/**
 * The storyboard monster — the creature that sits in the "o" of "monster".
 *
 * Ported from the logo design document's final direction (turn 21, "20a on
 * dark", FIRST treatment: near-black ground, pale terracotta feet — the two
 * dark options differ only in the feet). It is drawn in CSS
 * rather than SVG, exactly as the source is: a masked `repeating-conic-gradient`
 * makes the fur spikes, and the eye is four nested circles.
 *
 * SIZED IN `em`, so it scales with whatever font-size the lockup uses and can
 * sit inline in the wordmark. `scale` multiplies that — the document's turn 19
 * ("a bigger monster in the o") establishes that growing the creature past the
 * letter is a sanctioned move, and the rail needs it: the source drawing is
 * 0.72em, which at a font-size small enough for "storyboard monster" to fit a
 * 239px rail would put the creature under the legibility floor the document
 * itself measured — "below about 19px the fur spikes and the glint start to
 * merge".
 *
 * COLOURS ARE APPROXIMATED. The design document referenced its own design
 * system (`var(--color-bg)`, `var(--color-accent-2-900)`, …) and shipped
 * without that stylesheet, so only the sage is the source's literal value. The
 * cream and the pupil are matched by eye to the document's dark-mode frames and
 * are the two worth checking against the real palette.
 */
const SAGE = "oklch(0.86 0.17 128)";
/** The document's `--color-bg` on its dark frames: a warm off-white. */
const CREAM = "oklch(0.96 0.02 95)";
/** The document's `--color-accent-2-900`: the pupil, near-black. */
const PUPIL = "oklch(0.27 0.03 145)";
/**
 * The document's `--color-accent-300`: pale terracotta.
 *
 * The feet AND the word "monster" are this same token — turn 18 chose it as
 * "terracotta feet, matches the wordmark", and turn 21 kept it for dark. Export
 * it so the lockup cannot drift from the creature.
 */
export const STORYBOARD_MONSTER_ACCENT = "oklch(0.78 0.10 45)";

/** The fur ring: spikes radiating from the body, masked to an annulus so the
 *  gradient only shows outside the circle. */
const FUR: React.CSSProperties = {
  position: "absolute",
  left: "-0.14em",
  top: "-0.14em",
  width: "1em",
  height: "1em",
  background: `repeating-conic-gradient(from 0deg, ${SAGE} 0deg 11deg, transparent 11deg 22deg)`,
  WebkitMaskImage:
    "radial-gradient(circle at 50% 50%, transparent 0 35%, #000 35% 50%, transparent 50%)",
  maskImage:
    "radial-gradient(circle at 50% 50%, transparent 0 35%, #000 35% 50%, transparent 50%)",
};

/**
 * A LIGHT BLUE, off the document's palette and arrived at by elimination.
 *
 * Terracotta (turn 21's first dark treatment) is the same value as the word the
 * creature stands in, so the feet read as part of the letters. Cream (its
 * second) separates cleanly but is the brightest thing in the rail — the feet
 * ended up louder than the eye they belong to. Dark navy disappeared outright,
 * which is the failure turn 21 already documented for near-black: "the
 * near-black feet can't survive on a dark ground".
 *
 * The constraint the document is pointing at: the feet sit BELOW the body,
 * against the rail rather than against the sage, so anything near the rail's own
 * value has nothing behind it to separate from. And they are small — about 3px
 * tall at this size — which needs MORE contrast than a large shape, not less.
 *
 * So the value is chosen for LIGHTNESS first and hue second: 0.72 against the
 * rail's ~0.19. A dark blue was tried at 0.34 and vanished, which is the same
 * failure as the near-black. The hue also has to stay clear of the sage body it
 * sits under and the terracotta type it sits beside, which a blue does.
 */
const FEET = "oklch(0.72 0.13 250)";

const foot = (left: string): React.CSSProperties => ({
  position: "absolute",
  left,
  bottom: "-0.08em",
  width: "0.28em",
  height: "0.15em",
  background: FEET,
  borderRadius: "999px",
});

export function StoryboardMonsterMark({ scale = 1 }: Readonly<{ scale?: number }>) {
  // 0.72em of the element's OWN font-size, which `scale` has already set below.
  // Multiplying here as well applied the scale twice — a 1.6 scale rendered a
  // 33px creature beside 18px text instead of the intended 21px, which left a
  // visible gap where the box overhung the word.
  const size = "0.72em";
  return (
    <span
      data-storyboard-monster=""
      // The growth between rail states. Everything about the creature is sized
      // off its own font-size, so animating that one property scales the whole
      // drawing — fur, eye, glint and feet together.
      className="transition-[font-size] duration-200 motion-reduce:transition-none"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        // The creature's own box drives its parts, so one number scales the
        // whole drawing without touching the geometry below.
        fontSize: `${scale}em`,
        // NUDGED, NOT BASELINE-ALIGNED. The lockup is a flex row, and the
        // pieces around this are `RevealedLetters` — `display: grid`, so they
        // can only be flex items and the whole row is laid out by flex, not by
        // inline text. `align-self: baseline` on an item with no text of its
        // own resolves to its bottom margin edge and threw the creature to the
        // top of the 72px row. Centring it and dropping it by a fraction of its
        // own size is what puts the body on the line and the feet just under
        // it, which is where the source drawing sits inside the "o".
        position: "relative",
        top: `${0.1 * scale}em`,
      }}
    >
      <span style={FUR} />
      <span
        style={{
          position: "absolute",
          left: "0.01em",
          top: "0.01em",
          width: "0.7em",
          height: "0.7em",
          borderRadius: "999px",
          background: SAGE,
        }}
      >
        {/* eye white */}
        <span
          style={{
            position: "absolute",
            left: "0.12em",
            top: "0.12em",
            width: "0.46em",
            height: "0.46em",
            borderRadius: "999px",
            background: CREAM,
          }}
        >
          {/* pupil */}
          <span
            style={{
              position: "absolute",
              left: "0.09em",
              top: "0.09em",
              width: "0.28em",
              height: "0.28em",
              borderRadius: "999px",
              background: PUPIL,
            }}
          >
            {/* the glint — the document's turn 17 exists for this one dot, and
                it is the first thing to disappear at small sizes */}
            <span
              style={{
                position: "absolute",
                left: "0.035em",
                top: "0.035em",
                width: "0.1em",
                height: "0.1em",
                borderRadius: "999px",
                background: CREAM,
              }}
            />
          </span>
        </span>
      </span>
      <span style={foot("0.04em")} />
      <span style={foot("0.4em")} />
    </span>
  );
}
