// Extracts the reference stylesheet into a scoped module for the ported
// components. Run from the repo root:
//   node punch-list/reference/generate-playbar-css.mjs
import fs from "node:fs";

const SRC = "punch-list/reference/storyboard-playbar.html";
const OUT = "apps/timeline-gstudio001/components/graph-view/playbar/playbar-styles.ts";
const SCOPE = ".pb";

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
            if (sel === ":root" || sel === "html" || sel === "body") return SCOPE;
            if (/^body(::?[a-z-]+)/.test(sel)) return SCOPE + sel.slice(4);
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

const css =
  walk(style) +
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
${SCOPE}{ grid-template-columns: minmax(0, 1fr); min-height: 100%; }
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

export const PLAYBAR_CSS = \`${css.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\`;
`;

fs.mkdirSync("apps/timeline-gstudio001/components/graph-view/playbar", { recursive: true });
fs.writeFileSync(OUT, file, "utf8");
console.log("wrote", OUT, file.length, "bytes");
