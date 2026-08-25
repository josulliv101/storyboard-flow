// Extracts the reference stylesheet into a scoped module for the ported
// components. Run from the repo root:
//   node punch-list/reference/generate-playbar-css.mjs
import fs from "node:fs";

const SRC = "punch-list/reference/storyboard-playbar.html";
const OUT = "apps/timeline-gstudio001/components/graph-view/playbar/playbar-styles.ts";
const SCOPE = ".pb";
const PAGE = ".pb-page";

// Rules belonging to parts that were removed: the preview player, the coach
// mark, the keyboard hints, and the content-area header.
const DROP = [
  /^\.p-slot/, /^\.player/, /^\.p-close/, /^\.p-view/, /^\.p-frame/, /^\.p-bar/,
  /^\.p-fill/, /^\.p-notch/, /^\.p-row/, /^\.p-src/, /^\.p-ctl/, /^\.p-time/,
  /^\.t-btn/, /^\.t-main/, /^\.coach/, /^\.hints/, /^\.area-head/, /^\.a-chip/,
  /^\.a-count/, /^\.a-preview/,
];

const html = fs.readFileSync(SRC, "utf8");
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];

function walk(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const braceAt = css.indexOf("{", i);
    if (braceAt === -1) break;
    const prelude = css.slice(i, braceAt);
    let depth = 0;
    let j = braceAt;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const inner = css.slice(braceAt + 1, j);
    const trimmed = prelude.trim().replace(/\/\*[\s\S]*?\*\//g, "").trim();

    if (/^@keyframes/i.test(trimmed)) {
      out += trimmed + "{" + inner + "}\n";
    } else if (/^@/.test(trimmed)) {
      const nested = walk(inner);
      if (nested.trim() !== "") out += trimmed + "{" + nested + "}\n";
    } else {
      const selectors = trimmed
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "" && !DROP.some((re) => re.test(s)));
      if (selectors.length > 0) {
        const scoped = selectors
          .map((sel) => {
            // TOKENS AND THE RESET APPLY WHEREVER THE COMPONENT DOES; the
            // PAGE's own paint does not. `:root` carries the custom properties
            // everything reads, so it lands on the scope itself — but `body`
            // paints a background, centres its child and sets a min-height,
            // and a component dropped into the app must bring none of that
            // with it. Those go behind a second class the standalone story
            // adds and the embedded use does not.
            if (sel === ":root") return SCOPE;
            if (sel === "html" || sel === "body") return SCOPE + PAGE;
            if (/^body(::?[a-z-]+)/.test(sel)) return SCOPE + PAGE + sel.slice(4);
            if (sel === "*") return SCOPE + " *";
            return SCOPE + " " + sel;
          })
          .filter((s, k, all) => all.indexOf(s) === k);
        out += scoped.join(",") + "{" + inner + "}\n";
      }
    }
    i = j + 1;
  }
  return out;
}

/**
 * THE ACCENT IS OURS, AND THE REFERENCE HARDCODES ITS OWN 27 TIMES.
 *
 * Redefining `--signal` covers only the rules that read it. The rest spell the
 * teal out — `rgba(60,219,192,.55)` in the active range's gradient and its
 * glow, in the playhead chip's shadow, in a card's active ring — so a variable
 * override left the design half-changed and, worse, half-changed in exactly the
 * places that mark the SUBJECT.
 *
 * Substituted at extraction rather than patched afterwards: the alpha values
 * differ every time and hand-editing 27 of them is how one gets missed.
 * PL15-026 runs the subject's blue from the film to the minimap off one
 * exported constant, and this is that colour — rgb(56,189,248).
 */
function ourAccent(css) {
  return css
    .replace(/60,\s*219,\s*192/g, "56, 189, 248")
    .replace(/#3cdbc0/gi, "#38bdf8");
}

const css =
  ourAccent(walk(style)) +
  `
/* ── Deviations from the reference, and why ──────────────────────────────
   1. \`grid-template-columns: minmax(0, 1fr)\`. The reference centres its stage
      with \`body{display:grid;place-items:center}\`. Scoped onto a div, an
      implicit \`auto\` track grows to fit a 5280px filmstrip — measured, the
      root was 1400px and the stage inside it 5364, so the viewport filled its
      own content and had NOTHING LEFT TO SCROLL. That is exactly "the strip
      will not pan". \`body\` is sized by the initial containing block and never
      had the problem; a div needs the track bounded.
   2. A viewport minimum, because \`html,body{height:100%}\` became
      \`${SCOPE}{height:100%}\` and a percentage height needs a parent that has
      one. ─────────────────────────────────────────────────────────────── */
${SCOPE}${PAGE}{ grid-template-columns: minmax(0, 1fr); min-height: 100%; }

/* ── DRAGGING MUST NOT SELECT TEXT ───────────────────────────────────────
   The reference puts \`user-select: none\` on \`body\`, so scoping sent it to the
   PAGE class — and embedded in the app, where that class is absent, it never
   applied. A drag across a card's title or a shot's tag then starts a native
   text selection that fights the pan, which is exactly what "grab and pan does
   not work reliably" feels like: it depends entirely on what is under the
   pointer when you press.

   Not a page behaviour at all, on reflection. It belongs to the components,
   which is where it goes now.

   \`touch-action: none\` on the deck for the same class of reason: the strip's
   scroller already declares it, the deck never did, so a touch drag there is a
   page scroll the browser can take away mid-gesture. ────────────────────── */
${SCOPE}{ -webkit-user-select: none; user-select: none; }
${SCOPE} .deck{ touch-action: none; }

/* ── THE PAN SURFACE MUST SAY "GRAB" ─────────────────────────────────────
   The reference contradicts itself here. \`.strip\` sets \`cursor: grab\`, but
   \`.shot\` sits on top of it setting \`cursor: pointer\` — while
   \`.strip.panning .shot\` sets \`grabbing\`. So the shot boxes read "click me"
   at rest and "grabbing" once you are already dragging.

   Measured across the bar, that inverts the whole instrument: the band that
   PANS advertised \`pointer\`, and the ruler and label lane, which SEEK,
   advertised \`ew-resize\` — the drag-me cursor. Someone reading the cursors
   and acting on them gets the other behaviour every time, which is what
   "grab and panning does not work reliably" turned out to be.

   \`grab\` at rest agrees with the \`grabbing\` the reference already sets, so
   this makes the rule consistent with its own intent rather than inventing
   one. The ruler keeps \`ew-resize\`: it really is the scrub surface, and
   under the settled contract it is now the ONLY one. ─────────────────── */
${SCOPE} .strip .shot{ cursor: grab; }

/* ── THE TRIM HANDLES ──────────────────────────────────────────────────────
   Not in the reference, whose strip is a picture of a sequence and not an
   editor of one. Only on the subject: an edge on every box would be two dozen
   grab targets on a surface whose main gesture is a pan across all of them.

   BOTH EDGES, and they are told apart by which one MOVES. A box here is the
   USED length with no room to depict the source, so if both gestures resized
   from the right they would look identical and mean different things. An
   in-drag moves the left edge and holds the right; an out-drag does the
   reverse. The card remains the place to see the source itself, with its
   discards shaded.

   Wider than it looks: a 3px rule is a 3px target, and this one sits on the
   edge of a box you are also meant to be able to grab and fling. The bar is
   the affordance, the padding is the hit area. ──────────────────────────── */
/* THE APP'S OWN HANDLE, worn by both surfaces that have one.
   \`GraphTrimHandle\` is the design everywhere else on this board: an 8px white
   collar down the clip's edge, rounded on the outside, with a dark grip line
   centred in it — and the grip, not the collar, is what changes when the drag
   arms, because a geometry change INSIDE the handle does not move anything
   under the finger already on it. The reference's own edges are a thin accent
   rule and a bare 2px tick; two trim handles that look different in one view
   is one control with two stories. Restated here rather than imported because
   the canonical one is a React component in the app and this stylesheet has to
   stand on its own. */
${SCOPE} .strip .shot .s-edge,
${SCOPE} .c-h{
  position:absolute; top:0; bottom:0; width:8px;
  display:flex; align-items:center; justify-content:center;
  cursor:ew-resize; z-index:6;
  background:rgba(255,255,255,.95);
  transition:background-color .15s ease;
}
${SCOPE} .strip .shot .s-in,
${SCOPE} .c-h.l{ left:0; border-radius:6px 0 0 6px; }
${SCOPE} .strip .shot .s-out,
${SCOPE} .c-h.r{ right:0; border-radius:0 6px 6px 0; }

/* The grip: 2px, rounded, black at 45% — full height and darker once armed. */
${SCOPE} .strip .shot .s-edge::after,
${SCOPE} .c-h::after{
  content:""; position:static; transform:none;
  width:2px; height:20px; border-radius:9999px;
  background:rgba(0,0,0,.45);
  transition:height .15s ease, background-color .15s ease;
}
${SCOPE} .strip .shot.trimming .s-edge::after,
${SCOPE} .c-win:active .c-h::after{
  height:100%; background:rgba(0,0,0,.7);
}
/* Taller on a coarse pointer, for the same reason the target is wider there. */
@media (pointer: coarse){
  ${SCOPE} .strip .shot .s-edge::after,
  ${SCOPE} .c-h::after{ height:28px; }
}

/* ── THE FILM SETTLES INTO ITS NEW PLACES ────────────────────────────────
   A trim moves every box after it, and moving them instantly makes the
   sequence appear to cut to a different arrangement — you cannot see WHICH
   way it went, only that it changed. The same easing the subject mark and the
   ruler range already use, so the three things that move on this bar move
   alike.

   OFF WHILE THE DRAG IS RUNNING, which is the whole reason it is a class and
   not a blanket rule. An eased box lags the pointer: the edge you are holding
   would trail your hand by a quarter second and the ripple would arrive after
   the gesture that caused it. Direct manipulation has to be direct; it is the
   re-flow AFTERWARDS — a trim committed from the card, an undo, a clip
   arriving — that benefits from being followed by eye. ──────────────────── */
${SCOPE} .strip .shot{
  transition:
    left .28s cubic-bezier(.22,1,.3,1),
    width .28s cubic-bezier(.22,1,.3,1);
}
${SCOPE} .strip.rippling .shot{ transition:none; }

/* ── THE THUMBNAIL THAT FLEW HERE ────────────────────────────────────────
   The subject card's picture wears the app's own hero name (\`trim-subject\`,
   set from the modal) — the same one the board card carries until this view
   mounts — so the browser morphs one into the other instead of the details
   view simply appearing. The name itself is applied in the deck component,
   because only one element may hold it and the deck knows which card is the
   subject.

   LONGER THAN THE 250ms DEFAULT, and eased like the rest of this bar. The
   picture crosses most of the screen and changes size on the way; at the
   default it reads as a cut with a smear rather than as the same shot moving.
   \`contain\` on both ends so neither is stretched while the box morphs between
   two different aspect boxes. ──────────────────────────────────────────── */
::view-transition-group(trim-subject){
  animation-duration: 380ms;
  animation-timing-function: cubic-bezier(.22,1,.3,1);
}
::view-transition-old(trim-subject),
::view-transition-new(trim-subject){
  animation-duration: 380ms;
  object-fit: contain;
}
/* NO REDUCED-MOTION OVERRIDE HERE, deliberately and by request. It used to cut
   this to 1ms, which would have quietly undone the decision made in
   the view-transition helper to run this one flight regardless of the preference:
   the transition would start and finish inside a frame, which looks exactly
   like the nothing it was meant to replace. The two have to agree, so the
   override is gone rather than left as a second opinion. */

/* FRONT-MOST WHILE BEING TRIMMED. Nothing overlaps — the shots after it slide
   live, so the film stays a continuous run throughout the drag — but its
   handles must not pass under the box arriving beside it. */
${SCOPE} .strip .shot.trimming{ z-index:8; }
${SCOPE} .strip .shot .s-read{
  position:absolute; left:50%; top:6px; transform:translateX(-50%);
  padding:2px 6px; border-radius:5px;
  background:var(--chip); color:#0b0e13;
  font-size:10.5px; font-weight:600; letter-spacing:.02em;
  white-space:nowrap; pointer-events:none; z-index:7;
  box-shadow:0 2px 10px rgba(0,0,0,.55);
}

/* ── THE PLAYHEAD CHIP CARRIES THE MONITOR ───────────────────────────────
   The chip is the moment the preview pane is showing, so it wears the pane's
   own glyph — the same one the Preview toggle uses, not a second icon meaning
   the same thing. \`currentColor\` so it is the chip's ink and cannot drift
   from the numerals beside it; a hair below the cap height so it reads as a
   mark on the chip rather than a button in it. ─────────────────────────── */
${SCOPE} .ph-chip{
  display:inline-flex; align-items:center; gap:5px;
  /* BIGGER THAN THE REFERENCE'S. Its chip is a 10.5px numeral in a page that
     also has a player showing the same time; here it is the only readout of
     where the playhead is, and it now carries the monitor mark as well. */
  font-size:13px; padding:5px 10px 4px; border-radius:7px;
}
${SCOPE} .ph-tv{ width:12px; height:12px; flex:none; opacity:.85; }
/* THE STEM FOLLOWS THE CHIP. Both offsets are measured from the chip's lower
   edge in the reference — the arrow one pixel into it, the line six below —
   so growing the chip without moving these leaves the arrow buried in it and
   the line starting inside the label. Restated against the new height rather
   than nudged. */
${SCOPE} .ph-chip{ top:-3px; }
${SCOPE} .ph-tri{ top:25px; }

/* THE LINE STOPS AT THE FILM, rather than running down through it.
   The reference draws it to the bottom of the strip, a rule straight across
   every thumbnail the playhead passes — measured, 150px of it, the whole
   height of the film. The scale above is where a position is READ; the frames
   are what you are trying to look at, and a line across them is in the way of
   the one thing the strip is for.

   Ended with the film's own height variable rather than a fixed length: the
   playhead's lower edge and the strip's are the same line, so \`bottom\` set to
   the film's height lands exactly on its top edge — and follows it when the
   film concedes height on a short window, which a restated constant would
   not. ─────────────────────────────────────────────────────────────────── */
${SCOPE} .ph-line{ top:32px; bottom:var(--strip-h, 150px); }

/* ── THE CARD IS SIZED BY WIDTH, SO WIDTH IS THE HEIGHT DIAL ─────────────
   The reference gives \`.clip\` \`width: clamp(300px, 30vw, 440px)\` and makes
   the picture \`aspect-ratio: 2 / 1\`, so a card's height is a fixed stack of
   rows plus half its width. Everything below the picture — the head, the
   title, the transport row, the trim strip, the fields, the tags — is a
   constant.

   That makes the card proportional, and proportional is exactly what a
   height-constrained deck needs: to fit a shorter window, narrow the card and
   the picture gives back twice what it loses. Reaching instead for a flex
   column with a shrinking picture would change the card's height on the spot,
   because a block box collapses adjacent margins and a flex one does not, and
   this card's rows carry 54px of margin between them.

   \`--clip-w\` is published by the deck from the height it actually has (see
   \`clip-deck.tsx\`); the fallback IS the reference's own rule, so a standalone
   deck and any surface that never sets it are unchanged. ─────────────────── */
${SCOPE} .clip{ width: var(--clip-w, clamp(300px, 30vw, 440px)); }

/* ── AND THE STRIP GIVES A LITTLE BEFORE THE CARD GIVES A LOT ────────────
   150px of film is generous on a short window, and the bar is the one part
   whose job survives being shorter — a shot box still reads as a shot box at
   112px. Ahead of the card in the order of concessions because the card is
   where the text lives. Only ever SHRINKS: at any comfortable height this
   resolves to the reference's own 150px. ─────────────────────────────────── */
${SCOPE} .strip{ height: var(--strip-h, 150px); }

/* ── THE SKIM CARD ───────────────────────────────────────────────────────
   Not in the reference, which has no need of one: it always has the player
   above the bar, and hovering the ruler skims frames straight into it. Here
   the preview pane is dismissible, so when it is closed a scrub had nothing
   to show for itself — the playhead moved and the picture did not.

   The rule is the seam's, not a new one: \`usePublishTrimPreview\` publishes
   into the pane when it is open and reports whether it took the frame, and
   the caller draws this card only when it did not. Exactly one of the two is
   ever up.

   ABOVE THE BAR rather than inside it. Above the playhead means above the
   chip, and the chip sits at the top of the content — so anywhere "above"
   inside the bar is on top of the ruler, which is the surface being dragged.
   A card under the pointer during the gesture it exists to serve is no card
   at all. ──────────────────────────────────────────────────────────────── */
${SCOPE} .skim{
  position:fixed; top:0; left:0; /* both set from JS, in viewport pixels */
  transform:translateX(-50%);
  /* 184 rather than 216: the card has to clear the bar's top without leaving
     the window, and at a 910-tall window that leaves ~150px of room. A 16/9
     picture at this width is 94, which totals ~147. */
  width:184px; padding:8px 8px 7px;
  display:flex; flex-direction:column; gap:5px;
  background:rgba(12,15,20,.97);
  border:1px solid rgba(255,255,255,.14);
  border-radius:12px;
  box-shadow:0 26px 60px -24px rgba(0,0,0,.95), 0 0 0 1px rgba(0,0,0,.5);
  pointer-events:none; z-index:60;
}
/* A FIXED SHAPE, so the card cannot resize once it is up: the poster is a
   bare image with no intrinsic size until its bytes land, and a card that
   grows under a moving pointer is the "it appears then corrects itself"
   fault. \`contain\` rather than \`cover\` because a preview that crops answers
   the question with part of the answer missing. */
${SCOPE} .skim-shot{
  position:relative; aspect-ratio:16/9; border-radius:7px; overflow:hidden;
  background:#05070a; box-shadow:inset 0 0 0 1px rgba(255,255,255,.07);
}
${SCOPE} .skim-shot img{
  width:100%; height:100%; object-fit:contain; display:block;
}
${SCOPE} .skim-name{
  font-size:11.5px; font-weight:500; color:#d8dfe9; letter-spacing:.01em;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
${SCOPE} .skim-meta{
  font-size:10.5px; color:#8b94a2; letter-spacing:.02em;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}

/* ── THE ACCENT IS OURS, NOT THE REFERENCE'S ─────────────────────────────
   \`--signal\` is the reference's selection teal (#3cdbc0). Ours is sky blue and
   it is load-bearing: PL15-026 runs the subject's blue from the film through to
   the minimap off ONE exported constant, and adopting a second accent would
   mean two colours claiming "this is the subject". Redefined here rather than
   edited into the extracted rules, so re-running the generator cannot quietly
   put the teal back. ──────────────────────────────────────────────────── */
${SCOPE}{ --signal: #38bdf8; --signal-soft: rgba(56, 189, 248, .14); }

/* ── THE PANEL'S EDGE IS A RING, NOT A BORDER ────────────────────────────
   The reference gives \`.playbar\` a 1px border. On a panel this wide that
   moves every row inside it in by a pixel, and the bar's rows are read against
   the cards below them — \`TheBarSpansTheFullWidth\` caught the ruler starting
   at 25 where it must start at 24, twice now, once on our own bar and once
   here. A ring is drawn rather than laid out, so the alignment survives.
   The lift and the top highlight are restated because replacing the shadow
   replaces all of it. ─────────────────────────────────────────────────── */
${SCOPE} .playbar{
  border: 0;
  box-shadow:
    inset 0 0 0 1px var(--stroke),
    inset 0 1px 0 rgba(255,255,255,.05),
    0 40px 90px -40px rgba(0,0,0,.9),
    0 8px 30px -18px rgba(0,0,0,.8);
}
`;

const file = `/**
 * THE REFERENCE DESIGN'S STYLESHEET, scoped for the ported components.
 *
 * GENERATED — do not edit by hand. Run
 * \`node punch-list/reference/generate-playbar-css.mjs\` after changing
 * \`punch-list/reference/storyboard-playbar.html\`.
 *
 * Extracted rather than retyped: the look is gradients, masks and custom
 * properties tuned to each other, and a hand translation would be a second
 * opinion about the design. The markup and the BEHAVIOUR are real React (see
 * \`film-strip.tsx\` and \`clip-deck.tsx\`); only the rules are carried over.
 *
 * Scoped under \`${SCOPE}\`, because the reference is a whole page — it sets
 * \`:root\` variables, resets \`*\` and paints \`body\`. Left alone it would reach
 * out of the component and into the rest of the app.
 *
 * The preview player, the coach mark, the keyboard hints and the content-area
 * header are dropped: those parts are not being ported.
 */
export const PLAYBAR_SCOPE = "pb";

/** Added ONLY by the standalone story: the page paint, centring and height
 *  that a component embedded in the app must not bring with it. */
export const PLAYBAR_PAGE_CLASS = "pb-page";

export const PLAYBAR_CSS = \`${css.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\`;
`;

fs.mkdirSync("apps/timeline-gstudio001/components/graph-view/playbar", { recursive: true });
fs.writeFileSync(OUT, file, "utf8");
console.log("wrote", OUT, file.length, "bytes");
