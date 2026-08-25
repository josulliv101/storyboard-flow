import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useRef } from "react";

/**
 * THE REFERENCE DESIGN, RUNNING (PL15-030).
 *
 * Not our implementation and not a re-implementation: this is the artifact's
 * own markup, stylesheet and script, sliced into its two halves and mounted in
 * Storybook so the target can be opened beside what we build. Generated from
 * `punch-list/reference/storyboard-playbar.html`, which is the readable source
 * the owner supplied.
 *
 * WHY VERBATIM RATHER THAN PORTED. A port is a second opinion about what the
 * design is, and the whole value of a target is that it is not one. Running the
 * original means "does ours match?" is answered by looking, not by trusting
 * that the port was faithful.
 *
 * THE PREVIEW PANEL IS REMOVED, as asked. It also carried the seek bar, the
 * transport and the timecode — those five buttons live inside `.player` in the
 * reference — so they go with it. The playbar keeps its own playhead, ruler and
 * minimap, and the deck keeps its per-clip play buttons.
 *
 * THE STYLESHEET IS SCOPED under `.sbref`. The reference is a whole page: it
 * sets `:root` variables, resets `*`, and paints `body`. Left alone it would
 * reach out of the story and into every other one sharing the runner's page.
 * `:root`/`html`/`body` become the scope element; everything else is prefixed.
 *
 * NO `play` FUNCTION, deliberately. These are a design target, not an assertion
 * about our code — and a story that runs a play function on load is one the e2e
 * suite cannot drive (see the note in CLAUDE.md).
 */
const REFERENCE_CSS = `
/* ============================================================
   TOKENS — restyle the whole component from here
   ============================================================ */.sbref{
  --ink:        #08090d;   /* stage background            */
  --panel-hi:   #14181f;   /* bar surface, top            */
  --panel-lo:   #0b0d12;   /* bar surface, bottom         */
  --stroke:     rgba(255,255,255,.07);
  --groove:     rgba(255,255,255,.045);
  --slate:      #79828f;   /* quiet labels                */
  --slate-hi:   #aeb7c4;   /* emphasized labels           */
  --signal:     #3cdbc0;   /* selection teal              */
  --signal-soft:rgba(60,219,192,.14);
  --alarm:      #ff5c5c;   /* playhead red (minimap)      */
  --chip:       #f3f6f9;   /* playhead timecode chip      */

  --mono: "Spline Sans Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --wide: "Martian Mono", var(--mono);

  --r-card: 12px;
  --pxs: 44px;             /* pixels per second (mirrored in JS) */
}.sbref *{ box-sizing:border-box; margin:0; padding:0; }.sbref{ height:100%; }.sbref{
  background:var(--ink);
  color:var(--slate);
  font-family:var(--mono);
  display:grid; place-items:center;
  overflow-x:hidden;
  -webkit-user-select:none; user-select:none;
}.sbref::before{ /* faint stage light */
  content:""; position:fixed; inset:0; pointer-events:none;
  background:
    radial-gradient(60% 40% at 50% -5%, rgba(60,219,192,.05), transparent 70%),
    radial-gradient(70% 50% at 50% 115%, rgba(255,140,80,.04), transparent 70%);
}.sbref .stage{ width:100%; padding:44px 24px 40px; }

/* ---------- meta strip above the bar ---------- */.sbref .meta{
  position:relative;
  display:flex; justify-content:space-between; align-items:center;
  padding:0 6px 12px;
  font-family:var(--wide); font-size:9.5px; font-weight:600;
  letter-spacing:.22em; text-transform:uppercase; color:var(--slate);
}.sbref .meta .dot{
  display:inline-block; width:6px; height:6px; border-radius:50%;
  background:var(--signal); box-shadow:0 0 8px rgba(60,219,192,.7);
  margin-right:10px; vertical-align:1px;
  animation:pulse 2.6s ease-in-out infinite;
}.sbref .meta.playing .dot{ animation-duration:.9s; }
@keyframes pulse{ 0%,100%{opacity:.55} 50%{opacity:1} }.sbref .meta .sep{ color:#3a414b; padding:0 8px; }.sbref .meta-r{ color:#5b636f; font-weight:400; letter-spacing:.18em; }

/* ---------- the playbar shell ---------- */.sbref .playbar{
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

/* ---------- scrolling viewport ---------- */.sbref .viewport{
  overflow-x:auto; overflow-y:hidden;
  overscroll-behavior-x:contain;
  scrollbar-width:none;
  -webkit-mask-image:linear-gradient(90deg, transparent 0, #000 26px, #000 calc(100% - 26px), transparent 100%);
          mask-image:linear-gradient(90deg, transparent 0, #000 26px, #000 calc(100% - 26px), transparent 100%);
}.sbref .viewport::-webkit-scrollbar{ display:none; }.sbref .content{ position:relative; padding-bottom:14px; touch-action:none; }

/* ---------- ruler ---------- */.sbref .ruler{ position:relative; height:40px; margin-bottom:10px; cursor:ew-resize; }
/* ---------- labeled sections ---------- */.sbref .lane{ position:relative; height:26px; cursor:ew-resize; }.sbref .seclabel{
  position:absolute; top:4px; left:0; display:inline-flex; align-items:center; gap:6px;
  font-family:var(--wide); font-size:9px; font-weight:600;
  letter-spacing:.16em; text-transform:uppercase; color:#8b95a3;
  white-space:nowrap; cursor:pointer; transition:color .15s ease;
}.sbref .seclabel:hover{ color:#dbe2ea; }.sbref .seclabel svg{ width:11px; height:11px; opacity:.7; flex:none; }.sbref .rbase{
  position:absolute; bottom:0; height:2px; border-radius:1px;
  background:rgba(255,255,255,.08);
}.sbref .secdiv{
  position:absolute; top:24px; bottom:14px; width:1px; z-index:1;
  background:linear-gradient(180deg, rgba(255,255,255,.1), rgba(255,255,255,.04));
  pointer-events:none;
}.sbref .mm-sec{
  position:absolute; top:6px; bottom:2px; width:1px;
  background:rgba(255,255,255,.16); transform:translateX(-2px);
  pointer-events:none;
}.sbref .tick{ position:absolute; bottom:0; width:1px; background:rgba(150,160,175,.22); height:6px; }.sbref .tick.t2{ height:10px; background:rgba(150,160,175,.34); }.sbref .tick.t10{ height:15px; background:rgba(190,200,214,.5); }.sbref .tlabel{
  position:absolute; top:3px; transform:translateX(5px);
  font-size:10px; font-weight:500; letter-spacing:.05em; color:#69727f;
  pointer-events:none;
}.sbref .tlabel.big{ color:var(--slate-hi); font-weight:600; }

/* selected-shot range capsule on the ruler */.sbref .range{
  position:absolute; bottom:0; height:5px; border-radius:3px;
  background:linear-gradient(90deg, rgba(60,219,192,.75), var(--signal));
  box-shadow:0 0 12px rgba(60,219,192,.55), 0 0 2px rgba(60,219,192,.9);
  transition:left .28s cubic-bezier(.22,1,.3,1), width .28s cubic-bezier(.22,1,.3,1);
}

/* ---------- filmstrip ---------- */.sbref .strip{ position:relative; height:150px; cursor:grab; }.sbref .strip.panning,.sbref .strip.panning .shot{ cursor:grabbing; }.sbref .shot{
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
}.sbref .shot:hover{
  transform:translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.07),
    0 0 0 1px rgba(255,255,255,.2),
    0 14px 28px -14px rgba(0,0,0,.95);
}.sbref .shot.selected{
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.08),
    0 0 0 1.5px var(--signal),
    0 0 0 5px var(--signal-soft),
    0 14px 34px -12px rgba(60,219,192,.35);
}.sbref .frame{ position:relative; height:100%; }.sbref .frame + .frame{ border-left:1px solid rgba(0,0,0,.7); }.sbref .frame::before{ /* lens vignette */
  content:""; position:absolute; inset:0;
  background:radial-gradient(130% 120% at 50% 42%, transparent 52%, rgba(0,0,0,.5) 100%);
}.sbref .frame::after{ /* film grain */
  content:""; position:absolute; inset:0; opacity:.13; pointer-events:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E");
  mix-blend-mode:overlay;
}.sbref .shot .tag{
  position:absolute; z-index:2; top:8px; left:9px;
  font-size:9px; font-weight:600; letter-spacing:.09em;
  color:#d7dde6; padding:3px 7px; border-radius:5px;
  background:rgba(8,10,14,.72);
  border:1px solid rgba(255,255,255,.09);
  backdrop-filter:blur(4px);
  opacity:0; transform:translateY(-2px);
  transition:opacity .18s ease, transform .18s ease;
  pointer-events:none; white-space:nowrap;
}.sbref .shot:hover .tag,.sbref .shot.selected .tag{ opacity:1; transform:translateY(0); }.sbref .shot.selected .tag{ border-color:rgba(60,219,192,.45); color:#c8fff4; }

/* selection underline beneath the strip */.sbref .underline{
  position:absolute; bottom:-9px; height:3px; border-radius:2px;
  background:var(--signal);
  box-shadow:0 0 10px rgba(60,219,192,.6);
  transition:left .28s cubic-bezier(.22,1,.3,1), width .28s cubic-bezier(.22,1,.3,1);
}

/* ---------- hover ghost ---------- */.sbref .ghost{
  position:absolute; top:26px; bottom:14px; width:1px; left:0;
  background:rgba(255,255,255,.16);
  opacity:0; pointer-events:none; z-index:5;
}.sbref .content:hover .ghost.on{ opacity:1; }

/* ---------- playhead ---------- */.sbref .playhead{ position:absolute; top:0; bottom:14px; left:0; width:0; z-index:30; pointer-events:none; }.sbref .ph-line{
  position:absolute; top:27px; bottom:0; left:-1px; width:2px;
  background:linear-gradient(180deg, #fff, rgba(255,255,255,.35));
  box-shadow:0 0 10px rgba(255,255,255,.4);
}.sbref .ph-chip{
  position:absolute; top:0; left:0; transform:translateX(-50%);
  background:var(--chip); color:#0b0e13;
  font-size:10.5px; font-weight:600; letter-spacing:.03em;
  padding:3px 8px 2px; border-radius:6px;
  box-shadow:0 2px 10px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.25);
  pointer-events:auto; cursor:ew-resize; white-space:nowrap;
  transition:box-shadow .2s ease;
}.sbref .is-playing .ph-chip{ box-shadow:0 2px 10px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.25), 0 0 14px rgba(60,219,192,.45); }.sbref .ph-tri{
  position:absolute; top:20px; left:0; transform:translateX(-50%);
  width:0; height:0; border:5px solid transparent; border-bottom:none;
  border-top:6px solid var(--chip);
  filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));
}

/* ---------- top player: the one shared preview ---------- */.sbref .p-slot{ margin-bottom:22px; }.sbref .p-slot.anim{ overflow:hidden; transition:height .32s cubic-bezier(.22,1,.3,1), opacity .25s ease; }.sbref .player{
  position:relative;
  background:linear-gradient(180deg, var(--panel-hi), #0e1117 55%, var(--panel-lo));
  border:1px solid var(--stroke); border-radius:18px;
  padding:14px 14px 10px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05), 0 40px 90px -40px rgba(0,0,0,.9);
}.sbref .p-close{
  position:absolute; top:24px; right:24px; z-index:5;
  width:26px; height:26px; border-radius:7px; padding:0;
  background:rgba(8,10,14,.62); border:1px solid rgba(255,255,255,.12);
  color:#aab3c0; font-size:12px; line-height:1; cursor:pointer; backdrop-filter:blur(4px);
  transition:color .15s ease, border-color .15s ease;
}.sbref .p-close:hover{ color:#eef2f7; border-color:rgba(255,255,255,.3); }

/* ---------- main content area: everything below the preview ---------- */.sbref .area{
  background:linear-gradient(180deg, #10131a, #0b0d12);
  border:1px solid var(--stroke); border-radius:18px;
  padding:14px 16px 14px; overflow:hidden;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04), 0 40px 90px -40px rgba(0,0,0,.85);
}.sbref .area-head{
  display:grid; grid-template-columns:1fr auto 1fr; align-items:center;
  margin-bottom:14px;
}.sbref .a-chip{
  justify-self:start; display:inline-flex; align-items:center; gap:7px;
  padding:5px 11px; border-radius:8px;
  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.09);
  font-size:10.5px; font-weight:500; color:#cfd7e1; letter-spacing:.03em;
}.sbref .a-chip svg{ width:12px; height:12px; opacity:.75; }.sbref .a-count{ font-size:10px; color:#68717d; letter-spacing:.1em; }.sbref .a-preview{
  justify-self:end; display:inline-flex; align-items:center; gap:7px;
  padding:5px 11px; border-radius:8px; cursor:pointer;
  background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.1);
  font-family:var(--mono); font-size:10.5px; font-weight:500; color:#96a0ad; letter-spacing:.03em;
  transition:color .15s ease, border-color .15s ease, background .15s ease;
}.sbref .a-preview svg{ width:13px; height:13px; }.sbref .a-preview:hover{ color:#d5dce5; border-color:rgba(255,255,255,.22); }.sbref .a-preview.on{ color:var(--signal); border-color:rgba(60,219,192,.45); background:rgba(60,219,192,.07); }.sbref .p-view{
  position:relative; height:clamp(180px, 30vh, 320px); border-radius:12px; overflow:hidden;
  background:#000; box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);
  display:grid; place-items:center;
}.sbref .p-frame{ height:100%; aspect-ratio:16/9; }.sbref .p-bar{ position:relative; height:16px; margin:10px 2px 6px; cursor:pointer; touch-action:none; }.sbref .p-bar::before{
  content:""; position:absolute; left:0; right:0; top:50%; transform:translateY(-50%);
  height:3px; border-radius:2px; background:rgba(255,255,255,.1);
}.sbref .p-fill{
  position:absolute; left:0; top:50%; transform:translateY(-50%); height:3px;
  border-radius:2px; background:var(--signal);
  box-shadow:0 0 8px rgba(60,219,192,.5); pointer-events:none;
}.sbref .p-fill::after{
  content:""; position:absolute; right:-4px; top:50%; transform:translateY(-50%);
  width:9px; height:9px; border-radius:50%; background:#f3f6f9;
  box-shadow:0 1px 4px rgba(0,0,0,.6);
}.sbref .p-notch{
  position:absolute; top:50%; transform:translateY(-50%);
  width:1px; height:8px; background:rgba(255,255,255,.25); pointer-events:none;
}.sbref .p-row{ display:grid; grid-template-columns:1fr auto 1fr; align-items:center; padding:0 2px; }.sbref .p-src{
  font-family:var(--wide); font-size:8.5px; font-weight:600;
  letter-spacing:.2em; text-transform:uppercase; color:#7d8794; white-space:nowrap;
}.sbref .p-ctl{ display:flex; gap:10px; }.sbref .p-time{ justify-self:end; font-size:10.5px; color:#a7b0bd; letter-spacing:.04em; }.sbref .clip.active .c-view{ cursor:pointer; }

/* the top time zone lights up under the pointer */.sbref .playbar::before{
  content:""; position:absolute; left:0; right:0; top:0; height:82px;
  border-radius:18px 18px 0 0;
  background:linear-gradient(180deg, rgba(60,219,192,.055), rgba(60,219,192,0));
  opacity:0; transition:opacity .25s ease; pointer-events:none;
}.sbref .playbar.top-hot::before{ opacity:1; }

/* one-time hint, centered on the meta line between the seq title and stats */.sbref .coach{
  position:absolute; left:50%; top:-4px;
  transform:translate(-50%, 5px);
  display:flex; align-items:center; gap:7px;
  padding:3px 10px; border-radius:99px;
  background:#11151c; border:1px solid rgba(60,219,192,.32);
  color:#bfe6dc; font-family:var(--mono); font-size:9.5px; font-weight:500;
  letter-spacing:.08em; text-transform:none; white-space:nowrap;
  box-shadow:0 8px 22px -10px rgba(0,0,0,.8), 0 0 14px -6px rgba(60,219,192,.3);
  opacity:0; pointer-events:none; z-index:5;
  transition:opacity .35s ease, transform .35s ease;
}.sbref .coach.show{ opacity:1; transform:translate(-50%, 0); }.sbref .coach-dot{
  width:6px; height:6px; border-radius:50%; background:var(--signal);
  box-shadow:0 0 8px rgba(60,219,192,.8); flex:none;
  animation:pulse 1.6s ease-in-out infinite;
}

/* ---------- minimap ---------- */.sbref .minimap{ padding:16px 22px 2px; }.sbref .mm-track{ position:relative; height:28px; cursor:pointer; touch-action:none; }.sbref .mm-track::before{ /* groove */
  content:""; position:absolute; left:0; right:0; top:10px; height:8px; border-radius:4px;
  background:rgba(255,255,255,.035);
  box-shadow:inset 0 1px 3px rgba(0,0,0,.6);
}.sbref .mm-shot{
  position:absolute; top:11px; height:6px; border-radius:3px;
  background:#343b45; pointer-events:none;
  transition:background .2s ease, box-shadow .2s ease;
}.sbref .mm-shot.inview{ background:#4c5561; }.sbref .mm-shot.sel{ background:var(--signal); box-shadow:0 0 8px rgba(60,219,192,.55); }.sbref .mm-window{
  position:absolute; top:3px; height:22px; border-radius:7px;
  background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.28);
  cursor:grab; z-index:3;
  transition:border-color .15s ease, background .15s ease;
}.sbref .mm-window:hover{ border-color:rgba(255,255,255,.45); background:rgba(255,255,255,.075); }.sbref .mm-track.dragging,.sbref .mm-track.dragging .mm-window{ cursor:grabbing; }.sbref .mm-window::before,.sbref .mm-window::after{
  content:""; position:absolute; top:50%; transform:translateY(-50%);
  width:3px; height:9px; border-radius:2px; background:rgba(255,255,255,.55);
  opacity:0; transition:opacity .15s ease;
}.sbref .mm-window::before{ left:4px; }.sbref .mm-window::after{ right:4px; }.sbref .mm-window:hover::before,.sbref .mm-window:hover::after{ opacity:1; }.sbref .mm-ph{ position:absolute; top:1px; bottom:5px; width:2px; z-index:4; pointer-events:none;
  background:var(--alarm); box-shadow:0 0 8px rgba(255,92,92,.6); transform:translateX(-1px); }.sbref .mm-ph i{
  position:absolute; bottom:-8px; left:50%; transform:translateX(-50%);
  border:4px solid transparent; border-top:none; border-bottom:5px solid var(--alarm);
}

/* ============================================================
   Clip deck — swipeable takes, center card active
   ============================================================ */.sbref .deck{
  position:relative; height:480px; margin:20px 0 4px;
  -webkit-mask-image:linear-gradient(90deg, transparent 0, #000 5%, #000 95%, transparent 100%);
          mask-image:linear-gradient(90deg, transparent 0, #000 5%, #000 95%, transparent 100%);
}.sbref .deck.dragging,.sbref .deck.dragging .clip{ cursor:grabbing; }.sbref .clip{
  position:absolute; top:50%; left:50%; width:clamp(300px, 30vw, 440px);
  transform:translate(-50%,-50%);
  padding:12px 14px;
  background:linear-gradient(180deg, #141821, #0c0f14);
  border:1px solid rgba(255,255,255,.08); border-radius:16px;
  box-shadow:0 34px 80px -36px rgba(0,0,0,.95), inset 0 1px 0 rgba(255,255,255,.05);
  cursor:grab; will-change:transform, opacity, filter;
}.sbref .clip.active{
  border-color:rgba(255,255,255,.15);
  box-shadow:0 44px 96px -38px rgba(0,0,0,.98), 0 0 0 1px rgba(60,219,192,.12),
             0 0 34px -14px rgba(60,219,192,.35), inset 0 1px 0 rgba(255,255,255,.07);
}
/* shared cinematic treatment: vignette + grain */.sbref .cine{ position:relative; overflow:hidden; }.sbref .cine::before{
  content:""; position:absolute; inset:0;
  background:radial-gradient(130% 120% at 50% 42%, transparent 52%, rgba(0,0,0,.5) 100%);
}.sbref .cine::after{
  content:""; position:absolute; inset:0; opacity:.12; pointer-events:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E");
  mix-blend-mode:overlay;
}.sbref .c-head{ display:flex; align-items:center; gap:10px; }.sbref .c-id{ font-family:var(--wide); font-size:8.5px; font-weight:600; letter-spacing:.2em; text-transform:uppercase; color:#77808d; }.sbref .c-dur{ margin-left:auto; font-size:10.5px; color:#5d6570; }.sbref .c-dur b{ color:#e6ecf3; font-weight:600; }.sbref .c-dur i{ font-style:normal; color:#3c434d; padding:0 2px; }.sbref .c-menu{ background:none; border:0; color:#6a7380; font-size:15px; line-height:1; cursor:pointer; padding:2px 4px; border-radius:6px; }.sbref .c-menu:hover{ color:#cfd7e1; background:rgba(255,255,255,.06); }.sbref .c-title{ margin:7px 0 10px; font-size:12.5px; font-weight:500; color:#d3dae4; letter-spacing:.01em;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }.sbref .c-view{ position:relative; aspect-ratio:2/1; border-radius:10px; overflow:hidden; background:#000; box-shadow:inset 0 0 0 1px rgba(255,255,255,.08); }.sbref .c-frame{ position:absolute; inset:0; }.sbref .c-bar{ display:flex; align-items:center; gap:12px; margin:9px 2px 8px; }.sbref .c-play{
  width:26px; height:26px; border-radius:50%; border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.05); color:#c6cfda; cursor:pointer;
  display:grid; place-items:center; padding:0; transition:border-color .15s ease, color .15s ease, box-shadow .15s ease;
}.sbref .c-play svg{ width:10px; height:10px; fill:currentColor; }.sbref .c-play:hover{ border-color:rgba(60,219,192,.5); color:var(--signal); }.sbref .clip.playing .c-play{ border-color:rgba(60,219,192,.6); color:var(--signal); box-shadow:0 0 12px -4px rgba(60,219,192,.6); }.sbref .c-cut,.sbref .c-srct{ font-size:10px; color:#68717d; letter-spacing:.05em; }.sbref .c-cut b,.sbref .c-srct b{ color:#dfe6ee; font-weight:600; }.sbref .c-srct{ margin-left:auto; }.sbref .c-strip{ position:relative; display:flex; height:48px; border-radius:8px; overflow:hidden; background:#05070a;
  box-shadow:0 0 0 1px rgba(255,255,255,.08); }.sbref .c-cell{ flex:1 1 0; }.sbref .c-shade{ position:absolute; top:0; bottom:0; background:rgba(4,6,9,.72); pointer-events:none; }.sbref .c-shade.l{ left:0; }.sbref .c-shade.r{ right:0; }.sbref .c-playline{ position:absolute; top:0; bottom:0; width:2px; background:var(--signal);
  box-shadow:0 0 8px rgba(60,219,192,.7); opacity:0; transition:opacity .15s ease; pointer-events:none; }.sbref .clip.playing .c-playline{ opacity:1; }.sbref .c-win{
  position:absolute; top:1px; bottom:1px; border-radius:7px;
  border:2px solid var(--chip); cursor:grab;
  box-shadow:0 0 0 1px rgba(0,0,0,.65), 0 2px 12px rgba(0,0,0,.5);
}.sbref .c-win:active{ cursor:grabbing; }.sbref .c-h{ position:absolute; top:0; bottom:0; width:11px; cursor:ew-resize; }.sbref .c-h.l{ left:-6px; }.sbref .c-h.r{ right:-6px; }.sbref .c-h::after{ content:""; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
  width:2px; height:12px; border-radius:1px; background:rgba(10,13,18,.85); }.sbref .c-io{ display:flex; align-items:center; gap:8px; margin-top:9px;
  font-size:9.5px; letter-spacing:.1em; color:#68717d; }.sbref .c-io input{
  width:62px; padding:3px 6px; text-align:center;
  font-family:var(--mono); font-size:11px; font-weight:600; color:var(--signal);
  background:#0a0d13; border:1px solid rgba(255,255,255,.1); border-radius:7px; outline:none;
}.sbref .c-io input:focus{ border-color:rgba(60,219,192,.55); }.sbref .c-io .arr{ color:#454c56; }.sbref .c-total{ margin-left:auto; font-size:11px; font-weight:600; color:#dfe6ee; letter-spacing:.02em; }.sbref .c-tags{ display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:10px; min-height:24px; }.sbref .chip{ display:inline-flex; align-items:center; gap:6px; padding:3px 5px 3px 9px; border-radius:7px;
  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.09);
  font-size:9.5px; letter-spacing:.05em; color:#bac3cf; }.sbref .chip .x{ background:none; border:0; padding:0 3px; color:#6b7480; font-size:11px; cursor:pointer; line-height:1; }.sbref .chip .x:hover{ color:#ff8585; }.sbref .c-add{ width:24px; height:22px; border-radius:7px; border:1px dashed rgba(255,255,255,.22);
  background:none; color:#77808d; font-size:12px; line-height:1; cursor:pointer; }.sbref .c-add:hover{ border-color:rgba(60,219,192,.55); color:var(--signal); }.sbref .c-tagin{ width:76px; padding:3px 7px; font-family:var(--mono); font-size:10px; color:#d5dce5;
  background:#0a0d13; border:1px solid rgba(60,219,192,.4); border-radius:7px; outline:none; }.sbref .c-win:hover{ box-shadow:0 0 0 1px rgba(0,0,0,.65), 0 2px 12px rgba(0,0,0,.5), 0 0 14px rgba(255,255,255,.22); }.sbref .clip:not(.active) .c-play,.sbref .clip:not(.active) .c-menu,.sbref .clip:not(.active) input,.sbref .clip:not(.active) .c-tags{ pointer-events:none; }

/* ---------- transport buttons (shared by the player) ---------- */.sbref .t-btn{
  width:30px; height:30px; border-radius:50%; border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.05); color:#c6cfda; cursor:pointer;
  display:grid; place-items:center; padding:0;
  transition:border-color .15s ease, color .15s ease, box-shadow .15s ease;
}.sbref .t-btn svg{ width:11px; height:11px; fill:currentColor; }.sbref .t-btn:hover{ border-color:rgba(60,219,192,.5); color:var(--signal); }.sbref .t-btn:disabled{ opacity:.3; pointer-events:none; }.sbref .t-main{ width:38px; height:38px; border-color:rgba(255,255,255,.2); }.sbref .t-main svg{ width:13px; height:13px; }.sbref .t-main.playing{ border-color:rgba(60,219,192,.6); color:var(--signal); box-shadow:0 0 16px -5px rgba(60,219,192,.7); }

/* ---------- footer hints ---------- */.sbref .hints{
  padding:16px 6px 0; text-align:center;
  font-size:9.5px; letter-spacing:.12em; color:#4c545f;
}.sbref .hints b{ color:#8e98a5; font-weight:600; }.sbref .hints .sep{ padding:0 10px; color:#333a43; }

@media (prefers-reduced-motion: reduce){.sbref *,.sbref *::before,.sbref *::after{ transition:none !important; animation:none !important; }
}
`;

const REFERENCE_SCRIPT = `
/* ============================================================
   Model
   ============================================================ */
const PXS = 44;          // pixels per second — keep in sync with --pxs
const DUR = 120;         // sequence length (s)
const FPS = 24;

/* Procedural “cinematography” for placeholder frames.
   Swap these for real thumbnails: each .frame just takes a background. */
const LOOKS = {
  fadeOut:     "radial-gradient(120% 110% at 50% 45%, #0d0f14 0%, #05060a 60%, #020304 100%)",
  nightBlack:  "radial-gradient(120% 100% at 32% 42%, #131722 0%, #0a0d13 45%, #04050a 100%)",
  nightBlack2: "radial-gradient(110% 100% at 68% 40%, #10141d 0%, #080a10 50%, #030408 100%)",
  screenGlow:  "linear-gradient(78deg, rgba(4,6,10,.96) 0%, rgba(4,6,10,.96) 46%, rgba(4,6,10,0) 60%), radial-gradient(42% 58% at 70% 46%, #cdeeff 0%, #7cc7e4 30%, #1c4a5e 62%, #071018 88%, #04070b 100%)",
  darkGlance:  "radial-gradient(55% 78% at 72% 48%, #3d4b58 0%, #1a232c 46%, #070b10 100%)",
  listener:    "linear-gradient(84deg, rgba(6,6,10,.92) 0%, rgba(6,6,10,0) 34%), radial-gradient(62% 86% at 60% 44%, #c4a9a4 0%, #8a656b 30%, #3a2a33 62%, #120d13 100%)",
  emberProfile:"radial-gradient(30% 55% at 22% 30%, rgba(255,171,94,.45) 0%, rgba(255,171,94,0) 70%), radial-gradient(62% 88% at 34% 55%, #c1662b 0%, #7c3d18 38%, #2b1309 72%, #0b0502 100%)",
  faceWarmC:   "radial-gradient(52% 72% at 52% 44%, #eda65e 0%, #b06a2c 36%, #401e0c 74%, #100702 100%)",
  faceWarmSad: "radial-gradient(48% 66% at 47% 42%, #d69150 0%, #94571f 40%, #33170a 76%, #0d0602 100%)",
  goldenPair:  "radial-gradient(26% 60% at 80% 50%, rgba(10,6,3,.9) 0%, rgba(10,6,3,0) 70%), radial-gradient(70% 96% at 26% 48%, #f2b873 0%, #bd7a3c 40%, #4a220e 78%, #140903 100%)",
  gruffClose:  "radial-gradient(58% 80% at 56% 46%, #d99b58 0%, #9a5c26 38%, #38190a 74%, #0e0603 100%)",
  redheadTurn: "radial-gradient(24% 34% at 46% 20%, rgba(224,108,54,.55) 0%, rgba(224,108,54,0) 70%), radial-gradient(56% 78% at 48% 50%, #cf8e4d 0%, #8f5522 42%, #331708 76%, #0d0502 100%)",
  duoProfiles: "radial-gradient(24% 62% at 74% 52%, rgba(6,4,3,.92) 0%, rgba(6,4,3,0) 66%), radial-gradient(64% 90% at 30% 50%, #d79a56 0%, #9a5c24 40%, #3a1b0a 76%, #0f0603 100%)",
  greenShirt:  "linear-gradient(0deg, rgba(30,44,26,.85) 0%, rgba(30,44,26,0) 30%), radial-gradient(60% 82% at 46% 40%, #e0a869 0%, #9c6330 40%, #33190b 76%, #0e0603 100%)",
  shadowHat:   "radial-gradient(30% 60% at 84% 46%, rgba(255,158,84,.4) 0%, rgba(255,158,84,0) 60%), radial-gradient(70% 100% at 40% 55%, #241811 0%, #120b07 55%, #060303 100%)",
  carCool:     "radial-gradient(30% 44% at 20% 62%, rgba(255,176,112,.3) 0%, rgba(255,176,112,0) 70%), radial-gradient(64% 86% at 66% 40%, #47617c 0%, #22303f 46%, #0a0f15 100%)",
  startled:    "radial-gradient(50% 70% at 60% 44%, #e9b98a 0%, #a3703f 40%, #3a2313 74%, #0f0905 100%)",
  duskWide:    "linear-gradient(90deg, rgba(5,6,9,.9) 0%, rgba(5,6,9,0) 40%), radial-gradient(92% 120% at 82% 42%, #ff9d54 0%, #a04c1e 42%, #2a1208 76%, #090402 100%)",
  streetDay:   "linear-gradient(0deg, rgba(40,36,30,.7) 0%, rgba(40,36,30,0) 35%), radial-gradient(80% 100% at 50% 30%, #cfd8de 0%, #9aa4ad 40%, #55534e 75%, #2a2621 100%)",
  storefront:  "linear-gradient(0deg, rgba(30,20,10,.75) 0%, rgba(30,20,10,0) 40%), radial-gradient(70% 90% at 55% 45%, #e8b459 0%, #b57e2e 40%, #5a3a14 78%, #1d1206 100%)",
  bwPlate:     "linear-gradient(100deg, #0f0f10 0%, #2c2c2e 28%, #bfbfc2 52%, #39393b 78%, #121213 100%)",
  vanPop:      "radial-gradient(46% 70% at 42% 55%, #e5762b 0%, #a34d15 45%, #402209 78%, #120a04 100%)"
};

/* shot = { s: start, f: [[duration, look], …] } */
const SHOTS = [
  { s:0,     f:[[3.2,"fadeOut"],[3.3,"nightBlack2"]] },
  { s:6.5,   f:[[2.8,"duskWide"],[2.7,"emberProfile"]] },
  { s:12,    f:[[7.6,"nightBlack"]] },
  { s:19.6,  f:[[1.1,"darkGlance"],[1.4,"screenGlow"]] },
  { s:22.1,  f:[[3.5,"listener"]] },
  { s:25.6,  f:[[2.8,"emberProfile"],[2.9,"faceWarmC"],[2.7,"faceWarmSad"]] },
  { s:34.0,  f:[[2.1,"goldenPair"],[2.5,"gruffClose"]] },
  { s:38.6,  f:[[1.7,"redheadTurn"],[1.9,"duoProfiles"],[1.9,"faceWarmSad"]] },
  { s:44.1,  f:[[2.9,"greenShirt"],[2.7,"shadowHat"],[2.9,"redheadTurn"]] },
  { s:52.6,  f:[[3.4,"carCool"],[3.3,"startled"]] },
  { s:59.3,  f:[[3.4,"faceWarmC"],[3.3,"nightBlack2"]] },
  { s:66.0,  f:[[3.0,"darkGlance"],[3.0,"listener"],[3.0,"emberProfile"]] },
  { s:75.0,  f:[[4.2,"carCool"],[4.3,"goldenPair"]] },
  { s:83.5,  f:[[2.8,"faceWarmSad"],[2.9,"duoProfiles"],[2.8,"greenShirt"]] },
  { s:92.0,  f:[[4.5,"streetDay"],[4.5,"vanPop"]] },
  { s:101.0, f:[[3.1,"storefront"],[3.2,"streetDay"],[3.2,"bwPlate"]] },
  { s:110.5, f:[[5.0,"storefront"],[4.5,"streetDay"]] }
];
SHOTS.forEach(sh => sh.e = sh.s + sh.f.reduce((a,[d]) => a + d, 0));

/* labeled sections — named ranges of shots */
const SECTIONS = [
  { name:"Cold Open",  a:0,  b:2  },
  { name:"Boards",     a:3,  b:9  },
  { name:"Reference",  a:10, b:13 },
  { name:"Locations",  a:14, b:16 }
];
SECTIONS.forEach(x => { x.s = SHOTS[x.a].s; x.e = SHOTS[x.b].e; });

/* ============================================================
   DOM build
   ============================================================ */
const __stands = new Map();
const $ = id => {
  const found = document.getElementById(id);
  if (found) return found;
  // A STAND-IN FOR AN ELEMENT THIS SLICE DOES NOT RENDER.
  // The reference is one page wiring the playbar and the deck together; each
  // story shows one half, so the other half's ids are absent. A detached div
  // takes every write the script makes (style, textContent, classList,
  // listeners) and shows none of it, which lets the ORIGINAL logic run
  // unmodified rather than being forked per story.
  //
  // MEMOISED BY ID, because identity matters: \`mmTrack.insertBefore(b,
  // mmWindow)\` asks whether one lookup is a child of another, and handing back
  // a fresh element per call made that a NotFoundError that stopped the deck
  // being built at all.
  let stand = __stands.get(id);
  if (stand === undefined) {
    stand = document.createElement('div');
    stand.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    const nativeInsert = stand.insertBefore.bind(stand);
    // And forgiving: two stand-ins are siblings of nothing, so an insert
    // positioned against one of them becomes an append.
    stand.insertBefore = (node, ref) =>
      ref && ref.parentNode === stand ? nativeInsert(node, ref) : stand.appendChild(node);
    __stands.set(id, stand);
  }
  return stand;
};

const playbar=$("playbar"), viewport=$("viewport"), content=$("content"),
      ruler=$("ruler"), strip=$("strip"), rangeEl=$("range"), underEl=$("underline"),
      ghost=$("ghost"), lane=$("lane"),
      playhead=$("playhead"), chip=$("chip"),
      pFrame=$("pFrame"), pSrc=$("pSrc"), pTime=$("pTime"), pFill=$("pFill"), pBar=$("pBar"),
      tStart=$("tStart"), tPrev=$("tPrev"), tPlay=$("tPlay"), tNext=$("tNext"), tEnd=$("tEnd"),
      mmTrack=$("mmTrack"), mmWindow=$("mmWindow"), mmPh=$("mmPh");

content.style.width = DUR * PXS + "px";

/* ruler ticks + labels */
{
  const fr = document.createDocumentFragment();
  for (let i = 0; i <= DUR; i++){
    const t = document.createElement("div");
    t.className = "tick" + (i % 10 === 0 ? " t10" : i % 2 === 0 ? " t2" : "");
    t.style.left = i * PXS + "px";
    fr.appendChild(t);
    if (i % 2 === 0 && i < DUR){
      const l = document.createElement("span");
      l.className = "tlabel" + (i % 10 === 0 ? " big" : "");
      l.style.left = i * PXS + "px";
      l.textContent = i + "s";
      fr.appendChild(l);
    }
  }
  ruler.appendChild(fr);
}

/* shot cards + frames */
const shotEls = SHOTS.map((sh, i) => {
  const el = document.createElement("div");
  el.className = "shot";
  el.dataset.i = i;
  el.style.left  = sh.s * PXS + 2 + "px";
  el.style.width = (sh.e - sh.s) * PXS - 4 + "px";
  const dur = sh.e - sh.s;
  sh.f.forEach(([d, look]) => {
    const f = document.createElement("div");
    f.className = "frame";
    f.style.width = (d / dur * 100) + "%";
    f.style.background = LOOKS[look];
    el.appendChild(f);
  });
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = "SH " + String(i + 1).padStart(2, "0") + " · " + dur.toFixed(1) + "s";
  el.appendChild(tag);
  strip.appendChild(el);
  return el;
});

/* minimap shot bars */
const mmEls = SHOTS.map(sh => {
  const b = document.createElement("div");
  b.className = "mm-shot";
  b.style.left  = (sh.s / DUR * 100) + "%";
  b.style.width = "calc(" + ((sh.e - sh.s) / DUR * 100) + "% - 2px)";
  mmTrack.insertBefore(b, mmWindow);
  return b;
});

/* sections: sticky labels, segmented ruler base, boundary dividers, minimap notches */
const LAYERS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>';
const secEls = SECTIONS.map((sec, i) => {
  const base = document.createElement("div");
  base.className = "rbase";
  base.style.left  = sec.s * PXS + 3 + "px";
  base.style.width = (sec.e - sec.s) * PXS - 6 + "px";
  ruler.appendChild(base);

  if (i > 0){
    const div = document.createElement("div");
    div.className = "secdiv";
    div.style.left = sec.s * PXS + "px";
    content.appendChild(div);
    const notch = document.createElement("div");
    notch.className = "mm-sec";
    notch.style.left = (sec.s / DUR * 100) + "%";
    mmTrack.insertBefore(notch, mmWindow);
  }

  const el = document.createElement("div");
  el.className = "seclabel";
  el.innerHTML = LAYERS_ICON + "<span>" + sec.name + "</span>";
  el.addEventListener("pointerdown", ev => ev.stopPropagation());
  el.addEventListener("click", () => viewport.scrollTo({ left: sec.s * PXS - 24, behavior: "smooth" }));
  lane.appendChild(el);
  return el;
});

/* labels stay pinned to the viewport edge while their section is in view */
function updateLabels(){
  const sl = viewport.scrollLeft;
  secEls.forEach((el, i) => {
    const sec = SECTIONS[i];
    const min = sec.s * PXS + 4;
    const max = Math.max(min, sec.e * PXS - el.offsetWidth - 12);
    el.style.transform = "translateX(" + clamp(sl + 30, min, max) + "px)";
  });
}

/* ============================================================
   State + rendering
   ============================================================ */
let t = 0, sel = -1, playing = false, scrubbing = false, mmDrag = null, skimT = null;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pad = n => String(n).padStart(2, "0");
const tc = v => pad(Math.floor(v / 60)) + ":" + pad(Math.floor(v % 60)) + ":" + pad(Math.floor((v % 1) * FPS));

function setT(v){
  t = clamp(v, 0, DUR);
  playhead.style.transform = "translateX(" + t * PXS + "px)";
  chip.textContent = tc(t);
  mmPh.style.left = (t / DUR * 100) + "%";
  playerRender();
}

function select(i){
  if (i === sel) return;
  if (sel >= 0){ shotEls[sel].classList.remove("selected"); mmEls[sel].classList.remove("sel"); }
  sel = i;
  const sh = SHOTS[i];
  shotEls[i].classList.add("selected");
  mmEls[i].classList.add("sel");
  const l = sh.s * PXS + 2, w = (sh.e - sh.s) * PXS - 4;
  rangeEl.style.left = underEl.style.left = l + "px";
  rangeEl.style.width = underEl.style.width = w + "px";
  revealShot(i);                                      // keep the shot in view…
  goDeck(i);                                          // …and the deck centered on it
}

/* ---------- hover / scrub preview overlay ---------- */
function frameAt(v){
  let si = SHOTS.findIndex(sh => v >= sh.s && v < sh.e);
  if (si < 0) si = v >= DUR ? SHOTS.length - 1 : 0;
  const sh = SHOTS[si];
  let acc = sh.s, look = sh.f[sh.f.length - 1][1];
  for (const [d, l] of sh.f){ if (v < acc + d){ look = l; break; } acc += d; }
  const sec = SECTIONS.find(x => si >= x.a && si <= x.b);
  return { si, look, sec: sec ? sec.name : "" };
}
/* ---------- the one top player mirrors whatever is active: take > skim > sequence ---------- */
function clipLook(cl){
  return LOOKS[cl.seq[Math.min(cl.seq.length - 1, Math.floor(cl.playT / cl.src * cl.seq.length))]];
}
function playerRender(){
  const takeCl = CLIPS.find(c => c.playing);
  if (takeCl){
    pFrame.style.background = clipLook(takeCl);
    pSrc.textContent = "TAKE · SH " + pad(CLIPS.indexOf(takeCl) + 1);
    pTime.textContent = Math.max(0, takeCl.playT - takeCl.in).toFixed(2) + "s / " + (takeCl.out - takeCl.in).toFixed(2) + "s";
  } else if (skimT != null && !playing){
    const f = frameAt(skimT);
    pFrame.style.background = LOOKS[f.look];
    pSrc.textContent = "SH " + pad(f.si + 1) + " · " + f.sec;
    pTime.textContent = tc(skimT) + " / " + tc(DUR);
  } else {
    const f = frameAt(t);
    pFrame.style.background = LOOKS[f.look];
    pSrc.textContent = "SEQ 04 · " + f.sec;
    pTime.textContent = tc(t) + " / " + tc(DUR);
  }
  pFill.style.width = (t / DUR * 100) + "%";
}

/* hover / scrub on the ruler skims frames straight into the player */
function updatePreview(x){
  dismissCoach();                                     // the lesson is learned by doing
  skimT = clamp(x / PXS, 0, DUR);
  playerRender();
}
function hidePreview(){
  if (skimT == null) return;
  skimT = null;
  playerRender();
}

/* first-run coach mark — session-only here; persist a "seen" flag in your app */
const coach = $("coach");
let coached = false;
const coachIn  = setTimeout(() => { if (!coached) coach.classList.add("show"); }, 900);
const coachOut = setTimeout(dismissCoach, 12000);
function dismissCoach(){
  if (coached) return;
  coached = true;
  clearTimeout(coachIn); clearTimeout(coachOut);
  coach.classList.remove("show");
  setTimeout(() => coach.remove(), 400);
}

function syncWindow(){
  const cw = content.offsetWidth, vw = viewport.clientWidth, sl = viewport.scrollLeft;
  mmWindow.style.left  = (sl / cw * 100) + "%";
  mmWindow.style.width = (vw / cw * 100) + "%";
  const s0 = sl / PXS, s1 = (sl + vw) / PXS;
  SHOTS.forEach((sh, i) => mmEls[i].classList.toggle("inview", sh.e > s0 && sh.s < s1));
  updateLabels();
}
viewport.addEventListener("scroll", () => requestAnimationFrame(syncWindow));
new ResizeObserver(syncWindow).observe(viewport);

/* ============================================================
   Scrubbing on the ruler / strip
   ============================================================ */
function seekClient(cx){
  const r = viewport.getBoundingClientRect();
  setT((cx - r.left + viewport.scrollLeft) / PXS);
}
function edgeScroll(cx){
  const r = viewport.getBoundingClientRect();
  if (cx < r.left + 50)       viewport.scrollLeft -= (r.left + 50 - cx) * .35;
  else if (cx > r.right - 50) viewport.scrollLeft += (cx - (r.right - 50)) * .35;
}

/* ---------- inertia (strip fling) ---------- */
let pan = null, mo = null;
function cancelMomentum(){ if (mo){ cancelAnimationFrame(mo.raf); mo = null; } }
function startMomentum(v){
  if (Math.abs(v) < 0.05) return;
  mo = { v, last: performance.now() };
  const step = ts => {
    if (!mo) return;
    const dt = Math.min(ts - mo.last, 50); mo.last = ts;
    viewport.scrollLeft -= mo.v * dt;
    mo.v *= Math.pow(0.94, dt / 16.7);                  // exponential friction
    const max = content.offsetWidth - viewport.clientWidth;
    if (Math.abs(mo.v) < 0.02 || viewport.scrollLeft <= 0 || viewport.scrollLeft >= max - .5){ mo = null; return; }
    mo.raf = requestAnimationFrame(step);
  };
  mo.raf = requestAnimationFrame(step);
}

content.addEventListener("pointerdown", e => {
  if (e.button !== 0) return;
  cancelMomentum();
  content.setPointerCapture(e.pointerId);
  if (e.target.closest(".strip")){
    /* drag pans the strip with momentum; a quick tap still selects + seeks */
    pan = { x0:e.clientX, sl0:viewport.scrollLeft, lastX:e.clientX, lastT:performance.now(),
            v:0, moved:false, card:e.target.closest(".shot") };
    strip.classList.add("panning");
    playbar.classList.remove("top-hot");
    ghost.classList.remove("on");
    hidePreview();                                    // grabbing to pan — clear hover overlays immediately
  } else {
    scrubbing = true;
    stopAllClips();                                   // scrubbing the sequence claims the player
    ghost.classList.remove("on");
    seekClient(e.clientX);
    const r = viewport.getBoundingClientRect();
    updatePreview(clamp(e.clientX - r.left + viewport.scrollLeft, 0, DUR * PXS));
  }
});
content.addEventListener("pointermove", e => {
  if (pan){
    const now = performance.now(), dt = now - pan.lastT;
    if (dt > 0) pan.v = pan.v * .7 + ((e.clientX - pan.lastX) / dt) * .3;   // smoothed px/ms
    pan.lastX = e.clientX; pan.lastT = now;
    viewport.scrollLeft = pan.sl0 - (e.clientX - pan.x0);
    if (!pan.moved && Math.abs(e.clientX - pan.x0) > 4) pan.moved = true;
    return;
  }
  const r = viewport.getBoundingClientRect();
  const x = clamp(e.clientX - r.left + viewport.scrollLeft, 0, DUR * PXS);
  if (scrubbing){
    playbar.classList.add("top-hot");
    edgeScroll(e.clientX);
    seekClient(e.clientX);
  } else {
    if (mo) return;                                   // coasting — keep overlays hidden
    if (!e.target.closest(".lane, .ruler, .ph-chip")){
      playbar.classList.remove("top-hot");
      ghost.classList.remove("on");                   // hovering the strip — no overlays
      hidePreview();
      return;
    }
    playbar.classList.add("top-hot");
    ghost.style.left = x + "px";
    ghost.classList.add("on");
  }
  updatePreview(x);
});
function endPointer(e){
  if (pan){
    strip.classList.remove("panning");
    if (!pan.moved){                                    // tap → select + seek
      if (pan.card) select(+pan.card.dataset.i);
      seekClient(e.clientX);
    } else {
      if (performance.now() - pan.lastT > 80) pan.v = 0; // held still before release
      startMomentum(clamp(pan.v, -3.5, 3.5));
    }
    pan = null;
  }
  scrubbing = false;
}
content.addEventListener("pointerup", endPointer);
content.addEventListener("pointercancel", () => { if (pan){ strip.classList.remove("panning"); pan = null; } scrubbing = false; });
content.addEventListener("pointerleave",  () => { playbar.classList.remove("top-hot"); ghost.classList.remove("on"); hidePreview(); });

/* wheel = horizontal pan */
viewport.addEventListener("wheel", e => {
  cancelMomentum();
  viewport.scrollLeft += e.deltaY + e.deltaX;
  e.preventDefault();
}, { passive:false });

/* ============================================================
   Minimap: drag window to pan, click to jump
   ============================================================ */
mmTrack.addEventListener("pointerdown", e => {
  cancelMomentum();
  const cw = content.offsetWidth, vw = viewport.clientWidth, tw = mmTrack.clientWidth;
  if (e.target !== mmWindow){
    const ratio = (e.clientX - mmTrack.getBoundingClientRect().left) / tw;
    viewport.scrollLeft = ratio * cw - vw / 2;
  }
  mmDrag = { x: e.clientX, sl: viewport.scrollLeft };
  mmTrack.setPointerCapture(e.pointerId);
  mmTrack.classList.add("dragging");
});
mmTrack.addEventListener("pointermove", e => {
  if (!mmDrag) return;
  const cw = content.offsetWidth, tw = mmTrack.clientWidth;
  viewport.scrollLeft = mmDrag.sl + (e.clientX - mmDrag.x) * (cw / tw);
});
const mmEnd = () => { mmDrag = null; mmTrack.classList.remove("dragging"); };
mmTrack.addEventListener("pointerup", mmEnd);
mmTrack.addEventListener("pointercancel", mmEnd);

/* ============================================================
   Playback + keys
   ============================================================ */
let last = 0;
function follow(){
  const vw = viewport.clientWidth, x = t * PXS, sl = viewport.scrollLeft;
  if (x > sl + vw * .82)  viewport.scrollLeft = x - vw * .82;
  else if (x < sl + 40)   viewport.scrollLeft = Math.max(0, x - 40);
}
function frameLoop(ts){
  if (!playing) return;
  setT(t + (ts - last) / 1000);
  last = ts;
  follow();
  if (t >= DUR) return togglePlay(false);
  requestAnimationFrame(frameLoop);
}
function togglePlay(force){
  playing = force !== undefined ? force : !playing;
  if (playing && t >= DUR) setT(0);
  if (playing){ hidePreview(); cancelMomentum(); dismissCoach(); playbar.classList.remove("top-hot"); stopAllClips(); }
  playbar.classList.toggle("is-playing", playing);
  document.querySelector(".meta").classList.toggle("playing", playing);
  syncTransport();
  playerRender();
  if (playing){ last = performance.now(); requestAnimationFrame(frameLoop); }
}

window.addEventListener("keydown", e => {
  if (e.target.closest("input")) return;
  const nav = e.code === "Space" || e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End";
  if (nav) cancelMomentum();
  if (e.code === "Space"){ e.preventDefault(); togglePlay(); }
  else if (e.key === "ArrowRight"){ e.preventDefault(); setT(t + (e.shiftKey ? 1 : 1 / FPS)); follow(); }
  else if (e.key === "ArrowLeft"){  e.preventDefault(); setT(t - (e.shiftKey ? 1 : 1 / FPS)); follow(); }
  else if (e.key === "Home"){ setT(0); viewport.scrollLeft = 0; }
  else if (e.key === "End"){  setT(DUR); viewport.scrollLeft = content.offsetWidth; }
});

/* ============================================================
   Clip deck — swipeable takes, center card active
   ============================================================ */
/* one take card per shot — the deck and the timeline share selection */
const MODELS = ["H3 4-ref", "ref2va", "minimax-h3", "comfy-cloud H3"];
const CLIPS = SHOTS.map((sh, i) => {
  const dur = sh.e - sh.s;
  const head = +(0.4 + (i * 37 % 23) / 10).toFixed(2);   // deterministic source handles
  const tail = +(0.6 + (i * 53 % 17) / 10).toFixed(2);
  const secName = SECTIONS.find(x => i >= x.a && i <= x.b).name;
  const model = MODELS[i % MODELS.length];
  return {
    n: "SH " + String(i + 1).padStart(2, "0") + " — " + secName + " take (" + model + ", seed " + (100 + (i * 97) % 880) + ")",
    src: +(head + dur + tail).toFixed(2),
    in: head,
    out: +(head + dur).toFixed(2),
    seq: sh.f.map(fr => fr[1]),
    tags: [secName.toLowerCase().replace(/\\s+/g, "-"), "SH" + String(i + 1).padStart(2, "0"), model.split(" ")[0].toLowerCase()],
    shot: i
  };
});
const deck = $("deck"), deckTrack = $("deckTrack");
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const PLAY_SVG  = '<svg viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 12 12"><path d="M2.5 1.5h2.6v9H2.5zM6.9 1.5h2.6v9H6.9z"/></svg>';
const CELLS = 16;

/* deck state — declared before cards build so their first renders can read it */
let deckPos = 6, deckTarget = 6, deckNear = -1, deckRaf = 0, deckDrag = null, deckSp = 480;   // boots on the selected shot
let pendingAutoplay = -1, deckJustDragged = 0;

function wireClip(el, cl){
  const q = s => el.querySelector(s);
  const stripEl = q(".c-strip"), win = q(".c-win"),
        shadeL = q(".c-shade.l"), shadeR = q(".c-shade.r"),
        line = q(".c-playline"), frame = q(".c-frame"),
        inF = q(".c-in"), outF = q(".c-out"), total = q(".c-total"),
        trimD = q(".c-trim"), cutB = q(".c-cut b"), srcB = q(".c-srct b"),
        playBtn = q(".c-play"), tags = q(".c-tags"), addBtn = q(".c-add");

  cl.playT = cl.in; cl.playing = false;
  const lookAt = v => cl.seq[Math.min(cl.seq.length - 1, Math.floor(v / cl.src * cl.seq.length))];

  function tickUI(){
    line.style.left = (cl.playT / cl.src * 100) + "%";
    cutB.textContent = Math.max(0, cl.playT - cl.in).toFixed(2) + "s";
    srcB.textContent = cl.playT.toFixed(2) + "s";
    frame.style.background = LOOKS[lookAt(cl.playT)];
    playerRender();                                    // mirror into the main player
  }
  function render(){
    const l = cl.in / cl.src * 100, r = cl.out / cl.src * 100;
    win.style.left = l + "%"; win.style.width = (r - l) + "%";
    shadeL.style.width = l + "%"; shadeR.style.width = (100 - r) + "%";
    inF.value = cl.in.toFixed(2); outF.value = cl.out.toFixed(2);
    const d = cl.out - cl.in;
    total.textContent = trimD.textContent = d.toFixed(2) + "s";
    tickUI();
  }

  /* play the trimmed range */
  let raf = 0, lastTs = 0;
  function stopPlay(){
    if (!cl.playing) return;
    cl.playing = false; cancelAnimationFrame(raf);
    el.classList.remove("playing");
    playBtn.innerHTML = PLAY_SVG;
    syncTransport();
    playerRender();
  }
  function startPlay(){
    CLIPS.forEach(o => { if (o !== cl && o._stop) o._stop(); });
    if (playing) togglePlay(false);                    // one source at a time
    if (cl.playT >= cl.out - .01) cl.playT = cl.in;
    cl.playing = true; el.classList.add("playing");
    playBtn.innerHTML = PAUSE_SVG;
    syncTransport();
    lastTs = performance.now();
    const step = ts => {
      if (!cl.playing) return;
      cl.playT += (ts - lastTs) / 1000; lastTs = ts;
      if (cl.playT >= cl.out){ cl.playT = cl.out; tickUI(); stopPlay(); cl.playT = cl.in; setTimeout(tickUI, 260); return; }
      tickUI();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  cl._stop = stopPlay;
  cl._play = startPlay;
  playBtn.addEventListener("pointerdown", e => e.stopPropagation());
  playBtn.addEventListener("click", () => cl.playing ? stopPlay() : startPlay());

  /* trim dragging: handles resize, window body slides */
  let td = null;
  win.addEventListener("pointerdown", e => {
    e.stopPropagation();
    const rect = stripEl.getBoundingClientRect();
    const mode = e.target.classList.contains("c-h") ? (e.target.classList.contains("l") ? "l" : "r") : "m";
    td = { mode, rect, off:(e.clientX - rect.left) / rect.width * cl.src - cl.in, len: cl.out - cl.in };
    win.setPointerCapture(e.pointerId);
    stopPlay();
    if (!el.classList.contains("active")){
      /* trimming a back card: clarify and lift it while working —
         filter/opacity/z only, never transform, so the handle stays under the cursor */
      el.style.filter = "brightness(.97) saturate(1)";
      el.style.opacity = ".98";
      el.style.zIndex = 40;
    }
  });
  win.addEventListener("pointermove", e => {
    if (!td) return;
    const v = (e.clientX - td.rect.left) / td.rect.width * cl.src;
    if (td.mode === "l")      cl.in  = clamp(v, 0, cl.out - .2);
    else if (td.mode === "r") cl.out = clamp(v, cl.in + .2, cl.src);
    else { cl.in = clamp(v - td.off, 0, cl.src - td.len); cl.out = cl.in + td.len; }
    cl.playT = cl.in;
    render();
  });
  const tdEnd = () => { if (td){ td = null; layoutDeck(); } };   // settle a lifted back card
  win.addEventListener("pointerup", tdEnd);
  win.addEventListener("pointercancel", tdEnd);

  /* editable in/out fields */
  function commit(){
    const a = parseFloat(inF.value), b = parseFloat(outF.value);
    if (!isNaN(a)) cl.in  = clamp(a, 0, cl.src - .2);
    if (!isNaN(b)) cl.out = clamp(b, cl.in + .2, cl.src);
    if (cl.in > cl.out - .2) cl.in = clamp(cl.out - .2, 0, cl.src);
    cl.playT = cl.in; render();
  }
  [inF, outF].forEach(f => {
    f.addEventListener("change", commit);
    f.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") f.blur(); });
    f.addEventListener("pointerdown", e => e.stopPropagation());
  });

  /* tags: × removes, + adds via inline input */
  tags.addEventListener("pointerdown", e => e.stopPropagation());
  tags.addEventListener("click", e => {
    if (e.target.classList.contains("x")) e.target.closest(".chip").remove();
  });
  addBtn.addEventListener("click", () => {
    if (tags.querySelector(".c-tagin")) return;
    const f = document.createElement("input");
    f.className = "c-tagin"; f.placeholder = "tag"; f.spellcheck = false;
    tags.insertBefore(f, addBtn); f.focus();
    const done = () => {
      const v = f.value.trim();
      if (v){
        const s = document.createElement("span");
        s.className = "chip"; s.append(v);
        const x = document.createElement("button");
        x.className = "x"; x.title = "Remove tag"; x.textContent = "×";
        s.appendChild(x);
        tags.insertBefore(s, f);
      }
      f.remove();
    };
    f.addEventListener("blur", done);
    f.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") f.blur(); if (e.key === "Escape"){ f.value = ""; f.blur(); } });
  });

  /* clicking the frame plays this take in the main player */
  q(".c-view").addEventListener("click", () => {
    if (el.classList.contains("active") && performance.now() - deckJustDragged > 250)
      cl.playing ? stopPlay() : startPlay();
  });

  render();
}

const cardEls = CLIPS.map((cl, i) => {
  const el = document.createElement("article");
  el.className = "clip";
  el.dataset.i = i;
  let cells = "";
  for (let c = 0; c < CELLS; c++)
    cells += \`<div class="c-cell cine" style="background:\${LOOKS[cl.seq[c % cl.seq.length]]}"></div>\`;
  const chips = cl.tags.map(t => \`<span class="chip">\${t}<button class="x" title="Remove tag">×</button></span>\`).join("");
  el.innerHTML = \`
    <header class="c-head">
      <span class="c-id">clip \${i + 1}</span>
      <span class="c-dur"><b class="c-trim"></b><i>/</i><span class="c-srcd">\${cl.src.toFixed(2)}s</span></span>
      <button class="c-menu" title="Clip options">⋯</button>
    </header>
    <h3 class="c-title" title="\${cl.n}">\${cl.n}</h3>
    <div class="c-view"><div class="c-frame cine"></div></div>
    <div class="c-bar">
      <button class="c-play" title="Play trimmed range">\${PLAY_SVG}</button>
      <span class="c-cut">cut <b>0.00s</b></span>
      <span class="c-srct">src <b>0.00s</b></span>
    </div>
    <div class="c-strip">
      \${cells}
      <div class="c-shade l"></div><div class="c-shade r"></div>
      <div class="c-playline"></div>
      <div class="c-win"><i class="c-h l"></i><i class="c-h r"></i></div>
    </div>
    <div class="c-io">
      <label>in</label><input class="c-in" spellcheck="false">
      <span class="arr">→</span>
      <label>out</label><input class="c-out" spellcheck="false">
      <span class="c-total"></span>
    </div>
    <div class="c-tags">\${chips}<button class="c-add" title="Add tag">+</button></div>\`;
  deckTrack.appendChild(el);
  wireClip(el, cl);
  return el;
});

/* deck motion: drag to swipe with fling, tap a side card to activate */

function layoutDeck(){
  const w = cardEls[0].offsetWidth || 480;
  deckSp = w * 0.93 + 18;                              // side cards sit beside the center, 18px gap
  const near = Math.round(clamp(deckPos, 0, CLIPS.length - 1));
  if (near !== deckNear && (deckDrag || near === deckTarget)){
    deckNear = near;                                   // user sweep or arrival → timeline follows;
    stopAllClips();                                    // switching takes stops the old one
    select(near);                                      // cards passed mid-glide don't hijack the target
    if (pendingAutoplay === near){ pendingAutoplay = -1; CLIPS[near]._play(); }
    syncTransport();
  }
  cardEls.forEach((c, i) => {
    const o = i - deckPos, ao = Math.abs(o), k = Math.min(ao, 1);
    c.style.transform = \`translate(calc(-50% + \${o * deckSp}px), -50%) scale(\${1 - k * .14})\`;
    c.style.opacity = ao > 2 ? 0 : (1 - k * .16) * clamp(2 - ao, 0, 1);
    c.style.filter = \`brightness(\${1 - k * .22}) saturate(\${1 - k * .08})\`;
    c.style.zIndex = 30 - Math.round(ao * 6);
    c.style.pointerEvents = ao > 1.6 ? "none" : "";
    c.classList.toggle("active", i === near);
  });
}
function animDeck(){
  cancelAnimationFrame(deckRaf);
  const step = () => {
    const d = deckTarget - deckPos;
    if (Math.abs(d) < .002){ deckPos = deckTarget; layoutDeck(); return; }
    deckPos += d * (REDUCED ? 1 : .16);
    layoutDeck();
    deckRaf = requestAnimationFrame(step);
  };
  deckRaf = requestAnimationFrame(step);
}
function goDeck(i){ deckTarget = clamp(Math.round(i), 0, CLIPS.length - 1); if (!deckDrag) animDeck(); }

/* scroll the timeline so a shot is comfortably in view */
function revealShot(i){
  const sh = SHOTS[i];
  const x0 = sh.s * PXS, x1 = sh.e * PXS;
  const vw = viewport.clientWidth, sl = viewport.scrollLeft;
  if (x0 < sl + 30 || x1 > sl + vw - 30){
    cancelMomentum();
    viewport.scrollTo({ left: clamp((x0 + x1) / 2 - vw / 2, 0, content.offsetWidth - vw), behavior: REDUCED ? "auto" : "smooth" });
  }
}

deck.addEventListener("pointerdown", e => {
  if (e.target.closest("input, button, .c-win, .c-tags")) return;
  const card = e.target.closest(".clip");
  cancelAnimationFrame(deckRaf);
  deckDrag = { x0:e.clientX, pos0:deckPos, lastX:e.clientX, lastT:performance.now(),
               v:0, moved:false, card: card ? +card.dataset.i : null };
  deck.setPointerCapture(e.pointerId);
  deck.classList.add("dragging");
});
deck.addEventListener("pointermove", e => {
  if (!deckDrag) return;
  const now = performance.now(), dt = now - deckDrag.lastT;
  if (dt > 0) deckDrag.v = deckDrag.v * .7 + ((e.clientX - deckDrag.lastX) / dt) * .3;
  deckDrag.lastX = e.clientX; deckDrag.lastT = now;
  const dx = e.clientX - deckDrag.x0;
  if (Math.abs(dx) > 5) deckDrag.moved = true;
  deckPos = clamp(deckDrag.pos0 - dx / deckSp, -0.35, CLIPS.length - 1 + 0.35);
  layoutDeck();
});
function deckUp(){
  if (!deckDrag) return;
  deck.classList.remove("dragging");
  const d = deckDrag; deckDrag = null;
  if (d.moved) deckJustDragged = performance.now();
  if (!d.moved){
    if (d.card !== null && d.card !== Math.round(clamp(deckPos, 0, CLIPS.length - 1))) goDeck(d.card);
    return;
  }
  if (performance.now() - d.lastT > 80) d.v = 0;
  goDeck(deckPos + (-d.v) * 160 / deckSp);        // 160 ms fling projection
}
deck.addEventListener("pointerup", deckUp);
deck.addEventListener("pointercancel", deckUp);

/* trackpad horizontal swipe */
let wAcc = 0, wT = 0;
deck.addEventListener("wheel", e => {
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  e.preventDefault();
  const now = performance.now();
  if (now - wT > 260) wAcc = 0;
  wT = now; wAcc += e.deltaX;
  if (Math.abs(wAcc) > 130){ goDeck(deckTarget + Math.sign(wAcc)); wAcc = 0; }
}, { passive:false });

new ResizeObserver(layoutDeck).observe(deck);
layoutDeck();

/* ---------- player transport: start / prev / play / next / end ---------- */
function stopAllClips(){ CLIPS.forEach(c => c._stop && c._stop()); }
function syncTransport(){
  const on = playing || CLIPS.some(c => c.playing);
  tPlay.innerHTML = on ? PAUSE_SVG : PLAY_SVG;
  tPlay.classList.toggle("playing", on);
  tPlay.title = on ? "Pause" : "Play sequence";
  tPrev.disabled = deckTarget <= 0;
  tNext.disabled = deckTarget >= CLIPS.length - 1;
}
function stepDeck(dir){
  const nt = clamp(deckTarget + dir, 0, CLIPS.length - 1);
  if (nt === deckTarget) return;
  if (CLIPS.some(c => c.playing)) pendingAutoplay = nt;   // auditioning: keep rolling on the next take
  goDeck(nt);
  syncTransport();
}
tPrev.addEventListener("click", () => stepDeck(-1));
tNext.addEventListener("click", () => stepDeck(1));
tPlay.addEventListener("click", () => {
  const takeCl = CLIPS.find(c => c.playing);
  if (takeCl) takeCl._stop();
  else togglePlay();
  syncTransport();
});
tStart.addEventListener("click", () => { cancelMomentum(); stopAllClips(); setT(0); viewport.scrollLeft = 0; });
tEnd.addEventListener("click", () => {
  cancelMomentum(); stopAllClips();
  if (playing) togglePlay(false);
  setT(DUR); viewport.scrollLeft = content.offsetWidth;
});
syncTransport();

/* seekable progress bar with section notches */
SECTIONS.slice(1).forEach(s => {
  const n = document.createElement("i");
  n.className = "p-notch";
  n.style.left = (s.s / DUR * 100) + "%";
  pBar.appendChild(n);
});
let pSeek = false;
function seekBar(e){
  const r = pBar.getBoundingClientRect();
  setT(clamp((e.clientX - r.left) / r.width, 0, 1) * DUR);
  follow();
}
pBar.addEventListener("pointerdown", e => {
  pSeek = true; pBar.setPointerCapture(e.pointerId);
  cancelMomentum(); stopAllClips();
  seekBar(e);
});
pBar.addEventListener("pointermove", e => { if (pSeek) seekBar(e); });
pBar.addEventListener("pointerup",     () => pSeek = false);
pBar.addEventListener("pointercancel", () => pSeek = false);

/* ---------- preview is dismissible; the content area lives below it ---------- */
const pSlot = $("pSlot"), pToggle = $("pToggle"), pClose = $("pClose");
let playerOpen = true, pAnimT = 0;
function setPlayerOpen(open){
  if (open === playerOpen) return;
  playerOpen = open;
  pToggle.classList.toggle("on", open);
  pToggle.title = open ? "Hide preview" : "Show preview";
  clearTimeout(pAnimT);
  if (REDUCED){
    pSlot.style.display = open ? "" : "none";
    if (open) playerRender();
    return;
  }
  if (open){
    pSlot.style.display = "";
    playerRender();                                    // frame is current the moment it reappears
    window.scrollTo({ top: 0, behavior: "smooth" });   // preview + playbar share the viewport
    const h = pSlot.scrollHeight;
    pSlot.classList.add("anim");
    pSlot.style.height = "0px"; pSlot.style.opacity = "0";
    requestAnimationFrame(() => { pSlot.style.height = h + "px"; pSlot.style.opacity = "1"; });
    pAnimT = setTimeout(() => { pSlot.classList.remove("anim"); pSlot.style.height = ""; pSlot.style.opacity = ""; }, 340);
  } else {
    pSlot.classList.add("anim");
    pSlot.style.height = pSlot.scrollHeight + "px"; pSlot.style.opacity = "1";
    requestAnimationFrame(() => { pSlot.style.height = "0px"; pSlot.style.opacity = "0"; });
    pAnimT = setTimeout(() => { pSlot.classList.remove("anim"); pSlot.style.display = "none"; pSlot.style.height = ""; pSlot.style.opacity = ""; }, 340);
  }
}
pToggle.addEventListener("click", () => setPlayerOpen(!playerOpen));
pClose.addEventListener("click", () => setPlayerOpen(false));

/* ============================================================
   Boot — mirror the reference screenshot: shot 07 selected, ~34.6s
   ============================================================ */
select(6);
setT(34.6);
viewport.scrollLeft = 18 * PXS - 24;
syncWindow();
$("metaR").textContent = FPS + " fps · " + SECTIONS.length + " sections · " + SHOTS.length + " shots · " + tc(DUR);
$("areaCount").textContent = CLIPS.length + " takes · " + pad(Math.floor(DUR / 60)) + ":" + pad(DUR % 60);
if (document.fonts) document.fonts.ready.then(updateLabels);
`;

const FILMSTRIP_MARKUP = `<main class="stage"><section class="area"><div class="meta">
    <div class="meta-l"><span class="dot"></span>Seq 04 — Night Drive<span class="sep">/</span><span style="color:#525a66">Act I</span></div>
    
    <div class="meta-r" id="metaR">24 fps · 17 shots · 02:00:00</div>
  </div><section class="playbar" id="playbar" aria-label="Storyboard timeline">
    <div class="viewport" id="viewport">
      <div class="content" id="content">
        <div class="lane" id="lane"></div>
        <div class="ruler" id="ruler"><div class="range" id="range"></div></div>
        <div class="strip" id="strip"><div class="underline" id="underline"></div></div>
        <div class="ghost" id="ghost"></div>
        <div class="playhead" id="playhead">
          <div class="ph-chip" id="chip">00:00:00</div>
          <div class="ph-tri"></div>
          <div class="ph-line"></div>
        </div>
      </div>
    </div>
    <div class="minimap">
      <div class="mm-track" id="mmTrack" aria-label="Sequence navigator">
        <div class="mm-window" id="mmWindow"></div>
        <div class="mm-ph" id="mmPh"><i></i></div>
      </div>
    </div>
  </section></section></main>`;

const DECK_MARKUP = `<main class="stage"><section class="area"><header class="area-head">
      <span class="a-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>Takes</span>
      <span class="a-count" id="areaCount">17 takes · 02:00</span>
      
    </header><section class="deck" id="deck" aria-label="Clip takes">
    <div class="deck-track" id="deckTrack"></div>
  </section></section></main>`;

function ReferenceSlice({ markup }: Readonly<{ markup: string }>) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    // The reference's own script, run against this slice. `new Function` rather
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
        // `html,body{height:100%}` in the reference became `.sbref{height:100%}`
        // when the sheet was scoped, and a percentage height needs a parent that
        // has one — Storybook's root does not, so the stage collapsed to its
        // content and the page showed through white beneath it. A viewport
        // minimum is what `body` had by definition.
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
