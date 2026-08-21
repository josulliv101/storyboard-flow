/**
 * Whether the details bar TINTS ITS BOXES BY COLLECTION — the playbar's clip
 * boxes and the minimap row under it, which are the two places the tint is
 * spent.
 *
 * OFF. Every box and every minimap segment draws in one neutral instead, and
 * the bar says where one collection ends and the next begins the way it
 * already does without colour: a dashed divider on the strip and a named tick
 * on the ruler. Those two are structural rather than decorative, so nothing is
 * lost from a bar in which every clip looks alike — it is the difference
 * between a landmark and a wash.
 *
 * Set `NEXT_PUBLIC_GSTUDIO_BAR_COLOURS=on` to restore it. Compared against the
 * string rather than truthiness, the same way `NEXT_PUBLIC_GSTUDIO_LANE_TRACKS`
 * is, so that `=off`, `=0` and `=false` all read as off instead of the reverse
 * — a bare `!!process.env.X` makes the word "off" mean on.
 *
 * WHAT IS PARKED AND WHAT IS NOT. The derivation stays exactly where it is:
 * `clipColourOf` in the details modal still walks the collection tree and
 * still hands the bar a tone per clip, and this only decides whether the bar
 * paints with it. So turning the tint back on is one environment variable, and
 * the hue-family arithmetic — top-level hues 45° apart, siblings a few degrees
 * either side of their parent, depth carried by lightness — does not rot in
 * the meantime.
 *
 * WHAT THIS DOES NOT TOUCH. Colour elsewhere in the view is a different
 * decision and stays: the cards' own pictures, the blue of the readout, the
 * red of the playhead. The playhead in particular is deliberately still the
 * only saturated thing on the bar — which is easier to see now, not harder.
 */
export const BAR_COLLECTION_COLOURS_ENABLED =
  process.env.NEXT_PUBLIC_GSTUDIO_BAR_COLOURS === "on";

/**
 * What a box is when it is not saying which collection it came from.
 *
 * The same tone both consumers already fell back to for a clip with no
 * collection, so "flag off" and "no answer" look alike on purpose — there is
 * one neutral, not a default and a fallback that differ by a few percent.
 */
export const BAR_NEUTRAL_COLOUR = "hsl(220 8% 34%)";
