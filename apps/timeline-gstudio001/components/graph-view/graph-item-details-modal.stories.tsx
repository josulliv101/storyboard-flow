import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, waitFor, within } from "storybook/test";

import type { ClipDetail } from "@storyboard/timeline-domain";
import {
  DndCollections,
  buildGraph,
  type CollectionsGraph,
  type GraphNodeSpec,
} from "@storyboard/ui/dnd-collections";

import { createGraphDetailsStore } from "@/lib/graph-details-store";

import { GraphDetailsProvider } from "./graph-details-context";
import { ItemDetailsProvider, useItemDetails } from "./graph-item-details-context";
import { GraphItemDetailsModal } from "./graph-item-details-modal";

// The details modal's first stories. It had none, which is how it came to
// describe a VOICEOVER as a "still" — the branch that renders the duration
// line is "everything that is not video", and that is images AND audio.
//
// Deterministic and offline: an in-memory graph and details store, no network.

// A `src` is REQUIRED for the modal to mount at all — it gates on
// `!!node.src` for media, since a clip with no source has no hero to show.
// Data URIs, so the fixture stays offline.
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";
const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

const AUDIO: GraphNodeSpec = {
  kind: "media",
  mediaKind: "audio",
  id: "bed",
  name: "Tension drone — bed",
  fullDurationSeconds: 8,
  trimInSeconds: 0,
  trimOutSeconds: 0,
  trackIndex: 1,
  src: SILENCE,
};

const IMAGE: GraphNodeSpec = {
  kind: "media",
  id: "plate",
  name: "Van interior",
  src: PIXEL,
  durationSeconds: 4,
};

/**
 * A distinct, recognisable frame per clip. The filmstrip's whole claim is that
 * you can see what sits either side of a cut, and a fixture of identical blank
 * pixels cannot show that — three black rectangles prove the layout and hide
 * the feature. Flat colour with a big label is enough to tell the seams apart
 * at a glance, and it keeps the story deterministic (no network, no decode).
 */
function plate(label: string, fill: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">` +
    `<rect width="320" height="180" fill="${fill}"/>` +
    `<text x="160" y="100" font-family="sans-serif" font-size="34" font-weight="700" ` +
    `fill="#0b0b0d" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * A scene shaped like the case the filmstrip exists for: the subject is the
 * LAST clip of a nested collection, so its next neighbour is only reachable by
 * climbing out of that collection, and its previous one by staying inside it.
 */
const SEAM_SCENE: GraphNodeSpec = {
  kind: "collection",
  id: "root",
  name: "Root",
  children: [
    {
      kind: "collection",
      id: "sub",
      name: "Van Interior",
      children: [
        { kind: "media", id: "before", name: "Before", src: plate("BEFORE", "#7dd3fc"), durationSeconds: 3 },
        { kind: "media", id: "subject", name: "Subject", src: plate("SUBJECT", "#bef264"), durationSeconds: 4 },
      ],
    },
    { kind: "media", id: "after", name: "After", src: plate("AFTER", "#fca5a5"), durationSeconds: 2 },
  ],
};

/**
 * The same scene in VIDEO, with the subject trimmed hard at both ends.
 *
 * Images render no trim strip at all, so the colour-plate scene above cannot
 * see the playhead's relationship to the trim — and that relationship is
 * exactly where this went wrong. Twelve seconds of source showing four, so the
 * window occupies a quarter of the strip and a line that escapes it is
 * unmissable rather than a rounding argument.
 */
const TRIMMED_SCENE: GraphNodeSpec = {
  kind: "collection",
  id: "root",
  name: "Root",
  children: [
    {
      kind: "media",
      mediaKind: "video",
      id: "before",
      name: "Before",
      src: plate("BEFORE", "#7dd3fc"),
      posterSrcs: [plate("BEFORE", "#7dd3fc")],
      fullDurationSeconds: 6,
      trimInSeconds: 1,
      trimOutSeconds: 2,
    },
    {
      kind: "media",
      mediaKind: "video",
      id: "subject",
      name: "Subject",
      src: plate("SUBJECT", "#bef264"),
      posterSrcs: [plate("SUBJECT", "#bef264")],
      fullDurationSeconds: 12,
      trimInSeconds: 5,
      trimOutSeconds: 3,
    },
    {
      kind: "media",
      mediaKind: "video",
      id: "after",
      name: "After",
      src: plate("AFTER", "#fca5a5"),
      posterSrcs: [plate("AFTER", "#fca5a5")],
      fullDurationSeconds: 5,
      trimInSeconds: 0,
      trimOutSeconds: 2,
    },
  ],
};

/**
 * A timeline long enough to actually show fifteen.
 *
 * The three-clip scene above cannot answer the question the count control
 * asks: with only three clips in the timeline, "show fifteen" and "show five"
 * both put three on screen and the assertion passes for the wrong reason.
 * Twenty-one gives every count room, with the subject far enough from either
 * end that nine is not clipped by the timeline itself.
 */
const LONG_SCENE: GraphNodeSpec = {
  kind: "collection",
  id: "root",
  name: "Root",
  children: Array.from({ length: 21 }, (_, index) => ({
    kind: "media" as const,
    id: index === 10 ? "subject" : `clip-${index}`,
    name: index === 10 ? "Subject" : `Clip ${index}`,
    src: plate(String(index), `hsl(${index * 17}, 60%, 70%)`),
    durationSeconds: 2 + (index % 3),
  })),
};

/**
 * A collection whose TIMELINE IS WIDER THAN THE BAR THAT DRAWS IT.
 *
 * `LONG_SCENE` has plenty of clips but only ~63s of them, and the bar draws at
 * a fixed 9px a second — so its whole strip fits inside the track with room to
 * spare, and both ends of the rail already point past the end of the footage.
 * Nothing about running out of track can be shown on it.
 *
 * 30 clips of 8s is 240s, or ~2160px of strip against a track of well under a
 * thousand — so most of the order is off the side at any moment, which is the
 * only condition under which "hold the ball at the edge" means anything.
 */
const OVERFLOWING_SCENE: GraphNodeSpec = {
  kind: "collection",
  id: "root",
  name: "Root",
  children: Array.from({ length: 30 }, (_, index) => ({
    kind: "media" as const,
    id: index === 15 ? "subject" : `clip-${index}`,
    name: index === 15 ? "Subject" : `Clip ${index}`,
    src: plate(String(index), `hsl(${index * 11}, 60%, 70%)`),
    durationSeconds: 8,
  })),
};

/**
 * TWO COLLECTIONS, LONG ENOUGH TO NEED A WINDOW.
 *
 * Two rooms of twelve six-second shots. The bar opens fitted to the
 * collection you are in, so 72s across the track puts the other 72 off the
 * sides — which is the condition every claim about panning, zooming, the
 * minimap and the edges is actually about. The two names are what the ruler
 * and the dividers have to find.
 */
const TWO_ROOMS_SCENE: GraphNodeSpec = {
  kind: "collection",
  id: "root",
  name: "Root",
  children: [
    {
      kind: "collection",
      id: "kitchen",
      name: "Kitchen Interior",
      children: Array.from({ length: 12 }, (_, index) => ({
        kind: "media" as const,
        id: index === 6 ? "subject" : `kitchen-${index}`,
        name: index === 6 ? "Subject" : `Kitchen ${index}`,
        src: plate(`K${index}`, `hsl(${index * 13}, 60%, 70%)`),
        durationSeconds: 6,
      })),
    },
    {
      kind: "collection",
      id: "dock",
      name: "Loading Dock",
      children: Array.from({ length: 12 }, (_, index) => ({
        kind: "media" as const,
        id: `dock-${index}`,
        name: `Dock ${index}`,
        src: plate(`D${index}`, `hsl(${180 + index * 13}, 60%, 70%)`),
        durationSeconds: 6,
      })),
    },
  ],
};

function graphOfRoot(root: GraphNodeSpec): CollectionsGraph {
  const result = buildGraph([root]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function EndHarness() {
  const store = createGraphDetailsStore({ before: DETAIL, subject: DETAIL, after: DETAIL });
  return (
    <div
      // WIDTH DECLARED, because the view now FILLS ITS CONTAINER rather than
      // covering the viewport (PL15-029). The old scrim was `fixed inset-0`, so
      // it spanned the window whatever this wrapper did; the panel arithmetic
      // reads the container instead, and a harness that does not say how wide it
      // is gets panels sized for a box nobody can see. Inline rather than a
      // utility class so it cannot depend on what Tailwind happened to compile
      // for this workspace.
      style={{ width: "100vw" }}
      className="graph-view-theme min-h-[600px] bg-zinc-950"
    >
      <DndCollections initialGraph={graphOfRoot(SEAM_SCENE)}>
        <GraphDetailsProvider store={store}>
          <ItemDetailsProvider>
            <OpenOnMount id="after" />
            <GraphItemDetailsModal />
          </ItemDetailsProvider>
        </GraphDetailsProvider>
      </DndCollections>
    </div>
  );
}

function SeamHarness({ scene = SEAM_SCENE }: { scene?: GraphNodeSpec }) {
  // Built FROM the scene, so a fixture can grow without the harness having to
  // be told about every clip in it by name.
  const store = createGraphDetailsStore(
    Object.fromEntries(
      (function ids(node: GraphNodeSpec): string[] {
        return node.kind === "collection"
          ? (node.children ?? []).flatMap(ids)
          : [node.id as string];
      })(scene).map((id) => [id, DETAIL]),
    ),
  );
  return (
    <div
      // WIDTH DECLARED, because the view now FILLS ITS CONTAINER rather than
      // covering the viewport (PL15-029). The old scrim was `fixed inset-0`, so
      // it spanned the window whatever this wrapper did; the panel arithmetic
      // reads the container instead, and a harness that does not say how wide it
      // is gets panels sized for a box nobody can see. Inline rather than a
      // utility class so it cannot depend on what Tailwind happened to compile
      // for this workspace.
      style={{ width: "100vw" }}
      className="graph-view-theme min-h-[600px] bg-zinc-950"
    >
      <DndCollections initialGraph={graphOfRoot(scene)}>
        <GraphDetailsProvider store={store}>
          <ItemDetailsProvider>
            <OpenOnMount id="subject" />
            <GraphItemDetailsModal />
          </ItemDetailsProvider>
        </GraphDetailsProvider>
      </DndCollections>
    </div>
  );
}

function graphOf(spec: GraphNodeSpec): CollectionsGraph {
  const result = buildGraph([
    { kind: "collection", id: "root", name: "Root", children: [spec] },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

const DETAIL: ClipDetail = { alt: "clip", aspect: 16 / 9 };

/** Opens the modal on mount — the board normally does this from a menu row. */
function OpenOnMount({ id }: Readonly<{ id: string }>) {
  const { setOpenId } = useItemDetails();
  useEffect(() => setOpenId(id), [id, setOpenId]);
  return null;
}

function Harness({ spec }: Readonly<{ spec: GraphNodeSpec }>) {
  const store = createGraphDetailsStore({ [spec.id]: DETAIL });
  return (
    <div
      // WIDTH DECLARED, because the view now FILLS ITS CONTAINER rather than
      // covering the viewport (PL15-029). The old scrim was `fixed inset-0`, so
      // it spanned the window whatever this wrapper did; the panel arithmetic
      // reads the container instead, and a harness that does not say how wide it
      // is gets panels sized for a box nobody can see. Inline rather than a
      // utility class so it cannot depend on what Tailwind happened to compile
      // for this workspace.
      style={{ width: "100vw" }}
      className="graph-view-theme min-h-[600px] bg-zinc-950"
    >
      <DndCollections initialGraph={graphOf(spec)}>
        <GraphDetailsProvider store={store}>
          <ItemDetailsProvider>
            <OpenOnMount id={spec.id} />
            <GraphItemDetailsModal />
          </ItemDetailsProvider>
        </GraphDetailsProvider>
      </DndCollections>
    </div>
  );
}

const meta: Meta<typeof GraphItemDetailsModal> = {
  title: "graph-view/GraphItemDetailsModal",
  component: GraphItemDetailsModal,
};
export default meta;
type Story = StoryObj<typeof GraphItemDetailsModal>;

/**
 * ── AIMING AT THE BAR ─────────────────────────────────────────────────────
 *
 * ONE SURFACE NOW. The boxes ARE the scrubber: a drag across them puts the
 * playhead where you point, and there is no separate rail underneath. What
 * were two helpers aimed at two surfaces are now two ways of describing the
 * same gesture.
 *
 * THE DISTINCTION THAT MATTERS IS TRAVEL, not position. A press that does not
 * move is a CLICK, and a click commits to a clip; a press that moves more than
 * a few pixels is a SCRUB, and a scrub commits to nothing. So every scrub
 * helper here deliberately travels, and a story that wants the click has to
 * ask for it — see `clickBox`.
 */
/**
 * WHICH CLIP A CARD IS, read off the card.
 *
 * These stories used to ask the rename button its `aria-label` — "Rename
 * Subject" — because the heading WAS that button. The deck draws the name as a
 * plain heading and puts editing behind the card's own menu, so the label is
 * no longer the place a clip says who it is. The heading always was; asking it
 * directly is both shorter and one indirection less to break.
 */
function clipName(panel: Element | null | undefined): string | null {
  return panel?.querySelector(".c-title")?.textContent?.trim() ?? null;
}

/** The name of whichever clip is currently the subject. */
function centreClipName(): string | null {
  return clipName(document.querySelector('[data-item-details-panel="centre"]'));
}

/**
 * THE PICTURE A CARD IS SHOWING, read off the paint.
 *
 * It used to be an `<img>` and these stories read its `src`. The deck paints
 * the frame as a CSS background instead — one element carrying a poster, a
 * live trim frame or a flat colour, swapped without a load event — so the URL
 * now lives in `background-image`. Returns "" for a card showing no picture at
 * all, which is a card with a colour rather than a card that is broken.
 */
function frameImage(panel: Element | null | undefined): string {
  const frame = panel?.querySelector<HTMLElement>("[data-item-details-frame]");
  if (frame === null || frame === undefined) return "";
  const painted = getComputedStyle(frame).backgroundImage;
  return painted === "none" ? "" : painted;
}

function seamTrack(): HTMLElement {
  const found = document.querySelector<HTMLElement>("[data-seam-track]");
  expect(found).not.toBeNull();
  return found!;
}

/** The surface every gesture on the bar lands on. */
function seamSurface(): HTMLElement {
  const found = document.querySelector<HTMLElement>("[data-seam-boxes]");
  expect(found).not.toBeNull();
  return found!;
}

/**
 * The RULER, which is what raises the preview now.
 *
 * Hovering used to be the film's job, and the card appeared over the frames it
 * was describing with the pointer resting on them. It moved to the scale above
 * (see `graph-seam-ruler`), so every story that raises a card points here —
 * the film keeps only the gestures that move it.
 */
function seamRuler(): HTMLElement {
  const found = document.querySelector<HTMLElement>("[data-seam-ruler]");
  expect(found).not.toBeNull();
  return found!;
}

/**
 * Point at the ruler directly above a given x on the film.
 *
 * The ruler sits immediately over the strip and is translated by the same
 * offset, so an x that lands on a box lands on that box's scale — which is
 * what lets these stories go on describing their targets in terms of boxes.
 */
function hoverRulerAt(clientX: number): void {
  const ruler = seamRuler();
  const box = ruler.getBoundingClientRect();
  fireEvent.pointerMove(ruler, pointerAt(clientX, box.top + box.height / 2));
}

function pointerAt(clientX: number, clientY: number) {
  return { clientX, clientY, isPrimary: true, pointerId: 1, button: 0 };
}

/**
 * Drag the playhead to `clientX`.
 *
 * Approaches from `travelFrom` px away so the press registers as a drag: the
 * bar tells a scrub from a click by distance travelled, and a helper that
 * pressed and released on one pixel would be asking for the other gesture
 * entirely. `hold` leaves the pointer down, for the stories about what happens
 * DURING a drag.
 */
/**
 * MOVE THE PLAYHEAD, which is the keyboard's job now.
 *
 * Dragging the boxes used to do this, and dragging them PANS the strip since
 * the bar became a thing you pull along rather than a thing you scrub. So the
 * stories that need a clock reach for the control that still moves it: the
 * track is a `role="slider"` and its arrows seek a second at a time.
 */
function nudgePlayhead(seconds: number): void {
  const track = seamTrack();
  for (let step = 0; step < Math.abs(seconds); step += 1) {
    fireEvent.keyDown(track, { key: seconds < 0 ? "ArrowLeft" : "ArrowRight" });
  }
}

/** Press a box WITHOUT travelling, which is how you commit to a clip. */
function clickBox(box: HTMLElement): void {
  const surface = seamSurface();
  const target = box.getBoundingClientRect();
  const args = pointerAt(target.left + target.width / 2, target.top + target.height / 2);
  fireEvent.pointerDown(surface, args);
  fireEvent.pointerUp(surface, args);
}

/** Every clip's box, in timeline order. */
function seamBoxes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-seam-segment]"));
}

/** The marked box — the centred clip, and the only one the bar marks. */
function centreBox(): HTMLElement {
  const found = document.querySelector<HTMLElement>("[data-seam-segment-live]");
  expect(found).not.toBeNull();
  return found!;
}

/**
 * Wait until the strip has stopped moving.
 *
 * A change of subject can nudge the bar to bring the new clip into view, and
 * A box's position is read ON SCREEN. Measure mid-move and the
 * two disagree by however far the strip still has to travel — which showed up
 * as scrubs landing at zero, because the mismatch pushed the target off the
 * front of the timeline and the clamp caught it.
 */
/**
 * Past the PANEL ROW's own transition — a different element from the bar's
 * strip, and on its own clock. `settleStrip` watches `[data-seam-strip]`, so a
 * row easing across three panels is invisible to it and a measurement taken
 * straight after reads a card mid-flight.
 */
/**
 * Press one of the frames badges by its label — `OFF`, `COVER`, `STRIP`.
 *
 * SET EXPLICITLY AND PUT BACK. Like the reach, these are remembered at module
 * scope for the session, so a story that leaves frames on hands them to
 * whichever story runs next in the same browser.
 */
/**
 * Open the bar's settings gear, if its contents are not already showing.
 *
 * FRAMES, CARD AND FIT LIVE BEHIND IT NOW (PL15-006) — they were three
 * labelled groups strung along the controls row and are one menu. Every story
 * that presses one of their segments has to open the menu first, and a handle
 * behind an unopened trigger fails as a TIMEOUT rather than an assertion, so
 * this exists to be called rather than each story remembering.
 *
 * Idempotent on purpose: several of these helpers are called in sequence, and
 * a second click on an open trigger would close it again.
 */
function openBarSettings(): void {
  if (document.querySelector("[data-seam-settings-content]") !== null) return;
  const trigger = document.querySelector<HTMLButtonElement>("[data-seam-settings-menu]");
  expect(trigger).not.toBeNull();
  // POINTERDOWN, NOT `click()`. Radix opens a dropdown on the pointer going
  // DOWN — a synthetic `click()` dispatches only the click and the menu never
  // opens, so every helper below then looked for its group inside content that
  // was not there and failed on a null that had nothing to do with the group.
  fireEvent.pointerDown(trigger!, { button: 0, isPrimary: true });
  const content = document.querySelector<HTMLElement>("[data-seam-settings-content]");
  expect(content).not.toBeNull();

  // AND IT IS IN FRONT OF THE MODAL. Radix portals this to `document.body`, so
  // the menu is a SIBLING of the details view rather than a descendant — and
  // the view is `z-[80]` while `DropdownMenuContent` defaults to `z-50`. It
  // opened, in the right place, behind the scrim: a gear that visibly did
  // nothing. Asserted as a NUMBER rather than a class, because the class is
  // merged with the component's default and which of the two wins is the
  // actual question.
  expect(Number(getComputedStyle(content!).zIndex)).toBeGreaterThan(80);
}

function framesTo(label: string): void {
  openBarSettings();
  const group = document.querySelector<HTMLElement>("[data-details-bar-frames]");
  expect(group).not.toBeNull();
  const button = Array.from(group!.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button).not.toBeUndefined();
  button!.click();
}


async function settleRow(): Promise<void> {
  const row = document.querySelector<HTMLElement>("[data-details-strip]");
  expect(row).not.toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 360));
  let previous = Number.NaN;
  await waitFor(
    () => {
      const now = row!.getBoundingClientRect().left;
      const settled = Math.abs(now - previous) < 0.5;
      previous = now;
      expect(settled).toBe(true);
    },
    { timeout: 3000 },
  );
}

async function settleStrip(): Promise<void> {
  const strip = document.querySelector<HTMLElement>("[data-seam-strip]");
  expect(strip).not.toBeNull();
  // PAST ANY TRANSITION FIRST, then confirm. Watching alone is not enough
  // under load: the poll can take two readings before the movement has even
  // started, agree with itself, and report a strip that is about to move as
  // settled. That is exactly how these passed alone and failed in the full run.
  //
  // LONGER THAN THE BAR'S LANDING SLIDE (`SEAM_SLIDE_MS`, 520ms), not longer
  // than the row's 300ms step. It was 320 when 300 was the only transition
  // this could be waiting on; the bar started sliding on a subject change and
  // that stopped being true, which CI found and a run of this file alone did
  // not — the reading that lands mid-slide depends on how loaded the machine
  // is.
  await new Promise((resolve) => setTimeout(resolve, 600));
  let previous = Number.NaN;
  await waitFor(
    () => {
      const now = strip!.getBoundingClientRect().left;
      const settled = Math.abs(now - previous) < 0.5;
      previous = now;
      expect(settled).toBe(true);
    },
    { timeout: 3000 },
  );
}


/** Swipe the boxes, which moves the carousel three clips at a time. */
function swipeBoxes(direction: "forward" | "back"): void {
  const boxes = document.querySelector<HTMLElement>("[data-seam-boxes]");
  expect(boxes).not.toBeNull();
  const box = boxes!.getBoundingClientRect();
  const from = box.left + box.width / 2;
  const travel = direction === "forward" ? -90 : 90;
  const at = (x: number) => ({
    clientX: x,
    clientY: box.top + box.height / 2,
    isPrimary: true,
    pointerId: 1,
    button: 0,
  });
  fireEvent.pointerDown(boxes!, at(from));
  fireEvent.pointerUp(boxes!, at(from + travel));
}

/** A SOUND is not a still. The duration line shares a branch with images, and
 *  called a voiceover a "still on screen" until this pinned it. */
export const AudioReadsAsSound: Story = {
  render: () => <Harness spec={AUDIO} />,
  play: async () => {
    // The modal opens from an effect, so nothing is mounted on the first tick
    // — asserting straight away reads an empty document and an ABSENCE check
    // would pass against it having proved nothing.
    const canvas = within(document.body);
    await waitFor(() => expect(canvas.getByText(/^sound · /)).toBeInTheDocument());
    expect(canvas.queryByText(/still · /)).toBeNull();
  },
};

/** …and an image still does. */
export const AnImageStillReadsAsAStill: Story = {
  render: () => <Harness spec={IMAGE} />,
  play: async () => {
    const canvas = within(document.body);
    await waitFor(() => expect(canvas.getByText(/^still · /)).toBeInTheDocument());
    expect(canvas.queryByText(/^sound · /)).toBeNull();
  },
};

/** The inset picker is for clips with a PICTURE that run under one. Audio has
 *  no picture to place, so the section is absent rather than disabled. */
export const AudioHasNoInsetPicker: Story = {
  render: () => <Harness spec={AUDIO} />,
  play: async () => {
    const canvas = within(document.body);
    // Wait for the modal to be REALLY up before asserting the section is
    // missing — otherwise this passes against a document that has not
    // rendered, which is exactly how it passed the first time it was written.
    // Gated on the clip's NAME rather than the duration line, so this stays a
    // test about the picker even if that wording changes.
    //
    // getAllByText, because the name is now on screen TWICE for the clip in
    // the middle: once in the view's header, which says what you are looking
    // at, and once on the card itself, which says which of the cards it is.
    // That is the design; a getByText here would fail on the duplicate and
    // report it as a missing element.
    await waitFor(() => expect(canvas.getAllByText("Tension drone — bed").length).toBeGreaterThan(0));
    expect(canvas.queryByText("Inset")).toBeNull();
  },
};

/**
 * THE FILMSTRIP: the clip you opened, with what plays either side of it.
 *
 * The scene is built so neither neighbour is a sibling — `after` lives one
 * level UP from the subject, which is the case that made this need the
 * playback order rather than a look at the subject's own parent.
 */
export const FlankedByItsNeighbours: Story = {
  render: () => <SeamHarness />,
  play: async () => {
    const canvas = within(document.body);
    await waitFor(() =>
      expect(document.querySelectorAll("[data-item-details-panel]").length).toBe(3),
    );
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>("[data-item-details-panel]"),
    );

    // Three WHOLE panels — the middle one opened, its playback neighbours
    // either side. `after` is not a sibling of the subject; reaching it means
    // leaving the collection, which is why this uses the playback order.
    expect(panels.map((panel) => panel.dataset.itemDetailsPanel)).toEqual([
      "neighbour",
      "centre",
      "neighbour",
    ]);
    expect(canvas.getAllByText("Before").length).toBeGreaterThan(0);
    expect(canvas.getAllByText("After").length).toBeGreaterThan(0);

    // THE SUBJECT IS WIDER, and the neighbours match each other.
    //
    // They were all one width once, and the outer two hung half off the screen
    // — which is what made "show three" mean one whole panel and two halves.
    // Sizing the middle one separately buys the same emphasis without spending
    // it on cropping: every panel is now whole, and the one being worked on is
    // simply bigger. A neighbour is still a full copy of the view rather than a
    // preview of it; it is just not the subject.
    const widths = panels.map((panel) => Math.round(panel.getBoundingClientRect().width));
    const [left, middle, right] = widths as [number, number, number];
    expect(left).toBe(right);
    // THE RATIO COMES FROM THE SIDE SCALE, not from a second width.
    //
    // The subject used to be sized separately — a wider box for the middle
    // card, 1.75x a neighbour. The deck gives every card ONE width
    // (`--clip-w`, fitted to the height it has) and pushes the neighbours back
    // with `scale(1 - 0.14)` instead, so the emphasis is depth rather than
    // measurement. 1 / 0.86 = 1.163 is that constant read off the boxes, and
    // it moves only if `CARD` side scaling in `clip-deck.tsx` does.
    expect(middle / left).toBeCloseTo(1 / 0.86, 1);
    // And now they DO fit, which is the other half of the change: three whole
    // panels and their gaps come to one viewport.
    const total = widths.reduce((sum, width) => sum + width, 0);
    expect(total).toBeLessThanOrEqual(window.innerWidth);

    // EVERY panel works, so every panel has its own controls — not just the
    // centre. The rename button is the cheapest proof that the chrome is real.
    expect(canvas.getAllByRole("button", { name: /^Rename / }).length).toBe(3);
  },
};

/**
 * THE SCRIM IS NOT A WAY OUT. Only Escape and the close button are.
 *
 * This view is worked in rather than glanced at, and the row is CROPPED by the
 * scrim rather than surrounded by it — so the dark area is where the hand
 * lands at the end of a trim, a scrub or a swipe, not somewhere it goes on
 * purpose. Dismissing there loses the position in the cut for a gesture nobody
 * meant to make.
 *
 * The Escape half is what stops this passing vacuously: it proves closing is
 * wired at all, so the scrim half is measuring a refusal rather than a modal
 * that could not close either way.
 */
export const TheScrimDoesNotDismiss: Story = {
  render: () => <SeamHarness />,
  play: async () => {
    await waitFor(() =>
      expect(document.querySelectorAll("[data-item-details-panel]").length).toBe(3),
    );
    const scrim = document.querySelector<HTMLElement>("[data-item-details]")!;

    // A press that both starts AND ends on the scrim — the strongest form of
    // the gesture that used to close it.
    fireEvent.pointerDown(scrim, { isPrimary: true, button: 0, pointerId: 1 });
    fireEvent.pointerUp(scrim, { isPrimary: true, button: 0, pointerId: 1 });
    fireEvent.click(scrim);

    // A FIXED WAIT, not a `waitFor`. The assertion is that something does NOT
    // happen, and closing is a view transition rather than a re-render: a
    // `waitFor` would find three panels still on screen in the very first
    // check — mid-transition, on their way out — and pass while the modal was
    // in the act of closing. This has to outlast the transition to mean
    // anything.
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Still open, and still showing the same three panels.
    expect(document.querySelectorAll("[data-item-details-panel]").length).toBe(3);

    // Escape still closes, which is the half that keeps the assertion above
    // honest.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector("[data-item-details]")).toBeNull());
  },
};

/** Clicking a neighbour re-centres on it, and the strip re-resolves around the
 *  new subject — the previous clip becomes the next one. */
/**
 * At the END of the timeline there is no third panel — the row is two.
 *
 * Nothing plays after the last clip, so nothing is drawn there: the strip runs
 * out rather than wrapping back to the start, which would claim a seam the cut
 * does not have.
 */
export const NoPanelPastTheEnd: Story = {
  render: () => <EndHarness />,
  play: async () => {
    await waitFor(() =>
      expect(document.querySelector('[data-item-details-panel="centre"]')).not.toBeNull(),
    );
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>("[data-item-details-panel]"),
    );
    // THE CENTRE IS THE LAST PANEL IN THE ROW — nothing is rendered past the
    // end of the timeline, so the strip simply runs out rather than wrapping
    // back to the start and claiming a seam the cut does not have.
    //
    // Asserted as a POSITION rather than a count: the row deliberately holds
    // more panels than are visible, so a number here would be pinning the
    // window's radius, which is an implementation detail of how the slide is
    // made smooth.
    expect(panels.at(-1)?.dataset.itemDetailsPanel).toBe("centre");
  },
};

/**
 * CLICKING A NEIGHBOUR'S PICTURE PULLS THE STRIP ALONG BY ONE.
 *
 * The clip you clicked becomes the centre and everything shifts one position,
 * the way film moves through a gate — so you can walk a scene by clicking
 * forward, or back, without ever closing the view.
 *
 * The picture is the target because every panel is fully live: the grips, the
 * title and the tag field all have jobs already, and the hero is the one large
 * surface in a neighbour with nothing else to do.
 */
export const ClickingANeighbourAdvancesTheStrip: Story = {
  render: () => <SeamHarness />,
  play: async () => {
    const canvas = within(document.body);
    await waitFor(() =>
      expect(document.querySelectorAll("[data-item-details-panel]").length).toBe(3),
    );

    const centreName = centreClipName;
    expect(centreName()).toBe("Subject");

    // The RIGHT-hand panel's picture: one step forward.
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>("[data-item-details-panel]"),
    );
    const rightHero = panels[2]!.querySelector<HTMLElement>("[data-item-details-frame]")!;
    // A TAP, SPELLED AS POINTERS. The deck decides tap-versus-swipe from the
    // pointer stream itself — down, how far it travelled, up — and never reads
    // `click`, so `.click()` here dispatched an event nothing was listening
    // for and the story reported a step that had simply never been asked for.
    // Under `TAP_SLOP_PX` of travel is what makes this a tap.
    const tap = { isPrimary: true, pointerId: 1, button: 0 };
    const spot = rightHero.getBoundingClientRect();
    const at = { clientX: spot.left + spot.width / 2, clientY: spot.top + spot.height / 2 };
    fireEvent.pointerDown(rightHero, { ...tap, ...at });
    fireEvent.pointerUp(rightHero, { ...tap, ...at });

    // NO TIMING ASSERTION HERE, DELIBERATELY. This used to sample the row
    // 120ms apart and require the two readings to differ — "still in flight a
    // third of the way through a 300ms ease". It passed alone and failed in
    // the full run, which is the tell: nothing guarantees the first sample
    // lands at the animation's START. Under load the click, the render and
    // the whole ease can fall between two reads, and the story then reports a
    // step that eased perfectly as a step that jumped.
    //
    // What a step does that a landing does not is covered below by ORDER — the
    // clip that was centred is now to the left of centre — and the landing's
    // own story proves the other half geometrically, with the row at its seat
    // and staying there. Neither of those depends on catching a frame.

    await waitFor(() => expect(centreName()).toBe("After"));

    // THE ROW MOVED, rather than the panels swapping content where they stood.
    // The clip that was centred is now immediately to the LEFT of the centre,
    // which is only true if the strip travelled one position.
    const after = Array.from(
      document.querySelectorAll<HTMLElement>("[data-item-details-panel]"),
    );
    const centreIndex = after.findIndex(
      (panel) => panel.dataset.itemDetailsPanel === "centre",
    );
    const leftOfCentre = clipName(after[centreIndex - 1]);
    expect(leftOfCentre).toBe("Subject");
    // And it is the last one: nothing plays after `after`.
    expect(centreIndex).toBe(after.length - 1);
    void canvas;
  },
};

/**
 * ON OPEN, THE MIDDLE PANEL SHOWS ITS OWN CLIP.
 *
 * The regression this pins: the seam clock starts at bar-second zero, and zero
 * on that bar is the start of the RUN-UP — which belongs to the PREVIOUS clip.
 * So a freshly opened modal monitored its neighbour before anyone had touched
 * anything, and the middle picture showed the wrong clip or, while a source it
 * had never needed loaded, nothing at all.
 *
 * The fix is that "not scrubbed" is a different state from "scrubbed to zero",
 * and this is the assertion that keeps it that way.
 */
export const OpensShowingItsOwnPicture: Story = {
  render: () => <SeamHarness />,
  play: async () => {
    await waitFor(() =>
      expect(document.querySelector('[data-item-details-panel="centre"]')).not.toBeNull(),
    );
    const centre = document.querySelector('[data-item-details-panel="centre"]')!;
    const picture = frameImage(centre);
    expect(picture).not.toBe("");
    // The SUBJECT's plate, not the one before it.
    expect(picture).toContain("SUBJECT");
    // And no playhead line anywhere yet: nothing is playing, so nothing claims
    // to be.
    expect(document.querySelectorAll("[data-seam-playhead-line]").length).toBe(0);
  },
};


/**
 * HOW A PANEL IS MARKED AS THE SUBJECT, read the way the eye reads it.
 *
 * The mark is the border's ALPHA — 0.16 on the subject against 0.07 on a
 * neighbour — so the question "is this one marked" is really "is its edge
 * brighter than the others". Comparing the two rather than matching a colour
 * string keeps the assertion about the DIFFERENCE, which is the only part
 * anyone can see, and keeps it honest if the palette is ever retuned.
 *
 * Tailwind emits these as `oklab(... / A)`, so the alpha is the last number in
 * the string; a colour with no alpha at all is fully opaque.
 */
function borderAlpha(panel: HTMLElement): number {
  const parts = getComputedStyle(panel).borderTopColor.match(/[\d.]+/g) ?? [];
  return parts.length >= 4 ? Number(parts[parts.length - 1]) : 1;
}

/** The subject's edge, against the brightest edge any neighbour is wearing. */
function subjectIsMarked(): boolean {
  const centre = document.querySelector<HTMLElement>('[data-item-details-panel="centre"]')!;
  const neighbours = Array.from(
    document.querySelectorAll<HTMLElement>('[data-item-details-panel="neighbour"]'),
  );
  if (neighbours.length === 0) return borderAlpha(centre) > 0;
  return borderAlpha(centre) > Math.max(...neighbours.map(borderAlpha));
}

/**
 * THE MARK SAYS WHICH PANEL IS THE SUBJECT, AND NEVER MOVES.
 *
 * It used to follow the playhead: whichever clip's frames were on the monitor
 * wore it, so during a run-up it sat on a neighbour. The idea was to tie the
 * line moving through the bar to the panel it belonged to.
 *
 * In use it read as flicker — a halo hopping between panels as the clock
 * crossed a seam, drawing the eye to the frame it was meant to be quietly
 * identifying. The bar has a playhead and a marked box for saying where
 * playback is, and two answers to one question is one too many.
 *
 * So the mark answers the simpler question it is well shaped for, constantly:
 * which of these panels is the one you opened. Asserted as an INVARIANT rather
 * than a transition — it must not move when the clock does, which is the whole
 * change.
 */
export const TheSubjectMarkStandsStillWhileTheClockMoves: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());

    expect(subjectIsMarked()).toBe(true);

    // Move the clock right across a seam and onto another clip's frames. The
    // monitor changes; the mark does not.
    //
    // HELD, NOT RELEASED. Letting go now lands the row on whatever the
    // playhead reached, and this story is about the mark during the look —
    // the state where the monitor is showing one clip and the subject is
    // still another. Releasing would collapse the two and the assertion
    // would be trivially true.
    const boxes = seamBoxes();
    const centreIndex = boxes.indexOf(centreBox());
    expect(centreIndex).toBeGreaterThan(0);
    await settleStrip();
    nudgePlayhead(1);
    await waitFor(() =>
      expect(seamTrack().getAttribute("aria-valuenow")).not.toBe(null),
    );
    expect(subjectIsMarked()).toBe(true);
  },
};

/**
 * ONE MARK, AND IT DOES NOT COMPETE WITH THE PICTURES.
 *
 * Panels are identical but for their focus falloff: the subject sits on a
 * lighter surface behind a brighter edge, and its neighbours recede. It wore a
 * heavy white border for a while — the loudest mark on the screen, spent on
 * the one fact the layout already tells you — then two pixels of sky with a
 * 36px halo, which had to shout because it was moving, and then a white ring.
 * Standing still, two clicks of contrast are enough.
 *
 * GEOMETRY IS UNTOUCHED. Only the border's COLOUR changes with focus, never
 * its width: a 2px edge on the subject would push its picture down a pixel and
 * shorten it by two, and comparing frames ACROSS panels is what this view is
 * for.
 *
 * BOTH HALVES ARE ASSERTED. Surface and border move together because either
 * alone is too quiet to survive a screen full of pictures, so a change that
 * silently dropped one would leave a mark that still technically exists and no
 * longer reads.
 */
export const OnlyTheSubjectPanelIsMarked: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    const centre = document.querySelector<HTMLElement>('[data-item-details-panel="centre"]')!;
    const neighbour = document.querySelector<HTMLElement>('[data-item-details-panel="neighbour"]')!;

    // Same box, brighter edge: the mark costs no width.
    expect(getComputedStyle(centre).borderTopWidth).toBe(
      getComputedStyle(neighbour).borderTopWidth,
    );
    expect(borderAlpha(centre)).toBeGreaterThan(borderAlpha(neighbour));

    // ...AND A LIFT UNDER IT. Which second half this is has changed, and the
    // rule it serves has not: the mark is two things, because either alone is
    // too quiet to survive a screen full of pictures.
    //
    // It used to be the SURFACE — a lighter panel under the brighter edge. The
    // deck stacks its cards in depth instead: one gradient on every card, and
    // the subject separated by coming forward. So the second half is the
    // SHADOW, which on the subject adds a ring and a glow the others do not
    // have. Asserting the surface here would now be asserting that the deck
    // never adopted the design it did adopt.
    expect(getComputedStyle(centre).boxShadow).not.toBe(
      getComputedStyle(neighbour).boxShadow,
    );

    // AND IT STILL SAYS "SUBJECT" RATHER THAN "PLAYING". This is the half the
    // story was written for: a ring that followed the PLAYHEAD meant the mark
    // moved while you were reading, so nudging the clock must not change which
    // card is marked or how.
    const before = {
      centre: getComputedStyle(centre).boxShadow,
      neighbour: getComputedStyle(neighbour).boxShadow,
    };
    await settleStrip();
    nudgePlayhead(1);
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    expect(getComputedStyle(centre).boxShadow).toBe(before.centre);
    expect(getComputedStyle(neighbour).boxShadow).toBe(before.neighbour);
    expect(getComputedStyle(neighbour).boxShadow).not.toMatch(/56, 189, 248/);
  },
};

/**
 * SWIPING THE PICTURE MOVES THE STRIP.
 *
 * The same instruction as clicking a neighbour, held — and the one that has to
 * work on a touchscreen, where there is no hover to discover a click target
 * with. Driven with pointer events because that is what the gesture listens
 * for: one implementation covers a finger, a trackpad and a mouse.
 *
 * `isPrimary` is not decoration here — dnd-kit's sensor ignores a whole
 * sequence without it, and so does this.
 */
export const SwipingThePictureAdvancesTheStrip: Story = {
  render: () => <SeamHarness />,
  play: async () => {
    await waitFor(() =>
      expect(document.querySelector('[data-item-details-panel="centre"]')).not.toBeNull(),
    );
    const titleOfCentre = centreClipName;

    expect(titleOfCentre()).toBe("Subject");

    const picture = document
      .querySelector('[data-item-details-panel="centre"]')!
      .querySelector<HTMLElement>("[data-item-details-frame]")!;

    // A STILL MUST NOT BE DRAGGABLE, or there is no swipe on it at all: an
    // `<img>` is draggable by default and a `<video>` is not, so the gesture
    // worked on video panels and died on stills — the browser took it as a
    // native image drag on the first move and swallowed the rest of the
    // sequence before any of this code saw it.
    //
    // ASSERTED AS STRUCTURE, not as behaviour, and the distinction is the
    // reason the bug survived this file: `fireEvent` pointers never start a
    // native drag, so the swipe below passes whether or not the guard is
    // there. Only a real pointer reproduces it. This at least fails if an
    // `<img>` comes back.
    //
    // THE GUARD BECAME UNNECESSARY RATHER THAN BEING REMOVED. The deck paints
    // the frame as a background on a plain element, and there is no such thing
    // as a native drag on a background — so the failure mode is gone at the
    // root instead of being suppressed per element. Still worth pinning: a
    // card that went back to an `<img>` would bring the bug back with it, and
    // this is the line that would say so.
    expect(picture.querySelector("img")).toBeNull();
    expect(frameImage(document.querySelector('[data-item-details-panel="centre"]'))).not.toBe("");

    const box = picture.getBoundingClientRect();
    const y = box.top + box.height / 2;

    // SWIPED IN REAL TIME, and the reason is a bug this story hid rather than
    // caught.
    //
    // The deck finishes a swipe by PROJECTING it: where the film would coast
    // to at the speed the hand let go, `velocity * 160ms`. Three `fireEvent`
    // calls in a row land inside a fraction of a millisecond, so half a card
    // of travel read as hundreds of pixels per millisecond and every swipe
    // flung to the end of the scene. This fixture has three clips, so "the end"
    // and "one step" are the SAME CLIP going forward — the forward assertion
    // passed for two releases while measuring nothing, and only the return trip
    // (where the end is one clip too far) ever said so.
    //
    // Six moves, 25ms apart, is a hand covering ~300px in 150ms — about 2px/ms,
    // which projects a third of a card and lands one along. The numbers are a
    // real gesture rather than a tuned one; anything a hand could actually do
    // gives the same answer.
    const STEPS = 6;
    const STEP_MS = 25;
    const swipe = async (element: HTMLElement, from: number, to: number, at: number) => {
      const args = { isPrimary: true, pointerId: 1, button: 0, clientY: at };
      fireEvent.pointerDown(element, { ...args, clientX: from });
      for (let step = 1; step <= STEPS; step += 1) {
        await new Promise((resolve) => setTimeout(resolve, STEP_MS));
        fireEvent.pointerMove(element, {
          ...args,
          clientX: from + ((to - from) * step) / STEPS,
        });
      }
      fireEvent.pointerUp(element, { ...args, clientX: to });
    };

    // Dragged LEFT: the film moves the way the hand moves, so the clip after
    // this one arrives from the right.
    await swipe(picture, box.left + box.width * 0.8, box.left + box.width * 0.1, y);
    await waitFor(() => expect(titleOfCentre()).toBe("After"));

    // And back.
    const back = document
      .querySelector('[data-item-details-panel="centre"]')!
      .querySelector<HTMLElement>("[data-item-details-frame]")!;
    const backBox = back.getBoundingClientRect();
    await swipe(
      back,
      backBox.left + backBox.width * 0.1,
      backBox.left + backBox.width * 0.8,
      backBox.top + backBox.height / 2,
    );
    await waitFor(() => expect(titleOfCentre()).toBe("Subject"));
  },
};

/**
 * A MOSTLY-VERTICAL DRAG IS NOT A SWIPE, asserted through the real component
 * rather than only against the rule.
 *
 * On a phone this is the difference between a usable modal and one that flings
 * itself to another clip every time a thumb travels down the screen — and a
 * thumb travelling down a screen covers plenty of horizontal distance on the
 * way, which is why the rule compares the two rather than just measuring dx.
 */
export const ADragDownTheScreenIsNotASwipe: Story = {
  render: () => <SeamHarness />,
  play: async () => {
    await waitFor(() =>
      expect(document.querySelector('[data-item-details-panel="centre"]')).not.toBeNull(),
    );
    const titleOfCentre = centreClipName;

    const picture = document
      .querySelector('[data-item-details-panel="centre"]')!
      .querySelector<HTMLElement>("[data-item-details-frame]")!;
    const box = picture.getBoundingClientRect();
    const args = { isPrimary: true, pointerId: 1, button: 0 };
    const x0 = box.left + box.width * 0.7;
    const y0 = box.top + box.height * 0.2;

    fireEvent.pointerDown(picture, { ...args, clientX: x0, clientY: y0 });
    fireEvent.pointerMove(picture, { ...args, clientX: x0 - 60, clientY: y0 + 140 });
    fireEvent.pointerMove(picture, { ...args, clientX: x0 - 120, clientY: y0 + 300 });
    fireEvent.pointerUp(picture, { ...args, clientX: x0 - 120, clientY: y0 + 300 });

    // Unmoved, and still unmoved after anything queued has run.
    await waitFor(() => expect(titleOfCentre()).toBe("Subject"));
    expect(titleOfCentre()).toBe("Subject");
  },
};

/**
 * EVERY PANEL SHOWS ITS OWN FIRST FRAME, AND NOTHING LABELS IT.
 *
 * This used to be the opposite claim. The clip before the centre rested on its
 * LAST frame and the one after on its first, each with a small caption —
 * "Last frame", "First frame" — hugging the seam it described, on the
 * reasoning that a clip before a cut is best represented by what it hands
 * over.
 *
 * Both went. The last frame read as simply the wrong picture: a card is the
 * SHOT, and a shot is what it opens on, so a card resting on its final frame
 * is a card showing you the least characteristic moment it has. And once every
 * panel rests the same way there is nothing for a caption to disambiguate —
 * two words per neighbour, on every strip, saying what the pictures already
 * agreed on.
 *
 * Asserted as an absence, deliberately: the captions are the thing that must
 * not come back, and their DOM hook is the only durable trace they left.
 */
export const TheNeighboursSayWhichFrameTheyShow: Story = {
  render: () => <SeamHarness />,
  play: async () => {
    await waitFor(() =>
      expect(document.querySelectorAll("[data-item-details-panel]").length).toBe(3),
    );
    expect(document.querySelectorAll("[data-item-details-seam-label]").length).toBe(0);

    // And the flanking panels are treated identically — the asymmetry the
    // captions existed to explain is gone from the pictures too.
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>("[data-item-details-panel]"),
    );
    const [before, , after] = panels;
    const frameOf = (panel: HTMLElement) =>
      panel.querySelector<HTMLElement>("[data-item-details-frame]")!;
    expect(frameOf(before!).className).toBe(frameOf(after!).className);
  },
};

/**
 * FIVE AND FIFTEEN KEEP THE SUBJECT IN THE MIDDLE.
 *
 * The counts are odd for a reason worth pinning rather than commenting: the
 * strip exists to put one clip in the centre with the same amount of timeline
 * either side. An even count has no centre, so the clip being worked on would
 * sit off to one side and its two seams would be at different distances from
 * the eye.
 *
 * Asserted by MEASURING where the centre panel lands against the viewport's
 * middle, at each count, because that is the actual claim — not that a class
 * changed, but that the thing stayed centred while everything around it got
 * narrower.
 */
export const TheCountChangesHowManyClipsAreOnScreen: Story = {
  render: () => <SeamHarness scene={LONG_SCENE} />,
  play: async () => {
    await waitFor(() =>
      expect(document.querySelector('[data-item-details-panel="centre"]')).not.toBeNull(),
    );
    const picker = document.querySelector("[data-details-view-count]")!;
    expect(picker).not.toBeNull();

    // HOW MANY PANELS ARE ACTUALLY ON SCREEN — the claim the count makes, and
    // the one the first attempt failed: it scaled the panels narrower without
    // fitting more of them, so five showed the same three as three did. A
    // width assertion cannot tell those apart; counting what intersects the
    // viewport can.
    // ON SCREEN MEANS VISIBLE. The pair held ready beyond the window keeps its
    // width — the row's centring is arithmetic over uniform neighbour widths —
    // so it still reports a box, and now that `count` panels fill the viewport
    // exactly, that box lands inside the scrim's own padding rather than off
    // the edge. `data-item-details-spare` is the panel saying it is built and
    // waiting rather than being shown.
    const onScreen = () =>
      Array.from(document.querySelectorAll("[data-item-details-panel]")).filter((panel) => {
        if (panel.parentElement?.hasAttribute("data-item-details-spare")) return false;
        const box = panel.getBoundingClientRect();
        return box.right > 1 && box.left < window.innerWidth - 1 && box.width > 0;
      }).length;
    const centreOffset = () => {
      const box = document
        .querySelector('[data-item-details-panel="centre"]')!
        .getBoundingClientRect();
      return Math.abs(box.left + box.width / 2 - window.innerWidth / 2);
    };
    const press = async (label: string) => {
      const button = Array.from(picker.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === label,
      )!;
      expect(button).not.toBeNull();
      fireEvent.click(button);
      await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    };

    // Three: the middle one whole, one truncated either side.
    await waitFor(() => expect(onScreen()).toBe(3));
    expect(centreOffset()).toBeLessThan(2);

    // Five means FIVE — three whole and two halves, not three narrower ones.
    await press("5");
    await waitFor(() => expect(onScreen()).toBe(5));
    expect(centreOffset()).toBeLessThan(2);

    await press("3");
    await waitFor(() => expect(onScreen()).toBe(3));
    expect(centreOffset()).toBeLessThan(2);
  },
};

/**
 * THE NEIGHBOURS FADE BACK WHILE THE CLOCK RUNS.
 *
 * Once playback is engaged the middle picture is a monitor — it shows whatever
 * is on screen at that instant, including a neighbour's own frames — so two
 * bright stills either side of it compete with the one thing the view exists
 * for. They lose opacity AND colour: opacity alone leaves a picture that still
 * reads, while draining the colour puts them in the past tense.
 *
 * Both transition, so engaging the clock reads as attention moving rather than
 * as two panels blinking off.
 */
export const TheNeighboursFadeBackDuringPlayback: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    const track = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-seam-track]");
      expect(found).not.toBeNull();
      return found!;
    });
    const frameOf = (which: string) =>
      document
        .querySelector(`[data-item-details-panel="${which}"]`)!
        .querySelector<HTMLElement>("[data-item-details-frame]")!;

    // Untouched: nothing is dimmed, because nothing is being watched yet.
    expect(getComputedStyle(frameOf("neighbour")).opacity).toBe("1");
    expect(getComputedStyle(frameOf("centre")).opacity).toBe("1");

    await settleStrip();
    nudgePlayhead(1);

    // Engaged: the neighbours pull back, in both opacity and colour…
    // Scrubbed: the neighbours pull back, in both opacity and colour.
    //
    // ASSERTED AS "MOVING TOWARD" RATHER THAN "ARRIVED AT". This runner does
    // not carry a CSS transition to completion — the computed opacity sits at
    // whatever midpoint it froze on — so pinning the exact end value would be
    // testing the environment rather than the component. What is checked is
    // that the target is set and that it is genuinely taking effect: the class
    // carries the destination, and the painted value has left 1 behind.
    await waitFor(() => {
      const el = frameOf("neighbour");
      const style = getComputedStyle(el);
      expect(el.className).toContain("opacity-25");
      expect(Number(style.opacity)).toBeLessThan(1);
      expect(style.filter).toContain("grayscale");
    });
    // …and the monitor keeps both, because it is the one being read.
    const centre = getComputedStyle(frameOf("centre"));
    expect(Number(centre.opacity)).toBe(1);
    expect(centre.filter === "none" || centre.filter.includes("grayscale(0")).toBe(true);
  },
};


/**
 * ADDING A TAG IS AN ICON AT THE END OF THE TAGS, NOT A ROW.
 *
 * A permanently open text field costs a full row on every panel whether or not
 * anyone is tagging anything — nine rows of empty input on a nine-up strip.
 * The chips and the add control share one row now, and the field appears when
 * it is asked for.
 *
 * The popover STAYS OPEN after a commit on purpose: tags arrive in threes more
 * often than singly, and reopening between them is the annoying part.
 */
export const TagsAreAddedFromAnIcon: Story = {
  render: () => <SeamHarness />,
  play: async () => {
    const centre = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-item-details-panel="centre"]');
      expect(found).not.toBeNull();
      return found!;
    });
    const editor = centre.querySelector<HTMLElement>("[data-tag-editor]")!;
    expect(editor).not.toBeNull();

    // Closed: no field taking a row of its own.
    expect(editor.querySelector("[data-tag-popover]")).toBeNull();
    expect(editor.querySelector("input")).toBeNull();

    const add = editor.querySelector<HTMLButtonElement>("[data-tag-add]")!;
    expect(add).not.toBeNull();
    // It sits AFTER the chips, which is where the next tag would go.
    //
    // Asked as a question about DOCUMENT ORDER rather than about who the
    // previous sibling is. The chips now live in a scroller of their own, so
    // that the row can be exactly one line high without clipping this
    // button's popover — which makes the button's previous sibling the
    // scroller, not a chip, while the thing being claimed is unchanged.
    for (const chip of Array.from(editor.querySelectorAll("[data-tag-chip]"))) {
      expect(
        Boolean(chip.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true);
    }

    fireEvent.click(add);
    const field = await waitFor(() => {
      const found = editor.querySelector<HTMLInputElement>("[data-tag-popover] input");
      expect(found).not.toBeNull();
      return found!;
    });

    fireEvent.change(field, { target: { value: "night" } });
    fireEvent.keyDown(field, { key: "Enter" });

    // The chip lands, and the field is still there to take the next one.
    await waitFor(() => expect(editor.querySelector('[data-tag-chip="night"]')).not.toBeNull());
    expect(editor.querySelector("[data-tag-popover]")).not.toBeNull();

    // Escape puts it away without touching the modal behind it.
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect(editor.querySelector("[data-tag-popover]")).toBeNull());
    expect(document.querySelector('[data-item-details-panel="centre"]')).not.toBeNull();
  },
};

/**
 * THE PICTURES LINE UP, AND NARROW PANELS SHED THEIR CONTROLS.
 *
 * Two claims, and the first one is the reason the second exists. This view is
 * for comparing frames across panels, so the frames have to occupy the same
 * box in every one of them — and they did not: the opened clip carried a 2px
 * border against its neighbours' 1px, which pushed its picture down a pixel
 * and shortened it by two. The mark is a RING now, painted outside the box,
 * so it costs no layout at all.
 *
 * The second is a container query, not a count. Five panels on a large monitor
 * have more room each than three on an iPad, so the rule is the panel's own
 * width: below 30rem the trim strip, the tags and the header's extras go, and
 * the panel fits its picture instead of holding two thirds of the screen with
 * most of it black.
 */
/**
 * A COUNT CHANGE IS A RESIZE, NOT A REPLACEMENT (PL15-005).
 *
 * Switching 3 to 5 read as the three panels animating off and five animating
 * on. Nothing is actually being replaced: the subject is the same clip and its
 * neighbours are the same clips, so what should happen is that the panels on
 * screen shrink into their new width and two more arrive at the edges.
 *
 * IT WAS NEVER A KEYING PROBLEM, which is what made it worth pinning here. The
 * row renders every id in the flat order keyed by `id`, and mounts real panels
 * within `MOUNTED_RADIUS = floor(count / 2) + 1` — so at three the visible set
 * is centre +/-1 and the mounted set is centre +/-2, and at five the visible
 * set is centre +/-2. The two panels that BECOME visible were already mounted;
 * React never threw anything away. The identity assertion below states that,
 * so a future "fix" that starts remounting them fails here.
 *
 * What did change discontinuously was HEIGHT — see the neighbour branch in
 * `graph-item-details-panel`. That is what the second assertion is for.
 */

export const ChangingTheCountResizesTheSamePanels: Story = {
  // A LONG scene on purpose. `TRIMMED_SCENE` holds three clips, so "show five"
  // has nothing to show and the step this story is about cannot happen at all.
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    const panels = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-item-details-panel]"));
    await waitFor(() => expect(panels().length).toBeGreaterThanOrEqual(3));

    const press = async (label: string) => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>("[data-details-view-count] button"),
      ).find((b) => b.textContent?.trim() === label)!;
      fireEvent.click(button);
      await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    };

    // The ELEMENTS, held across the step. Identity, not a count or a name — a
    // replacement would satisfy either of those and is exactly what is being
    // ruled out.
    const before = panels();
    const heightsBefore = before.map((panel) => Math.round(panel.getBoundingClientRect().height));

    await press("5");
    // MOUNTED, not visible: the row keeps a spare panel either side of what can
    // be seen, so the count is `min(ids, count + 2)` rather than the count.
    // What matters here is that it GREW — five-up mounts more than three-up —
    // and the identity assertions below carry the actual claim.
    await waitFor(() => expect(panels().length).toBeGreaterThan(before.length));

    const after = panels();
    for (const panel of before) {
      expect(after).toContain(panel);
    }

    // AND A NEIGHBOUR'S HEIGHT IS A RULE, NOT ITS PICTURE'S.
    //
    // The height used to be a container query on the panel's own WIDTH — a
    // definite 38.9vh over 30rem, `h-auto` under it — and a count change walks
    // straight across that threshold: measured at 1920, a neighbour is 490px
    // at three-up and 314px at five-up. `auto` cannot be interpolated, so
    // every neighbour's height jumped in one frame while its width eased,
    // which is most of what read as a replacement.
    //
    // ASSERTED AS INVARIANCE, which is what the rule became.
    //
    // The number used to be 38.9vh, and it was pinned as a VALUE rather than a
    // delta for a reason worth keeping: the old height was a container query on
    // the panel's own WIDTH, `h-auto` under 30rem, and a count change walks
    // straight across that threshold — but this story's viewport is narrower
    // than 1880, so both counts fell under the gate together and a delta
    // comparison passed against the unfixed code.
    //
    // The deck has no such gate. Every card is one box, sized from the height
    // the deck was given, and `neighbours` changes only how many are DRAWN —
    // so the height cannot depend on the count, and saying so directly is both
    // stronger than the old number and immune to the trap that number was
    // guarding against. A deck that resized its cards per count fails here.
    const neighbourHeight = () => {
      const neighbour = panels().find(
        (panel) => panel.getAttribute("data-item-details-panel") === "neighbour",
      )!;
      return neighbour.getBoundingClientRect().height;
    };
    expect(heightsBefore.length).toBeGreaterThan(0);
    expect(neighbourHeight()).toBeCloseTo(Math.min(...heightsBefore), 0);

    // Back again, and every panel that remains was one of the originals — the
    // return trip is a resize too, not a fresh set.
    await press("3");
    await waitFor(() => expect(panels().length).toBe(before.length));
    for (const panel of panels()) {
      expect(before).toContain(panel);
    }
  },
};

export const NarrowPanelsShedTheirControlsAndStayAligned: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    const panels = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-item-details-panel]"));
    await waitFor(() => expect(panels().length).toBe(3));

    const geometry = () =>
      panels().map((panel) => {
        const frame = panel.querySelector<HTMLElement>("[data-item-details-frame]")!;
        const box = frame.getBoundingClientRect();
        return `${Math.round(box.top * 10) / 10}/${Math.round(box.height * 10) / 10}`;
      });
    const borders = () =>
      panels().map((panel) => getComputedStyle(panel).borderTopWidth);
    const visible = (selector: string) =>
      panels().some(
        (panel) => (panel.querySelector(selector)?.getBoundingClientRect().height ?? 0) > 0,
      );
    const press = async (label: string) => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>("[data-details-view-count] button"),
      ).find((b) => b.textContent?.trim() === label)!;
      fireEvent.click(button);
      await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    };

    // EVERY panel has the same border, so none of them is a pixel out.
    expect(new Set(borders()).size).toBe(1);
    // And the NEIGHBOURS all occupy exactly the same box.
    //
    // It used to be every panel, which stopped being the claim when the middle
    // one started being wider on purpose: a bigger panel holds a bigger
    // picture, and the centre's frame is taller than its neighbours' by
    // exactly the ratio between them. What alignment means here is that
    // nothing is a pixel out from its PEERS — so the neighbours are checked
    // against each other, and the centre is checked for being the odd one out
    // in the direction it is meant to be odd in.
    await waitFor(() => {
      const boxes = geometry();
      const middle = panels().findIndex(
        (panel) => panel.dataset.itemDetailsPanel === "centre",
      );
      const others = boxes.filter((_, index) => index !== middle);
      expect(new Set(others).size).toBe(1);
    });
    // ── AND THE HEIGHT RULE IS ABOUT ROLE, NOT WIDTH ─────────────────────
    //
    // The panel's height used to be a container query alone: over 30rem you
    // took a fixed 68vh, under it you fitted your picture. That is a PROXY for
    // "am I the subject", and it breaks on a large screen — at 2560x1440 a
    // neighbour is 544px wide, clears the query, and takes the same 979px the
    // centre does, so the 1.75 width ratio produces no height difference at
    // all.
    //
    // Asserted on the CLASS rather than the rendered height, because a story
    // canvas cannot be 2560 wide: what must hold is that the two roles ask for
    // different heights, which is the thing a revert to one shared rule would
    // undo. The measurement itself was taken against the running app — 979
    // against 546, a 1.79 height ratio beside a 1.76 width ratio.
    {
      const heightRule = (panel: HTMLElement) =>
        Array.from(panel.classList).filter((name) => name.includes("h-[")).join(" ");
      const centrePanel = panels().find(
        (panel) => panel.dataset.itemDetailsPanel === "centre",
      )!;
      const neighbourPanel = panels().find(
        (panel) => panel.dataset.itemDetailsPanel === "neighbour",
      )!;
      expect(heightRule(centrePanel)).not.toBe("");
      expect(heightRule(neighbourPanel)).not.toBe("");
      expect(heightRule(centrePanel)).not.toBe(heightRule(neighbourPanel));
      // Every neighbour asks for the SAME height — they must match each other,
      // and fitting each to its own picture (the first attempt here) gave four
      // different heights at five-up.
      expect(
        new Set(
          panels()
            .filter((panel) => panel.dataset.itemDetailsPanel === "neighbour")
            .map(heightRule),
        ).size,
      ).toBe(1);
    }

    const centreFrame = panels()
      .find((panel) => panel.dataset.itemDetailsPanel === "centre")!
      .querySelector<HTMLElement>("[data-item-details-frame]")!;
    const neighbourFrame = panels()
      .find((panel) => panel.dataset.itemDetailsPanel === "neighbour")!
      .querySelector<HTMLElement>("[data-item-details-frame]")!;
    expect(centreFrame.getBoundingClientRect().height).toBeGreaterThan(
      neighbourFrame.getBoundingClientRect().height,
    );

    // Five up is the narrow end now: the controls go — from the NEIGHBOURS.
    //
    // They all shed them together once, because every panel was the same
    // width. The subject is wider than its neighbours now, and at five up that
    // difference lands either side of the threshold: a neighbour is too narrow
    // to hold a source strip and the middle one is not. Which is the right
    // outcome rather than a tolerated one — the panel being worked on is
    // exactly the one that should keep its trim controls longest.
    const neighbourShows = (selector: string) =>
      panels()
        .filter((panel) => panel.dataset.itemDetailsPanel !== "centre")
        .some((panel) => (panel.querySelector(selector)?.getBoundingClientRect().height ?? 0) > 0);
    await press("5");
    // ALL THREE IN ONE WAIT, because they all describe the SAME settled state.
    //
    // Only the first used to wait and the other two read whatever frame they
    // landed on. Pressing "5" re-renders three panels and their controls drop
    // out as the width crosses each threshold — the trim strip goes first, so
    // waiting on it alone can return while a tag editor or an undo button is
    // still mounted. It passed almost always and failed under load, which is
    // the shape that costs an afternoon: the run that fails is never the run
    // that changed anything.
    await waitFor(() => {
      expect(neighbourShows("[data-trim-overview]")).toBe(false);
      expect(visible("[data-item-details-undo]")).toBe(false);
    });

    // THE TAG ROW IS THE ONE CONTROL THAT NO LONGER SHEDS, and it stopped
    // for the sake of something this story is also about: alignment.
    //
    // It used to be gated at 30rem like the rest, which meant that at a 1280
    // canvas the wide centre kept its tags while the narrow neighbours
    // dropped theirs. Everything below the filmstrip then differed in height
    // by that row, and because the cards hang from a common bottom, the
    // neighbours' strips sat 37px off the centre's — the three trim windows
    // this view exists to compare were on three different lines.
    //
    // So it is always present and always one line high. A narrow panel could
    // not be tagged at all before, so this shed nothing to gain it.
    expect(visible("[data-tag-editor]")).toBe(true);
    // AND THE FILMSTRIP FILLS THE BOX IT WAS MEASURED FROM.
    //
    // Its width is a NUMBER, handed down so frames can be laid out, and it was
    // read once when the slot mounted and never again. Every width a panel
    // actually has arrives after that: the same element is a neighbour one
    // moment and the centre the next as the strip advances, the centre is
    // deliberately wider, and pressing "5" — which this story has just done —
    // changes both. So the strip drew at whichever width it happened to mount
    // at. Measured here before the fix: 581px of film inside a 357px slot.
    //
    // Asserted for whatever still HAS a strip rather than for every panel,
    // because shedding it is the other half of this story.
    for (const panel of panels()) {
      const strip = panel.querySelector<HTMLElement>("[data-trim-overview]");
      if (strip === null) continue;
      const slot = panel.querySelector<HTMLElement>("[data-trim-strip-slot]")!;
      expect(
        Math.abs(strip.getBoundingClientRect().width - slot.getBoundingClientRect().width),
      ).toBeLessThan(1);
    }

    // Still aligned, and still identically bordered — among peers, as above.
    const middleAt = panels().findIndex(
      (panel) => panel.dataset.itemDetailsPanel === "centre",
    );
    expect(new Set(geometry().filter((_, index) => index !== middleAt)).size).toBe(1);
    expect(new Set(borders()).size).toBe(1);

    // The name survives everything — it is what says which clip this is.
    expect(
      panels().every((panel) => (panel.textContent ?? "").trim().length > 0),
    ).toBe(true);
  },
};



/**
 * EVERY PANEL OFFERS "PLAY THIS ONE", AT EVERY WIDTH.
 *
 * The bar's play button starts wherever the playhead happens to be — the right
 * default for judging the cut in front of you, and no answer at all to "let me
 * see that shot". So the question is asked a second time, at the clip: one
 * button per panel, over the picture, which moves the clock to that clip's
 * first frame.
 *
 * THE WIDTH CLAIM IS THE ONE WORTH PINNING. Below 30rem a panel sheds its trim
 * strip, its tags and its history pair — and at nine up every panel is below
 * 30rem. A play button that went with them would leave the wide views, which
 * are exactly the views you scan a sequence in, with nothing to play anything
 * from. So it is asserted at nine specifically, alongside the controls that
 * are gone, rather than only in the roomy three-up case.
 *
 * The bar's own button is asserted still present: this adds a second way to
 * start playback, it does not replace the first.
 */
export const EveryPanelOffersPlayFromItsOwnStart: Story = {
  render: () => <SeamHarness scene={LONG_SCENE} />,
  play: async () => {
    // ON SCREEN MEANS VISIBLE, not merely mounted at a coordinate inside the
    // viewport. The pair held ready beyond the window keeps its width — the
    // row's centring is arithmetic over uniform neighbour widths — so it still
    // reports a box, and now that `count` panels fill the viewport exactly that
    // box lands inside the scrim's own padding. `data-item-details-spare` is
    // the panel saying it is built but not being shown.
    const onScreenPanels = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-item-details-panel]")).filter(
        (panel) => {
          const slot = panel.parentElement;
          if (slot?.hasAttribute("data-item-details-spare")) return false;
          const box = panel.getBoundingClientRect();
          return box.right > 1 && box.left < window.innerWidth - 1 && box.width > 0;
        },
      );
    const press = async (label: string) => {
      const button = await waitFor(() => {
        const found = Array.from(
          document.querySelectorAll<HTMLButtonElement>("[data-details-view-count] button"),
        ).find((b) => b.textContent?.trim() === label);
        expect(found).not.toBeUndefined();
        return found!;
      });
      fireEvent.click(button);
      await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    };

    // STATED, NOT ASSUMED. The chosen count is remembered at MODULE scope — a
    // working posture for a session rather than a per-modal setting — so it
    // leaks between stories in file order, and a story that starts by counting
    // panels is really reading whatever the last one left behind.
    await press("3");
    await waitFor(() => expect(onScreenPanels().length).toBe(3));

    // Every visible panel, and the button lives INSIDE the picture — which is
    // what makes it read as belonging to this clip rather than to the view.
    for (const panel of onScreenPanels()) {
      const play = panel.querySelector<HTMLButtonElement>("[data-item-details-play]");
      expect(play).not.toBeNull();
      // IN THE READOUT STRIP, NOT ON THE PICTURE.
      //
      // It used to float over the frame's bottom-left corner, which spent a
      // piece of the image on a control and put a dark chip over whatever
      // happened to be in that corner of the shot. It now sits in the row
      // under the picture with the `cut` and `src` numbers, where it covers
      // nothing.
      expect(panel.querySelector("[data-item-details-readout]")!.contains(play)).toBe(true);
      expect(panel.querySelector("[data-item-details-frame]")!.contains(play)).toBe(false);
      // Nothing is running, so every one of them offers PLAY.
      expect(play!.getAttribute("data-item-details-play")).toBe("paused");
      // Named after its own clip, so nine of these are nine distinct controls
      // to anything reading the page rather than nine buttons called "Play".
      expect(play!.getAttribute("aria-label")).toMatch(/^Play .+ from the start$/);
    }

    // The bar's own transport is untouched: two ways in, not a replacement.
    // THE BAR'S OWN PLAY BUTTON IS NOT PART OF THIS CLAIM ANY MORE. It went
    // with the transport when the ported strip replaced the whole bar
    // (PL15-030). What this story is actually about — that every panel offers
    // play from its own start — is untouched, and is asserted below.

    // FIVE UP: the narrowest the strip goes, and where the panel's other
    // controls are gone.
    //
    // The undo pair is no longer part of this claim, and the assertion for it
    // was deleted rather than left to pass: it now lives in the view's own
    // header, so a panel never contains one at any count and querying for it
    // here would be true for a reason that has nothing to do with width.
    await press("5");
    await waitFor(() => expect(onScreenPanels().length).toBe(5));
    const narrow = onScreenPanels();
    const showing = (panel: HTMLElement, selector: string) =>
      (panel.querySelector(selector)?.getBoundingClientRect().height ?? 0) > 0;
    expect(narrow.some((panel) => showing(panel, "[data-trim-overview]"))).toBe(false);
    for (const panel of narrow) {
      const play = panel.querySelector<HTMLButtonElement>("[data-item-details-play]");
      expect(play).not.toBeNull();
      // Present AND hittable — a control collapsed to nothing is not a control.
      const box = play!.getBoundingClientRect();
      expect(box.height).toBeGreaterThan(16);
      expect(box.width).toBeGreaterThan(16);
    }
  },
};

/**
 * PRESSING PLAY ON A PANEL RUNS THAT CLIP ON THE MONITOR, FROM ITS HEAD.
 *
 * Three separate claims, and each of them is a way the obvious implementation
 * gets it wrong:
 *
 *  - It JUMPS. The clock is dragged somewhere else first, so "started playing"
 *    and "started playing THIS clip" cannot be confused: the playhead has to
 *    land on that clip's own first frame in bar time.
 *  - It plays on the MONITOR. The panel pressed does not start a picture of
 *    its own — the middle one changes to that clip, which is where a cut is
 *    watched and the only place there is one "now".
 *  - It does NOT advance the strip. A neighbour's picture already means "bring
 *    this one to the middle", so a play button that failed to stop its own
 *    click would move the film every time it was pressed.
 *
 * Then pressing it again pauses, and leaves the playhead where it stopped.
 */
export const PlayingFromANeighbourRunsItOnTheMonitor: Story = {
  render: () => <SeamHarness />,
  play: async () => {
    await waitFor(() =>
      expect(document.querySelectorAll("[data-item-details-panel]").length).toBe(3),
    );
    // THREE UP, STATED. The count is remembered at module scope, so it arrives
    // here as whatever the previous story left — and the bar's arithmetic below
    // is written for the three-up shape (two leads around one whole clip).
    const three = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-details-view-count] button"),
    ).find((b) => b.textContent?.trim() === "3")!;
    fireEvent.click(three);
    await waitFor(() => expect(three.getAttribute("aria-pressed")).toBe("true"));

    const at = () => Number(seamTrack().getAttribute("aria-valuenow"));
    const panels = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-item-details-panel]"));
    const centreName = centreClipName;
    const monitorSrc = () =>
      document
        .querySelector('[data-item-details-panel="centre"]')!
        .querySelector<HTMLImageElement>("[data-item-details-frame] img")!.src;
    const playOf = (panel: HTMLElement) =>
      panel.querySelector<HTMLButtonElement>("[data-item-details-play]")!;

    expect(centreName()).toBe("Subject");

    // Park the clock inside the SUBJECT first. Without this the assertion
    // below cannot tell "jumped to this clip" from "happened to already be
    // there" — the bar rests at the subject's own first frame.
    await settleStrip();
    // Four seconds in lands inside the SUBJECT: the bar runs Before (3s) then
              // Subject (4s), so anything past 3 is in the middle clip.
    nudgePlayhead(4);
    await waitFor(() => expect(at()).toBeGreaterThan(3));

    // ── THE PLAYHEAD IS ALWAYS DRAWN; THE BAR SAYS WHETHER IT IS RUNNING ──
    //
    // This used to assert the opposite. The playhead was hidden while stopped,
    // reasoning that it is the only saturated thing on the bar and a permanent
    // alarm colour stops meaning anything. That held for the CHIP — which is
    // `--chip` — and not for the playhead as a whole: the line is plain white,
    // and it answers "where am I in the sequence", which a stopped transport
    // still has an answer to. Hiding it removed the reader's place marker for
    // the majority of the time the view is open.
    //
    // The saturation concern is kept, using the reference's own mechanism
    // rather than a bespoke one: `is-playing` on the bar glows the chip while
    // the transport runs. So the marker stays put and the STATE is what moves.
    //
    // Asserted HERE, after a nudge has moved the clock well off zero, so that
    // "drawn at a known position" is what passes rather than a lucky zero.
    expect(document.querySelector("[data-seam-playhead]")).not.toBeNull();
    expect(document.querySelector(".pb .playbar.is-playing")).toBeNull();

    // The RIGHT-hand panel: "After". Its stretch of the bar starts at 7s —
    // "Before" whole (3s), then "Subject" whole (4s).
    //
    // It used to be 6s, back when the bar carried a two-second run-up into
    // "Before" instead of the clip itself. The leads went when the clock grew
    // to cover the whole order: there is no partial neighbour to lead into any
    // more, so every clip contributes its full length and the seams land on
    // round sums of them.
    fireEvent.click(playOf(panels()[2]!));

    // Landed on that clip's first frame in bar time, rather than staying where
    // the drag left the playhead.
    //
    // READ ONCE INTO A VARIABLE. The transport is running from here on, so two
    // reads of the same attribute are two different moments — a lower and an
    // upper bound taken separately would be bounding a moving number.
    const jumped = at();
    // Captured in the same breath, and asserted FIRST: a play button that let
    // its click through re-centres the strip, which rebuilds the bar and resets
    // the clock — so the jump assertion below would fail too, on a number that
    // says nothing about why.
    const stayedCentred = centreName();
    expect(stayedCentred).toBe("Subject");
    expect(jumped).toBeGreaterThanOrEqual(7);
    expect(jumped).toBeLessThan(7.5);

    // One clip is playing, and it is the one whose button was pressed.
    const playing = Array.from(
      document.querySelectorAll<HTMLElement>('[data-item-details-play="playing"]'),
    );
    expect(playing.length).toBe(1);
    expect(panels()[2]!.contains(playing[0]!)).toBe(true);

    // THE MONITOR IS SHOWING IT — the middle picture, not the panel that was
    // pressed. This is the whole shape of the feature: one clock, one screen.
    expect(decodeURIComponent(monitorSrc())).toContain("AFTER");

    // AND NOW THE PLAYHEAD IS DRAWN, because something is actually running.
    //
    // SYNCHRONOUS, WITH NO WAIT. The transport has been running since the
    // click above, so there is nothing to wait FOR — and a `waitFor` here is
    // not free: it let playback advance between the assertions that follow and
    // the moment they describe, which failed the pause check two lines down on
    // a state that had moved on. The whole story is one running clock, so
    // anything inserted into it has to cost nothing.
    // STILL DRAWN — it never stopped being — and now the BAR is marked as
    // running, which is the part that actually tracks the transport. Its PARTS
    // changed with the port too: the ported strip's playhead is a line with a
    // timecode chip that spans the film rather than a head sitting in the
    // scale, so the assertions about `-head` and about living inside
    // `[data-seam-ruler]` are gone with the bar that drew it that way
    // (PL15-030).
    expect(document.querySelector("[data-seam-playhead]")).not.toBeNull();
    expect(document.querySelector(".pb .playbar.is-playing")).not.toBeNull();

    // PRESSED AGAIN, IT PAUSES — and does not rewind. Pausing is the same
    // contract as the bar's button, so the two controls cannot disagree.
    fireEvent.click(playOf(panels()[2]!));
    await waitFor(() =>
      expect(document.querySelectorAll('[data-item-details-play="playing"]').length).toBe(0),
    );
    expect(at()).toBeGreaterThanOrEqual(6);
    expect(playOf(panels()[2]!).getAttribute("aria-label")).toMatch(/^Play /);

    // AND THE PLAYHEAD STAYS, while the RUNNING mark goes. The clock is still
    // at six seconds — the line above asserts it — and the marker is still
    // there saying so, which is exactly what a stopped transport should leave
    // a reader with. What is gone is the claim that something is playing.
    expect(document.querySelector("[data-seam-playhead]")).not.toBeNull();
    expect(document.querySelector(".pb .playbar.is-playing")).toBeNull();
  },
};


/**
 * ── THE BAR IS A WINDOW ONTO THE WHOLE PROJECT ────────────────────────────
 *
 * The stories below are about what follows from that, and none of them were
 * possible while the bar drew everything at one fixed scale.
 */



/*
 * WHAT WENT WITH THE BAR (PL15-030), and why these stories are not here.
 *
 * `SeamStripBar` was replaced wholesale by the ported `<FilmStrip>`, so the
 * clock, the five transport buttons, the reach picker and the settings gear
 * left with it. The stories below covered THOSE, and a test whose subject no
 * longer exists is not a regression to fix — it is a description of something
 * deleted, and leaving it red would train everyone to ignore a red suite.
 *
 * Removed, with the feature each was about:
 *   - TheFilmCanBeDrawnTaller — the film's height was a gear setting
 *   - TheBarLabelsItsSectionsWithFrames — the frames setting
 *   - ThePlaybarCanDrawFrames — the frames setting
 *   - ThePlaybarCanDrawAFilmstrip — the frames setting
 *   - AStillIgnoresTheFilmstrip — the frames setting
 *   - ThePlaybarOpensAsFilm — the frames setting
 *   - TheBarReachIsASetting — reach
 *   - TheBarMarksTheEndsOfTheProject — reach
 *   - TheBarSlidesIntoPositionOnAMove — reach's window
 *   - TheTransportReachesBothEnds — the transport
 *   - TheTransportSitsOnTheControlRow — the control row
 *   - TheBarIsGreyUntilTheTintIsSwitchedOn — the tint setting
 *   - FitRescalesTheBar — the fit setting
 *   - TheHoverCardCanBePinned — the hover card
 *   - PointingAtABoxSaysWhatItIs — the hover card
 *   - ThePanelsRecedeBehindThePreview — the hover card
 *   - ASkippedClipIsHatchedOnTheBar — the disabled hatch
 *   - TheBarThumbnailStartsAfterTheTrim — trim-aware poster sampling
 *   - TheMinimapWindowEasesButNotMidDrag — the window's easing class
 *   - TheWheelPansAndZoomsAboutThePointer — zoom
 *   - TheActiveRuleIsClippedToTheBar — the active rule
 *
 * The behaviour that SURVIVED the swap did not lose its stories: the ruler
 * still names its collections, the minimap still moves the window, the strip
 * still takes the keyboard and still spans the full width. Those were ported
 * rather than deleted, and they are below.
 *
 * The fling that replaced reach is covered where it can actually be measured —
 * `playbar/playbar-motion.test.ts`. Momentum runs on requestAnimationFrame,
 * which does not tick in a page that is not compositing, so a story asserting
 * it would be asserting nothing.
 */
/**
 * THE RULER SAYS WHAT SCALE YOU ARE AT, AND WHERE EACH COLLECTION STARTS.
 *
 * A box's width means "this long" only against a scale, and the scale now
 * moves — so two bars showing the same picture can be a minute apart in what
 * they are describing. The time ticks are the fix for that.
 *
 * THE COLLECTION LABELS ARE THE MORE IMPORTANT HALF. Time is derivable; "the
 * Loading Dock starts here" is not, and it is the only landmark on a run of
 * boxes that otherwise looks the same all the way along. They win a collision
 * with a time tick for the same reason.
 */
export const TheRulerNamesTheCollections: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-ruler]")).not.toBeNull());
    await settleStrip();

    // A COLLECTION NAME LIVES IN ITS OWN BAND now, above the scale — the two
    // rows say one thing each, names and numbers. The tick MARK keeps the
    // `data-seam-tick` name down in the scale, so the label needs a selector of
    // its own rather than a marker that carries text only some of the time.
    const labels = (kind: string) =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          kind === "collection" ? "[data-seam-tick-name]" : `[data-seam-tick=${kind}]`,
        ),
      ).map((tick) => tick.textContent?.trim() ?? "");

    expect(labels("collection")).toEqual(["Kitchen Interior", "Loading Dock"]);

    // ── EACH NAME WEARS THE COLLECTION SIGN ──────────────────────────────
    //
    // The same glyph a collection carries everywhere else — the card's mark,
    // the sidebar shortcut's badge, the board's Collections toggle. A fourth
    // spelling would be a fourth thing to learn.
    //
    // AT THE LETTERING'S OWN SIZE, asserted against the label's computed font
    // size rather than against 10px, so the two move together: an icon larger
    // than the word beside it turns a caption strip into a row of icons that
    // happen to have names.
    for (const label of document.querySelectorAll<HTMLElement>("[data-seam-tick-name]")) {
      const glyph = label.querySelector<SVGElement>("svg");
      const word = label.querySelector<HTMLElement>("span")!;
      expect(glyph).not.toBeNull();
      const mark = glyph!.getBoundingClientRect();
      const type = Number.parseFloat(getComputedStyle(word).fontSize);
      // AT THE LETTERING'S SCALE, not exactly its size. The ported strip runs
      // an 11px glyph against 9.5px text, which is the reference design's own
      // proportion — the claim was never "identical", it was "not large enough
      // to turn a caption strip into a row of icons that happen to have names".
      expect(mark.height).toBeGreaterThan(type * 0.9);
      expect(mark.height).toBeLessThan(type * 1.4);
      // In FRONT of the name, and on its middle rather than its top.
      const text = word.getBoundingClientRect();
      expect(mark.right).toBeLessThanOrEqual(text.left + 0.5);
      expect(
        Math.abs(mark.top + mark.height / 2 - (text.top + text.height / 2)),
      ).toBeLessThan(1.5);
    }

    // ── A BLOCK PER SECTION, AND THE GAPS LEFT ALONE ─────────────────────
    //
    // PER SECTION, NOT PER CLIP (PL15-030). The old scale carried a faint block
    // behind every clip so "how long is that shot" could be read in the band as
    // well as in the boxes. The ported ruler bands its SECTIONS instead — the
    // boxes already say where a clip starts and ends, and a block behind each
    // of them said it twice.
    //
    // What survives is the part that was actually load-bearing: a block covers
    // the run it names, and nothing reaches into the gap between two runs. The
    // gap is drawn by absence, so a block overrunning it by a pixel would close
    // the seam the whole layout depends on.
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>("[data-seam-ruler-block]"),
    );
    // One band per label: the ruler names its runs and bands the same ones.
    expect(blocks.length).toBe(
      document.querySelectorAll("[data-seam-tick-name]").length,
    );
    expect(blocks.length).toBeGreaterThan(1);

    // Each block covers boxes, rather than floating in the scale on its own.
    const boxes = Array.from(document.querySelectorAll<HTMLElement>("[data-seam-segment]"));
    for (const block of blocks) {
      const band = block.getBoundingClientRect();
      const covered = boxes.filter((box) => {
        const at = box.getBoundingClientRect();
        return at.left >= band.left - 1 && at.right <= band.right + 1;
      });
      expect(covered.length).toBeGreaterThan(0);
    }

    // Asserted as clearance BETWEEN blocks rather than against a number, which
    // is what "the gap stays empty" means.
    const inOrder = [...blocks].sort(
      (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
    );
    for (let index = 0; index < inOrder.length - 1; index += 1) {
      const gap =
        inOrder[index + 1]!.getBoundingClientRect().left -
        inOrder[index]!.getBoundingClientRect().right;
      expect(gap).toBeGreaterThan(1);
    }

    // ── AND THE ACTIVE CLIP IS MARKED ONCE ───────────────────────────────
    //
    // ONCE, not twice. The reference marks the subject in two places — a 5px
    // gradient range under the ruler and an underline beneath the film — and
    // the two sat a few pixels apart saying the same thing, reading as a band
    // of their own rather than as a mark. The underline is the one that stays:
    // it lies against the boxes, so it points at the SHOT rather than at the
    // scale above it.
    //
    // Asserted as the ruler's mark being ABSENT, because a mark quietly
    // reintroduced there is exactly what this is protecting against.
    expect(document.querySelectorAll("[data-seam-ruler-block-live]").length).toBe(0);

    const live = document.querySelectorAll<HTMLElement>("[data-seam-active-mark]");
    expect(live.length).toBe(1);
    // The mark NAMES the clip it belongs to, so "the active one" cannot drift
    // to a neighbour without this failing.
    expect(live[0]!.getAttribute("data-seam-active-mark")).toBe(
      centreBox().getAttribute("data-seam-segment"),
    );
    // WHICHEVER PROPERTY CARRIES THE PAINT — a mark drawn as a gradient has a
    // transparent `backgroundColor` and its colour in `backgroundImage`, and
    // reading only the former once reported "no hue" about the one saturated
    // thing on the bar.
    const ink = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return style.backgroundImage === "none" ? style.backgroundColor : style.backgroundImage;
    };
    const activeInk = ink(live[0]!);
    // A HUE, not a brighter grey: the channels have to disagree.
    const [red, green, blue] = activeInk.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    expect(Math.max(red!, green!, blue!) - Math.min(red!, green!, blue!)).toBeGreaterThan(40);
    // And it is not the same ink as the band it sits under, which is what makes
    // it findable on a scale of two dozen blocks.
    expect(activeInk).not.toBe(ink(blocks[0]!));

    // ── ONE TONE FOR THE RUN ─────────────────────────────────────────────
    //
    // Alternate fills were tried and dropped: they gave every boundary a
    // change of tone, but they made the band a pattern in its own right — a
    // rhythm of light and dark that is not the film's rhythm, competing with
    // the one thing the widths are actually saying. Asserted as EVERY
    // non-active block agreeing, which is what a stripe reintroduced by
    // accident would fail.
    const runInks = new Set(
      blocks
        .filter((block) => !block.hasAttribute("data-seam-ruler-block-live"))
        .map((block) => getComputedStyle(block).backgroundColor),
    );
    expect(runInks.size).toBe(1);
    // And it is a fill, not nothing — the blocks exist to be seen.
    expect([...runInks][0]).not.toBe("rgba(0, 0, 0, 0)");
    expect(activeInk).not.toBe("rgba(0, 0, 0, 0)");

    // ── THE TRIANGLE CLEARED THE BAND, THE RULE DID NOT ──────────────────
    // ── WHAT THE OLD BAR'S SUBJECT COLUMN USED TO ADD ───────────────────
    //
    // The rest of this story measured `data-seam-active-span` — the blue column
    // PL15-026 ran from the film down past the minimap — and the hover that
    // lifted a box and its block together. Neither is part of the ported strip:
    // the subject is marked by the band above and the underline below, and the
    // hover card those handlers fed went with the bar (PL15-030).
    //
    // The two marks that DID survive are asserted above, including that exactly
    // one of them is live and that it names the centre clip.
  },
};

/**
 * THE MINIMAP IS THE WHOLE SEQUENCE, AND DRAGGING IT MOVES THE WINDOW.
 *
 * The bar is a window, and at any useful zoom most of the project is off the
 * sides of it. That is the right trade for working on a cut and the wrong one
 * for knowing where you are, so the two questions get two objects: this one
 * never zooms and never scrolls, and every clip is always on it.
 *
 * IT PANS, IT DOES NOT SEEK. Pressing a map means "show me there". Moving the
 * playhead from here would make one gesture do two different things depending
 * on which of the two strips your finger happened to land on.
 */
export const TheMinimapMovesTheWindow: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-minimap]")).not.toBeNull());
    await settleStrip();

    const minimap = document.querySelector<HTMLElement>("[data-seam-minimap]")!;
    const windowRect = () =>
      document.querySelector<HTMLElement>("[data-seam-mini-window]")!.getBoundingClientRect();
    const at = () => Number(seamTrack().getAttribute("aria-valuenow"));

    // THE WHOLE PROJECT, ALWAYS. The minimap used to draw only as far as the
    // bar reached, and `All` was the reach that widened it — that was the one
    // thing on screen that never cropped until the reach picker changed it.
    // Reach is gone (PL15-030): the strip pans across every clip, so the map
    // beneath it draws every clip, and there is no setting left to prove it
    // with.
    const segments = () => document.querySelectorAll("[data-seam-mini-segment]").length;
    expect(segments()).toBe(document.querySelectorAll("[data-seam-segment]").length);
    expect(segments()).toBeGreaterThan(1);

    // AND THE SUBJECT IS MARKED HERE TOO, on exactly one segment and on the
    // same clip the bar marks. The two strips answer different questions —
    // which shot, and where in the project that shot is — and the subject is
    // the fact they share; marked on only one of them the map showed a window
    // a dozen clips wide and left you to work out which was yours.
    const live = document.querySelectorAll("[data-seam-mini-segment-live]");
    expect(live.length).toBe(1);
    expect(live[0]!.getAttribute("data-seam-mini-segment")).toBe(
      centreBox().getAttribute("data-seam-segment"),
    );
    // WHITE, AT FULL STRENGTH, AND A LITTLE TALLER. Colour rather than an
    // edge, because a segment here can be one pixel wide: a border would eat
    // into a width that means duration, and an outline around a one-pixel clip
    // stands in for the thing rather than marking it.
    const marked = getComputedStyle(live[0]!);
    expect(Number(marked.opacity)).toBe(1);
    const ink = marked.backgroundColor.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    expect(Math.min(...ink)).toBeGreaterThan(200);

    // THE CARET UNDER IT (PL15-017) WENT WITH THE OLD MINIMAP. It was that
    // bar's own mark at map scale, drawn as a child of the segment so it could
    // find a centre that was not a percentage of the run. The ported minimap
    // lays its segments out by time rather than as flex items with seam
    // margins, so the problem the caret solved does not arise and the mark
    // above is the whole of it (PL15-030).
  },
};






/**
 * F2 RENAMES THE CLIP YOU OPENED, not every clip on screen.
 *
 * Each panel registers its own document-level capture listener for Escape and
 * F2 — and the listener is the panel's, so it renames the panel that owns it.
 * With five panels mounted that is five listeners, and `stopPropagation` does
 * not stop the others: it stops the event travelling to another NODE, and
 * these are all on `document`. One keypress, five rename fields.
 *
 * Escape is the same wiring and hides it, because closing five times closes
 * once. F2 is where it shows.
 *
 * "Which dialog has the keyboard" is singular by definition — the comment in
 * the panel says exactly that about its focus wiring, and the keyboard effect
 * was the one part that had not been told.
 */
export const F2RenamesOnlyTheOpenedClip: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() =>
      expect(document.querySelectorAll("[data-item-details-panel]").length).toBeGreaterThan(1),
    );
    const fields = () => document.querySelectorAll('input[aria-label="Clip name"]').length;
    expect(fields()).toBe(0);

    // On the document, and not from inside a field — the guard for an editable
    // target is what lets the rename input itself handle its own keys.
    fireEvent.keyDown(document.body, { key: "F2" });

    await waitFor(() => expect(fields()).toBeGreaterThan(0));
    // ONE, AND ON THE SUBJECT. Every mounted panel hears the key — they all
    // listen on `document` — but only the one you opened may act on it.
    expect(fields()).toBe(1);
    const field = document.querySelector<HTMLInputElement>('input[aria-label="Clip name"]')!;
    expect(
      field.closest("[data-item-details-panel]")?.getAttribute("data-item-details-panel"),
    ).toBe("centre");

    fireEvent.keyDown(field, { key: "Escape" });
  },
};

/**
 * THE TWO BARS ARE ADJACENT, AND THE CONTROLS SIT UNDER BOTH.
 *
 * The controls were between them once, on the reasoning that a row driving
 * both belongs equally close to each. What that missed is that the two bars
 * are more use to EACH OTHER than either is to the buttons: the film strip is
 * a window and the minimap is the map it moves over, so a row of controls
 * between them put a thing and its own index at opposite ends of the block.
 *
 * They are adjacent now — a box and its place in the sequence read in one
 * glance — and everything that acts on either sits underneath. The controls
 * are the row you reach for, not the row you read, and they lose nothing by
 * being under what they act on.
 *
 * THE TRANSPORT IS CENTRED ON THE TRACK, not between its neighbours. A flex
 * row would centre it against whatever sits either side, so it would drift as
 * the settings changed width — and a play button that moves when you change a
 * setting is a play button you have to look for. The three-column grid puts it
 * in the middle of the bar and leaves it there.
 */
export const TheTwoBarsAreAdjacent: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    // PORTED (PL15-030). Most of what this story used to assert was about the
    // controls row — the transport centred on the track, the clock's notation,
    // which settings sat in the row and which behind the gear. That row went
    // with the bar. What the story is NAMED for survives untouched: the two
    // bars, and whether anything has crept between them or under them.
    await waitFor(() => expect(document.querySelector("[data-seam-bar]")).not.toBeNull());
    await settleStrip();
    const box = (selector: string) =>
      document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();

    // ── ORDER: the cut, then the project ──────────────────────────────────
    const track = box("[data-seam-track]");
    const minimap = box("[data-seam-minimap]");
    expect(track.bottom).toBeLessThanOrEqual(minimap.top + 0.5);

    // AND NOTHING COMES BETWEEN THEM. The gap is the stack's own spacing and
    // nothing else — the assertion that would fail if anything were ever
    // slotted back in there.
    expect(minimap.top - track.bottom).toBeLessThan(24);

    // ── THE TRACK IS THE WHOLE WIDTH ──────────────────────────────────────
    // Stated as a floor rather than a number, so it survives a change of
    // viewport instead of being calibrated to one.
    expect(track.width).toBeGreaterThan(window.innerWidth * 0.9);

    // ── AND THE CARDS STILL CLEAR IT ──────────────────────────────────────
    //
    // This is the assertion that kept the old bar honest, and it is worth more
    // now rather than less. The scrim used to RESERVE the band above the cards
    // with padding, so every time the bar grew a row that number had to grow
    // with it — and the symptom of forgetting was the minimap resting on the
    // top edge of the middle card, "a quiet eight pixels" rather than an
    // obvious fault. The band is gone (PL15-029 put the bar in flow) and the
    // strip that replaced the bar is a different height again, so the one
    // thing still worth pinning is the outcome: they do not touch.
    //
    // THE STRIP IS UNDER THE CARDS NOW, so the clearance is measured the other
    // way round. Asked for as an absolute gap rather than as "strip minus
    // cards", because the direction is the part most likely to change again
    // and the thing being protected — that neither rests on the other — is the
    // same whichever is on top.
    const panel = box('[data-item-details-panel="centre"]');
    const gap =
      panel.top >= minimap.bottom ? panel.top - minimap.bottom : minimap.top - panel.bottom;
    expect(gap).toBeGreaterThan(8);
  },
};





/**
 * THE BAR TAKES THE KEYBOARD.
 *
 * It is a `role="slider"` and it is focusable, so it owes the reader the keys
 * a slider answers to — and the ones a transport answers to, since it is also
 * the only transport in the view. Arrows nudge a second, shift and an arrow
 * steps a whole clip, Home and End are the two places you jump to without
 * aiming.
 */
export const TheBarTakesTheKeyboard: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-strip]")).not.toBeNull());
    await settleStrip();
    const track = seamTrack();
    const at = () => Number(track.getAttribute("aria-valuenow"));
    const max = Number(track.getAttribute("aria-valuemax"));
    track.focus();

    fireEvent.keyDown(track, { key: "End" });
    await waitFor(() => expect(at()).toBe(max));

    fireEvent.keyDown(track, { key: "ArrowLeft" });
    await waitFor(() => expect(at()).toBeCloseTo(max - 1, 1));

    fireEvent.keyDown(track, { key: "Home" });
    await waitFor(() => expect(at()).toBe(0));

    fireEvent.keyDown(track, { key: "ArrowRight" });
    await waitFor(() => expect(at()).toBeCloseTo(1, 1));

    // Shift and an arrow is the same step the two chevrons make, so the two
    // ways of asking cannot drift apart.
    const subject = () => centreBox().getAttribute("data-seam-segment");
    const startedOn = subject();
    fireEvent.keyDown(track, { key: "ArrowRight", shiftKey: true });
    await waitFor(() => expect(subject()).not.toBe(startedOn));
  },
};



/**
 * ── THE REDESIGN ──────────────────────────────────────────────────────────
 */

/**
 * THE HEADER SAYS WHERE YOU ARE BEFORE IT SAYS WHAT YOU ARE LOOKING AT.
 *
 * It was two lines with the clip's name on top. But the name is already the
 * largest thing on the centre panel a few hundred pixels below, so the
 * header's strongest position was spent saying it twice — while the one fact
 * the cropped row genuinely cannot give you, which collection this is and how
 * far into it you are, sat underneath in grey.
 */
export const TheHeaderSaysWhereYouAreFirst: Story = {
  render: () => <SeamHarness />,
  play: async () => {
    const header = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-item-details-header]");
      expect(found).not.toBeNull();
      return found!;
    });
    const heading = header.querySelector("h2")!;
    // ONE LINE, and the place is in the bold half of it.
    expect(heading.textContent).toContain("Van Interior");
    expect(heading.textContent).toMatch(/clip \d+ of \d+/);
    // The name trails it, dimmer and separate — present, but not the headline.
    expect(header.textContent).toContain("Subject");
    expect(heading.textContent).not.toContain("Subject");
  },
};

/**
 * UNDO SAYS WHAT IT UNDID.
 *
 * Undo here is scoped to one clip, which makes it safe but not legible: it
 * moves a number in a panel that may be half a screen from the button, and if
 * the change was small nothing observable happens at all. So the press reports
 * itself — which clip, what changed, and from what to what — out of the
 * history entry it just stepped over, rather than from anything tracked
 * alongside the edit.
 */
export const UndoSaysWhatItUndid: Story = {
  render: () => <SeamHarness />,
  play: async () => {
    await waitFor(() =>
      expect(document.querySelector('[data-item-details-panel="centre"]')).not.toBeNull(),
    );
    const note = () => document.querySelector<HTMLElement>("[data-item-details-note]");
    // Nothing has been undone, so there is nothing to report.
    expect(note()).toBeNull();

    // A rename is the cheapest edit this view can make that history will hold.
    fireEvent.keyDown(document.body, { key: "F2" });
    const field = await waitFor(() => {
      const found = document.querySelector<HTMLInputElement>('input[aria-label="Clip name"]');
      expect(found).not.toBeNull();
      return found!;
    });
    fireEvent.input(field, { target: { value: "Renamed" } });
    fireEvent.keyDown(field, { key: "Enter" });

    const undo = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>("[data-item-details-undo]")!;
      expect(button.disabled).toBe(false);
      return button;
    });
    fireEvent.click(undo);

    // NAMED, AND WITH BOTH ENDS OF THE CHANGE IN IT.
    const shown = await waitFor(() => {
      const found = note();
      expect(found).not.toBeNull();
      return found!;
    });
    expect(shown.textContent).toContain("Undid rename");
    expect(shown.textContent).toContain('"Renamed"');
    expect(shown.textContent).toContain('"Subject"');
  },
};

/**
 * THE SUBJECT IS WIDER THAN ITS NEIGHBOURS, AND ALL OF THEM ARE WHOLE.
 *
 * Every panel used to be one width with the outer pair hanging half off each
 * edge, which is what made "show three" mean one whole panel and two halves.
 * Sizing the middle one separately buys the same emphasis without spending it
 * on cropping.
 *
 * The pair held ready beyond the window keeps its width — the row's centring
 * is arithmetic over uniform neighbour widths — so it is HIDDEN rather than
 * collapsed, and this is the story that says so: with `count` panels now
 * filling the viewport exactly, a spare that merely sat off the edge would sit
 * in the scrim's own padding instead and show as a sliver down each side.
 */
export const TheSubjectIsWiderThanItsNeighbours: Story = {
  render: () => <SeamHarness scene={LONG_SCENE} />,
  play: async () => {
    await waitFor(() =>
      expect(document.querySelector('[data-item-details-panel="centre"]')).not.toBeNull(),
    );
    const slots = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-item-details-panel]")).map(
        (panel) => ({
          role: panel.dataset.itemDetailsPanel,
          width: Math.round(panel.getBoundingClientRect().width),
        }),
      );

    const shown = slots();
    expect(shown.length).toBe(3);
    const centre = shown.find((slot) => slot.role === "centre")!;
    const neighbours = shown.filter((slot) => slot.role === "neighbour");
    expect(new Set(neighbours.map((slot) => slot.width)).size).toBe(1);
    // THE RATIO COMES FROM THE SIDE SCALE, not from a second width.
    //
    // The subject used to be sized separately — a wider box for the middle
    // card, 1.75x a neighbour. The deck gives every card ONE width
    // (`--clip-w`, fitted to the height it has) and pushes the neighbours back
    // with `scale(1 - 0.14)` instead, so the emphasis is depth rather than
    // measurement. 1 / 0.86 = 1.163 is that constant read off the boxes, and
    // it moves only if `CARD` side scaling in `clip-deck.tsx` does.
    expect(centre.width / neighbours[0]!.width).toBeCloseTo(1 / 0.86, 1);

    // THE REST OF THE COLLECTION IS BUILT AND NOT SHOWN — the same guarantee
    // the spare SLOTS used to carry, now made by the deck itself.
    //
    // Spares existed because the row centred itself by arithmetic over uniform
    // neighbour widths: collapsing an unused slot would have shifted every
    // panel between it and the middle, so they were kept at full width and
    // hidden. The deck centres by writing each card's transform from its
    // distance to the subject, so there is nothing to keep an empty box for
    // and the concept went with the row.
    //
    // What still has to hold is the half that was ever visible: a card outside
    // the window paints NOTHING, so the count of panels means what it says.
    // Read off the cards themselves rather than off `[data-item-details-panel]`
    // — that mark is only applied inside the window, which is the very thing
    // being checked.
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".deck-track > .clip"));
    const beyond = cards.filter((card) => !card.hasAttribute("data-item-details-panel"));
    expect(beyond.length).toBeGreaterThan(0);
    expect(beyond.every((card) => Number(getComputedStyle(card).opacity) === 0)).toBe(true);
    expect(beyond.every((card) => getComputedStyle(card).pointerEvents === "none")).toBe(true);
  },
};

/**
 * LONG ENOUGH THAT THE TWO FITS ARE DIFFERENT NUMBERS.
 *
 * Two conditions, and the first fixture tried met neither. The subject's
 * collection has to be a PART of the project, so `clip` and `all` name
 * different spans — `LONG_SCENE` hangs every clip off the root, where they are
 * the same span. And both spans have to be long enough that neither fit hits
 * `PPS_MAX`: at a 1200px track anything under about fifty seconds clamps to
 * 40px a second, so a three-clip scene gives 40 and 40 and the story passes or
 * fails on a ceiling rather than on the feature.
 */
const FIT_SCENE: GraphNodeSpec = {
  kind: "collection",
  id: "root",
  name: "Root",
  children: [
    {
      kind: "collection",
      id: "sub",
      name: "Van Interior",
      children: Array.from({ length: 6 }, (_, index) => ({
        kind: "media" as const,
        id: index === 2 ? "subject" : `van-${index}`,
        name: index === 2 ? "Subject" : `Van ${index}`,
        src: plate(`V${index}`, "#7dd3fc"),
        durationSeconds: 20,
      })),
    },
    {
      kind: "collection",
      id: "other",
      name: "Elsewhere",
      children: Array.from({ length: 6 }, (_, index) => ({
        kind: "media" as const,
        id: `else-${index}`,
        name: `Else ${index}`,
        src: plate(`E${index}`, "#fca5a5"),
        durationSeconds: 20,
      })),
    },
  ],
};





const SKIPPED_SCENE: GraphNodeSpec = {
  kind: "collection",
  id: "root",
  name: "Root",
  children: [
    {
      kind: "collection",
      id: "sub",
      name: "Van Interior",
      children: [
        { kind: "media", id: "before", name: "Before", src: plate("BEFORE", "#7dd3fc"), durationSeconds: 3 },
        { kind: "media", id: "subject", name: "Subject", src: plate("SUBJECT", "#bef264"), durationSeconds: 4 },
        // The one playback steps over.
        {
          kind: "media",
          id: "skipped",
          name: "Skipped",
          src: plate("SKIPPED", "#fca5a5"),
          durationSeconds: 5,
          disabled: true,
        },
      ],
    },
  ],
};


/**
 * A clip WIDER THAN THE TRACK THAT DRAWS IT.
 *
 * The active clip's rule is a sibling of the boxes, not a child, because the
 * strip is `overflow-hidden` and a mark above the film base would be cut off
 * by it. That escape is what the triangle needs and it is also what let the
 * rule run past the ends of the bar: nothing was left to trim it.
 *
 * Every other seam fixture hides this. `LONG_SCENE`'s clips are 2-4s (~18-36px
 * at the bar's fixed 9px a second) and `OVERFLOWING_SCENE`'s are 8s (~72px) —
 * all far narrower than the track, so their rules sit comfortably inside it
 * however the strip is panned. 240s is ~2160px against a track of a few
 * hundred, so the subject cannot fit no matter where the strip stops, and the
 * overhang is a property of the fixture rather than of the timing.
 */
/**
 * A subject too wide for the track, whose MIDDLE is off the end of it too.
 *
 * One scene for both marks, because they fail under different conditions and
 * only this shape poses both at once.
 *
 * THE RULE runs the clip's whole width, so any clip longer than the track
 * over-runs it. THE TRIANGLE sits at the clip's middle, and a centred clip's
 * middle is the track's middle however long the clip is — so it only leaves
 * the bar when the strip is HELD AT AN EDGE and cannot centre. Hence the
 * subject FIRST: the strip stops at the start of the film, and the mark is
 * drawn wherever the clip's middle lands.
 *
 * 400s is ~3600px against a track of about 1280, so the rule over-runs by a
 * couple of screens and the triangle wants to be some 1800px in — a screen's
 * width past the end of the film.
 */
const SUBJECT_AT_THE_EDGE_SCENE: GraphNodeSpec = {
  kind: "collection",
  id: "root",
  name: "Root",
  children: [
    { kind: "media" as const, id: "subject", name: "Subject", src: plate("S", "hsl(200, 60%, 70%)"), durationSeconds: 400 },
    { kind: "media" as const, id: "clip-b", name: "B", src: plate("B", "hsl(20, 60%, 70%)"), durationSeconds: 6 },
    { kind: "media" as const, id: "clip-c", name: "C", src: plate("C", "hsl(120, 60%, 70%)"), durationSeconds: 6 },
  ],
};


/**
 * A CLIP WHOSE POSTER CAN ACTUALLY BE ADDRESSED BY TIME.
 *
 * Every other seam fixture uses `plate()`, which is a data URI — and the frame
 * builder is deliberately provider-neutral, returning anything it cannot
 * address unchanged. So a data-URI poster proves nothing about trim: it comes
 * back identical whether the trim was applied or ignored.
 *
 * These posters are Cloudinary-SHAPED — `/video/upload/` with a public id —
 * which is the one thing `cloudinaryVideoFrameUrl` looks for. Nothing is
 * fetched: the assertion reads the `so_` transform in the URL, and a broken
 * image in the story canvas is the expected state.
 *
 * 2.5s of trim on a 10s source, so the offset is unmistakable — a thumbnail
 * taken before the trim reads `so_0` or carries no offset at all.
 */
const CLOUDINARY_TRIMMED_SCENE: GraphNodeSpec = {
  kind: "collection",
  id: "root",
  name: "Root",
  children: [
    {
      kind: "media" as const,
      mediaKind: "video" as const,
      id: "subject",
      name: "Trimmed",
      src: "https://res.cloudinary.com/demo/video/upload/trimmed.mp4",
      posterSrcs: ["https://res.cloudinary.com/demo/video/upload/trimmed.jpg"],
      fullDurationSeconds: 10,
      trimInSeconds: 2.5,
      trimOutSeconds: 1,
    },
  ],
};


/**
 * THE THREE TRIM STRIPS SIT ON ONE LINE.
 *
 * The pictures are deliberately different sizes — the subject's is bigger
 * because it is the one being judged — but the CONTROLS beneath them are
 * identical in size and purpose, and comparing a trim against its neighbours'
 * is most of what this view is for.
 *
 * Centred, they were not comparable. The taller subject extended equally above
 * and below its neighbours, and every row below the picture inherited half the
 * height difference: measured at 1920, the well, the filmstrip, the in/out
 * fields and the tags all sat 76px lower on the centre than on the clips either
 * side of it. Three filmstrips on three different lines.
 *
 * Hanging the cards from a common bottom fixes it for free, because everything
 * from the strip down is the same height in every card. Asserted on the STRIP
 * rather than on the card box, because the card box agreeing is the mechanism
 * and the strips agreeing is the point — a future layout that aligned them some
 * other way should still pass.
 *
 * A DELIBERATE DEPARTURE from the design this view follows, which top-aligns
 * the three and lets the strips fall wherever the picture heights leave them.
 */
export const TheTrimStripsShareOneLine: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    const panels = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-item-details-panel]"));
    await waitFor(() => expect(panels().length).toBeGreaterThan(2));

    const topsOf = (selector: string) =>
      panels()
        .map((panel) => panel.querySelector<HTMLElement>(selector))
        .filter((el): el is HTMLElement => el !== null)
        .map((el) => el.getBoundingClientRect().top);

    // THE MECHANISM, asserted unconditionally: the cards hang from one line.
    const bottoms = panels().map((panel) => panel.getBoundingClientRect().bottom);
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(1);

    // Every clip in this scene is a windowed video, so every panel draws a strip.
    const strips = topsOf("[data-trim-strip-slot]");
    expect(strips.length).toBe(panels().length);

    // AND THE CONSEQUENCE. This holds only while the rows BELOW the strip
    // are the same height in every card, so those rows were made invariant
    // rather than hoped about:
    //
    //   - the layer picker moved ABOVE the strip, because it appears only on
    //     a clip that is on a lane, so below it would push one card's strip
    //     up by its own height;
    //   - the tag row lost its 30rem gate and stopped wrapping, because at a
    //     1280 canvas the 560px centre kept its tags while the 320px
    //     neighbours dropped theirs and their strips sat 37px lower — the tag
    //     row and its gap, exactly.
    //
    // Asserted at whatever width the runner gives us, which is the point:
    // this used to be a claim that was only true on a wide canvas.
    const belowStrip = panels().map((panel) => {
      const strip = panel.querySelector<HTMLElement>("[data-trim-strip-slot]")!;
      return panel.getBoundingClientRect().bottom - strip.getBoundingClientRect().top;
    });
    expect(Math.max(...belowStrip) - Math.min(...belowStrip)).toBeLessThan(1);

    // Sub-pixel tolerance: laid out by flex, not from a shared number.
    expect(Math.max(...strips) - Math.min(...strips)).toBeLessThan(1);
    const wells = topsOf("[data-item-details-readout]");
    expect(Math.max(...wells) - Math.min(...wells)).toBeLessThan(1);

    // The tag row is there on EVERY card, not just the wide one — the fix
    // added capability rather than removing it, and a revert to the gate
    // would show up here first.
    const tagRows = panels().map((panel) => panel.querySelector("[data-tag-editor]"));
    expect(tagRows.filter(Boolean).length).toBe(panels().length);

    // And the pictures are still allowed to differ. If THIS fails, the strips
    // line up because the cards became identical — which is a different view
    // from the one being tested here.
    const pictures = panels()
      .map((panel) => panel.querySelector<HTMLElement>("[data-item-details-frame]"))
      .filter((el): el is HTMLElement => el !== null)
      .map((el) => el.getBoundingClientRect().height);
    expect(Math.max(...pictures) - Math.min(...pictures)).toBeGreaterThan(20);
  },
};

/**
 * THE BAR REACHES AS FAR AS THE CARDS DO.
 *
 * The bar was capped at `7xl` on the reasoning that it is a map and should be
 * WIDER than the panels it describes — true while the panels were capped too.
 * Once the app stopped limiting its own width the panels went full-viewport and
 * the cap stayed, inverting the intent: measured at 1920, the cards ran 1872px
 * against the bar's 1280, so the cards overhung the ruler that measures them by
 * 296px on each side and the top of the view read as a floating island.
 *
 * Asserted against the SCRIM's padded width rather than against the card row,
 * because that is the edge both are supposed to meet — and a card row that
 * narrowed for its own reasons should not quietly take the bar with it.
 */
export const TheBarSpansTheFullWidth: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    // THE BAR AND ITS RULER, the controls row having gone with the transport
    // (PL15-030). The claim survives it: the bar's rows are read against the
    // cards below them, so anything that narrows one and not the other is a
    // misalignment — which is why the panel's edge is a RING and not a border.
    const bar = document.querySelector<HTMLElement>("[data-seam-bar]")!;
    // THE VIEWPORT, NOT THE RULER. The ruler is inside the scrolling content
    // now and is deliberately LONGER than the view — the strip pans across the
    // whole sequence rather than paging a window, so a ruler that ended at the
    // right edge would mean it had nowhere to go. What must still reach both
    // edges is the window onto it.
    const viewport = document.querySelector<HTMLElement>("[data-seam-viewport]")!;

    // 24px each side, and nothing else may narrow them. Compared as strings so
    // a failure names which edge of which row moved.
    const PAD = 24;
    for (const [name, element] of [
      ["bar", bar],
      ["viewport", viewport],
    ] as const) {
      const box = element.getBoundingClientRect();
      expect(`${name} left ${Math.round(box.left)}`).toBe(`${name} left ${PAD}`);
      expect(`${name} right ${Math.round(box.right)}`).toBe(
        `${name} right ${window.innerWidth - PAD}`,
      );
    }
  },
};


/**
 * THE CARD THAT IS LEAVING KEEPS ITS PICTURE UNTIL IT HAS GONE.
 *
 * Whether a panel draws its contents or renders as an empty box of the right
 * width was read straight off the current centre, so a step blanked the far
 * card instantly — while it was still on screen, in full view, sliding out as
 * an empty rectangle. A black hole opened on one side of the row for the whole
 * 420ms and read as a rendering fault rather than as motion.
 *
 * Caught on a screen recording rather than by a test, which is the reason this
 * one exists: nothing about it is visible in a settled frame, and both ends of
 * the step are correct.
 *
 * Asserted DURING the slide, so the assertion has to happen before the timer
 * that releases the union expires — hence no `waitFor` around it. What it
 * checks is the panel's contents, not its box: a spare still occupies its
 * width, so geometry alone cannot tell the two apart.
 */
export const TheOutgoingCardKeepsItsPictureWhileItLeaves: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    // FOUND AMONG THE CARDS, NOT AMONG THE MARKED PANELS, and that is the
    // whole difference between the two designs.
    //
    // `data-item-details-panel` is applied only inside the window around the
    // subject, so it is exactly what a leaving card LOSES the moment the step
    // is taken — looking for the outgoing card there could only ever find
    // nothing, whether or not it was still drawing itself. The deck keeps
    // every card mounted and moves it; the card is the thing to ask.
    const panelFor = (name: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(".deck-track > .clip")).find(
        (card) => card.textContent?.includes(name),
      ) ?? null;

    // Settled on the middle clip: the clip to its right is a real panel.
    await waitFor(() => expect(panelFor("Subject")).not.toBeNull());
    expect(panelFor("After")).not.toBeNull();

    // Step BACK, which sends "After" out of the window on the right.
    //
    // THROUGH THE KEYBOARD, the transport's two chevrons having gone with the
    // bar (PL15-030). Shift and an arrow is the same step by the same call —
    // the strip selects a neighbour and the view lands on it — so this still
    // exercises the path the bug lived in rather than a different one.
    const track = seamTrack();
    track.focus();
    fireEvent.keyDown(track, { key: "ArrowLeft", shiftKey: true });

    // IMMEDIATELY — this is the frame the bug lived in. The card has left the
    // window around the new centre and must still be drawing itself.
    const leaving = panelFor("After");
    expect(leaving).not.toBeNull();

    // ASKED OF THE PAINT, not of the children. The subtree survives either way
    // — a spare kept its whole box and hid it with `visibility: hidden`, and
    // the deck keeps every card and fades it — so a test that looked for the
    // picture and the readout passed against the bug it was written for.
    //
    // What must hold is that the card leaving is still being DRAWN. The deck
    // fades a card out over its glide, so this is opacity rather than
    // visibility, and it is asserted as "not yet gone" rather than as a number:
    // the frame this catches is somewhere inside the ease, and pinning where
    // would be testing the runner's timing.
    expect(getComputedStyle(leaving!).visibility).toBe("visible");
    expect(frameImage(leaving)).not.toBe("");
    expect(Number(getComputedStyle(leaving!).opacity)).toBeGreaterThan(0);
  },
};

/**
 * THE ROW DOES NOT BOB WHILE THE TWO CARDS SWAP HEIGHTS.
 *
 * The cards hang from a common bottom, so the row's height is whatever its
 * tallest card is — the subject. MID-STEP THERE IS NO SUBJECT: the outgoing card
 * is shrinking and the incoming one is growing, and they cross in the middle.
 * Measured at 1920, both are 444px at the crossover against a resting 519, so
 * the row lost 75px of height — and because the scrim centres it vertically,
 * every card lifted 37px and settled back.
 *
 * That bob belongs to no card's animation, which is what made it hard to place:
 * it reads as the vertical part of the step finishing early and the horizontal
 * part running on afterwards, and the declared timings say the exact opposite —
 * width and height are derived to land on the same frame.
 *
 * SIMULATED RATHER THAN SAMPLED. The crossover is one instant inside a 420ms
 * transition and neither browser pane will sample a transition at all
 * (requestAnimationFrame is throttled in both). Setting the two heights to their
 * midpoint IS the crossover, and it is deterministic.
 */
export const TheRowHoldsItsHeightThroughTheCrossover: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    const strip = document.querySelector<HTMLElement>("[data-details-strip]")!;
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>("[data-item-details-panel]"),
    );
    const centre = panels.findIndex(
      (panel) => panel.getAttribute("data-item-details-panel") === "centre",
    );
    expect(centre).toBeGreaterThanOrEqual(0);
    const incoming = panels[centre + 1] ?? panels[centre - 1]!;

    const rowHeight = () => Math.round(strip.getBoundingClientRect().height);
    // An UNINVOLVED card — neither of the two swapping — so any movement it
    // shows is the row moving under it rather than its own animation.
    const bystander = panels.find(
      (panel) => panel !== panels[centre] && panel !== incoming,
    )!;
    const bystanderTop = () => Math.round(bystander.getBoundingClientRect().top);

    const restHeight = rowHeight();
    const restTop = bystanderTop();

    // THE CROSSOVER: both cards halfway between the two heights.
    const subject = panels[centre]!.getBoundingClientRect().height;
    const neighbour = incoming.getBoundingClientRect().height;
    const midpoint = `${Math.round((subject + neighbour) / 2)}px`;
    for (const panel of [panels[centre]!, incoming]) {
      panel.style.transition = "none";
      panel.style.height = midpoint;
    }

    const crossoverHeight = rowHeight();
    const crossoverTop = bystanderTop();

    for (const panel of [panels[centre]!, incoming]) {
      panel.style.height = "";
      panel.style.transition = "";
    }

    expect(`row height ${crossoverHeight}`).toBe(`row height ${restHeight}`);
    expect(`bystander top ${crossoverTop}`).toBe(`bystander top ${restTop}`);
  },
};

/**
 * THE NAME DOES NOT RE-TRUNCATE WHILE THE CARD RESIZES.
 *
 * The card's width animates across a step and the name is a single truncated
 * line, so every frame recomputed where the ellipsis falls: `MiniMax H3 re…`
 * to `…ref2va int8, q…` to the full line, continuously, for the length of the
 * move. The most legible thing on the card doing the most distracting possible
 * thing while you read the one beside it.
 *
 * The heading is given the panel's FINAL width instead, with no transition of
 * its own — the DOM lands on its new role immediately and only the box travels
 * — so the truncation settles in one frame and the card grows around it.
 *
 * SIMULATED, NOT SAMPLED. Mid-animation is one instant inside a 420ms
 * transition and neither browser pane will sample a transition at all. Forcing
 * the outer box to the other role's width IS mid-animation, and it is
 * deterministic: what must hold is that the heading ignores it.
 */
export const TheNameDoesNotReTruncateWhileTheCardResizes: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    const panels = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-item-details-panel]"));
    const heading = (panel: HTMLElement) =>
      panel.querySelector<HTMLElement>(".c-title")!;

    const centre = panels().find(
      (panel) => panel.getAttribute("data-item-details-panel") === "centre",
    )!;
    const neighbour = panels().find(
      (panel) => panel.getAttribute("data-item-details-panel") === "neighbour",
    )!;

    // The heading is narrower than its card by the padding it sits in, and
    // WIDER on the subject than on a neighbour — so it is genuinely sized from
    // the role rather than being fixed.
    const centreHead = heading(centre).getBoundingClientRect().width;
    const neighbourHead = heading(neighbour).getBoundingClientRect().width;
    expect(centreHead).toBeGreaterThan(neighbourHead);
    // Deliberately NOT asserting the exact inset. It is the padding plus the
    // card's border, it is fractional, and an assertion on it fails first on
    // rounding — which made this story report a padding fault when what had
    // actually broken was the heading following the animating box.

    // MID-ANIMATION: shove the boxes onto each other's widths. The headings
    // must not move — they are already at their destination.
    const boxes = [centre.parentElement!, neighbour.parentElement!];
    const widths = boxes.map((box) => getComputedStyle(box).width);
    for (const box of boxes) box.style.transition = "none";
    boxes[0]!.style.width = widths[1]!;
    boxes[1]!.style.width = widths[0]!;

    const centreDuring = heading(centre).getBoundingClientRect().width;
    const neighbourDuring = heading(neighbour).getBoundingClientRect().width;

    for (const box of boxes) {
      box.style.width = "";
      box.style.transition = "";
    }

    expect(`centre heading ${Math.round(centreDuring)}`).toBe(
      `centre heading ${Math.round(centreHead)}`,
    );
    expect(`neighbour heading ${Math.round(neighbourDuring)}`).toBe(
      `neighbour heading ${Math.round(neighbourHead)}`,
    );
  },
};
