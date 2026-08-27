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
| Clip name                                              |  x   |   view header
| Van Interior . clip 5 of 13                                   |
+--------------------------------------------------------------+
|                                                               |
|     +--------+   +------------------+   +--------+            |
|     |  prev  |   |      CENTRE      |   |  next  |            |   the deck
|     |  card  |   |       card       |   |  card  |            |
|     +--------+   +------------------+   +--------+            |
|                                                               |
|                       |<   >   >|                             |   transport
|                                                    [ 3 | 5 ]  |   clips on screen
+--------------------------------------------------------------+
| 0:00     0:30      VAN INTERIOR      1:00       EXTERIOR      |   ruler + sections
| [##][#####][##][####][#]    shots, one per clip, width = time |   the film strip
| ~~~~~~~~~~~~~~[ window ]~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ |   minimap
+--------------------------------------------------------------+
```

**The deck is above and the film below**, which is swapped from the reference
design this was ported from — there the strip sits under the player and the
cards under that. Here the strip is the whole sequence and the deck is the clip
being worked on, so the film reads as the ground the work sits on rather than a
header above it. It also puts the skim card, which hangs above the playhead,
over the cards rather than over the page furniture.

**Almost nothing is absolutely positioned any more.** The header takes its own
height in normal flow, and the `13rem` reserved top band is gone with the bar it
was reserving for. The clips-on-screen control in the bottom-right corner is the
one exception.

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
  it a scroll container over content wider than the window; focusing a card then
  scroll-into-views it, and that scroll stacks on top of the transform the cards
  are already carrying. Measured once at 1981px of `scrollLeft` against a row
  that had moved 1728px — the card just chosen ended up entirely off the left
  edge. The measurement predates the deck, but the hazard is the same shape:
  the deck writes its own transforms, so a scroll container around it is a
  second, invisible position nobody is managing.

---

## 4. The clip deck

`ClipDeck` (`playbar/clip-deck.tsx`) — three cards across with the centre one
active, each carrying its own frame, cut and source readouts, a trim strip with
handles, in/out fields and tags.

**The glide is written, not rendered.** `deckPos` is a float that eases toward
an integer target at `GLIDE_RATE` a frame, and every card's transform, opacity,
brightness and z-index is derived from it sixty times a second by a `layout()`
call that writes styles directly. Routing that through state would re-render
every mounted card per frame to move them. What state IS for: which card is
active, each clip's trim, and which one is playing — things that change when a
person does something.

- **Side cards are scaled to `0.86`** and sit on the same centre line.
- **Card width fits between `300px` and `440px`.** Below the floor the deck
  stops narrowing and the view scrolls instead — a card is mostly text, and text
  has a size past which it is not worth showing.
- **`neighbours` decides how many are drawn**, and the clips-on-screen control
  sets it. `layout()` draws out to `neighbours + 1` and paints nothing beyond;
  two more each side stay mounted, because `deckPos` is fractional mid-glide and
  a card that is not mounted then is a hole in the row.
- A card's trim strip is **8 cells** (`CLIP_DECK_STRIP_CELLS`), each a real
  frame at its own moment rather than one picture repeated. Sixteen 25px slivers
  of a 16:9 frame is a column of noses; eight at ~50px are readable pictures and
  half the fetches.

**What the deck does not carry**, said plainly because it is not nothing: the
panel row it replaced had an inline rename, the disable toggle, the layer-frame
picker and the real tag editor. The deck's card has none of them. Trim and
selection DO still go through the same command path — the deck's `onTrim`
dispatches the same `update-media` the trim fields dispatched, so it is undoable
like every other edit.

---

## 5. The seam clock — one number for the whole view

`barSeconds` is the single source of truth. The monitor frame, every panel's
playhead line, and the bar all read it, so they cannot disagree about "now".

- **It starts null, and null is not zero.** Zero is a real position (the head
  of the bar). Null means "nobody has touched this", which is what makes a
  freshly opened modal show the cut rather than a playback state nobody asked
  for. `scrubbed = barSeconds !== null`.
- The timeline (`buildSeamTimeline`) lays out **every clip in the collection**,
  in full, with no lead-ins. `seamAt(timeline, seconds)` resolves a bar second
  to `{clipId, clipSeconds}`; `seamSecondsAt` is the inverse.
  It was built from the reach window until PL15-030 (§10): the strip pans across
  every clip at once, and a clock that stopped at a window's end would disagree
  with the thing drawing it — pressing `End` landed at 126 on a strip whose last
  frame was at 144.
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
  drag, and a **canvas crossfade** (`useFrameCrossfade`) holds the outgoing
  frame across a cut so the picture never goes blank. Both moved into
  `media-preview-surface.tsx` with the monitor itself; the modal no longer
  reaches for either directly.
- Cards never play in place — a deck of cards each running its own clip would
  be one clock per card with no shared "now". Playback raises the preview over
  the deck instead (§9).

### The frame-skip fix

Landing on a clip used to briefly show its first frame before skipping to the
playhead, because a freshly mounted video element has no decoded frame yet.

**The surviving half of the fix is the poster.** `monitorPosterUrl` points a
video's `poster` at the seek target rather than at frame zero, quantised to a
quarter-second so the same landing reuses one cached grab. The modal and
`media-preview-surface.tsx` both do this.

> The other half of the original fix does not apply any more, and is recorded
> here because the reasoning still shows up in review comments. There used to be
> a second cause: landing *inside* the mounted radius reached an existing video
> element that already held a decoded frame — the wrong one — and the cure was
> to have the panel under the playhead pre-seek itself while it was still a
> neighbour. That depended on every panel owning a video element. The deck's
> cards do not; there is one preview surface, raised over the deck, so there is
> no second element to arrive already wrong.

---

## 7. The film strip

`FilmStrip` (`playbar/film-strip.tsx`) — the ruler and its section lanes, the
strip of shots, the playhead with its timecode chip, and the minimap.

**The scale is fixed: `PIXELS_PER_SECOND = 44`.** The strip's entire geometry is
that times a duration. There is no zoom and no fit-to-anything; the strip PANS
across the whole sequence instead, which is why the reach setting that used to
page a window over it has nothing left to do (§10).

**Scroll is imperative, and that is deliberate.** The pan, the fling, the
minimap drag and the playhead's follow all write `viewport.scrollLeft` directly,
and the sticky section labels and the minimap window are written from a scroll
handler rather than from state. Routing sixty scroll positions a second through
React would re-render every shot and every tick to move two boxes.

### Gestures

| Input | Does |
|---|---|
| **Drag the shots** | **Pan the film**, one-to-one with the hand, with momentum on release. Commits to nothing |
| **Tap a shot** (under 4px of travel) | Select it *and* seek to it |
| **Press the ruler or a lane** | **Scrub** — seeks at once, and keeps seeking with the pointer |
| **Wheel** | Pan. `deltaY + deltaX` summed, so a trackpad swipe and a mouse notch both work |
| **Hover the ruler, a lane or the chip** | A ghost playhead under the pointer |
| **Click a section label** | Scroll to that section |
| **Click the minimap track** | Jump — centres the viewport there |
| **Drag the minimap** | Pan proportionally. Never seeks — the playhead is not the minimap's business |

**There IS a pointer scrub, and that is a reversal.** The bar this replaced had
removed it deliberately: dragging used to move the playhead, which made the
middle card a monitor for the duration, so reaching for the bar to look further
along the sequence changed what you were working on. The strip separates the two
by SURFACE rather than dropping one of them — the shots are the film, and
dragging them pans; the ruler is the clock, and pressing it seeks.

Click versus drag is decided by **travel (`TAP_SLOP_PX`, 4px)**, not timing — a
slow deliberate pan must not also count as a tap on whatever it started over.

While a scrub runs the strip **edge-scrolls**, and the skim is reported AFTER
the edge scroll, so a skim near the edge names the frame the playhead actually
reached rather than the one that was under the pointer before the strip moved
beneath it.

The wheel listener is **native and non-passive**. React registers `onWheel`
passively and so cannot `preventDefault`, and without that the page scrolls
underneath the strip.

### Keyboard (the track is `role="slider"`, `tabIndex=0`)

| Key | Does |
|---|---|
| `Space` | Play / pause |
| `←` `→` | Seek ±1s |
| `Shift` + `←` `→` | Step one clip — the same call tapping a shot makes, so the two cannot drift |
| `Home` / `End` | Jump to either end |

---

## 8. The shots

- **A shot's width is its duration.** `left = start × 44px`, `width = seconds ×
  44px`. This is the strip's core claim and nothing is allowed to compromise it.
- Each box is inset **2px per side**, so the gap between two shots is 4px of
  strip showing through. An inset rather than a margin, because the box's middle
  must stay on the clip's middle.
- **A shot is filled with frames** — one `data-seam-thumbnail` per frame, each
  an equal share of the width, each a CSS background. That is the whole seam for
  real media: `url(…)` and `radial-gradient(…)` are the same kind of value here,
  so one component takes the reference's procedural looks and the app's real
  posters without knowing the difference.
- **Sections are runs, resolved by adjacency.** Consecutive shots naming the
  same section become one labelled run on the ruler. The same collection
  appearing twice with something else between it is two runs, because a label
  spanning a gap would claim shots that are not its own.
- **Trim handles appear on the selected shot only**, and only while the two 8px
  grips would take no more than a quarter of the box (`MAX_HANDLE_SHARE`). An
  edge on every box would be two dozen grab targets on a surface whose main
  gesture is a pan across all of them. The share is measured against the width
  the box WILL have, so a shot dragged narrow loses its handles at the same point
  a resting one would rather than at the width it started from.
- **A trim ripples live.** The trimmed box keeps its place and takes its new
  width; every shot after it slides by the difference, so the film stays a
  continuous run at every moment of the drag rather than overlapping its
  neighbour or opening a gap. A readout shows the length it will be, during the
  drag only — a box's width is its duration, but a width is not a number you can
  read, and the thing being chosen here is a number.
- Trim is floored at **0.1s**: a trimmed shot may not vanish. A shot with no
  source window gets **no handles at all** rather than handles that quietly do
  nothing — a still has nothing to reach into.

**What the old bar drew and this does not:** the red ring marker, the diagonal
hatching for a clip playback skips, the skip rule above it, collection dividers,
and the end-of-project stops. None of those attributes exist in the strip — see
the list at the end of §15.

---

## 9. The transport

Between the deck and the strip, centred: **previous clip · play/pause · next
clip** (`data-details-transport`). It sits between them because it acts on the
cut the deck is showing, and the strip below is the thing it moves through.

Step buttons are **disabled, not hidden**, at the ends — a control that vanishes
takes its position with it and shifts the row sideways.

**Play raises the preview**, and that is the point of it rather than a side
effect: pressing play is a request to watch, so the deck becomes the screen
exactly as it does under a scrub. Nothing sets that separately — it derives from
`playing`, so pause puts the cards back without a second piece of state to keep
in step.

The only other control in the view is the **clips-on-screen** segmented control
(3 / 5) in the bottom-right corner. It wears no label, and it is the single
exception in a view where every other group has one: `3 · 5` sits alone in a
corner with nothing to be confused with, and the words are already in its
`aria-label` and in every segment's title.

The controls row the old bar carried — `frames`, `fit`, `reach`, and the clock
readout — went with the bar. See §13.

---

## 10. Reach — removed

`5 · 10 · 20 · All`, a count of clips either side of the subject, is **gone**.

It existed because the old bar could not move: seeing more of the sequence meant
paging a window over it, and the window had to be clamped rather than centred so
the bar did not change width as you walked towards an end.

The strip PANS, with momentum, across every clip at once — so its clock is the
timeline's by construction and there is no window left to size. That is also why
the seam clock in §5 is built from every clip in the collection rather than from
a reach window, and why the deck and the strip can no longer disagree about how
far they reach.

---

## 11. Landing — the subtle part

Two gestures bring a new clip to the middle, and they arrive **differently**.

| | Distance | Deck behaviour | Cards |
|---|---|---|---|
| **Step** (arrow, swipe, tap a neighbour, land on an adjacent clip) | 1 | Glides to the next seat | Travel with it |
| **Land** (release a scrub, tap a distant shot) | > 1 | Arrives without travelling | Neighbours **fade in**, `SWAP_MS` 300ms |

Why a landing does not travel: **the centre has been the monitor for the whole
scrub**, so it is already showing the clip you landed on. Animating the deck
across to it animates a change that has already happened — the one thing on
screen that did not need to move is the thing that moves. So the centre stays
where it is with the picture it had, and only the cards either side change.
*What changes is what changes.*

`landOn` is what tells them apart, and it decides by **distance, not by which
gesture asked**: `swapping` is set when the target is more than one clip away.
A neighbour is still a step — landing on the clip beside the one you are on is
the same single move the arrows and the swipe make, and it keeps their glide.
The fade is for arrivals that come from somewhere the deck was not showing.

### Carrying the frame across a landing

The frame you released on is the entire point of having gone there, so it
arrives with you rather than resetting to the new clip's head.

It is carried as a **position (`{clipId, clipSeconds}`), never a raw second.**
The clock is rebuilt around the collection you land in, so the same frame of the
same clip can be a *different number of bar seconds* before and after — a raw
second would survive the journey and mean something else at the end of it. It is
converted with `seamSecondsAt` during the clock reset.

Only a position **on the clip being landed on** is carried. At a seam the
playhead and the clicked box can disagree by a frame, and carrying the other
clip's position would land you on the right card showing the wrong one's time.

---

## 12. The swipe

The deck owns it. The handlers sit on the deck, and **controls inside a card are
not a swipe surface** — anything inside an `input`, a `button`, the window
fields or the tag row is excluded, so a drag that starts on a control belongs to
that control.

- **A drag down the screen is not a swipe.** The reference deck reads X and
  nothing else, which is safe on a surface that fills the window and scrolls
  nowhere. Here the view is a page — with the preview down the cards sit in
  normal flow with a scrollbar — so a hand that meant "scroll" was travelling far
  enough sideways to pan the deck as well, and the clip you were reading slid out
  from under it.
- The direction is decided **once**, at the moment the gesture first commits to
  one (`max(dx, dy) > 4px` and `dy > dx` abandons it), and never revisited: a
  swipe that curls downward at the end is still a swipe, and re-testing every
  move would abandon it halfway. The same rule in reverse lets a slightly untidy
  horizontal drag through.
- Position lives in a **ref, not state**, and is written by `layout()` — a
  re-render per pointer move would re-render every mounted card sixty times a
  second.
- **A tap (under 4px) on a side card brings it to the centre; on the centre card
  it does nothing**, which is what makes tapping safe while reading one.
- A release after movement **projects the throw**: velocity is px/ms, and the
  seat it lands on is `pos + (−velocity × 160ms) / spacing`.

---

## 13. Settings, and where they live

**One setting is left**, and it is **module-scope, deliberately not
persisted**. It is a working posture for a session, not a preference — a board
reopened tomorrow should start close in. Module scope rather than component
state so that closing the modal and opening another clip does not reset it.

| Setting | Values | Default | Module |
|---|---|---|---|
| View count | 3, 5 | 3 | `graph-item-details-view-count.ts` |

**Bar reach and Frames are gone**, and this table listed them for a while
after they went. Both controls lived in `SeamStripBar`'s controls row, which
PL15-030 removed along with the rest of the bar — an explicit call, not a
casualty: the ported strip PANS across every clip at once, so reach had
nothing left to do, and the strip draws its own frames. Their state stayed
behind in the modal, written by choosers nothing called, until PL16-014
removed it with the modules (`graph-item-details-bar-reach.ts`,
`graph-playbar-thumbnails.tsx`).

If either is ever wanted again it is a NEW control on the strip, not a
revival: there is no longer a controls row to put it back on.

---

## 14. Constants worth knowing

| Constant | Value | What it governs |
|---|---|---|
| `PIXELS_PER_SECOND` | 44 | the strip's whole geometry — a shot's width is this times its duration |
| `TAP_SLOP_PX` | 4 | tap vs. pan on the strip, and tap vs. swipe on the deck — the same number in both |
| `TRIM_HANDLE_PX` | 8 | a trim grip's width |
| `MAX_HANDLE_SHARE` | 0.25 | grips are dropped once they would take more of the box than this |
| `TRIM_FLOOR_SECONDS` | 0.1 | a trimmed shot may not vanish |
| `SKIM_GAP_PX` / `SKIM_EDGE_PX` | 10 / 8 | the skim card's gap above the playhead, and its clearance from the edges |
| `RULER_MARGIN_SECONDS` | 30 | scale kept built beyond each edge of the viewport |
| `RULER_FIRST_PAINT_SECONDS` | 60 | how much ruler the first paint draws |
| `MOMENTUM_FRICTION` | 0.94 | per-frame decay of a fling |
| `MOMENTUM_MIN_LAUNCH` / `MOMENTUM_MIN` | 0.05 / 0.02 | the speed a throw needs to start, and to keep going |
| `MOMENTUM_MAX` | 3.5 | fling speed cap, px/ms |
| `MOMENTUM_STALE_MS` | 80 | a hand that stopped before releasing throws nothing |
| `CARD_GAP_PX` | 18 | between deck cards |
| `CARD_MIN_WIDTH_PX` / `CARD_MAX_WIDTH_PX` | 300 / 440 | the deck's fitted card width; below the floor the view scrolls instead |
| side card scale | 0.86 | the cards either side of the active one |
| `GLIDE_RATE` / `GLIDE_SETTLED` | 0.16 / 0.002 | how fast `deckPos` eases to its seat, and when it has arrived |
| `FLING_PROJECTION_MS` | 160 | how far a deck throw is projected |
| `CLIP_DECK_STRIP_CELLS` | 8 | frames sampled across a card's trim strip |
| `PREVIEW_MAX_W` | 720 | widest the preview ever gets |
| `SWAP_MS` | 300 | neighbour fade on a landing |

---

## 15. Test hooks

Every moving part carries a data attribute. Stories drive the modal in real
headless Chromium (`apps/storybook`, `npx vitest run --project=storybook`).

**View** — `data-item-details`, `data-details-hero`, `data-details-view-count`,
`data-details-transport` with `-prev` / `-play` / `-next` (the play button also
carries `data-playing` while it runs)

**Deck** — `data-item-details-panel="centre"|"neighbour"`,
`data-item-details-frame`, `data-item-details-edge`, `data-details-strip`,
`data-trim-overview` with `-window` and `-handle`

**Strip** — `data-seam-bar`, `data-seam-viewport`, `data-seam-track`,
`data-seam-strip`, `data-seam-boxes`, `data-seam-lane`, `data-seam-segment`,
`data-seam-segment-live`, `data-seam-thumbnail`, `data-seam-trim-in`,
`data-seam-trim-out`, `data-seam-playhead`, `data-seam-active-mark`,
`data-seam-ruler`, `data-seam-ruler-block`, `data-seam-tick`,
`data-seam-tick-name`

**Minimap** — `data-seam-minimap`, `data-seam-mini-window`,
`data-seam-mini-segment`, `data-seam-mini-segment-live`

**Gone with the old bar**, and rendered by nothing now — if you find one of
these in a test, the test is asserting against a component that no longer
exists: `data-seam-marker`, `data-seam-hatch`, `data-seam-skip-rule`,
`data-seam-divider`, `data-seam-cap`, `data-seam-controls`, `data-seam-fade`,
`data-seam-ghost`, `data-seam-chip`, `data-seam-preview`, `data-seam-filmstrip`,
`data-seam-centre-at`, `data-seam-pps`, `data-seam-transport`, `data-seam-step`,
`data-seam-playhead-head`, `data-seam-mini-playhead`, `data-details-bar-reach`,
`data-details-bar-frames`.

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

`useSeekedVideo` runs a `requestAnimationFrame` tick loop per mounted video,
continuously — whether or not anything is playing or scrubbing.

**The scale of this changed with the deck, and nobody has re-measured it.** The
figure recorded here was ~300 callbacks/second, from five panels each owning a
video element. The deck's cards do not own video elements: the hook now runs in
`media-preview-surface.tsx` (the one preview raised over the deck) and in
`graph-trim-panel.tsx`. That should be one continuous loop rather than five, but
it is an inference from where the imports are, not a measurement — treat the
cost as unknown rather than as fixed.
