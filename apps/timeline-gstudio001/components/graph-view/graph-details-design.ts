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

/**
 * A card.
 *
 * OPAQUE, rather than a white wash: these sit over the board, and a translucent
 * card would let the board's own cards read through the frame you are trying to
 * judge.
 *
 * LIT FROM ABOVE (PL15-030), like the bar. The reference design gives a clip
 * card a top-to-bottom gradient rather than a flat fill, and it is the same
 * trick the bar's panel uses — the card reads as a surface catching light
 * instead of a rectangle of a slightly different grey.
 */
export const SURFACE_CARD = "bg-[linear-gradient(180deg,#12151c,#0c0f14)]";

/** The SAME card, in focus. Two clicks of lightness — enough that the eye
 *  reads the centre as nearer without it becoming a different component. */
export const SURFACE_CARD_FOCUS = "bg-[linear-gradient(180deg,#141821,#0c0f14)]";

/**
 * WHAT LIFTS A CARD OFF THE PAGE, and marks the one in focus (PL15-030).
 *
 * A deep, wide shadow and a single lit pixel along the top edge — the same
 * pairing the bar's panel uses, so the two read as parts of one instrument
 * rather than two components that happen to be dark.
 *
 * AND IT IS THE SAME ON EVERY PANEL, which is a decision this repo already
 * made and which the reference contradicts. The reference rings its active
 * card in the accent; here the white ring and the sky-blue one that used to
 * follow the playhead were both removed deliberately — the shadow lifts the
 * row off the board and says nothing about which panel you are in. Focus
 * falloff is carried by the SURFACE and the BORDER moving together, and
 * `OnlyTheSubjectPanelIsMarked` asserts the shadow is identical either side and
 * carries no accent at all. It caught this being reintroduced.
 */
export const CARD_LIFT =
  "shadow-[0_34px_80px_-36px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.05)]";

/** A well cut INTO a card: the transport bar, and the tray a control group
 *  sits in. Darker than the card, so it reads as recessed rather than as a
 *  second card stacked on the first. */
export const SURFACE_WELL = "bg-[#08080a]";

/**
 * THE BAR'S OWN SURFACE — the one lit thing in the view (PL15-030).
 *
 * The cards are lit now too (see `SURFACE_CARD`), so this is no longer the
 * only gradient in the view — but it is the deepest. The bar is the instrument
 * the whole view is arranged around, and the reference gives it a stronger
 * top-lit panel than the cards that sit below it, which is what keeps the two
 * reading as an instrument and its contents rather than as two rows of card.
 *
 * A GRADIENT PLUS AN INSET HIGHLIGHT, and the highlight is the half that does
 * the work. `inset 0 1px 0 rgba(255,255,255,.05)` is a single lit pixel along
 * the top edge; without it the gradient alone reads as a slightly different
 * grey rather than as a surface catching light from above.
 *
 * THE EDGE IS AN INSET RING, NOT A BORDER, and that is a correction rather than
 * a preference. A 1px border on a panel this wide moves everything inside it in
 * by a pixel — `TheBarSpansTheFullWidth` caught the ruler starting at 25 where
 * it must start at 24, and its rule is exactly right: the bar's rows and the
 * cards below them are read against each other, so anything that narrows one
 * and not the other is a misalignment. A ring is drawn, not laid out.
 *
 * 18px, NOT `RADIUS_CARD`'s 12. The bar is wider than anything else in the
 * view and a radius that reads as generous on a 400px card reads as tight
 * across 1100px — the reference makes the same distinction, and for the same
 * reason.
 */
export const SURFACE_BAR = "bg-[linear-gradient(180deg,#14181f,#0e1117_55%,#0b0d12)]";
export const RADIUS_BAR = "rounded-[18px]";
export const BAR_LIFT =
  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07),inset_0_1px_0_rgba(255,255,255,0.05),0_40px_90px_-40px_rgba(0,0,0,0.9),0_8px_30px_-18px_rgba(0,0,0,0.8)]";

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

/**
 * A control's name, and any word that labels a value rather than being one.
 *
 * SMALL, WIDE AND LIFTED (PL15-030) — the treatment the reference design uses
 * for every label on the bar, and the thing that actually carries its look now
 * that the two faces it loads are not being adopted. Tracking is doing the work
 * a display face would have done: at this size, letters set close read as a
 * word and letters set apart read as a LABEL, whatever family draws them.
 *
 * 10px with `0.14em` rather than the reference's 9.5px with `0.22em`. Tracking
 * adds width per character, and these sit in control rows that are already
 * full — the reference can afford more of it because its labels live in a strip
 * with nothing beside them. Same treatment, sized for where ours actually go.
 *
 * `zinc-500`, up from `zinc-600`. The reference's quiet label is `#79828f` and
 * ours was `#52525b` — dark enough that a label beside a value read as disabled
 * rather than as quiet. `zinc-500` is `#71717a`, which is the same intent.
 */
export const TEXT_LABEL =
  "font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase";

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

/** A card. 16px, up from 12 (PL15-030): the reference's clip card is rounder
 *  than its wells, and at this size a tighter corner reads as a tile rather
 *  than as something with a picture mounted in it. */
export const RADIUS_CARD = "rounded-2xl";
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
