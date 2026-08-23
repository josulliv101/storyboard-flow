/**
 * ONE SET OF SURFACES, HAIRLINES AND TYPE FOR THE DETAILS VIEW.
 *
 * The view had grown about a dozen slightly different greys, four radii and
 * three ways of drawing the same toggle — and that variance, rather than any
 * one wrong value, is what read as untidy. Nothing here is new design; it is
 * the set of values already in use, deduplicated down to the smallest number
 * that still says everything the view needs to say, and given names so the
 * next control added reaches for an existing value instead of inventing a
 * thirteenth grey.
 *
 * THE RULE THAT MAKES IT A SYSTEM: depth comes from THREE surfaces and TWO
 * hairlines, never from a fourth of either. A thing is the page, a card on the
 * page, or a well cut into a card. If something seems to need a level between
 * two of these, it wants a different position on the page, not a new grey.
 */

/* ── SURFACES ──────────────────────────────────────────────────────────── */

/** The page a card sits on. */
export const SURFACE_PAGE = "bg-zinc-950";

/** A card. Opaque rather than a white wash, because these sit over the board
 *  and a translucent card would let the board's own cards read through the
 *  frame you are trying to judge. */
export const SURFACE_CARD = "bg-[#0d0d10]";

/** The SAME card, in focus. Two clicks of lightness — enough that the eye
 *  reads the centre as nearer without it becoming a different component. */
export const SURFACE_CARD_FOCUS = "bg-[#141418]";

/** A well cut INTO a card: the transport bar, and the tray a control group
 *  sits in. Darker than the card, so it reads as recessed rather than as a
 *  second card stacked on the first. */
export const SURFACE_WELL = "bg-[#08080a]";

/* ── HAIRLINES ─────────────────────────────────────────────────────────── */

/** Ordinary separation. */
export const HAIRLINE = "border-white/[0.07]";

/** The focused card only. Focus falloff is carried by BOTH the surface and
 *  the border moving together; either alone is too quiet to survive a screen
 *  full of pictures. */
export const HAIRLINE_STRONG = "border-white/[0.16]";

/* ── TYPE ──────────────────────────────────────────────────────────────── */

/* FOUR SIZES, and the split between them is by JOB, not by size: mono for
 * anything the machine knows (times, counts, control labels), sans for the
 * one thing a person wrote (the clip's name). That is why a 13px title and a
 * 13px readout look nothing alike and never need to be told apart by size. */

/** A control's name, and any word that labels a value rather than being one. */
export const TEXT_LABEL = "font-mono text-[11px] text-zinc-600";

/** A value the machine produced: a duration, a count, a clip number. */
export const TEXT_VALUE = "font-mono text-[11px] tabular-nums text-zinc-200";

/** The same, when it is the second and lesser half of a pair — the source
 *  length beside the cut length, the total beside the clock. */
export const TEXT_VALUE_DIM = "font-mono text-[11px] tabular-nums text-zinc-500";

/** BLUE IS RESERVED, and this is the whole of what it means: a number you can
 *  edit. In and out points, the clock, the source time. It is not decoration
 *  and it is not "important" — a duration you cannot type into stays grey, and
 *  that consistency is what makes the blue ones findable. */
export const TEXT_DATA = "font-mono text-[11px] tabular-nums text-blue-300";

/** The clip's name on the card in focus. */
export const TITLE_FOCUS = "text-[15px] font-semibold text-zinc-100";

/** The clip's name on a card beside it. Dimmer AND smaller: a neighbour's
 *  name is there to tell you which clip it is, not to be read. */
export const TITLE_SIDE = "text-[13px] font-semibold text-zinc-400";

/* ── RADII ─────────────────────────────────────────────────────────────── */

/** A card. */
export const RADIUS_CARD = "rounded-xl";
/** A well, and a control group's tray. */
export const RADIUS_WELL = "rounded-lg";
/** Anything inside a well: a segment, a field, a chip. */
export const RADIUS_INNER = "rounded-md";
/** Picture. Tighter than its card, so the frame reads as mounted IN the card
 *  rather than as the card's own edge. */
export const RADIUS_MEDIA = "rounded-md";

/* ── ACCENTS ───────────────────────────────────────────────────────────── */

/* Three, each with exactly one meaning, none of them shared:
 *   BLUE  — a value you can edit (TEXT_DATA above).
 *   RED   — the playhead. Never anything else, so a red mark anywhere in the
 *           view means "play is here" without being labelled.
 *   AMBER — a judgement someone made. Today that is the keeper tag: the one
 *           chip in a row of factual ones that says what a person decided.
 * WHITE is not an accent — it is spent entirely on the play button, which is
 * why that button is findable at a glance on a screen of grey furniture. */

/** The keeper tag, and any tag that later comes to mean the same kind of
 *  judgement. Quiet on purpose: it should be findable in the row, not the
 *  loudest thing on the card. */
export const TAG_JUDGEMENT =
  "bg-amber-400/[0.08] text-amber-300/90 ring-amber-400/25";

/** Every other tag: what the clip IS, not what anyone thought of it. */
export const TAG_FACT = "bg-white/[0.04] text-zinc-300 ring-white/10";

/** Tags that carry a judgement, and so wear {@link TAG_JUDGEMENT}.
 *  A set rather than a single name so the vocabulary can grow without another
 *  branch appearing at the call site. */
export const JUDGEMENT_TAGS: ReadonlySet<string> = new Set(["keeper"]);
