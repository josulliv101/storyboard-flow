# Punch List 11

## PL11-001 — Lighter icon strokes, white logo

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `timeline-sidebar.tsx`
- Screenshot: Not captured

At 28px the rail's glyphs carried too much stroke — lucide's default 2 reads
heavy once the icon is that big. Every rail glyph is now 1.5.

Set in CSS (`[stroke-width:1.5]` on the shared glyph class) rather than as a
prop on each icon: `stroke-width` is an INHERITED SVG property, so one class
covers every lucide icon the rail renders. The two composed folder icons keep
their own explicit widths — a presentation attribute on an element beats an
inherited value — so those were lightened by hand: the folder to 1.5, and
their corner badges to 1.9 (a little heavier, because at 16px inside a 24px
badge 1.5 disappears).

The logo's "SW" is white rather than zinc-400, with the hover a step down
instead of up.

Acceptance criteria:

- Every rail glyph computes to 1.5px stroke.
- The badge marks stay legible at their size.
- The logo renders pure white.

Verified live: `getComputedStyle(svg).strokeWidth` is 1.5px on the rail's
lucide glyphs (their `stroke-width` ATTRIBUTE is still 2 — the CSS wins),
1.5px on the folders, 1.9px on the badges, and the logo computes to
rgb(255, 255, 255).
