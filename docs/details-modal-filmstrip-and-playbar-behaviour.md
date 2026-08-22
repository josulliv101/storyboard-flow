# The clip details modal — filmstrip, play bar, and everything that moves

A complete behavioural description of the modal that opens when you click a
media item in the graph view. Written to be handed to someone (or something)
that has never seen the code.

Entry point: `components/graph-view/graph-item-details-modal.tsx` in
`apps/timeline-gstudio001`.

---

## 1. What it is

A full-screen modal for working on ONE clip, with the clips that play either
side of it visible at the same time, and a scrubbable bar across the top
covering a stretch of the project's playback order.

It answers three questions at once:

- **What is this clip?** — the centre panel: name, duration, trim, tags, frame.
- **What does it cut against?** — the panels either side, which are complete
  working copies of the same panel, not thumbnails.
- **Where does it sit?** — the bar and the minimap above.

The layout is a **film strip**, taken literally: panels do not shrink to fit,
the film simply continues off both edges of the screen.

---

## 2. Anatomy

```
+--------------------------------------------------------------+
| Clip name                                  undo redo |  x    |   view header
| Van Interior . clip 5 of 13                                  |
+--------------------------------------------------------------+
| [##][#####][##][####][#]  <- boxes, one per clip, width=time |   the play bar
| |___ruler_________________________________________________|  |   (track)
|  frames OFF COVER STRIP    < play >    12.40s / 88.20s   reach 5 10 20 All |
| ------------------------------------------------------------ |   minimap
+--------------------------------------------------------------+
|                                                              |
|    +-------+   +---------------------+   +-------+           |
|    | prev  |   |      CENTRE         |   | next  |           |   the row
|    | panel |   |      panel          |   | panel |           |
|    +-------+   +---------------------+   +-------+           |
|                                                              |
|                                                    [ 3 | 5 ] |   view count
+--------------------------------------------------------------+
```

Everything above the row (header, bar, controls, minimap) is absolutely
positioned. The scrim reserves a `13rem` top band for it via padding. If the
bar grows another line, that padding must grow with it — the symptom of it not
doing so is the minimap resting on the top edge of the middle card.

---

## 3. Opening and closing

- Opens from `useItemDetails()` context — a card's details trigger sets `openId`.
- The card **grows into** the modal using a CSS view transition. One shared
  `view-transition-name` (`"trim-subject"`) is handed from the card to the
  modal's hero frame inside the transition callback. Only one element may carry
  it at a time or the browser skips the morph.
- Closing runs the same transition in reverse. The modal deliberately survives
  the close render (`mountedId` outlives `openId`) so the browser has a
  "before" frame with the modal still in it.
- **The scrim does NOT dismiss.** Only `Escape` or the `×` in the view header.
  This is deliberate: the view is worked in, trimming/scrubbing/swiping all end
  with the pointer somewhere unpredictable, and the panels are *cropped* by the
  scrim rather than surrounded by it — so "outside" is a place the hand lands
  by accident.
- A collection node opens a different body entirely (`CollectionDetails`).
- The scrim uses **`overflow-clip`, never `overflow-hidden`**. `hidden` makes
  it a scroll container over a row that can be 13,000px wide; focusing a panel
  then scroll-into-views it, and that scroll stacks on top of the row's own
  transform. Measured once at 1981px of `scrollLeft` against a row that had
  moved 1728px — the card just chosen ended up entirely off the left edge.

---

## 4. The panel row

**Every clip in the project's flat playback order has a position in one flex
row.** The row is a single element translated sideways:

```
translateX(calc(-1 * offset * (panelWidth + 1rem) + dragPx))
offset = centre - (ids.length - 1) / 2
```

Advancing moves the whole row by exactly one step, so every panel travels the
same distance because they are all inside the thing that moved. The panel width
is a CSS variable and the step is written in `calc()` against it, so the two
cannot drift by a subpixel.

- **Only `floor(viewCount/2) + 1` panels either side are actually mounted.**
  Everything else is an empty div of the right width holding its position. The
  spare pair beyond the visible edge means an arriving panel already exists
  rather than being constructed mid-slide. Those spares are
  **`visibility: hidden`** (`data-item-details-spare`) — they keep their width,
  because the centring is arithmetic over uniform neighbour widths, but they
  paint nothing. Without that they show as a sliver down each side, since
  `count` panels now fill the viewport exactly.
- **View count is 3 or 5**, picked bottom-right. The picker dims to 20%
  opacity while scrubbing.
- **Two widths, not one.** The clip being worked on is **1.75×** its
  neighbours, and every panel is fully visible:

  ```
  N = (100vw - 3rem - (count-1)rem) / (count - 1 + 1.75)      neighbour
  C = 1.75 × N                                                 centre
  ```

  It used to be one width with the outer pair hanging half off each edge —
  which is what made "show three" mean one whole panel and two halves.
- **The centre's extra width cancels out of the centring.** The row still
  translates by `-(N + gap) × (centre - (n-1)/2)`: the wide panel is symmetric
  about its own middle, so only the neighbour width sets the step.
- Transition on the row: `300ms ease-out`, disabled while a finger is on it.
  The panels' **width** animates over the same 300ms on a step — that size
  change is the motion — and is **cut to `transition-none` on a landing**,
  because a landing must not move the middle card at all.

### What one panel contains

All of it is live on every panel, not just the centre:

| Element | Behaviour |
|---|---|
| Meta row | `clip 4` label, trim readout (`7.83 / 10.13s`), `⋯` menu |
| `⋯` menu | Holds the disable toggle (play-time skip) |
| Name | Inline rename. **Single** click opens it, Enter commits, Escape cancels, blur commits. The field's `aria-label` is `"Clip name"` |
| Monitor | The picture — see §6 |
| Trim strip | The **whole source** as a filmstrip with the showing window marked and draggable grips |
| Trim numbers | Typed in/out points, disabled while a grip is being dragged |
| Layer frame picker | Only at `@min-[30rem]` container width |
| Tag editor | Only at `@min-[30rem]` container width |

### What is singular (centre panel only)

- The dialog focus wiring (`aria-modal` is a promise; the focus trap keeps it)
- The `Escape` / `F2` document keydown listeners
- The `view-transition-name`

> **This mattered.** Every mounted panel used to run the keyboard effect. All
> five listeners are on `document`, and `stopPropagation` stops an event
> reaching another *node*, not the other listeners on the same one — so `F2`
> called `begin()` on all five panels and which one you ended up renaming was
> listener order. Measured, it was a neighbour. `Escape` hid the bug, because
> closing five times closes once.

### Panel states

| State | Trigger | Effect |
|---|---|---|
| `dimmed` | clock engaged, panel is not centre | opacity + grayscale, 300ms |
| `scrubFocus` | mid-drag, panel is centre | everything except `[data-item-details-frame]` drops to opacity 15% |
| `magnified` | mid-drag, panel is centre | `transform: scale()` aiming at **620px**, capped at **2.2×** |
| `live` | the playhead is inside this clip | red ring |
| `swapping` | arrived via a bar landing | 300ms fade-in |

Magnification is a **transform, not a width**. The row's slide arithmetic
assumes a uniform panel width; a centre panel that actually got wider would put
every landing off by the difference.

`scrubFocus` dims siblings by child selector rather than by an overlay scrim —
the row carries a `transform`, which makes it a stacking context, so nothing
inside a panel can be raised above a scrim that is a sibling of the row.

---

## 5. The seam clock — one number for the whole view

`barSeconds` is the single source of truth. The monitor frame, every panel's
playhead line, and the bar all read it, so they cannot disagree about "now".

- **It starts null, and null is not zero.** Zero is a real position (the head
  of the bar). Null means "nobody has touched this", which is what makes a
  freshly opened modal show the cut rather than a playback state nobody asked
  for. `scrubbed = barSeconds !== null`.
- The timeline (`buildSeamTimeline`) lays out every clip **in the bar's reach
  window**, in full, with no lead-ins. `seamAt(timeline, seconds)` resolves a
  bar second to `{clipId, clipSeconds}`; `seamSecondsAt` is the inverse.
- The clock is reset on a change of subject **during render**, not in an
  effect, by comparing a `clockFor` state value against the current node id.
  An effect would paint one frame with the new bar and the old playhead — a
  visible flash of the wrong position at exactly the moment the strip moves.

---

## 6. The monitor (the picture)

The **centre panel is a monitor, not a window onto its own clip.** Playing
across a cut means the frame changes clip halfway through, and it has to change
in one place or there is nothing to watch.

- When the clock is running, the centre paints whatever `seamAt` says is on
  screen — which may belong to a neighbour four cards away, mounted or not.
- The clock's time is measured inside the clip's *showing* range; a video
  element seeks in *source* time, so `trimInSeconds` is added back or every
  frame is early by however much was trimmed off the head.
- **Only the monitor makes sound**, and only while the transport runs. Two
  elements playing the same seconds is two soundtracks.
- A **low-res scrub proxy** (`cloudinaryScrubProxySrc`) stands in during a
  drag, for the centre and for whichever panel the playhead is inside.
- A **canvas crossfade** (`useFrameCrossfade`) holds the outgoing frame across
  a cut so the picture never goes blank.
- A panel's own play button plays **that clip from its first frame** on the
  monitor; a second press pauses. Panels never play in place — five panels each
  running their own clip would be five clocks with no shared "now".

### The two frame-skip fixes

Landing on a clip used to briefly show its first frame before skipping to the
playhead. There were **two separate causes**, covering opposite cases:

1. **Landing beyond `MOUNTED_RADIUS`** mounts a fresh video element with no
   decoded frame. Fixed by pointing its `poster` at the seek target
   (`monitorPosterUrl`) rather than at frame zero.
2. **Landing inside the radius** lands on an existing element that already has
   a decoded frame — the wrong one. Fixed by having **the panel under the
   playhead pre-seek itself even while it is still a neighbour**, so it is
   already showing the landed frame before it is asked to be the subject. The
   cut then has nothing left to change. Exactly one panel is ever under the
   playhead, so this is one extra element seeking, not five.

---

## 7. The play bar

`SeamStripBar` → a track (`SeamLane` + `SeamRuler` + edge fades), a controls
row, and a `SeamMinimap`.

### Gestures — one surface, each on its own input

| Input | Does |
|---|---|
| **Drag the boxes** | Scrub. Snaps to a cut when near one, with a one-shot pulse on the playhead head |
| **Click a box** | Commit — make that clip the centre |
| **Release a drag** | **Also commits**, landing on wherever the playhead finished |
| **Wheel** | Pan. Dominant axis, so a trackpad swipe and a mouse notch both work |
| **⌘/Ctrl + wheel** | Zoom about the pointer |
| **Hold within 40px of an edge** | The strip runs under a stationary pointer, ramped by depth up to 16px/frame |
| **Hover a box** | Preview: name, collection, `time / duration`, poster |
| **Drag the minimap** | Pan the bar there. Never seeks — that is the bar's job |

Click vs. drag is decided by **travel (4px)**, not timing — a slow deliberate
scrub must not also count as a tap on wherever it started. The edge-run sets the
`moved` flag itself, or an edge-scrub across half the project would end as a
click on whatever clip happened to arrive under a still finger.

The wheel listener is **native and non-passive**. React registers `onWheel`
passively at the root, so `preventDefault` from a synthetic handler is ignored
— which would leave a zoom gesture also zooming the browser.

### Scale and pan

- The bar **opens fitted to the subject's own collection**, not the whole
  project — on a fifty-minute project a fit-to-all scale draws the shot you
  opened as two pixels. It fits at ~1.65 trackfuls, so a little spills off each
  side to say there is more.
- It fits **once**. Not on resize (that would undo a zoom whenever the window
  moved) and not on a change of subject (that would undo one every step).
- Pan is null until the user pans; the fallback centres the marked box, which
  is right exactly once — on open. After that the bar stays where it was put.
- Pan is clamped to `±max(trackWidth/2, centreAtPx)` — a transform has no
  natural end stops, and a firm two-finger swipe would otherwise throw the
  whole strip off the side of the track.
- **The playhead is nudged into view, never centred**, and only once it
  actually reaches an edge (56px lead / 72px trail). Any deliberate pan
  suspends following; any deliberate seek clears the suspension.
- **A change of subject brings the new clip into view and no further.** The bar
  is a map you positioned; stepping a clip is not a request to throw that away.

### Keyboard (the track is `role="slider"`, `tabIndex=0`)

| Key | Does |
|---|---|
| `Space` | Play / pause |
| `←` `→` | Seek ±1s |
| `Shift` + `←` `→` | Step one clip |
| `Home` / `End` | Jump to either end |

---

## 8. The boxes (`SeamLane`)

- **A box's width is its duration.** This is the bar's core claim and nothing
  is allowed to compromise it — which is why the gap treatment below never
  widens the gap.
- Each box is inset **2.5px per side**, so the gap between two boxes is 5px of
  strip showing through. An inset rather than a margin, because the box's
  *middle* must stay on the clip's middle — that is what the centring
  arithmetic aligns to the card below.
- **The boxes slide into position on a move** (`520ms`) and jump for everything
  else. Drags, pans and zooms are the hand and must track it exactly; a change
  of centre is the one case where nothing is under the reader's finger and a
  jump cannot be told apart from a redraw. Implemented as a FLIP: restore the
  old transform with `transition: none`, force a reflow, then apply the new one
  — a transition cannot be added to a value that has already changed.
- **End-of-project stops** are drawn just outside the first and last boxes, and
  only when the reach window actually reaches the real ends. A bar that has run
  out otherwise looks exactly like a bar that has been cropped. They are a 6px
  gradient falling away from the film — deliberately not box-shaped, because
  anything box-shaped here gets counted as a clip.
- **The clip the cards are on wears a red ring** on the box's own edge
  (`data-seam-marker`), not a dot inside it — a dot had to fight whatever
  picture the box was drawing and would not fit in a narrow one. Same red as
  the playhead: both answer "which clip is this view about", one in space and
  one in time.
- **A clip playback skips is hatched** (`data-seam-hatch`) with diagonal
  stripes, plus a red dotted rule above its box (`data-seam-skip-rule`). A
  pattern rather than a dim, because a dimmed box is indistinguishable from a
  dark frame. It keeps its **full width** — a disabled clip is still part of
  the sequence you are reading, and shrinking it would move every cut after it.
- Collection dividers and ruler labels are the only landmarks on a run of
  boxes. Collection tinting exists but sits behind
  `BAR_COLLECTION_COLOURS_ENABLED`; with it off every box takes one neutral.

### Frames in the boxes

Three states in one control, two stored settings:

- **OFF** — plain boxes. The default. A run of even grey reads as *rhythm*:
  where the cuts fall, which shots are long, where the pace changes. Put
  pictures in them and the eye reads the pictures, because it always will.
- **COVER** — one frame filling each box. Answers "which shot is that".
- **STRIP** — square cells sampled at even intervals across the clip (one per
  ~36px, capped at **12**, past which they stretch rather than multiply).
  Answers what *happens* in the shot. A long take that opens on a closed door
  and ends on an empty room is one picture at COVER and a story at STRIP.

Switching to OFF **does not wipe the style**, so toggling frames is a
comparison you can make twice rather than a choice you re-enter. Stills never
get the filmstrip — one image sampled ten times is ten copies of itself — so
they fall back to COVER.

### The gap bands (frames on only)

With pictures in the boxes the 5px gap disappears, and **no single colour fixes
it**: a dark gap is invisible between two dark frames, a pale one is invisible
between two bright frames, and footage supplies both within the same cut.

So the gap carries **both tones**. The strip background is near-black and each
box casts a 1.5px pale ring into the gap, making every gap read
**light · dark · light**:

```
two bright frames    white | PALE dark PALE | white    <- the core shows
two dark frames      black | pale DARK pale | black    <- the rings show
one of each          both, from opposite sides
                           |1.5px| 2px |1.5px|   within the 5px already there
```

**Which tone is the ring is free; that there are two is not.** The polarity was
the other way round once — pale strip, dark rings — and flipped with the
redesign because a run of boxes edged in white is what makes the bar read as
frames on a strip of film rather than as tiles in a chart. The invariant that
survives is that no arrangement of neighbours leaves both tones without
contrast.

Roughly equal thirds. An earlier pass gave the pale core three of the five and
it read as a white band with a hairline either side. Widening the gap is the
wrong fix — a box's width is its duration, so spending more of it on separation
makes short clips read shorter.

---

## 9. The controls row

Between the two bars, as a **three-column grid (`1fr auto 1fr`)** — not a flex
row with `justify-between`, because the transport has to be centred on the
*track* and flex would drift it left and right as the settings changed width.

| Column | Contents |
|---|---|
| Left | `frames` — OFF / COVER / STRIP |
| Centre | prev clip · play/pause · next clip |
| Right | clock (`0:21.6 / 4:12.9`) · `fit` — clip / all · `reach` — 5 / 10 / 20 / All |

**The clock is clock notation with tenths.** `252.90s` is accurate and
unplaceable in a four-minute cut. Tenths rather than hundredths because the
left half moves: the second decimal is a blur at playback speed and the first
is exactly enough to see time passing. It floors the tenth rather than rounding
it, so it never displays a time it has not reached.

**`fit` names the two scales worth one press** — `clip` is the subject's own
collection (the scale the bar opens at), `all` is everything the reach window
covers. Both were already one `fitPixelsPerSecond` call; before this they were
reachable only by rolling ⌘-wheel until they happened to arrive. Fitting
re-centres as well as re-scales, which is the one place the bar deliberately
overrides "stay where you were put". A wheel zoom clears the lit button,
because at that point neither is true.

Step buttons are **disabled, not hidden**, at the ends — a control that
vanishes takes its position with it and shifts the bar sideways. Both settings
groups are hidden below `md`; the row keeps what is being *used*.

---

## 10. Reach — how far the bar covers

`5 · 10 · 20 · All`, default **10**. A number is a count of clips **either
side**, so 10 puts 21 clips on the bar.

The window is **clamped, not centred**: a subject three clips from the start
with a reach of ten cannot have ten behind it, and shrinking the window would
make the bar change width as you walked towards an end. Taking what is
available on the short side and making it up on the long side keeps the window
constant, so the scale under the playhead does not shift as you move.

**The bar's reach and the row's reach are different things.** The row walks the
whole flat order; the bar only walks the reach window. They can disagree, and
the row can be stepped past the end of the bar.

---

## 11. Landing — the subtle part

Two gestures bring a new clip to the middle, and they arrive **differently**.

| | Distance | Row behaviour | Panels |
|---|---|---|---|
| **Step** (arrow, swipe, click a neighbour, land on an adjacent clip) | 1 | Slides, 300ms | Travel with it |
| **Land** (release a scrub, click a distant box) | > 1 | **Cuts** — no transition | Neighbours **fade in**, 300ms |

Why a landing does not travel: **the middle card has been the monitor for the
whole scrub**, so it is already showing the clip you landed on. Scrolling the
row to it animates a change that has already happened — the one thing on screen
that did not need to move is the thing that moves. So the row cuts to its new
offset, the middle card stays exactly where it is with exactly the picture it
had, and only the panels either side change. *What changes is what changes.*

The cut is done in a **layout effect against the DOM node**, not via state: a
layout effect runs after the new transform is in the DOM and before the browser
paints it, which is the only window where "do not travel" can still be said.
The reflow read between the two style writes is load-bearing.

### Carrying the frame across a landing

The frame you released on is the entire point of having gone there, so it
arrives with you rather than resetting to the new clip's head.

It is carried as a **position (`{clipId, clipSeconds}`), never a raw second.**
The bar is a window with a reach either side of the subject, so it is rebuilt
around wherever you land — the same frame of the same clip is a *different
number of bar seconds* on the bar you left and the bar you arrive on. It is
converted onto the new bar with `seamSecondsAt` during the clock reset.

Only a position **on the clip being landed on** is carried. At a seam the
playhead and the clicked box can disagree by a frame, and carrying the other
clip's position would land you on the right card showing the wrong one's time.

---

## 12. The swipe

Pointer handlers are spread onto **the picture and nothing else**. Every other
large surface in a panel is already a gesture — the filmstrip drags the source
window, the grips trim, the bar scrubs, the title is a text field. The picture
is the one big area with only a tap on it, and the tap already means "bring
this one to the middle"; the swipe is the same instruction, held.

- Not recognised until **8px and mostly sideways** — otherwise it steals every
  tap that wobbles and every vertical scroll that starts on a picture.
- Drag offset is stored in a **ref, not state** — a re-render per pointer move
  would re-render every live panel, video elements included, 60×/second.
- A swipe that ends on a neighbour is suppressed at `onClickCapture`, or the
  browser's follow-up click would advance a second time.

---

## 13. Settings, and where they live

All three are **module-scope, deliberately not persisted**. They are a working
posture for a session, not preferences — a board reopened tomorrow should start
close in. Module scope rather than component state so that closing the modal
and opening another clip does not reset them.

| Setting | Values | Default | Module |
|---|---|---|---|
| View count | 3, 5 | 3 | `graph-item-details-view-count.ts` |
| Bar reach | 5, 10, 20, All | 10 | `graph-item-details-bar-reach.ts` |
| Frames | off/on × cover/filmstrip | off, cover | `graph-playbar-thumbnails.tsx` |

Frames reach the lane through a **context**, not props — the consumer is
several layers down inside a portalled dialog and the value changes rarely.
It defaults to off with no provider, so a bar rendered in a story behaves like
the shipped default.

---

## 14. Constants worth knowing

| Constant | Value | What it governs |
|---|---|---|
| `SEAM_SLIDE_MS` | 520ms | bar boxes sliding to a new centre |
| `SWAP_MS` | 300ms | neighbour fade on a landing |
| row transition | 300ms ease-out | panel row stepping |
| `MONITOR_TARGET_PX` | 620 | magnification target |
| `MAX_MAGNIFICATION` | 2.2 | magnification cap |
| `PANEL_GAP` | 1rem | between panels |
| `BOX_INSET_PX` | 2.5 | per side, so a 5px gap |
| `CAP_WIDTH_PX` | 6 | end-of-project stop |
| `FILMSTRIP_CELL_PX` | 36 | one strip cell |
| `MAX_FILMSTRIP_CELLS` | 12 | per box |
| `CLICK_SLOP_PX` | 4 | click vs. drag |
| `EDGE_PAN_ZONE_PX` | 40 | edge-run trigger zone |
| `EDGE_PAN_MAX_PX_PER_FRAME` | 16 | edge-run top speed |
| `FOLLOW_LEAD_PX` / `FOLLOW_TRAIL_PX` | 56 / 72 | playhead follow margins |
| scrim top padding | `13rem` | must track the bar's height |

---

## 15. Test hooks

Every moving part carries a data attribute. Stories drive the modal in real
headless Chromium (`apps/storybook`, `npx vitest run --project=storybook`);
41 stories cover this modal in `graph-item-details-modal.stories.tsx`.

**View** — `data-item-details`, `data-details-strip`, `data-item-details-header`,
`data-item-details-undo`, `data-item-details-redo`, `data-details-view-count`,
`data-details-bar-reach`, `data-details-bar-frames`

**Panel** — `data-item-details-panel="centre"|"neighbour"`,
`data-item-details-at` (the exact second the panel shows, to 3dp),
`data-item-details-swapping`, `data-item-details-scrub-focus`,
`data-item-details-magnified`, `data-item-details-live`,
`data-item-details-frame`, `data-item-details-menu`, `data-item-details-play`,
`data-item-details-edge`

**Bar** — `data-seam-bar`, `data-seam-track`, `data-seam-centre-at`,
`data-seam-pps` (pixels per second), `data-seam-boxes`, `data-seam-segment`,
`data-seam-segment-live`, `data-seam-thumbnail`, `data-seam-filmstrip`,
`data-seam-cap`, `data-seam-divider`, `data-seam-playhead`,
`data-seam-playhead-head`, `data-seam-fade`, `data-seam-ghost`,
`data-seam-chip`, `data-seam-preview`, `data-seam-marker`, `data-seam-ruler`,
`data-seam-tick`, `data-seam-controls`, `data-seam-transport`, `data-seam-step`

**Minimap** — `data-seam-minimap`, `data-seam-mini-segment`,
`data-seam-mini-window`, `data-seam-mini-playhead`

---

## 16. Traps for anyone editing this

1. **`overflow-clip`, never `overflow-hidden`, on the scrim.** See §3.
2. **Never measure card geometry mid-animation.** A landing animates displaced
   cards; `getBoundingClientRect` includes the transform, so a drag measured
   then releases at a stale coordinate.
3. **Simulated `PointerEvent`s must set `isPrimary: true`** or dnd-kit's
   sensors ignore the whole sequence.
4. **A `transition` cannot be added to a value that already changed.** Restore
   the old value with `transition: none`, force a reflow, apply the new one.
5. **`stopPropagation` does not stop sibling listeners on the same node.** It
   stops the event reaching a different node. This is what broke `F2`.
6. **State that derives from a changed prop is adjusted during render**, not in
   an effect — that is the codebase's idiom and it avoids a visible flash of
   the wrong value. The repo also lints against synchronous `setState` in
   effects.
7. **Two nested opacity animations over a `<video>` judder.** A landing leaves
   the clock engaged, so a neighbour starts a dim transition (which animates a
   *grayscale filter*) in the same frame the swap fade begins — and a filter
   over a video still decoding its first frame is repainted from the decoder
   every tick. The incoming panel therefore arrives already dimmed, with
   `[&_[data-item-details-frame]]:transition-none` while swapping. This is why
   the problem showed on video and not on stills: an `<img>` is a static bitmap
   and costs nothing to re-filter.

---

## 17. Known unmeasured cost

`useSeekedVideo` runs a `requestAnimationFrame` tick loop **per mounted video
panel, continuously** — whether or not anything is playing or scrubbing. At
five panels that is roughly 300 callbacks/second for as long as the modal is
open. Scrub-time measurements already include this cost and it did not show,
but idle cost has never been measured.
