/**
 * THE REFERENCE DESIGN'S STYLESHEET, scoped for the ported components.
 *
 * GENERATED — do not edit by hand. Run
 * `node punch-list/reference/generate-playbar-css.mjs` after changing
 * `punch-list/reference/storyboard-playbar.html`.
 *
 * Extracted rather than retyped: the look is gradients, masks and custom
 * properties tuned to each other, and a hand translation would be a second
 * opinion about the design. The markup and the BEHAVIOUR are real React (see
 * `film-strip.tsx` and `clip-deck.tsx`); only the rules are carried over.
 *
 * Scoped under `.pb`, because the reference is a whole page — it sets
 * `:root` variables, resets `*` and paints `body`. Left alone it would reach
 * out of the component and into the rest of the app.
 *
 * The preview player, the coach mark, the keyboard hints and the content-area
 * header are dropped: those parts are not being ported.
 */
export const PLAYBAR_SCOPE = "pb";

/** Added ONLY by the standalone story: the page paint, centring and height
 *  that a component embedded in the app must not bring with it. */
export const PLAYBAR_PAGE_CLASS = "pb-page";

export const PLAYBAR_CSS = `.pb{
  --ink:        #08090d;   /* stage background            */
  --panel-hi:   #14181f;   /* bar surface, top            */
  --panel-lo:   #0b0d12;   /* bar surface, bottom         */
  --stroke:     rgba(255,255,255,.07);
  --groove:     rgba(255,255,255,.045);
  --slate:      #79828f;   /* quiet labels                */
  --slate-hi:   #aeb7c4;   /* emphasized labels           */
  --signal:     #38bdf8;   /* selection teal              */
  --signal-soft:rgba(56, 189, 248,.14);
  --alarm:      #ff5c5c;   /* playhead red (minimap)      */
  --chip:       #f3f6f9;   /* playhead timecode chip      */

  --mono: "Spline Sans Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --wide: "Martian Mono", var(--mono);

  --r-card: 12px;
  --pxs: 44px;             /* pixels per second (mirrored in JS) */
}
.pb *{ box-sizing:border-box; margin:0; padding:0; }
.pb.pb-page{ height:100%; }
.pb.pb-page{
  background:var(--ink);
  color:var(--slate);
  font-family:var(--mono);
  display:grid; place-items:center;
  overflow-x:hidden;
  -webkit-user-select:none; user-select:none;
}
.pb.pb-page::before{ /* faint stage light */
  content:""; position:fixed; inset:0; pointer-events:none;
  background:
    radial-gradient(60% 40% at 50% -5%, rgba(56, 189, 248,.05), transparent 70%),
    radial-gradient(70% 50% at 50% 115%, rgba(255,140,80,.04), transparent 70%);
}
.pb .stage{ width:100%; padding:44px 24px 40px; }
.pb .meta{
  position:relative;
  display:flex; justify-content:space-between; align-items:center;
  padding:0 6px 12px;
  font-family:var(--wide); font-size:9.5px; font-weight:600;
  letter-spacing:.22em; text-transform:uppercase; color:var(--slate);
}
.pb .meta .dot{
  display:inline-block; width:6px; height:6px; border-radius:50%;
  background:var(--signal); box-shadow:0 0 8px rgba(56, 189, 248,.7);
  margin-right:10px; vertical-align:1px;
  animation:pulse 2.6s ease-in-out infinite;
}
.pb .meta.playing .dot{ animation-duration:.9s; }
@keyframes pulse{ 0%,100%{opacity:.55} 50%{opacity:1} }
.pb .meta .sep{ color:#3a414b; padding:0 8px; }
.pb .meta-r{ color:#5b636f; font-weight:400; letter-spacing:.18em; }
.pb .playbar{
  position:relative;
  background:linear-gradient(180deg, var(--panel-hi), #0e1117 55%, var(--panel-lo));
  border:1px solid var(--stroke);
  border-radius:18px;
  padding:14px 0 12px;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.05),
    0 40px 90px -40px rgba(0,0,0,.9),
    0 8px 30px -18px rgba(0,0,0,.8);
}
.pb .viewport{
  overflow-x:auto; overflow-y:hidden;
  overscroll-behavior-x:contain;
  scrollbar-width:none;
  -webkit-mask-image:linear-gradient(90deg, transparent 0, #000 26px, #000 calc(100% - 26px), transparent 100%);
          mask-image:linear-gradient(90deg, transparent 0, #000 26px, #000 calc(100% - 26px), transparent 100%);
}
.pb .viewport::-webkit-scrollbar{ display:none; }
.pb .content{ position:relative; padding-bottom:14px; touch-action:none; }
.pb .ruler{ position:relative; height:40px; margin-bottom:10px; cursor:ew-resize; }
.pb .lane{ position:relative; height:26px; cursor:ew-resize; }
.pb .seclabel{
  position:absolute; top:4px; left:0; display:inline-flex; align-items:center; gap:6px;
  font-family:var(--wide); font-size:9px; font-weight:600;
  letter-spacing:.16em; text-transform:uppercase; color:#8b95a3;
  white-space:nowrap; cursor:pointer; transition:color .15s ease;
}
.pb .seclabel:hover{ color:#dbe2ea; }
.pb .seclabel svg{ width:11px; height:11px; opacity:.7; flex:none; }
.pb .rbase{
  position:absolute; bottom:0; height:2px; border-radius:1px;
  background:rgba(255,255,255,.08);
}
.pb .secdiv{
  position:absolute; top:24px; bottom:14px; width:1px; z-index:1;
  background:linear-gradient(180deg, rgba(255,255,255,.1), rgba(255,255,255,.04));
  pointer-events:none;
}
.pb .mm-sec{
  position:absolute; top:6px; bottom:2px; width:1px;
  background:rgba(255,255,255,.16); transform:translateX(-2px);
  pointer-events:none;
}
.pb .tick{ position:absolute; bottom:0; width:1px; background:rgba(150,160,175,.22); height:6px; }
.pb .tick.t2{ height:10px; background:rgba(150,160,175,.34); }
.pb .tick.t10{ height:15px; background:rgba(190,200,214,.5); }
.pb .tlabel{
  position:absolute; top:3px; transform:translateX(5px);
  font-size:10px; font-weight:500; letter-spacing:.05em; color:#69727f;
  pointer-events:none;
}
.pb .tlabel.big{ color:var(--slate-hi); font-weight:600; }
.pb .range{
  position:absolute; bottom:0; height:5px; border-radius:3px;
  background:linear-gradient(90deg, rgba(56, 189, 248,.75), var(--signal));
  box-shadow:0 0 12px rgba(56, 189, 248,.55), 0 0 2px rgba(56, 189, 248,.9);
  transition:left .28s cubic-bezier(.22,1,.3,1), width .28s cubic-bezier(.22,1,.3,1);
}
.pb .strip{ position:relative; height:150px; cursor:grab; }
.pb .strip.panning,.pb .strip.panning .shot{ cursor:grabbing; }
.pb .shot{
  position:absolute; top:0; height:100%;
  display:flex; overflow:hidden;
  border-radius:var(--r-card);
  background:#000;
  cursor:pointer;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.05),
    0 0 0 1px rgba(255,255,255,.09),
    0 10px 24px -14px rgba(0,0,0,.9);
  transition:box-shadow .18s ease, transform .18s ease;
}
.pb .shot:hover{
  transform:translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.07),
    0 0 0 1px rgba(255,255,255,.2),
    0 14px 28px -14px rgba(0,0,0,.95);
}
.pb .shot.selected{
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.08),
    0 0 0 1.5px var(--signal),
    0 0 0 5px var(--signal-soft),
    0 14px 34px -12px rgba(56, 189, 248,.35);
}
.pb .frame{ position:relative; height:100%; }
.pb .frame + .frame{ border-left:1px solid rgba(0,0,0,.7); }
.pb .frame::before{ /* lens vignette */
  content:""; position:absolute; inset:0;
  background:radial-gradient(130% 120% at 50% 42%, transparent 52%, rgba(0,0,0,.5) 100%);
}
.pb .frame::after{ /* film grain */
  content:""; position:absolute; inset:0; opacity:.13; pointer-events:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E");
  mix-blend-mode:overlay;
}
.pb .shot .tag{
  position:absolute; z-index:2; top:8px; left:9px;
  font-size:9px; font-weight:600; letter-spacing:.09em;
  color:#d7dde6; padding:3px 7px; border-radius:5px;
  background:rgba(8,10,14,.72);
  border:1px solid rgba(255,255,255,.09);
  backdrop-filter:blur(4px);
  opacity:0; transform:translateY(-2px);
  transition:opacity .18s ease, transform .18s ease;
  pointer-events:none; white-space:nowrap;
}
.pb .shot:hover .tag,.pb .shot.selected .tag{ opacity:1; transform:translateY(0); }
.pb .shot.selected .tag{ border-color:rgba(56, 189, 248,.45); color:#c8fff4; }
.pb .underline{
  position:absolute; bottom:-9px; height:3px; border-radius:2px;
  background:var(--signal);
  box-shadow:0 0 10px rgba(56, 189, 248,.6);
  transition:left .28s cubic-bezier(.22,1,.3,1), width .28s cubic-bezier(.22,1,.3,1);
}
.pb .ghost{
  position:absolute; top:26px; bottom:14px; width:1px; left:0;
  background:rgba(255,255,255,.16);
  opacity:0; pointer-events:none; z-index:5;
}
.pb .content:hover .ghost.on{ opacity:1; }
.pb .playhead{ position:absolute; top:0; bottom:14px; left:0; width:0; z-index:30; pointer-events:none; }
.pb .ph-line{
  position:absolute; top:27px; bottom:0; left:-1px; width:2px;
  background:linear-gradient(180deg, #fff, rgba(255,255,255,.35));
  box-shadow:0 0 10px rgba(255,255,255,.4);
}
.pb .ph-chip{
  position:absolute; top:0; left:0; transform:translateX(-50%);
  background:var(--chip); color:#0b0e13;
  font-size:10.5px; font-weight:600; letter-spacing:.03em;
  padding:3px 8px 2px; border-radius:6px;
  box-shadow:0 2px 10px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.25);
  pointer-events:auto; cursor:ew-resize; white-space:nowrap;
  transition:box-shadow .2s ease;
}
.pb .is-playing .ph-chip{ box-shadow:0 2px 10px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.25), 0 0 14px rgba(56, 189, 248,.45); }
.pb .ph-tri{
  position:absolute; top:20px; left:0; transform:translateX(-50%);
  width:0; height:0; border:5px solid transparent; border-bottom:none;
  border-top:6px solid var(--chip);
  filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));
}
.pb .area{
  background:linear-gradient(180deg, #10131a, #0b0d12);
  border:1px solid var(--stroke); border-radius:18px;
  padding:14px 16px 14px; overflow:hidden;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04), 0 40px 90px -40px rgba(0,0,0,.85);
}
.pb .clip.active .c-view{ cursor:pointer; }
.pb .playbar::before{
  content:""; position:absolute; left:0; right:0; top:0; height:82px;
  border-radius:18px 18px 0 0;
  background:linear-gradient(180deg, rgba(56, 189, 248,.055), rgba(56, 189, 248,0));
  opacity:0; transition:opacity .25s ease; pointer-events:none;
}
.pb .playbar.top-hot::before{ opacity:1; }
.pb .minimap{ padding:16px 22px 2px; }
.pb .mm-track{ position:relative; height:28px; cursor:pointer; touch-action:none; }
.pb .mm-track::before{ /* groove */
  content:""; position:absolute; left:0; right:0; top:10px; height:8px; border-radius:4px;
  background:rgba(255,255,255,.035);
  box-shadow:inset 0 1px 3px rgba(0,0,0,.6);
}
.pb .mm-shot{
  position:absolute; top:11px; height:6px; border-radius:3px;
  background:#343b45; pointer-events:none;
  transition:background .2s ease, box-shadow .2s ease;
}
.pb .mm-shot.inview{ background:#4c5561; }
.pb .mm-shot.sel{ background:var(--signal); box-shadow:0 0 8px rgba(56, 189, 248,.55); }
.pb .mm-window{
  position:absolute; top:3px; height:22px; border-radius:7px;
  background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.28);
  cursor:grab; z-index:3;
  transition:border-color .15s ease, background .15s ease;
}
.pb .mm-window:hover{ border-color:rgba(255,255,255,.45); background:rgba(255,255,255,.075); }
.pb .mm-track.dragging,.pb .mm-track.dragging .mm-window{ cursor:grabbing; }
.pb .mm-window::before,.pb .mm-window::after{
  content:""; position:absolute; top:50%; transform:translateY(-50%);
  width:3px; height:9px; border-radius:2px; background:rgba(255,255,255,.55);
  opacity:0; transition:opacity .15s ease;
}
.pb .mm-window::before{ left:4px; }
.pb .mm-window::after{ right:4px; }
.pb .mm-window:hover::before,.pb .mm-window:hover::after{ opacity:1; }
.pb .mm-ph{ position:absolute; top:1px; bottom:5px; width:2px; z-index:4; pointer-events:none;
  background:var(--alarm); box-shadow:0 0 8px rgba(255,92,92,.6); transform:translateX(-1px); }
.pb .mm-ph i{
  position:absolute; bottom:-8px; left:50%; transform:translateX(-50%);
  border:4px solid transparent; border-top:none; border-bottom:5px solid var(--alarm);
}
.pb .deck{
  position:relative; height:480px; margin:20px 0 4px;
  -webkit-mask-image:linear-gradient(90deg, transparent 0, #000 5%, #000 95%, transparent 100%);
          mask-image:linear-gradient(90deg, transparent 0, #000 5%, #000 95%, transparent 100%);
}
.pb .deck.dragging,.pb .deck.dragging .clip{ cursor:grabbing; }
.pb .clip{
  position:absolute; top:50%; left:50%; width:clamp(300px, 30vw, 440px);
  transform:translate(-50%,-50%);
  padding:12px 14px;
  background:linear-gradient(180deg, #141821, #0c0f14);
  border:1px solid rgba(255,255,255,.08); border-radius:16px;
  box-shadow:0 34px 80px -36px rgba(0,0,0,.95), inset 0 1px 0 rgba(255,255,255,.05);
  cursor:grab; will-change:transform, opacity, filter;
}
.pb .clip.active{
  border-color:rgba(255,255,255,.15);
  box-shadow:0 44px 96px -38px rgba(0,0,0,.98), 0 0 0 1px rgba(56, 189, 248,.12),
             0 0 34px -14px rgba(56, 189, 248,.35), inset 0 1px 0 rgba(255,255,255,.07);
}
.pb .cine{ position:relative; overflow:hidden; }
.pb .cine::before{
  content:""; position:absolute; inset:0;
  background:radial-gradient(130% 120% at 50% 42%, transparent 52%, rgba(0,0,0,.5) 100%);
}
.pb .cine::after{
  content:""; position:absolute; inset:0; opacity:.12; pointer-events:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E");
  mix-blend-mode:overlay;
}
.pb .c-head{ display:flex; align-items:center; gap:10px; }
.pb .c-id{ font-family:var(--wide); font-size:8.5px; font-weight:600; letter-spacing:.2em; text-transform:uppercase; color:#77808d; }
.pb .c-dur{ margin-left:auto; font-size:10.5px; color:#5d6570; }
.pb .c-dur b{ color:#e6ecf3; font-weight:600; }
.pb .c-dur i{ font-style:normal; color:#3c434d; padding:0 2px; }
.pb .c-menu{ background:none; border:0; color:#6a7380; font-size:15px; line-height:1; cursor:pointer; padding:2px 4px; border-radius:6px; }
.pb .c-menu:hover{ color:#cfd7e1; background:rgba(255,255,255,.06); }
.pb .c-title{ margin:7px 0 10px; font-size:12.5px; font-weight:500; color:#d3dae4; letter-spacing:.01em;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pb .c-view{ position:relative; aspect-ratio:2/1; border-radius:10px; overflow:hidden; background:#000; box-shadow:inset 0 0 0 1px rgba(255,255,255,.08); }
.pb .c-frame{ position:absolute; inset:0; }
.pb .c-bar{ display:flex; align-items:center; gap:12px; margin:9px 2px 8px; }
.pb .c-play{
  width:26px; height:26px; border-radius:50%; border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.05); color:#c6cfda; cursor:pointer;
  display:grid; place-items:center; padding:0; transition:border-color .15s ease, color .15s ease, box-shadow .15s ease;
}
.pb .c-play svg{ width:10px; height:10px; fill:currentColor; }
.pb .c-play:hover{ border-color:rgba(56, 189, 248,.5); color:var(--signal); }
.pb .clip.playing .c-play{ border-color:rgba(56, 189, 248,.6); color:var(--signal); box-shadow:0 0 12px -4px rgba(56, 189, 248,.6); }
.pb .c-cut,.pb .c-srct{ font-size:10px; color:#68717d; letter-spacing:.05em; }
.pb .c-cut b,.pb .c-srct b{ color:#dfe6ee; font-weight:600; }
.pb .c-srct{ margin-left:auto; }
.pb .c-strip{ position:relative; display:flex; height:48px; border-radius:8px; overflow:hidden; background:#05070a;
  box-shadow:0 0 0 1px rgba(255,255,255,.08); }
.pb .c-cell{ flex:1 1 0; }
.pb .c-shade{ position:absolute; top:0; bottom:0; background:rgba(4,6,9,.72); pointer-events:none; }
.pb .c-shade.l{ left:0; }
.pb .c-shade.r{ right:0; }
.pb .c-playline{ position:absolute; top:0; bottom:0; width:2px; background:var(--signal);
  box-shadow:0 0 8px rgba(56, 189, 248,.7); opacity:0; transition:opacity .15s ease; pointer-events:none; }
.pb .clip.playing .c-playline{ opacity:1; }
.pb .c-win{
  position:absolute; top:1px; bottom:1px; border-radius:7px;
  border:2px solid var(--chip); cursor:grab;
  box-shadow:0 0 0 1px rgba(0,0,0,.65), 0 2px 12px rgba(0,0,0,.5);
}
.pb .c-win:active{ cursor:grabbing; }
.pb .c-h{ position:absolute; top:0; bottom:0; width:11px; cursor:ew-resize; }
.pb .c-h.l{ left:-6px; }
.pb .c-h.r{ right:-6px; }
.pb .c-h::after{ content:""; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
  width:2px; height:12px; border-radius:1px; background:rgba(10,13,18,.85); }
.pb .c-io{ display:flex; align-items:center; gap:8px; margin-top:9px;
  font-size:9.5px; letter-spacing:.1em; color:#68717d; }
.pb .c-io input{
  width:62px; padding:3px 6px; text-align:center;
  font-family:var(--mono); font-size:11px; font-weight:600; color:var(--signal);
  background:#0a0d13; border:1px solid rgba(255,255,255,.1); border-radius:7px; outline:none;
}
.pb .c-io input:focus{ border-color:rgba(56, 189, 248,.55); }
.pb .c-io .arr{ color:#454c56; }
.pb .c-total{ margin-left:auto; font-size:11px; font-weight:600; color:#dfe6ee; letter-spacing:.02em; }
.pb .c-tags{ display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:10px; min-height:24px; }
.pb .chip{ display:inline-flex; align-items:center; gap:6px; padding:3px 5px 3px 9px; border-radius:7px;
  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.09);
  font-size:9.5px; letter-spacing:.05em; color:#bac3cf; }
.pb .chip .x{ background:none; border:0; padding:0 3px; color:#6b7480; font-size:11px; cursor:pointer; line-height:1; }
.pb .chip .x:hover{ color:#ff8585; }
.pb .c-add{ width:24px; height:22px; border-radius:7px; border:1px dashed rgba(255,255,255,.22);
  background:none; color:#77808d; font-size:12px; line-height:1; cursor:pointer; }
.pb .c-add:hover{ border-color:rgba(56, 189, 248,.55); color:var(--signal); }
.pb .c-tagin{ width:76px; padding:3px 7px; font-family:var(--mono); font-size:10px; color:#d5dce5;
  background:#0a0d13; border:1px solid rgba(56, 189, 248,.4); border-radius:7px; outline:none; }
.pb .c-win:hover{ box-shadow:0 0 0 1px rgba(0,0,0,.65), 0 2px 12px rgba(0,0,0,.5), 0 0 14px rgba(255,255,255,.22); }
.pb .clip:not(.active) .c-play,.pb .clip:not(.active) .c-menu,.pb .clip:not(.active) input,.pb .clip:not(.active) .c-tags{ pointer-events:none; }
@media (prefers-reduced-motion: reduce){.pb *,.pb *::before,.pb *::after{ transition:none !important; animation:none !important; }
}

/* ── Deviations from the reference, and why ──────────────────────────────
   1. \`grid-template-columns: minmax(0, 1fr)\`. The reference centres its stage
      with \`body{display:grid;place-items:center}\`. Scoped onto a div, an
      implicit \`auto\` track grows to fit a 5280px filmstrip — measured, the
      root was 1400px and the stage inside it 5364, so the viewport filled its
      own content and had NOTHING LEFT TO SCROLL. That is exactly "the strip
      will not pan". \`body\` is sized by the initial containing block and never
      had the problem; a div needs the track bounded.
   2. A viewport minimum, because \`html,body{height:100%}\` became
      \`.pb{height:100%}\` and a percentage height needs a parent that has
      one. ─────────────────────────────────────────────────────────────── */
.pb.pb-page{ grid-template-columns: minmax(0, 1fr); min-height: 100%; }

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
.pb{ -webkit-user-select: none; user-select: none; }
.pb .deck{ touch-action: none; }

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
.pb .strip .shot{ cursor: grab; }

/* ── THE PLAYHEAD CHIP CARRIES THE MONITOR ───────────────────────────────
   The chip is the moment the preview pane is showing, so it wears the pane's
   own glyph — the same one the Preview toggle uses, not a second icon meaning
   the same thing. \`currentColor\` so it is the chip's ink and cannot drift
   from the numerals beside it; a hair below the cap height so it reads as a
   mark on the chip rather than a button in it. ─────────────────────────── */
.pb .ph-chip{
  display:inline-flex; align-items:center; gap:5px;
  /* BIGGER THAN THE REFERENCE'S. Its chip is a 10.5px numeral in a page that
     also has a player showing the same time; here it is the only readout of
     where the playhead is, and it now carries the monitor mark as well. */
  font-size:13px; padding:5px 10px 4px; border-radius:7px;
}
.pb .ph-tv{ width:12px; height:12px; flex:none; opacity:.85; }
/* THE STEM FOLLOWS THE CHIP. Both offsets are measured from the chip's lower
   edge in the reference — the arrow one pixel into it, the line six below —
   so growing the chip without moving these leaves the arrow buried in it and
   the line starting inside the label. Restated against the new height rather
   than nudged. */
.pb .ph-tri{ top:28px; }
.pb .ph-line{ top:35px; }

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
.pb .clip{ width: var(--clip-w, clamp(300px, 30vw, 440px)); }

/* ── AND THE STRIP GIVES A LITTLE BEFORE THE CARD GIVES A LOT ────────────
   150px of film is generous on a short window, and the bar is the one part
   whose job survives being shorter — a shot box still reads as a shot box at
   112px. Ahead of the card in the order of concessions because the card is
   where the text lives. Only ever SHRINKS: at any comfortable height this
   resolves to the reference's own 150px. ─────────────────────────────────── */
.pb .strip{ height: var(--strip-h, 150px); }

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
.pb .skim{
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
.pb .skim-shot{
  position:relative; aspect-ratio:16/9; border-radius:7px; overflow:hidden;
  background:#05070a; box-shadow:inset 0 0 0 1px rgba(255,255,255,.07);
}
.pb .skim-shot img{
  width:100%; height:100%; object-fit:contain; display:block;
}
.pb .skim-name{
  font-size:11.5px; font-weight:500; color:#d8dfe9; letter-spacing:.01em;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.pb .skim-meta{
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
.pb{ --signal: #38bdf8; --signal-soft: rgba(56, 189, 248, .14); }

/* ── THE PANEL'S EDGE IS A RING, NOT A BORDER ────────────────────────────
   The reference gives \`.playbar\` a 1px border. On a panel this wide that
   moves every row inside it in by a pixel, and the bar's rows are read against
   the cards below them — \`TheBarSpansTheFullWidth\` caught the ruler starting
   at 25 where it must start at 24, twice now, once on our own bar and once
   here. A ring is drawn rather than laid out, so the alignment survives.
   The lift and the top highlight are restated because replacing the shadow
   replaces all of it. ─────────────────────────────────────────────────── */
.pb .playbar{
  border: 0;
  box-shadow:
    inset 0 0 0 1px var(--stroke),
    inset 0 1px 0 rgba(255,255,255,.05),
    0 40px 90px -40px rgba(0,0,0,.9),
    0 8px 30px -18px rgba(0,0,0,.8);
}
`;
