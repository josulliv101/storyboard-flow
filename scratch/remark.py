#!/usr/bin/env python3
"""Re-lift the shipped monster animation into the frame-by-frame artifact page.

    python scratch/remark.py [--check]

The page at `scratch/monster-jump-frames.html` is a contact sheet of the rail
toggle's jump: every cell is a REAL creature with the shipped keyframes paused
at its own millisecond. That only means anything if the keyframes on the page
are the ones the app ships, so they are not typed there — they are copied out
of `globals.css` and `timeline-sidebar.tsx` by this script, into two marked
regions the page treats as machine-written.

WHY THE SCRIPT EXISTS AT ALL, rather than a note saying "keep these in sync":
it already drifted. The page carried the six-stop opening arc for a day after
the shipped one grew to eleven stops and a sampled descent, and it ran that arc
on `linear` while the app ran it on the closing cubic-bezier. Both are exactly
the kind of thing the page is FOR, and neither is visible by looking at it.

WHAT IS LIFTED, and the rule for each:

  CSS   every top-level rule whose selector mentions `[data-storyboard-monster]`,
        the `--sw-antenna-bend` property registration, and the named keyframe
        sets below. Comments are dropped — the page has its own prose, and the
        stylesheet's is written for someone editing it.

  JS    each direction's keyframe name, the clock between its stops, and its
        travel curve, read out of the `CLOSING` / `OPENING` literals in the
        sidebar. Those three are one setting in three parts; the page needs all
        of them or it draws an arc the app never runs.

THE ONE RULE THAT IS REWRITTEN rather than copied is
`[data-storyboard-monster][data-settling]`, the untwist. In the app it sits on
the mark; on the page the mark is inside a `.rig` that carries the flight
transform, so it is re-emitted as `.rig.settling` with its duration and easing
intact. Same for the flight itself, which the app expresses as custom
properties on `::view-transition-old/new` and the page as `.rig.flying`.

`--check` exits non-zero if the page is out of date, without writing to it.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "apps/timeline-gstudio001/app/globals.css"
SIDEBAR = ROOT / "apps/timeline-gstudio001/components/timeline/timeline-sidebar.tsx"
PAGE = ROOT / "scratch/monster-jump-frames.html"

# The sets the page pauses. `sw-monster-depart` / `-arrive` are deliberately
# absent: they are the opacity cross-fade between two view-transition snapshots,
# which the page cannot have (it has one element, not two images). It
# approximates the handover by swapping the departure pose for the arrival one
# at the same 72%.
KEYFRAMES = [
    "sw-monster-hop",
    "sw-monster-hop-open",
    "sw-monster-untwist",
    "sw-pupil-saccade",
    "sw-pupil-constrict",
    "sw-pupil-bob",
    "sw-foot-settle",
    "sw-body-settle",
    "sw-antennae-settle",
]

# Re-emitted against the page's own rig instead of copied — see the module note.
REWRITTEN = "[data-storyboard-monster][data-settling]"


def strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    # Collapse the runs of blank lines the comments left behind, but keep the
    # single blank line that separates one rule from the next.
    text = re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", text)
    return re.sub(r"[ \t]+\n", "\n", text)


def block_at(text: str, open_brace: int) -> int:
    """Index just past the `}` matching the `{` at `open_brace`."""
    depth = 0
    for i in range(open_brace, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return i + 1
    raise SystemExit("remark: unbalanced braces in the stylesheet")


def top_level_rules(css: str):
    """Yield (selector, rule text) for every rule starting at column 0.

    Column 0 is what keeps the reduced-motion guard out: its copies of these
    same selectors are indented inside an `@media`, and the page ships its own.

    A SELECTOR IS NOT A LINE, which is what the first version of this assumed
    and what cost an hour. Two of the rules here are a comma-separated list
    split across lines, and one has a comment between the two halves; matching
    up to the first `{` on a single line silently dropped `[data-monster-body]`
    from the settle and both flight foot poses entirely — a page where the fur
    squashed and the head it is masked to did not. So the text is de-commented
    first and the selector is allowed to run over newlines, and it is
    re-emitted one selector per line rather than however the source wrapped it.
    """
    # `[^\s@]` rather than `[^ \t@]`: a BLANK line is a line start too, and one
    # sitting above an indented rule let a selector match run down into the
    # reduced-motion guard and lift ITS overrides — the rules whose whole job is
    # to switch this animation off.
    for m in re.finditer(r"^(?=[^\s@])([^{};]+?)\s*\{", css, flags=re.M):
        end = block_at(css, m.end() - 1)
        parts = [p.strip() for p in m.group(1).split(",")]
        selector = ",\n".join(" ".join(p.split()) for p in parts)
        yield selector, selector + " " + css[m.end() - 1 : end]


def at_rule(css: str, prelude: str) -> str:
    m = re.search(r"^" + re.escape(prelude) + r"\s*\{", css, flags=re.M)
    if not m:
        raise SystemExit("remark: `" + prelude + "` is gone from " + CSS.name)
    return css[m.start() : block_at(css, m.end() - 1)]


def declaration(rule: str, prop: str) -> str:
    m = re.search(re.escape(prop) + r"\s*:\s*(.+?);", rule, flags=re.S)
    if not m:
        raise SystemExit("remark: no `" + prop + "` in " + repr(rule[:60]))
    return " ".join(m.group(1).split())


def jump_arcs(tsx: str) -> dict:
    """The two `JumpArc` literals, with `CLOSING.x` back-references resolved."""
    arcs: dict = {}
    for name in ("CLOSING", "OPENING"):
        m = re.search(r"const " + name + r": JumpArc = \{(.*?)\n\};", tsx, flags=re.S)
        if not m:
            raise SystemExit("remark: no `" + name + "` literal in " + SIDEBAR.name)
        body = strip_comments(m.group(1))
        fields: dict = {}
        for key in ("hop", "hopEase", "travel", "travelMs"):
            f = re.search(key + r":\s*(.+?),\n", body, flags=re.S)
            if not f:
                raise SystemExit("remark: `" + name + "." + key + "` is missing")
            raw = f.group(1).strip()
            if raw.startswith("CLOSING."):
                fields[key] = arcs["CLOSING"][raw.split(".", 1)[1]]
                continue
            # A string literal, possibly concatenated across several lines.
            parts = re.findall(r'"((?:[^"\\]|\\.)*)"', raw)
            if not parts:
                raise SystemExit(
                    "remark: `" + name + "." + key + "` is not a string literal"
                )
            fields[key] = " ".join("".join(parts).split())
        arcs[name] = fields
    return {"open": arcs["OPENING"], "close": arcs["CLOSING"]}


def flight_ms(css: str) -> str:
    """The hop's duration, off the `::view-transition-old` shorthand."""
    m = re.search(r"var\(--sw-hop-name,[^)]*\)\s*(\d+)ms", strip_comments(css))
    if not m:
        raise SystemExit("remark: could not read the flight duration")
    return m.group(1)


def build_css(css: str, arcs: dict) -> str:
    out = []
    settle = ""
    for selector, rule in top_level_rules(strip_comments(css)):
        if "[data-storyboard-monster]" not in selector:
            continue
        if selector == REWRITTEN:
            settle = declaration(rule, "animation")
            continue
        out.append(rule.strip())
    if not settle:
        raise SystemExit("remark: `" + REWRITTEN + "` is gone from " + CSS.name)

    # A DROPPED RULE LOOKS LIKE A DESIGN CHOICE, which is why these are checked
    # by hand. Each is a part that has to move WITH something else, so losing
    # one leaves the page rendering a creature that comes apart in a way the
    # app never does — and rendering it confidently.
    body = "\n".join(out)
    for needed in (
        "[data-monster-body]",  # squashes with the fur, or the ring shows
        '[data-monster-foot="left"]',  # the flight poses; both or neither
        '[data-monster-foot="right"]',
    ):
        if needed not in body:
            raise SystemExit("remark: `" + needed + "` did not survive the lift")

    out.append(strip_comments(at_rule(css, "@property --sw-antenna-bend")).strip())
    for name in KEYFRAMES:
        out.append(strip_comments(at_rule(css, "@keyframes " + name)).strip())

    ms = flight_ms(css) + "ms"
    out.append(
        "/* THE FLIGHT, off the two directions' own settings. Each arc is a\n"
        "   keyframe set AND the clock between its stops: an\n"
        "   `animation-timing-function` applies between every PAIR of keyframes,\n"
        "   so it shapes the arc rather than finishing it, and neither direction\n"
        "   survives being given the other's. The app picks the same pair by\n"
        "   direction in `timeline-sidebar.tsx`. */\n"
        ".rig.flying {\n  animation: "
        + arcs["open"]["hop"] + " " + ms + " " + arcs["open"]["hopEase"] + " both;\n}\n\n"
        ".rig.dir-close.flying {\n  animation: "
        + arcs["close"]["hop"] + " " + ms + " " + arcs["close"]["hopEase"] + " both;\n}"
    )
    out.append(
        "/* The untwist, which the app runs on the mark itself. Here the mark is\n"
        "   inside a rig that carries the flight transform, so it moves up one\n"
        "   element; the duration and the easing are the shipped ones. */\n"
        ".rig.settling {\n  animation: " + settle + ";\n}"
    )
    return "\n\n".join(out)


def build_js(arcs: dict, ms: str) -> str:
    def row(which: str) -> str:
        a = arcs[which]
        return (
            "  " + which + ": {\n"
            '    hop: "' + a["hop"] + '",\n'
            '    ease: "' + a["hopEase"] + '",\n'
            '    travel: "' + a["travel"] + '",\n'
            "    travelMs: " + a["travelMs"].removesuffix("ms") + ",\n"
            "  },"
        )

    return (
        "/* Each direction is three settings that only mean anything together --\n"
        "   the keyframes, the clock between them, and how the ground goes by\n"
        "   underneath. Lifted from the sidebar's `OPENING` and `CLOSING`\n"
        "   literals; the flight's own duration comes off `globals.css`. */\n"
        "var ARCS = {\n" + row("open") + "\n" + row("close") + "\n};\n"
        "var FLIGHT = " + ms + ";"
    )


def splice(page: str, marker: str, body: str) -> str:
    """Replace one marked region, keeping the indentation its opener sits at."""
    start, end = "/* " + marker + "_START */", "/* " + marker + "_END */"
    a, b = page.find(start), page.find(end)
    if a < 0 or b < 0:
        raise SystemExit("remark: the page has no " + marker + " markers")
    pad = page[page.rfind("\n", 0, a) + 1 : a]
    lines = [pad + line if line.strip() else line for line in body.split("\n")]
    return page[: a + len(start)] + "\n" + "\n".join(lines) + "\n" + pad + page[b:]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report drift, write nothing")
    args = ap.parse_args()

    css = CSS.read_text(encoding="utf-8")
    tsx = SIDEBAR.read_text(encoding="utf-8")
    page = PAGE.read_text(encoding="utf-8")
    arcs = jump_arcs(tsx)

    updated = splice(page, "SW_LIFTED", build_css(css, arcs))
    updated = splice(updated, "SW_ARCS", build_js(arcs, flight_ms(css)))

    if updated == page:
        print("remark: the page is current")
        return 0
    if args.check:
        print("remark: the page is STALE — run `python scratch/remark.py`")
        return 1
    PAGE.write_text(updated, encoding="utf-8")
    print("remark: rewrote " + str(PAGE.relative_to(ROOT)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
