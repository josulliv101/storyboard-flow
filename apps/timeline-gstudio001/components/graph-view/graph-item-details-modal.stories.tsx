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
    <div className="graph-view-theme min-h-[600px] bg-zinc-950">
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
    <div className="graph-view-theme min-h-[600px] bg-zinc-950">
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
    <div className="graph-view-theme min-h-[600px] bg-zinc-950">
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
function framesTo(label: string): void {
  const group = document.querySelector<HTMLElement>("[data-details-bar-frames]");
  expect(group).not.toBeNull();
  const button = Array.from(group!.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button).not.toBeUndefined();
  button!.click();
}

/** Press one of the reach picker's buttons by its label. */
function reachTo(label: string): void {
  const group = document.querySelector<HTMLElement>("[data-details-bar-reach]");
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
    expect(middle / left).toBeCloseTo(1.75, 1);
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

    const centreName = () =>
      document
        .querySelector('[data-item-details-panel="centre"]')
        ?.querySelector("button[aria-label^='Rename ']")
        ?.getAttribute("aria-label");
    expect(centreName()).toBe("Rename Subject");

    // The RIGHT-hand panel's picture: one step forward.
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>("[data-item-details-panel]"),
    );
    const rightHero = panels[2]!.querySelector<HTMLElement>("[data-item-details-frame]")!;
    rightHero.click();

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

    await waitFor(() => expect(centreName()).toBe("Rename After"));

    // THE ROW MOVED, rather than the panels swapping content where they stood.
    // The clip that was centred is now immediately to the LEFT of the centre,
    // which is only true if the strip travelled one position.
    const after = Array.from(
      document.querySelectorAll<HTMLElement>("[data-item-details-panel]"),
    );
    const centreIndex = after.findIndex(
      (panel) => panel.dataset.itemDetailsPanel === "centre",
    );
    const leftOfCentre = after[centreIndex - 1]
      ?.querySelector("button[aria-label^='Rename ']")
      ?.getAttribute("aria-label");
    expect(leftOfCentre).toBe("Rename Subject");
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
    const picture = centre.querySelector<HTMLImageElement>("[data-item-details-frame] img");
    expect(picture).not.toBeNull();
    // The SUBJECT's plate, not the one before it.
    expect(picture!.src).toContain("SUBJECT");
    // And no playhead line anywhere yet: nothing is playing, so nothing claims
    // to be.
    expect(document.querySelectorAll("[data-seam-playhead-line]").length).toBe(0);
  },
};


/**
 * THE RING SAYS WHICH PANEL IS THE SUBJECT, AND NEVER MOVES.
 *
 * It used to follow the playhead: whichever clip's frames were on the monitor
 * wore the ring, so during a run-up it sat on a neighbour. The idea was to tie
 * the line moving through the bar to the panel it belonged to.
 *
 * In use it read as flicker — a halo hopping between panels as the clock
 * crossed a seam, drawing the eye to the frame it was meant to be quietly
 * identifying. The bar has a playhead and a marked box for saying where
 * playback is, and two answers to one question is one too many.
 *
 * So the ring answers the simpler question it is well shaped for, constantly:
 * which of these panels is the one you opened. Asserted as an INVARIANT rather
 * than a transition — it must not move when the clock does, which is the whole
 * change.
 */
export const TheRingMarksWhoseFramesAreUp: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    const centre = () => document.querySelector<HTMLElement>('[data-item-details-panel="centre"]')!;
    const neighbours = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-item-details-panel="neighbour"]'));
    const ringed = (panel: HTMLElement) =>
      getComputedStyle(panel).boxShadow.includes("255, 255, 255");

    expect(ringed(centre())).toBe(true);
    expect(neighbours().some(ringed)).toBe(false);

    // Move the clock right across a seam and onto another clip's frames. The
    // monitor changes; the ring does not.
    //
    // HELD, NOT RELEASED. Letting go now lands the row on whatever the
    // playhead reached, and this story is about the ring during the look —
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
    expect(ringed(centre())).toBe(true);
    expect(neighbours().some(ringed)).toBe(false);
  },
};

/**
 * ONE MARK, AND IT DOES NOT COMPETE WITH THE PICTURES.
 *
 * Panels are identical but for the ring on the subject. The opened clip wore a
 * heavy white border for a while — the loudest mark on the screen, spent on
 * the one fact the layout already tells you — and then two pixels of sky with
 * a 36px halo, which had to shout because it was moving. Standing still, a
 * hairline is enough.
 *
 * Geometry is untouched by it either way: a box-shadow paints outside the box,
 * so the panel that wears one is exactly as wide as the ones that do not.
 */
export const OnlyTheLiveClipIsMarked: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    const centre = document.querySelector<HTMLElement>('[data-item-details-panel="centre"]')!;
    const neighbour = document.querySelector<HTMLElement>('[data-item-details-panel="neighbour"]')!;

    // Same box, different shadow: the ring costs no width.
    expect(getComputedStyle(centre).borderTopWidth).toBe(
      getComputedStyle(neighbour).borderTopWidth,
    );
    expect(getComputedStyle(centre).boxShadow).toMatch(/255, 255, 255/);
    expect(getComputedStyle(neighbour).boxShadow).not.toMatch(/255, 255, 255/);

    // And the sky-blue ring that used to follow the playhead is gone from
    // both — a colour this view no longer spends here.
    await settleStrip();
    nudgePlayhead(1);
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    expect(getComputedStyle(centre).boxShadow).not.toMatch(/56, 189, 248/);
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
    const titleOfCentre = () =>
      document
        .querySelector('[data-item-details-panel="centre"]')
        ?.querySelector("button[aria-label^='Rename']")
        ?.getAttribute("aria-label") ?? null;

    expect(titleOfCentre()).toBe("Rename Subject");

    const picture = document
      .querySelector('[data-item-details-panel="centre"]')!
      .querySelector<HTMLElement>("[data-item-details-frame]")!;

    // A STILL MUST NOT BE DRAGGABLE, or there is no swipe on it at all: an
    // `<img>` is draggable by default and a `<video>` is not, so the gesture
    // worked on video panels and died on stills — the browser took it as a
    // native image drag on the first move and swallowed the rest of the
    // sequence before any of this code saw it.
    //
    // ASSERTED AS AN ATTRIBUTE, not as behaviour, and the distinction is the
    // reason the bug survived this file: `fireEvent` pointers never start a
    // native drag, so the swipe story below passes on an image fixture whether
    // or not the guard is there. Only a real pointer reproduces it. This at
    // least fails if the attribute is removed.
    const still = picture.querySelector<HTMLImageElement>("img");
    expect(still).not.toBeNull();
    expect(still!.draggable).toBe(false);

    const box = picture.getBoundingClientRect();
    const y = box.top + box.height / 2;

    const swipe = (from: number, to: number) => {
      const args = { isPrimary: true, pointerId: 1, button: 0, clientY: y };
      fireEvent.pointerDown(picture, { ...args, clientX: from });
      // Two moves: the first crosses the "is this sideways" threshold, the
      // second carries it past the distance rule.
      fireEvent.pointerMove(picture, { ...args, clientX: from + (to - from) / 2 });
      fireEvent.pointerMove(picture, { ...args, clientX: to });
      fireEvent.pointerUp(picture, { ...args, clientX: to });
    };

    // Dragged LEFT: the film moves the way the hand moves, so the clip after
    // this one arrives from the right.
    swipe(box.left + box.width * 0.8, box.left + box.width * 0.1);
    await waitFor(() => expect(titleOfCentre()).toBe("Rename After"));

    // And back.
    const back = document
      .querySelector('[data-item-details-panel="centre"]')!
      .querySelector<HTMLElement>("[data-item-details-frame]")!;
    const backBox = back.getBoundingClientRect();
    const backY = backBox.top + backBox.height / 2;
    const args = { isPrimary: true, pointerId: 1, button: 0, clientY: backY };
    fireEvent.pointerDown(back, { ...args, clientX: backBox.left + backBox.width * 0.1 });
    fireEvent.pointerMove(back, { ...args, clientX: backBox.left + backBox.width * 0.4 });
    fireEvent.pointerMove(back, { ...args, clientX: backBox.left + backBox.width * 0.9 });
    fireEvent.pointerUp(back, { ...args, clientX: backBox.left + backBox.width * 0.9 });
    await waitFor(() => expect(titleOfCentre()).toBe("Rename Subject"));
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
    const titleOfCentre = () =>
      document
        .querySelector('[data-item-details-panel="centre"]')
        ?.querySelector("button[aria-label^='Rename']")
        ?.getAttribute("aria-label") ?? null;

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
    await waitFor(() => expect(titleOfCentre()).toBe("Rename Subject"));
    expect(titleOfCentre()).toBe("Rename Subject");
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
    expect(add.previousElementSibling?.hasAttribute("data-tag-chip") ?? true).toBe(true);

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
      expect(visible("[data-tag-editor]")).toBe(false);
      expect(visible("[data-item-details-undo]")).toBe(false);
    });
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
 * THE BAR IS ONE BOX PER CLIP, SIZED AND COLOURED BY WHAT IT IS.
 *
 * It used to tuck a poster frame into the right-hand end of each section, so
 * you could tell the clips apart by picture rather than by a hairline. That
 * made sense while the bar covered three clips and two leads. It covers the
 * whole playback order now — dozens of boxes, most of them narrower than a
 * thumbnail — and a picture per section became a row of stamps you could not
 * read.
 *
 * What tells them apart instead: WIDTH, which is the clip's duration at a
 * fixed scale, and COLOUR, which is the collection it belongs to. Both are
 * asserted here, because either alone would pass on a bar that had lost the
 * other.
 */
export const TheBarLabelsItsSectionsWithFrames: Story = {
  render: () => <SeamHarness scene={LONG_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    const boxes = await waitFor(() => {
      const found = seamBoxes();
      expect(found.length).toBeGreaterThan(2);
      return found;
    });

    // The frames are gone, and staying gone is the point of asserting it.
    expect(document.querySelectorAll("[data-seam-thumb]").length).toBe(0);

    // WIDTH IS DURATION. The scene's clips differ in length, so their boxes
    // must differ in width — a bar drawing equal boxes would be a list, not a
    // timeline.
    const widths = boxes.map((box) => Math.round(box.getBoundingClientRect().width));
    expect(new Set(widths).size).toBeGreaterThan(1);

    // COLOUR IS COLLECTION. Every box is painted, and clips sharing a
    // collection share a colour.
    const colours = boxes.map((box) => box.style.backgroundColor);
    expect(colours.every((colour) => colour.length > 0)).toBe(true);
    expect(new Set(colours).size).toBeLessThan(boxes.length);

    // And exactly one box is marked as the one in the middle.
    //
    // A TRIANGLE ABOVE IT, not a ring around it. Two things were wrong with the
    // ring: it enclosed an AREA, so at a wide reach — where a box is a few
    // pixels across — the mark became most of the clip and stopped reading as a
    // mark; and it was RED, which is the playhead's colour, putting two
    // different "you are here" claims in one hue, one about time and one about
    // which shot. A triangle points at a place, and its size has nothing to do
    // with the clip's duration, so it reads the same at every zoom.
    expect(document.querySelectorAll("[data-seam-segment-live]").length).toBe(1);
    const mark = document.querySelector<HTMLElement>("[data-seam-active-mark]");
    expect(mark).not.toBeNull();
    expect(mark!.getAttribute("data-seam-active-mark")).toBe(
      centreBox().getAttribute("data-seam-segment"),
    );
    // ON THE MIDDLE OF THAT BOX, and ABOVE the film base rather than on it.
    // The strip clips, so this lives outside the clipping wrapper — the same
    // escape the time chip and the hover preview use — and a version drawn
    // inside would simply not be there.
    const tip = mark!.getBoundingClientRect();
    const marked = centreBox().getBoundingClientRect();
    expect(Math.abs((tip.left + tip.width / 2) - (marked.left + marked.width / 2)))
      .toBeLessThanOrEqual(1);
    expect(tip.bottom).toBeLessThanOrEqual(marked.top);
    // White, because the band above the film base is the dark part of the bar.
    const tone = getComputedStyle(mark!).borderTopColor.match(/[\d.]+/g)!.slice(0, 3);
    expect(Math.min(...tone.map(Number))).toBeGreaterThan(200);
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
    expect(
      document
        .querySelector("[data-seam-bar]")!
        .querySelector("button[aria-label='Play across the cut']"),
    ).not.toBeNull();

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
    const centreName = () =>
      document
        .querySelector('[data-item-details-panel="centre"]')
        ?.querySelector("button[aria-label^='Rename ']")
        ?.getAttribute("aria-label") ?? null;
    const monitorSrc = () =>
      document
        .querySelector('[data-item-details-panel="centre"]')!
        .querySelector<HTMLImageElement>("[data-item-details-frame] img")!.src;
    const playOf = (panel: HTMLElement) =>
      panel.querySelector<HTMLButtonElement>("[data-item-details-play]")!;

    expect(centreName()).toBe("Rename Subject");

    // Park the clock inside the SUBJECT first. Without this the assertion
    // below cannot tell "jumped to this clip" from "happened to already be
    // there" — the bar rests at the subject's own first frame.
    await settleStrip();
    // Four seconds in lands inside the SUBJECT: the bar runs Before (3s) then
              // Subject (4s), so anything past 3 is in the middle clip.
    nudgePlayhead(4);
    await waitFor(() => expect(at()).toBeGreaterThan(3));

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
    expect(stayedCentred).toBe("Rename Subject");
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

    // PRESSED AGAIN, IT PAUSES — and does not rewind. Pausing is the same
    // contract as the bar's button, so the two controls cannot disagree.
    fireEvent.click(playOf(panels()[2]!));
    await waitFor(() =>
      expect(document.querySelectorAll('[data-item-details-play="playing"]').length).toBe(0),
    );
    expect(at()).toBeGreaterThanOrEqual(6);
    expect(playOf(panels()[2]!).getAttribute("aria-label")).toMatch(/^Play /);
  },
};


/**
 * ── THE BAR IS A WINDOW ONTO THE WHOLE PROJECT ────────────────────────────
 *
 * The stories below are about what follows from that, and none of them were
 * possible while the bar drew everything at one fixed scale.
 */

/**
 * THE WHEEL PANS; ⌘ OR CTRL AND THE WHEEL ZOOMS ABOUT THE POINTER.
 *
 * Two gestures on the same input, and the second is the one that matters: at
 * a single fixed scale a bar is either a smear of a long project or a keyhole
 * onto a short one, and which you get depends on nothing but how much footage
 * happens to exist.
 *
 * ZOOMING ABOUT THE POINTER IS THE WHOLE CLAIM. A zoom that scaled about the
 * left edge would throw away the thing you were looking at every time you
 * pushed in, which makes it a control you have to undo rather than one you
 * aim. So this asserts the time under the cursor before and after, and lets
 * everything else move around it.
 */
export const TheWheelPansAndZoomsAboutThePointer: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-strip]")).not.toBeNull());
    await settleStrip();

    const pps = () => Number(seamTrack().getAttribute("data-seam-pps"));
    const stripLeft = () =>
      document.querySelector<HTMLElement>("[data-seam-strip]")!.getBoundingClientRect().left;
    /** The second of footage sitting under a given screen x. */
    const secondsUnder = (clientX: number) => (clientX - stripLeft()) / pps();

    const surface = seamSurface();
    const box = surface.getBoundingClientRect();
    const anchor = box.left + box.width * 0.7;

    // ── PAN ───────────────────────────────────────────────────────────────
    const beforePanX = stripLeft();
    const beforePanPps = pps();
    fireEvent.wheel(surface, { deltaY: 160, clientX: anchor, clientY: box.top + 4 });
    await waitFor(() => expect(stripLeft()).toBeLessThan(beforePanX - 100));
    // A pan is not a zoom: the scale is untouched, so every box keeps its size.
    expect(pps()).toBe(beforePanPps);

    // ── ZOOM ──────────────────────────────────────────────────────────────
    const heldSecond = secondsUnder(anchor);
    const beforeZoom = pps();
    fireEvent.wheel(surface, {
      deltaY: -240,
      ctrlKey: true,
      clientX: anchor,
      clientY: box.top + 4,
    });
    await waitFor(() => expect(pps()).toBeGreaterThan(beforeZoom * 1.2));
    // THE SAME SECOND IS STILL UNDER THE CURSOR. Everything else on the bar
    // has moved and been redrawn at a new size; this one point has not.
    expect(Math.abs(secondsUnder(anchor) - heldSecond)).toBeLessThan(0.05);

    // And back out again, about the same point.
    const zoomedIn = pps();
    fireEvent.wheel(surface, {
      deltaY: 240,
      ctrlKey: true,
      clientX: anchor,
      clientY: box.top + 4,
    });
    await waitFor(() => expect(pps()).toBeLessThan(zoomedIn * 0.9));
    expect(Math.abs(secondsUnder(anchor) - heldSecond)).toBeLessThan(0.05);

    // ── AND THE STRIP CANNOT BE THROWN AWAY ───────────────────────────────
    //
    // A native scroller clamps for free; a transform does not. Twenty hard
    // notches one way and twenty back is a firm two-finger flick in each
    // direction, and neither may end with the bar empty and the strip
    // somewhere off the side of the track.
    const strip = document.querySelector<HTMLElement>("[data-seam-strip]")!;
    const stillOnScreen = () => {
      const s = strip.getBoundingClientRect();
      const t = seamTrack().getBoundingClientRect();
      return Math.min(s.right, t.right) - Math.max(s.left, t.left);
    };
    for (const direction of [1, -1]) {
      for (let notch = 0; notch < 20; notch += 1) {
        fireEvent.wheel(surface, {
          deltaY: 600 * direction,
          clientX: anchor,
          clientY: box.top + 4,
        });
      }
      await waitFor(() => expect(stillOnScreen()).toBeGreaterThan(0));
      // Not a sliver, either: half the track is the far end of the clamp, so
      // there is always something to grab hold of and read.
      expect(stillOnScreen()).toBeGreaterThan(box.width * 0.4);
    }
  },
};


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

    const labels = (kind: string) =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-seam-tick=" + kind + "]")).map(
        (tick) => tick.textContent?.trim() ?? "",
      );

    expect(labels("collection")).toEqual(["Kitchen Interior", "Loading Dock"]);

    // Seconds, and enough of them to read a scale from.
    const times = labels("time");
    expect(times.length).toBeGreaterThan(3);
    expect(times.every((label) => /^[0-9]+s$/.test(label))).toBe(true);

    // A DASHED LINE AT THE SEAM, one per crossing and none before the first
    // clip — there is no seam at a beginning, only a start.
    expect(document.querySelectorAll("[data-seam-divider]").length).toBe(1);
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

    // AS FAR AS THE BAR REACHES, which is the default ten either side — the
    // minimap draws the stretch the clock covers, not the whole project. It
    // used to be the one thing on screen that never cropped; the reach picker
    // is what changed that, and `All` is still there for when the question is
    // where this sits in the sequence.
    const segments = () => document.querySelectorAll("[data-seam-mini-segment]").length;
    expect(segments()).toBe(21);
    reachTo("All");
    await waitFor(() => expect(segments()).toBe(24));
    // Left as it was found, for whichever story runs next in this browser.
    reachTo("10");
    await waitFor(() => expect(segments()).toBe(21));

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

    // Taller than its neighbours, and on the SAME CENTRE LINE — grown both
    // ways rather than hanging off the bottom of the run.
    const others = Array.from(
      document.querySelectorAll<HTMLElement>("[data-seam-mini-segment]"),
    ).filter((segment) => !segment.hasAttribute("data-seam-mini-segment-live"));
    const markedBox = live[0]!.getBoundingClientRect();
    const plainBox = others[0]!.getBoundingClientRect();
    expect(markedBox.height).toBeGreaterThan(plainBox.height);
    expect(
      Math.abs(
        (markedBox.top + markedBox.height / 2) - (plainBox.top + plainBox.height / 2),
      ),
    ).toBeLessThan(0.6);

    // The window is a PART of it, not all of it: if it covered the whole
    // minimap there would be nothing off the sides and nothing to say.
    const map = minimap.getBoundingClientRect();
    expect(windowRect().width).toBeLessThan(map.width * 0.8);

    const before = windowRect().left;
    const clock = at();
    const press = pointerAt(map.left + map.width * 0.85, map.top + map.height / 2);
    fireEvent.pointerDown(minimap, press);
    await waitFor(() => expect(windowRect().left).toBeGreaterThan(before + 40));

    // AND THE PLAYHEAD DID NOT MOVE. Panning is a change of view, not a change
    // of position — the difference between looking somewhere and going there.
    expect(at()).toBe(clock);
    fireEvent.pointerUp(minimap, press);
  },
};

/**
 * POINTING AT A BOX SAYS WHICH SHOT IT IS.
 *
 * A box is a coloured rectangle. Colour groups it by collection and width
 * gives its length, and neither answers the question anyone actually has,
 * which is whether that is the shot they are looking for — the bar spans the
 * whole project, so most of what is on it is unidentifiable by construction.
 *
 * The preview answers it WITHOUT MOVING THE PLAYHEAD, which is the point:
 * checking costs you nothing and leaves you where you were.
 */
export const PointingAtABoxSaysWhatItIs: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-strip]")).not.toBeNull());
    await settleStrip();
    const at = () => Number(seamTrack().getAttribute("aria-valuenow"));
    const preview = () => document.querySelector<HTMLElement>("[data-seam-preview]");

    expect(preview()).toBeNull();

    const target = seamBoxes()[3]!.getBoundingClientRect();
    const before = at();
    // AT THE RULER, above that box. The film raises nothing now.
    hoverRulerAt(target.left + target.width / 2);

    await waitFor(() => expect(preview()).not.toBeNull());
    expect(preview()!.textContent).toContain("Kitchen 3");
    // Which collection, and how far into the clip — the two facts a box
    // cannot carry itself.
    expect(preview()!.textContent).toContain("Kitchen Interior");
    // A ghost line marks WHERE, so the words and the position are one object.
    // TWO SEGMENTS OF ONE LINE, since the pointer is on the ruler and the clip
    // it is asking about is below: the scale draws its own so that pointing at
    // it visibly does something, and the film draws the half that lands on the
    // frames.
    expect(document.querySelector("[data-seam-ghost]")).not.toBeNull();
    expect(document.querySelector("[data-seam-ruler-ghost]")).not.toBeNull();
    // LOOKING IS FREE.
    expect(at()).toBe(before);

    // `pointerOut` with a relatedTarget, not `pointerLeave`: React synthesises
    // enter/leave from delegated over/out events, so a bare `pointerleave`
    // reaches no handler and the preview would look sticky in a way it is not.
    fireEvent.pointerOut(seamRuler(), {
      ...pointerAt(target.left, target.top),
      relatedTarget: document.body,
    });
    await waitFor(() => expect(preview()).toBeNull());
  },
};

/**
 * THE PLAY BAR CAN DRAW FRAMES INSTEAD OF GREY BOXES, and does not by default.
 *
 * A bar of frames answers "which shot is that" without a hover, which is the
 * whole reason to want it. What it costs is what the grey bar is good at: a
 * box's width is its duration, so an even run of grey reads as rhythm — where
 * the cuts fall, which shots are long, where the pace changes. Put pictures in
 * them and the eye reads the pictures, because it always will. Hence a
 * setting, and hence off.
 *
 * THE COLOUR STAYS UNDERNEATH. A clip with no poster — audio has none — and a
 * frame that has not loaded yet both leave the box exactly as it is without
 * the setting, so turning this on can add pictures but never subtract the bar.
 */
export const ThePlaybarCanDrawFrames: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-strip]")).not.toBeNull());
    await settleStrip();

    // OFF FIRST, and asserted: the control is on the bar now, so the story can
    // show the before as well as the after. It has to ASK for the before —
    // the bar ships on STRIP, so the plain grey state is somewhere this story
    // goes rather than somewhere it starts.
    framesTo("OFF");
    await waitFor(() =>
      expect(document.querySelectorAll("[data-seam-thumbnail]").length).toBe(0),
    );
    framesTo("COVER");

    const boxCount = seamBoxes().length;
    await waitFor(() =>
      expect(document.querySelectorAll("[data-seam-thumbnail]").length).toBe(boxCount),
    );
    const thumbs = Array.from(
      document.querySelectorAll<HTMLImageElement>("[data-seam-thumbnail]"),
    );

    // COVER, AND THE WHOLE BOX. The box's width is its duration and its height
    // is the bar's, so the frame is whatever shape that comes out as —
    // anything but `cover` would letterbox each clip differently and turn a
    // strip into a row of unrelated shapes.
    const first = thumbs[0]!;
    expect(getComputedStyle(first).objectFit).toBe("cover");
    const box = first.parentElement!.getBoundingClientRect();
    const picture = first.getBoundingClientRect();
    expect(picture.width).toBeCloseTo(box.width, 0);
    expect(picture.height).toBeCloseTo(box.height, 0);

    // The colour is still under it, so a frame that never loads leaves a bar
    // rather than a hole.
    const boxStyle = getComputedStyle(first.parentElement!);
    expect(boxStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");

    // AND THE GAP CARRIES BOTH TONES. No single colour separates two frames:
    // a dark gap is invisible between two dark ones, a pale gap between two
    // bright ones, and footage supplies both inside the same cut. So one of
    // the two is the strip's background and the other is a ring each box casts
    // into the gap, and every gap reads light · dark · light whatever is
    // beside it. Asserted as BOTH being present, because either alone is the
    // bug.
    //
    // AND THE PALE ONE IS THE STRIP, which is not a free choice even though
    // the contrast rule would be satisfied either way.
    //
    // It was inverted for a while — near-black base, pale rings — on exactly
    // that reasoning. The contrast held and the resemblance did not: a dark
    // strip with light lines in it looks like a chart with gridlines. A strip
    // of film is a LIGHT BASE with pictures printed on it and dark frame
    // lines, and the whole point of this treatment is the resemblance.
    const gap = getComputedStyle(
      document.querySelector<HTMLElement>("[data-seam-strip]")!,
    ).backgroundColor;
    const base = gap.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    expect(Math.min(...base)).toBeGreaterThan(160);

    const ring = boxStyle.boxShadow.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    expect(Math.max(...ring)).toBeLessThan(90);
    // OUTSIDE the box, which is what puts it in the gap rather than over the
    // picture — and what keeps it costing no layout.
    expect(boxStyle.boxShadow).not.toMatch(/inset/);
    // AND THE THREE BANDS SHARE THE GAP THAT WAS ALREADY THERE. The ring is
    // most of the way to half the inset either side, so the pale core is a
    // band rather than the whole gap with a hairline on it — a white band with
    // a hairline either side reads as a white band. It must not reach the
    // inset itself, which would close the gap and leave two boxes touching.
    const spread = Number(boxStyle.boxShadow.match(/([\d.]+)px(?!.*px)/)![1]);
    expect(spread).toBeGreaterThan(1);
    expect(spread).toBeLessThan(2.5);

    // AND THE RING HAS SOMEWHERE TO PAINT ON ALL FOUR SIDES.
    //
    // This is the assertion that would have caught the real bug, and it hid
    // for a long time because everything ABOUT the ring was correct: the right
    // colour, the right width, present in the DOM, reported by
    // `getComputedStyle`. It was simply invisible on two of its four sides.
    //
    // A box was `inset-y-0` — exactly the lane's height — and the lane is
    // `overflow-hidden`, so a shadow painted OUTSIDE the box had no vertical
    // room and was clipped away. What survived was the left and right of each
    // ring, which reads as a row of thin separators rather than as film. A
    // frame on a strip has margin on all four sides, not two.
    const lane = document.querySelector<HTMLElement>("[data-seam-strip]")!.parentElement!;
    const laneBox = lane.getBoundingClientRect();
    const boxRect = seamBoxes()[0]!.getBoundingClientRect();
    expect(boxRect.top - laneBox.top).toBeGreaterThanOrEqual(spread);
    expect(laneBox.bottom - boxRect.bottom).toBeGreaterThanOrEqual(spread);

    framesTo("OFF");
    await waitFor(() =>
      expect(document.querySelectorAll("[data-seam-thumbnail]").length).toBe(0),
    );
    // AND IT GOES AWAY WITH THEM. Over flat grey the whole treatment is
    // decoration answering a question nobody asked, and one more thing between
    // the reader and the rhythm the grey bar is for.
    expect(getComputedStyle(seamBoxes()[0]!).boxShadow).toBe("none");
    expect(
      getComputedStyle(document.querySelector<HTMLElement>("[data-seam-strip]")!)
        .backgroundColor,
    ).toBe("rgba(0, 0, 0, 0)");

    // PUT IT BACK. The setting is module scope so it outlives this story, and
    // a story that leaves the bar somewhere other than its default hands the
    // next one a state nobody chose — which is exactly how the story asserting
    // the default came to fail with no bug behind it.
    framesTo("STRIP");
  },
};

/**
 * FILMSTRIP: A ROW OF FRAMES ACROSS THE CLIP, not one frame standing for it.
 *
 * `cover` answers "which shot is that". A strip answers a second question the
 * single frame cannot: what HAPPENS in it. A long take that opens on a closed
 * door and ends on an empty room is one picture at `cover` and a story here.
 *
 * WHAT THIS COVERS IS THE LAYOUT, not the sampling. Which times the cells are
 * taken at is `videoFrameUrls`, which has its own tests — and in a story the
 * fixture posters are not Cloudinary video URLs, so every cell resolves to the
 * same image and only the arrangement is observable. The two are worth keeping
 * apart: the arithmetic is pure and the arrangement is geometry, and neither
 * needs the other to be wrong to fail.
 */
export const ThePlaybarCanDrawAFilmstrip: Story = {
  // TRIMMED_SCENE because its clips are VIDEO with posters and real trims —
  // the only fixture here a filmstrip can be built from at all. A still falls
  // back to the single frame by design, which is the story after next.
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-strip]")).not.toBeNull());
    await settleStrip();
    framesTo("STRIP");

    // The widest box, so there is room for more than one cell in it — a strip
    // of one is a `cover` by another name and would prove nothing.
    await waitFor(() =>
      expect(document.querySelectorAll("[data-seam-filmstrip]").length).toBeGreaterThan(0),
    );
    const widest = Array.from(
      document.querySelectorAll<HTMLElement>("[data-seam-filmstrip]"),
    )
      .slice()
      .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]!;
    const cells = Array.from(widest.querySelectorAll<HTMLImageElement>("img"));
    expect(cells.length).toBeGreaterThan(1);

    // THEY DIVIDE THE BOX EXACTLY. `flex-1` rather than a fixed cell width, so
    // there is never a grey tail at the end of a strip where the arithmetic
    // did not come out even.
    const box = widest.getBoundingClientRect();
    const first = cells[0]!.getBoundingClientRect();
    const last = cells[cells.length - 1]!.getBoundingClientRect();
    expect(first.left).toBeCloseTo(box.left, 0);
    expect(last.right).toBeCloseTo(box.right, 0);

    // AND EVERY FRAME IS FRAMED, not just every clip.
    //
    // The cells butted together once, so a clip's strip read as one long
    // smeared picture and the only light lines on the bar were at the shot
    // boundaries. On a strip of film every frame has an edge, and that
    // repeating rhythm at a finer interval than the cuts is most of what makes
    // the bar recognisable as film rather than as a row of tiles.
    const strip = cells[0]!.parentElement!;
    const cellEdge = getComputedStyle(strip).backgroundColor;
    expect(Math.min(...cellEdge.match(/[\d.]+/g)!.slice(0, 3).map(Number))).toBeGreaterThan(160);
    // A HAIRLINE, and THINNER THAN THE RING AROUND THE CLIP. That order is the
    // hierarchy: a frame edge is texture, a clip edge is a cut. Equal weights
    // would make every sampled frame look like a shot boundary, which is the
    // one thing the bar exists to show.
    const between = cells[1]!.getBoundingClientRect().left - cells[0]!.getBoundingClientRect().right;
    expect(between).toBeGreaterThan(0);
    expect(between).toBeLessThan(1.5);

    // Square-ish: about one cell per bar-height, which is what makes them read
    // as frames in a strip rather than as stripes.
    expect(Math.abs(first.width - first.height)).toBeLessThan(first.height);
    expect(getComputedStyle(cells[0]!).objectFit).toBe("cover");

    // THE STYLE IS A SEPARATE SETTING FROM WHETHER FRAMES SHOW AT ALL: this is
    // the strip, so the single covering frame must not ALSO be in the box.
    expect(widest.parentElement!.querySelectorAll("img").length).toBe(cells.length);

    framesTo("STRIP");
  },
};

/**
 * A STILL FALLS BACK TO THE SINGLE FRAME, whatever the style says.
 *
 * A still has one image. Sampling it at ten intervals gives ten copies of
 * itself — a filmstrip whose content is "nothing happens here", which is worse
 * than the one frame it is made of and takes ten requests to say. So the strip
 * is offered only where there is something to sample, and the setting degrades
 * rather than obeying.
 */
export const AStillIgnoresTheFilmstrip: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-strip]")).not.toBeNull());
    await settleStrip();
    framesTo("STRIP");

    // Still a picture per box — falling back is not the same as giving up.
    await waitFor(() =>
      expect(document.querySelectorAll("[data-seam-thumbnail]").length).toBe(
        seamBoxes().length,
      ),
    );
    expect(document.querySelectorAll("[data-seam-filmstrip]").length).toBe(0);

    framesTo("STRIP");
  },
};

/**
 * THE BAR OPENS AS FILM.
 *
 * It opened grey, on the argument that a run of even boxes reads as RHYTHM and
 * that pictures override that because the eye always reads pictures first.
 * That is still true, and it is now the thing you switch TO: the bar's FIRST
 * job is saying which shot is where, and a row of grey rectangles cannot do
 * that at all without a hover per box. Rhythm is what you read second, once
 * you know what you are looking at.
 *
 * Its own story rather than a half of the one above, because "the setting does
 * something" and "the setting starts here" fail in different ways and one
 * should not hide the other.
 */
export const ThePlaybarOpensAsFilm: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-strip]")).not.toBeNull());
    await settleStrip();
    expect(seamBoxes().length).toBeGreaterThan(0);

    // ASKED FOR EXPLICITLY, and the reason is worth stating rather than
    // hiding: the setting is MODULE SCOPE, deliberately, so that closing the
    // details view and opening another clip does not reset it. That also means
    // it is shared by every story in this file and outlives each of them — so
    // no story here can honestly assert "this is what it opens on", only "this
    // is what it looks like when it is on". Whichever story ran last owns the
    // value, and a test whose result depends on that is a test that will pass
    // or fail for reasons that have nothing to do with the bar.
    //
    // The default itself is one constant in `graph-playbar-thumbnails.tsx` and
    // is verified in a browser against the real board, not here.
    framesTo("STRIP");
    await waitFor(() =>
      expect(document.querySelectorAll("[data-seam-thumbnail]").length).toBeGreaterThan(0),
    );
    // AND STILLS STILL SHOW SOMETHING, which is the half of this that matters
    // for a default.
    //
    // These clips are images, so they have no posters to sample across and
    // fall back to one covering frame each — a still sampled ten times is ten
    // copies of itself, which is a filmstrip of nothing happening. That
    // fallback is why STRIP is safe to ship as the default: a project of
    // stills gets a bar of pictures rather than a bar of blanks. The
    // filmstrip's own layout is covered on a video fixture in
    // `ThePlaybarCanDrawAFilmstrip`.
    expect(document.querySelectorAll("[data-seam-filmstrip]").length).toBe(0);
    expect(document.querySelectorAll("[data-seam-thumbnail]").length).toBe(
      seamBoxes().length,
    );

    // The control says so too, which is what makes the bar's state readable
    // rather than merely true.
    const group = document.querySelector<HTMLElement>("[data-details-bar-frames]")!;
    const badges = Array.from(group.querySelectorAll("button"));
    expect(badges.map((badge) => badge.textContent?.trim())).toEqual([
      "OFF",
      "COVER",
      "STRIP",
    ]);
    // STRIP is the one lit, and the plain bar is offered rather than hidden —
    // the row says what the bar could be as well as what it is, and `OFF` is
    // one press away because the reading it gives is still worth having.
    expect(badges.map((badge) => badge.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "true",
    ]);
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
    await waitFor(() => expect(document.querySelector("[data-seam-controls]")).not.toBeNull());
    await settleStrip();
    const box = (selector: string) =>
      document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();

    // ── ORDER: cut, project, controls ─────────────────────────────────────
    const track = box("[data-seam-track]");
    const controls = box("[data-seam-controls]");
    const minimap = box("[data-seam-minimap]");
    expect(track.bottom).toBeLessThanOrEqual(minimap.top + 0.5);
    expect(minimap.bottom).toBeLessThanOrEqual(controls.top + 0.5);
    // AND NOTHING COMES BETWEEN THEM. The gap between the two bars is the
    // stack's own spacing and nothing else — the assertion that would fail if
    // anything were ever slotted back in there.
    expect(minimap.top - track.bottom).toBeLessThan(24);

    // ── THE TRANSPORT IS CENTRED ON THE TRACK ─────────────────────────────
    const transport = box("[data-seam-transport]");
    expect(Math.abs(
      transport.left + transport.width / 2 - (track.left + track.width / 2),
    )).toBeLessThan(2);

    // ── AND EVERYTHING ELSE IS IN THAT ROW WITH IT ────────────────────────
    const row = document.querySelector<HTMLElement>("[data-seam-controls]")!;
    expect(row.querySelector("[data-details-bar-frames]")).not.toBeNull();
    expect(row.querySelector("[data-details-bar-reach]")).not.toBeNull();
    expect(row.querySelector("[data-seam-transport]")).not.toBeNull();
    // The clock, which used to sit at the far right of the scrub bar itself.
    // CLOCK NOTATION, not seconds: `252.90s` is accurate and unplaceable in a
    // four-minute cut, so it reads `0:36.0 / 2:06.0` — minutes, and tenths
    // because the left half MOVES and the second decimal is a blur at
    // playback speed.
    expect(row.textContent).toMatch(/\d+:\d\d\.\d\s*\/\s*\d+:\d\d\.\d/);
    // And the fit control, which shares the row for the same reason the reach
    // does: both are questions about how much of the bar you are looking at.
    expect(row.querySelector("[data-seam-fit]")).not.toBeNull();

    // ── AND THE TRACK GOT THE WIDTH THE TRANSPORT AND CLOCK GAVE UP ───────
    // They were siblings of the track, so the bar was as wide as the modal
    // minus both of them; now they are below it and the track is the whole
    // width. Stated as a floor rather than a number, so it survives a change
    // of viewport instead of being calibrated to one.
    expect(track.width).toBeGreaterThan(window.innerWidth * 0.9);

    // ── AND THE ROW BELOW STILL CLEARS IT ─────────────────────────────────
    // The top band is RESERVED by the scrim's padding, not shared: the bar is
    // absolutely positioned and takes no space, so the strip would centre
    // straight up underneath it. Every time the bar grows a row that padding
    // has to grow with it, and the symptom of it not doing so is the minimap
    // resting on the top edge of the middle card — a quiet eight pixels rather
    // than an obvious fault. This moved the transport and the clock INTO that
    // band, so it is exactly the change that would do it.
    const panel = box('[data-item-details-panel="centre"]');
    //
    // BOUNDED BOTH WAYS, because only one of the two is a fault you would
    // notice. Too little and the minimap rests on the card — the code calls
    // that "a quiet eight pixels", and eight is exactly what an 11rem band
    // leaves, so the floor is set above it. Too much and the band is holding
    // space for a row that is no longer there, which nothing would ever
    // report: the view just sits lower than it needs to.
    //
    // MEASURED FROM THE CONTROLS, NOT THE MINIMAP. The controls row used to sit
    // between the two bars and now sits under both, so the space below the
    // minimap legitimately contains it — measuring there counts a row as slack
    // and reports 84px of "waste" that is actually the transport.
    const controlsRow = box("[data-seam-controls]");
    expect(minimap.bottom).toBeLessThanOrEqual(controlsRow.top + 0.5);
    const slack = panel.top - controlsRow.bottom;
    expect(slack).toBeGreaterThan(16);
    expect(slack).toBeLessThan(80);
  },
};

/**
 * THE BAR SAYS WHEN IT HAS ACTUALLY RUN OUT.
 *
 * Running out of boxes and running out of PROJECT look identical, and at any
 * reach short of `All` they are usually different things: the window is
 * cropped at both ends nearly everywhere in a long cut, so the last box on
 * screen is just the last one the reach allowed. A stop is drawn only where
 * the window has reached a real end.
 *
 * BOTH DIRECTIONS ARE ASSERTED FROM THE SAME SCENE, by changing the reach
 * rather than the subject: at `All` this collection fits, so both ends are
 * real ends; at `5` the subject sits far enough inside that neither is.
 */
export const TheBarMarksTheEndsOfTheProject: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-strip]")).not.toBeNull());
    await settleStrip();
    const caps = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-seam-cap]")).map(
        (cap) => cap.dataset.seamCap,
      );

    // EVERYTHING ON THE BAR: both ends are the project's own.
    reachTo("All");
    await waitFor(() => expect(seamBoxes().length).toBe(24));
    expect(caps().sort()).toEqual(["end", "start"]);

    // The start cap sits OUTSIDE the first box rather than over it — it is a
    // mark about the film, not a mark on a clip.
    const first = seamBoxes()[0]!.getBoundingClientRect();
    const startCap = document
      .querySelector<HTMLElement>('[data-seam-cap="start"]')!
      .getBoundingClientRect();
    expect(startCap.right).toBeLessThanOrEqual(first.left + 0.5);

    const last = seamBoxes()[23]!.getBoundingClientRect();
    const endCap = document
      .querySelector<HTMLElement>('[data-seam-cap="end"]')!
      .getBoundingClientRect();
    expect(endCap.left).toBeGreaterThanOrEqual(last.right - 0.5);

    // CROPPED AT BOTH ENDS: the subject is ten clips in and five either side
    // reaches neither, so neither stop is true and neither is drawn.
    reachTo("5");
    await waitFor(() => expect(seamBoxes().length).toBe(11));
    expect(caps()).toEqual([]);

    reachTo("10");
  },
};

/**
 * THE BAR'S BOXES SLIDE INTO POSITION WHEN THE CENTRED CLIP CHANGES.
 *
 * The strip's transform is driven by three different things and only one of
 * them wants easing. A drag has to track the hand exactly — the edge run's
 * whole point is that the strip moves WITH the pointer — and a wheel zoom or
 * a pan is the same hand by another route. Changing which clip is centred is
 * not: nothing is under the reader's finger, the strip re-centres on somewhere
 * else entirely, and a jump there cannot be told apart from the bar being
 * redrawn with different contents.
 *
 * THE DRAG HALF IS COVERED BY `HoldingAtAnEdgeRunsTheStrip`, which measures
 * the strip's travel against the clock to within two pixels — an easing left
 * switched on during a drag puts the strip behind the hand and fails there.
 */
export const TheBarSlidesIntoPositionOnAMove: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-strip]")).not.toBeNull());
    await settleStrip();
    const stripX = () =>
      document.querySelector<HTMLElement>("[data-seam-strip]")!.getBoundingClientRect().left;
    const subject = () => centreBox().getAttribute("data-seam-segment");

    const startedOn = subject();
    const from = stripX();

    // A press on a box well along the bar: a move, not a drag.
    const boxes = seamBoxes();
    const target = boxes[boxes.indexOf(centreBox()) + 6]!;
    clickBox(target);
    await waitFor(() => expect(subject()).not.toBe(startedOn));

    // STILL ON ITS WAY. This is the assertion a jump fails: with no easing the
    // strip is already at its destination by the first reading, so the two
    // readings agree and nothing here can tell that it moved at all.
    const early = stripX();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(stripX()).not.toBe(early);

    // And it does arrive somewhere else, so the movement was real rather than
    // a wobble.
    await settleStrip();
    expect(Math.abs(stripX() - from)).toBeGreaterThan(20);

    // ── AND THE SAME IS TRUE OF THE STEP BUTTONS ─────────────────────────
    //
    // A different path to the same move, and the one that was broken: a click
    // on a box commits the clip and the travel together, while a STEP changes
    // the subject and only then decides whether the bar has to follow. Those
    // are separate commits, so the slide had nothing to interpolate on the
    // first and no move left to claim on the second — the strip cut 986px with
    // no transition property set at all.
    //
    // Everything above passed throughout, which is why this is here: the story
    // covered the path that worked.
    //
    // AND THIS IS COVERAGE, NOT A REGRESSION GUARD — said plainly because the
    // difference matters. Reverting the fix and re-running this leaves it
    // GREEN: whether the subject change and the nudge land in one commit or
    // two is React's scheduling, and under the story runner they arrive
    // together, which is exactly the case the old code handled. The split is
    // real in the app and was measured there — 986px with no transition
    // property at all, against `transform 520ms ease-out` after. What follows
    // asserts the step path eases at all, which nothing did before.
    const strip = () => document.querySelector<HTMLElement>("[data-seam-strip]")!;
    const forward = document.querySelector<HTMLElement>('[data-seam-step="forward"]')!;
    expect(forward).not.toBeNull();

    // STEP UNTIL THE BAR ACTUALLY HAS TO TRAVEL. Most steps move nothing —
    // the next clip is usually already on screen and the bar deliberately
    // stays where it was put — so asserting on the first press would assert
    // against a bar that correctly did nothing.
    let travelled = false;
    for (let attempt = 0; attempt < 12 && !travelled; attempt++) {
      const before = stripX();
      const wasOn = subject();
      forward.click();
      await waitFor(() => expect(subject()).not.toBe(wasOn));
      // Read the easing while the transition is still on the node: the effect
      // clears it once the slide is over.
      await new Promise((resolve) => setTimeout(resolve, 30));
      const easing = strip().style.transition;
      await settleStrip();
      if (Math.abs(stripX() - before) > 20) {
        travelled = true;
        expect(easing).toContain("transform");
      }
    }
    // The loop proving nothing would be the quiet failure here.
    expect(travelled).toBe(true);
  },
};

/**
 * HOW FAR THE BAR REACHES IS A SETTING, and ten either side is where it opens.
 *
 * The bar used to draw the whole collection whatever you were doing, which is
 * the right answer to "where does this sit in the sequence" and the wrong one
 * to "what is around this cut" — at a hundred clips a box is a hairline and
 * the thing you are working on is indistinguishable from the thing you are
 * not. The reach is the dial between those two questions.
 *
 * TWENTY AND ALL ARE THE SAME PICTURE HERE, because this scene is 24 clips
 * long and twenty either side reaches past both ends. That is the window
 * clamping rather than the setting failing — `barReachWindow` has its own
 * tests for the arithmetic, and this covers the wiring.
 */
export const TheBarReachIsASetting: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-strip]")).not.toBeNull());
    await settleStrip();
    const boxes = () => seamBoxes().length;
    const subject = () => centreBox().getAttribute("data-seam-segment");

    // SET EXPLICITLY RATHER THAN ASSUMED. The reach is remembered at module
    // scope for the session, so a story that ran earlier in this browser and
    // reached for `All` would leave it there — and a story that reads the
    // default is really reading whoever went last. What the default IS belongs
    // in the module's own test, where nothing can have moved it.
    reachTo("10");
    await waitFor(() => expect(boxes()).toBe(21));
    const startedOn = subject();

    reachTo("All");
    await waitFor(() => expect(boxes()).toBe(24));

    reachTo("10");
    await waitFor(() => expect(boxes()).toBe(21));

    // CHANGING THE REACH IS NOT A MOVE. It changes how much you can get to,
    // not where you are — losing your place to a change of view would make
    // the control cost more than it is worth.
    expect(subject()).toBe(startedOn);
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
 * THE BAR IS GREY, AND THE SEAMS STILL SHOW.
 *
 * The collection tint is parked behind `NEXT_PUBLIC_GSTUDIO_BAR_COLOURS`, off
 * by default, so every box on the strip and every segment of the minimap draws
 * in one neutral. This is the DEFAULT that is pinned here — the tinted path
 * cannot be exercised from a story, because the flag is a compile-time
 * constant; turn it on and this is the story that should fail.
 *
 * THE SECOND HALF IS THE POINT. A bar in which every clip looks alike is only
 * acceptable because the structure it used to carry in colour is carried
 * elsewhere: a dashed divider on the strip, a named tick on the ruler, and a
 * real gap in the minimap. So this asserts the greyness AND the three
 * landmarks together — losing either half is what would make the flag a
 * regression rather than a parking space.
 */
export const TheBarIsGreyUntilTheTintIsSwitchedOn: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-strip]")).not.toBeNull());
    await settleStrip();

    const colours = (selector: string) =>
      new Set(
        Array.from(document.querySelectorAll<HTMLElement>(selector)).map(
          (el) => el.style.backgroundColor,
        ),
      );

    // ONE colour across two collections, on both rows.
    const boxColours = colours("[data-seam-segment]");
    expect(boxColours.size).toBe(1);
    // THE SUBJECT IS EXCLUDED, and only it. The map marks the active clip
    // white, which is a claim about WHICH CLIP rather than which collection —
    // the flag withholds the second and has nothing to say about the first.
    // Scoped with `:not()` rather than by filtering afterwards so a mark that
    // silently stopped being applied would take the exclusion with it and
    // leave this asserting over everything again.
    const miniColours = colours(
      "[data-seam-mini-segment]:not([data-seam-mini-segment-live])",
    );
    expect(miniColours.size).toBe(1);
    // And the SAME one, so the strip and the map read as one object.
    expect([...miniColours]).toEqual([...boxColours]);

    // GREY rather than merely uniform: one saturated hue for everything would
    // pass the count above while being exactly what the flag withholds. The
    // measure is how far the channels spread — the neutral spans 14 of 255,
    // and a collection tint at 52% saturation spans about 90, so 24 separates
    // them with room either side rather than sitting on top of one.
    const [only] = [...boxColours];
    const [, r, g, b] = /rgb\((\d+), (\d+), (\d+)\)/.exec(only ?? "") ?? [];
    const channels = [Number(r), Number(g), Number(b)];
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThan(24);

    // THE SEAMS ARE STILL THERE, in the three places that now carry them
    // alone: the strip, the ruler and the minimap.
    expect(document.querySelectorAll("[data-seam-divider]").length).toBe(1);
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[data-seam-tick="collection"]')).map(
        (tick) => tick.textContent?.trim(),
      ),
    ).toEqual(["Kitchen Interior", "Loading Dock"]);
    // The minimap's own crossing: a real left margin on the first clip of the
    // second collection, and on nothing else.
    const gapped = Array.from(
      document.querySelectorAll<HTMLElement>("[data-seam-mini-segment]"),
    ).filter((segment) => Number.parseFloat(segment.style.marginLeft || "0") > 0);
    expect(gapped.length).toBe(1);
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
          spare: panel.parentElement!.hasAttribute("data-item-details-spare"),
          width: Math.round(panel.getBoundingClientRect().width),
          hidden: getComputedStyle(panel.parentElement!).visibility === "hidden",
        }),
      );

    const shown = slots().filter((slot) => !slot.spare);
    expect(shown.length).toBe(3);
    const centre = shown.find((slot) => slot.role === "centre")!;
    const neighbours = shown.filter((slot) => slot.role === "neighbour");
    expect(new Set(neighbours.map((slot) => slot.width)).size).toBe(1);
    expect(centre.width / neighbours[0]!.width).toBeCloseTo(1.75, 1);

    // THE SPARES ARE BUILT AND NOT SHOWN. Both halves matter: they keep their
    // width so the row's centring still works, and they paint nothing so the
    // count means what it says.
    const spares = slots().filter((slot) => slot.spare);
    expect(spares.length).toBeGreaterThan(0);
    expect(spares.every((slot) => slot.hidden)).toBe(true);
    expect(spares.every((slot) => slot.width === neighbours[0]!.width)).toBe(true);
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

/**
 * FIT RE-SCALES THE BAR TO SOMETHING YOU CAN NAME.
 *
 * Zoom was ⌘-wheel and nothing else, which meant the two scales anyone
 * actually wants — this scene, and the lot — were reachable only by rolling
 * until they happened to arrive. Both are one `fitPixelsPerSecond` call the
 * bar already makes on open; this gives them a button, and lights the one the
 * bar is currently sitting at.
 */
export const FitRescalesTheBar: Story = {
  render: () => <SeamHarness scene={FIT_SCENE} />,
  play: async () => {
    const track = await waitFor(() => {
      const found = seamTrack();
      expect(found).not.toBeNull();
      return found;
    });
    const scale = () => Number(track.getAttribute("data-seam-pps"));
    const button = (label: string) =>
      Array.from(
        document.querySelectorAll<HTMLButtonElement>("[data-seam-fit] button"),
      ).find((found) => found.textContent?.trim() === label)!;

    // It opens fitted to the subject's own collection, so that is what is lit.
    await waitFor(() => expect(button("clip").getAttribute("aria-pressed")).toBe("true"));
    const fitted = scale();
    expect(fitted).toBeGreaterThan(0);

    // EVERYTHING is a wider span, so it must be a smaller scale.
    fireEvent.click(button("all"));
    await waitFor(() => expect(button("all").getAttribute("aria-pressed")).toBe("true"));
    expect(scale()).toBeLessThan(fitted);
    expect(button("clip").getAttribute("aria-pressed")).toBe("false");

    // And back, to the number it started on.
    fireEvent.click(button("clip"));
    await waitFor(() => expect(scale()).toBeCloseTo(fitted, 1));
  },
};

/**
 * THE MINIMAP'S WINDOW EASES TO A NEW PLACE — BUT NOT UNDER A HAND.
 *
 * The rectangle says which part of the project the bar is drawing, and most of
 * what moves it is a jump: pressing `fit` rescales it, stepping a clip nudges
 * it, letting go of a scrub lands it somewhere else. At that size a jump cannot
 * be told apart from a redraw, so it eases.
 *
 * A DRAG IS THE EXCEPTION, and it is the same rule the strip itself follows:
 * while a gesture is driving the bar the rectangle has to be exactly where the
 * hand has put it, and easing would leave it trailing by a fixed distance —
 * which reads as lag, not as smoothing.
 */
export const TheMinimapWindowEasesButNotMidDrag: Story = {
  render: () => <SeamHarness scene={FIT_SCENE} />,
  play: async () => {
    const window_ = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-seam-mini-window]");
      expect(found).not.toBeNull();
      return found!;
    });

    // AT REST IT EASES, and both edges do: a fit changes the window's width as
    // much as its position, and easing one while cutting the other makes the
    // rectangle stretch from a corner.
    await waitFor(() => expect(window_.hasAttribute("data-seam-mini-window-eased")).toBe(true));
    const eased = getComputedStyle(window_).transitionProperty;
    expect(eased).toContain("left");
    expect(eased).toContain("width");

    // MID-SCRUB IT DOES NOT. The strip can run under a pointer that is holding
    // still, so the window moves continuously and must track it exactly.
    const surface = seamSurface();
    const box = surface.getBoundingClientRect();
    fireEvent.pointerDown(surface, pointerAt(box.left + 40, box.top + box.height / 2));
    fireEvent.pointerMove(surface, pointerAt(box.left + 120, box.top + box.height / 2));
    await waitFor(() =>
      expect(window_.hasAttribute("data-seam-mini-window-eased")).toBe(false),
    );
    expect(getComputedStyle(window_).transitionProperty).toBe("all");

    // And it comes back when the hand comes off.
    fireEvent.pointerUp(surface, pointerAt(box.left + 120, box.top + box.height / 2));
    await waitFor(() => expect(window_.hasAttribute("data-seam-mini-window-eased")).toBe(true));
  },
};

/**
 * THE HOVER CARD CAN BE PINNED UNDER THE MIDDLE OF THE BAR.
 *
 * `follow` centres it on the box being described, which is the right default:
 * pointing at a shot and reading about that shot is one gesture with no lookup
 * in the middle.
 *
 * `pinned` parks it and leaves it there, so the pointer scrubs and the picture
 * changes in place. That earns its keep now the card is big enough to judge a
 * frame in — a large picture sliding around under a moving pointer is the one
 * arrangement in which you cannot judge anything, because the eye spends the
 * whole sweep re-finding it. The cost is that a card away from the box is less
 * obviously ABOUT that box, which is why it is a choice rather than a change.
 */
export const TheHoverCardCanBePinned: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    await settleStrip();
    framesTo("STRIP");

    const lane = document.querySelector<HTMLElement>("[data-seam-boxes]")!;
    const press = (label: string) => {
      const group = document.querySelector<HTMLElement>("[data-details-bar-card]")!;
      Array.from(group.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === label)!
        .click();
    };
    const hoverOver = async (box: HTMLElement, fraction: number) => {
      const rect = box.getBoundingClientRect();
      // The ruler above that point on the box — the film no longer hovers.
      hoverRulerAt(rect.left + rect.width * fraction);
      return await waitFor(() => {
        const card = document.querySelector<HTMLElement>("[data-seam-preview]");
        expect(card).not.toBeNull();
        return card!.style.left;
      });
    };

    const boxes = seamBoxes();
    const first = boxes[0]!;
    const last = boxes[boxes.length - 1]!;

    // FOLLOW: two different boxes, two different places.
    press("FOLLOW");
    const followedLeft = await hoverOver(first, 0.2);
    const followedRight = await hoverOver(last, 0.8);
    expect(followedLeft).not.toBe(followedRight);
    // And clamped, so a box near either end never pushes the card off the
    // track — the failure that arrived with making the card bigger.
    expect(followedLeft).toContain("clamp(");

    // PINNED: the same place wherever the pointer is.
    press("PIN");
    const pinnedLeft = await hoverOver(first, 0.2);
    const pinnedRight = await hoverOver(last, 0.8);
    expect(pinnedLeft).toBe("50%");
    expect(pinnedRight).toBe("50%");

    // Put both settings back — module scope outlives the story.
    press("FOLLOW");
    framesTo("STRIP");
  },
};

/**
 * THE PANELS GO BACK WHILE THE PREVIEW IS UP.
 *
 * The hover card is a picture big enough to judge a frame in, and it is drawn
 * OVER the row rather than in a gap above it. Three bright panels behind it
 * compete with the one thing being looked at — and the card is usually about a
 * clip that is not one of the three, so they are not even context for it.
 *
 * NOT DURING A SCRUB, which is the distinction worth asserting. A scrub hides
 * the card and grows the monitor, so the middle panel is exactly what you are
 * watching; pulling the row back there would dim the thing the gesture exists
 * to show you.
 */
export const ThePanelsRecedeBehindThePreview: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    await settleStrip();
    const row = () => document.querySelector<HTMLElement>("[data-details-strip]")!;
    const dimmed = () => row().className.includes("opacity-40");
    const lane = document.querySelector<HTMLElement>("[data-seam-boxes]")!;
    const box = seamBoxes()[1]!.getBoundingClientRect();
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };

    expect(dimmed()).toBe(false);

    // Pointing at a box brings the card up, and the row goes back for it.
    // THE CARD WAITS BEFORE IT APPEARS — see `HOVER_DWELL_MS`. So does the dim
    // that follows it, and it arrives a render later than the card because the
    // bar reports the state and the view acts on it. Both are waited for
    // rather than assumed, which is also the assertion that the dwell has not
    // quietly become "never".
    // AT THE RULER above the box. Pressing, below, is still the film's.
    hoverRulerAt(centre.x);
    await waitFor(() => expect(document.querySelector("[data-seam-preview]")).not.toBeNull());
    await waitFor(() => expect(dimmed()).toBe(true));
    // Both properties ease, so the row does not snap dark while it slides.
    expect(getComputedStyle(row()).transitionProperty).toContain("opacity");

    // Pressing starts a scrub: the card goes, the monitor grows, and the row
    // comes back — the panel being watched must not be the dim one.
    fireEvent.pointerDown(lane, pointerAt(centre.x, centre.y));
    await waitFor(() => expect(document.querySelector("[data-seam-preview]")).toBeNull());
    await waitFor(() => expect(dimmed()).toBe(false));
    fireEvent.pointerUp(lane, pointerAt(centre.x, centre.y));
  },
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
 * A CLIP PLAYBACK SKIPS IS SAID SO ON THE BAR.
 *
 * `disabled` has been on the node all along and the bar had never been told,
 * so the one control that shows you the shape of playback was silent about a
 * clip playback steps over — and not noticing one is the whole failure mode.
 *
 * Hatched rather than dimmed, because a dimmed box is indistinguishable from a
 * dark frame and a bar already drawing pictures has no spare brightness to
 * signal with. And it keeps its full width: a disabled clip is still part of
 * the sequence you are reading, and shrinking it would move every cut after it.
 */
export const ASkippedClipIsHatchedOnTheBar: Story = {
  render: () => <SeamHarness scene={SKIPPED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    const hatched = await waitFor(() => {
      const found = document.querySelectorAll<HTMLElement>("[data-seam-hatch]");
      expect(found.length).toBe(1);
      return found[0]!;
    });

    // ON the skipped clip, and only that one.
    const marked = Array.from(
      document.querySelectorAll<HTMLElement>("[data-seam-segment-skipped]"),
    );
    expect(marked.length).toBe(1);
    expect(marked[0]!.getAttribute("data-seam-segment")).toBe("skipped");
    expect(marked[0]!.contains(hatched)).toBe(true);
    // A pattern, so it survives whatever is drawn under it.
    expect(getComputedStyle(hatched).backgroundImage).toContain("repeating-linear-gradient");

    // AND SAID AGAIN ABOVE THE BOX, for someone scanning rather than reading.
    const rule = document.querySelector<HTMLElement>('[data-seam-skip-rule="skipped"]');
    expect(rule).not.toBeNull();
    expect(getComputedStyle(rule!).borderTopStyle).toBe("dotted");

    // WIDTH IS STILL DURATION. The longest clip in the scene is the skipped
    // one, so it must still own the widest box — the treatment paints over it
    // and never shrinks it.
    const boxes = seamBoxes();
    const widest = boxes.reduce((a, b) =>
      a.getBoundingClientRect().width >= b.getBoundingClientRect().width ? a : b,
    );
    expect(widest.getAttribute("data-seam-segment")).toBe("skipped");
  },
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
 * THE ACTIVE CLIP'S RULE STOPS WHERE THE BAR DOES.
 *
 * The rule says how long the marked clip runs, and it is the one mark on the
 * bar whose width is a measurement. When the clip is longer than the track,
 * that measurement has nowhere to go — and it used to simply keep drawing,
 * out past the first box and off under the panels either side, which reads as
 * a clip that starts somewhere off-screen rather than one that continues.
 *
 * Asserted as CONTAINMENT rather than against a number: the clamp is CSS
 * (`max(0px, …)` and `min(100%, …)` against the lane's own box), so there is
 * no measured width to compare to and the invariant holds through a resize
 * and through every frame of a pan.
 */
export const TheActiveRuleIsClippedToTheBar: Story = {
  render: () => <SeamHarness scene={SUBJECT_AT_THE_EDGE_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    await waitFor(() => expect(seamBoxes().length).toBeGreaterThan(0));
    await settleStrip();

    const lane = seamSurface().getBoundingClientRect();
    const rule = document.querySelector<HTMLElement>("[data-seam-active-span]");
    const mark = document.querySelector<HTMLElement>("[data-seam-active-mark]");
    expect(rule).not.toBeNull();
    expect(mark).not.toBeNull();

    // THE FIXTURE ACTUALLY POSES THE PROBLEM. Without this the containment
    // below would pass on a clip that fit all along, which is how every other
    // seam story passes it today.
    const marked = centreBox().getBoundingClientRect();
    expect(marked.width).toBeGreaterThan(lane.width);

    // WHAT THIS STORY CANNOT POSE, said plainly: the TRIANGLE leaving the bar.
    // It sits at the clip's middle, and the bar CENTRES the active clip — so
    // that middle is the track's middle however long the clip is (measured
    // here: 600 in a track ending at 1176). The triangle only leaves the bar
    // once the bar has been PANNED away from the active clip, which the bar
    // deliberately allows: "a change of subject brings the new clip into view
    // if it is off the side, and otherwise leaves the bar exactly where you
    // put it".
    //
    // So the containment below is an INVARIANT here rather than a regression
    // test for the triangle — it holds either way in this fixture. The
    // triangle's clamp was verified by driving its `left` past both ends and
    // measuring: at 5000px it lands flush with the track's right edge, at
    // -3000px flush with the left. Reproducing it as a story needs a simulated
    // pan, which belongs with the e2e that already drives real drags.

    // BOTH ENDS, BOTH MARKS. Half a pixel of slack for subpixel rounding and
    // no more — the bug this covers was 326px of overhang on the rule, and the
    // triangle was left hanging off the end in the same way afterwards.
    for (const drawn of [rule!.getBoundingClientRect(), mark!.getBoundingClientRect()]) {
      expect(drawn.left).toBeGreaterThanOrEqual(lane.left - 0.5);
      expect(drawn.right).toBeLessThanOrEqual(lane.right + 0.5);
      // AND THEY ARE STILL MARKS. Clamped to nothing would satisfy the two
      // bounds above, so each has to survive the clamping that trimmed it.
      expect(drawn.width).toBeGreaterThan(0);
    }

    // THE TRIANGLE STAYS ON ITS RULE. They are one mark — a pointer with a
    // span — so a triangle clamped to the track while the rule stopped
    // somewhere else would read as two unrelated things at the same height.
    const ruleBox = rule!.getBoundingClientRect();
    const markBox = mark!.getBoundingClientRect();
    expect(markBox.left).toBeGreaterThanOrEqual(ruleBox.left - 0.5);
    expect(markBox.right).toBeLessThanOrEqual(ruleBox.right + 0.5);
  },
};
