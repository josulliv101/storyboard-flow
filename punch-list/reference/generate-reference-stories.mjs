// Generates the two reference stories from the vendored artifact source.
// Run once; the output is committed. Kept in the scratchpad because it is a
// one-shot transform, not part of the build.
import fs from "node:fs";

const SRC = "punch-list/reference/storyboard-playbar.html";
const OUT =
  "apps/timeline-gstudio001/components/graph-view/graph-playbar-reference.stories.tsx";
const SCOPE = ".sbref";

const html = fs.readFileSync(SRC, "utf8");
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const body = html.match(/<body>([\s\S]*?)<script>/)[1];
const script = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

/* ── scope the stylesheet ──────────────────────────────────────────────── */

// Walk top-level rules so @media can be recursed into and @keyframes left
// alone (its "0%,100%" are not selectors and must not be prefixed).
function scope(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const braceAt = css.indexOf("{", i);
    if (braceAt === -1) {
      out += css.slice(i);
      break;
    }
    const prelude = css.slice(i, braceAt);
    // Match the block, counting nesting.
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
    const trimmed = prelude.trim();

    if (/^@keyframes/i.test(trimmed)) {
      out += prelude + "{" + inner + "}";
    } else if (/^@/.test(trimmed)) {
      out += prelude + "{" + scope(inner) + "}";
    } else {
      out += scopeSelector(prelude) + "{" + inner + "}";
    }
    i = j + 1;
  }
  return out;
}

function scopeSelector(prelude) {
  // Comments before a selector are kept where they are.
  const commentMatch = prelude.match(/^([\s\S]*?\*\/)?([\s\S]*)$/);
  const lead = commentMatch[1] ?? "";
  const selectors = commentMatch[2];
  const scoped = selectors
    .split(",")
    .map((raw) => {
      const sel = raw.trim();
      if (sel === "") return raw;
      // The page-level selectors all become the scope element itself.
      if (sel === ":root" || sel === "html" || sel === "body") return SCOPE;
      if (/^body(::?[a-z-]+)/.test(sel)) return SCOPE + sel.slice("body".length);
      if (sel === "*") return SCOPE + " *";
      if (/^\*(::?[a-z-]+)/.test(sel)) return SCOPE + " " + sel;
      return SCOPE + " " + sel;
    })
    .filter((s, idx, all) => all.indexOf(s) === idx)
    .join(",");
  return lead + scoped;
}

const scopedCss = scope(style);

/* ── slice the markup ──────────────────────────────────────────────────── */

const between = (start, end) => {
  const a = body.indexOf(start);
  const b = body.indexOf(end, a);
  if (a === -1 || b === -1) throw new Error("slice not found: " + start);
  return body.slice(a, b + end.length);
};

const meta = between('<div class="meta">', "</div>\n  </div>").replace(
  /<div class="coach"[\s\S]*?<\/div>/,
  "",
);
const playbar = between('<section class="playbar"', "</section>");
const deck = between('<section class="deck"', "</section>");
const areaHead = between('<header class="area-head">', "</header>").replace(
  /<button class="a-preview"[\s\S]*?<\/button>|<button class="a-preview on"[\s\S]*?<\/button>/,
  "",
);

const filmstripMarkup = `<main class="stage"><section class="area">${meta}${playbar}</section></main>`;
const deckMarkup = `<main class="stage"><section class="area">${areaHead}${deck}</section></main>`;

/* ── the script, made tolerant of a sliced DOM ─────────────────────────── */

const OLD_LOOKUP = "const $ = id => document.getElementById(id);";
if (!script.includes(OLD_LOOKUP)) throw new Error("lookup helper not found");
const SHIM = fs.readFileSync("punch-list/reference/reference-stories-shim.js", "utf8");
const patchedScript = script.replace(OLD_LOOKUP, SHIM);

/* ── emit ──────────────────────────────────────────────────────────────── */

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const file = `import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useRef } from "react";

/**
 * THE REFERENCE DESIGN, RUNNING (PL15-030).
 *
 * Not our implementation and not a re-implementation: this is the artifact's
 * own markup, stylesheet and script, sliced into its two halves and mounted in
 * Storybook so the target can be opened beside what we build. Generated from
 * \`punch-list/reference/storyboard-playbar.html\`, which is the readable source
 * the owner supplied.
 *
 * WHY VERBATIM RATHER THAN PORTED. A port is a second opinion about what the
 * design is, and the whole value of a target is that it is not one. Running the
 * original means "does ours match?" is answered by looking, not by trusting
 * that the port was faithful.
 *
 * THE PREVIEW PANEL IS REMOVED, as asked. It also carried the seek bar, the
 * transport and the timecode — those five buttons live inside \`.player\` in the
 * reference — so they go with it. The playbar keeps its own playhead, ruler and
 * minimap, and the deck keeps its per-clip play buttons.
 *
 * THE STYLESHEET IS SCOPED under \`.sbref\`. The reference is a whole page: it
 * sets \`:root\` variables, resets \`*\`, and paints \`body\`. Left alone it would
 * reach out of the story and into every other one sharing the runner's page.
 * \`:root\`/\`html\`/\`body\` become the scope element; everything else is prefixed.
 *
 * NO \`play\` FUNCTION, deliberately. These are a design target, not an assertion
 * about our code — and a story that runs a play function on load is one the e2e
 * suite cannot drive (see the note in CLAUDE.md).
 */
const REFERENCE_CSS = \`${esc(scopedCss)}\`;

const REFERENCE_SCRIPT = \`${esc(patchedScript)}\`;

const FILMSTRIP_MARKUP = \`${esc(filmstripMarkup)}\`;

const DECK_MARKUP = \`${esc(deckMarkup)}\`;

function ReferenceSlice({ markup }: Readonly<{ markup: string }>) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    // The reference's own script, run against this slice. \`new Function\` rather
    // than an import because it is 845 lines of page script with top-level
    // statements — wrapping it in a module would be the first edit, and the
    // point of this story is that there are none.
    const run = new Function(REFERENCE_SCRIPT);
    try {
      run();
    } catch (error) {
      // A slice missing something the script insists on should show as an empty
      // panel, not a blank Storybook with a console nobody opened.
      host.setAttribute("data-reference-error", String(error));
    }
  }, []);

  return (
    <>
      <style>{REFERENCE_CSS}</style>
      <div
        ref={hostRef}
        className="sbref"
        // \`html,body{height:100%}\` in the reference became \`.sbref{height:100%}\`
        // when the sheet was scoped, and a percentage height needs a parent that
        // has one — Storybook's root does not, so the stage collapsed to its
        // content and the page showed through white beneath it. A viewport
        // minimum is what \`body\` had by definition.
        style={{ minHeight: "100vh" }}
        // The reference's own markup. Static, from a file in this repo, and the
        // only way to mount it without re-typing it as JSX — which would be the
        // port this story exists to avoid.
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    </>
  );
}

const meta: Meta<typeof ReferenceSlice> = {
  title: "graph-view/PlaybarReference",
  component: ReferenceSlice,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof ReferenceSlice>;

/**
 * THE FILM STRIP: the meta line, the ruler and its section lanes, the strip of
 * shots, the playhead with its timecode chip, and the minimap beneath.
 *
 * Live: hover or drag the ruler to scrub, flick the strip to pan with inertia,
 * drag the minimap window, click it to jump, and press space to play.
 */
export const FilmStrip: Story = {
  render: () => <ReferenceSlice markup={FILMSTRIP_MARKUP} />,
};

/**
 * THE THREE-UP CLIP DISPLAY: the deck, centre card active, with each clip's own
 * frame, duration, source time and trim strip.
 *
 * Live: swipe or tap a card to make it the centre one, and use a card's own
 * play button to run that clip.
 */
export const ClipDisplay: Story = {
  render: () => <ReferenceSlice markup={DECK_MARKUP} />,
};
`;

fs.writeFileSync(OUT, file, "utf8");
console.log("wrote", OUT, file.length, "bytes");
