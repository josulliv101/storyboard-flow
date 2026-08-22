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
function scrubToClientX(clientX: number, options?: { hold?: boolean; travelFrom?: number }): void {
  const surface = seamSurface();
  const box = surface.getBoundingClientRect();
  const y = box.top + box.height / 2;
  const from = clientX - (options?.travelFrom ?? 12);
  fireEvent.pointerDown(surface, pointerAt(from, y));
  fireEvent.pointerMove(surface, pointerAt(clientX, y));
  if (options?.hold === true) return;
  fireEvent.pointerUp(surface, pointerAt(clientX, y));
}

/** Let go of a held scrub, wherever the pointer was left. */
function releaseScrub(clientX: number): void {
  const surface = seamSurface();
  const box = surface.getBoundingClientRect();
  fireEvent.pointerUp(surface, pointerAt(clientX, box.top + box.height / 2));
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
 * `scrubIntoBox` reads a box's position ON SCREEN. Measure mid-move and the
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
  await new Promise((resolve) => setTimeout(resolve, 320));
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

/**
 * Scrub to a point inside `box`, `within` of the way across that clip.
 *
 * Aim at the BOX'S OWN x: the pointer and the boxes share a client coordinate
 * space, so a clip is at the same place on both and no conversion through the
 * strip's transform is needed — which is what makes this survive a pan and a
 * zoom that a fraction-of-the-timeline version would not.
 */
function scrubIntoBox(
  box: HTMLElement,
  within = 0.5,
  options?: { hold?: boolean },
): void {
  const target = box.getBoundingClientRect();
  scrubToClientX(target.left + target.width * within, options);
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

    // Identical size — a neighbour is a copy of the view, not a preview of it.
    const widths = panels.map((panel) => Math.round(panel.getBoundingClientRect().width));
    expect(new Set(widths).size).toBe(1);
    // And three of them cannot fit, which is the crop that gives the strip its
    // edges: the outer two run off the screen.
    const total = widths.reduce((sum, width) => sum + width, 0);
    expect(total).toBeGreaterThan(window.innerWidth);

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

    // ONE STEP STILL EASES. The counterpart to the cut in
    // `LettingGoOfTheBarLandsTheStrip`: a landing more than a panel away
    // arrives without travelling, and the guard that does it is a distance
    // test — so the thing to protect is the case just under the line. A step
    // is a gesture finishing itself and has to be seen to move.
    const strip = () => document.querySelector<HTMLElement>("[data-details-strip]")!;
    const movingX = strip().getBoundingClientRect().left;
    await new Promise((resolve) => setTimeout(resolve, 120));
    // Still in flight a third of the way through a 300ms ease.
    expect(strip().getBoundingClientRect().left).not.toBe(movingX);

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
 * THE PLAYHEAD STAYS INSIDE THE TRIMMED WINDOW.
 *
 * The regression: the line's position was measured as a fraction of what the
 * clip SHOWS, then drawn across a strip that renders the whole SOURCE. So it
 * swept the entire filmstrip — dimmed, trimmed-off material included — while
 * the picture only ever played the trimmed part. It reads precisely as being
 * able to scrub past the trim; the picture was fine and the line was lying
 * about it.
 *
 * Asserted against the amber window's own box rather than against a computed
 * number, because the thing that was wrong was an ASSUMPTION about what the
 * strip draws — and only the strip can settle that. A unit test agreeing with
 * my arithmetic would have agreed with the broken arithmetic too.
 */
export const PlayheadStaysInsideTheTrim: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() =>
      expect(document.querySelector('[data-item-details-panel="centre"]')).not.toBeNull(),
    );
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    // Scrub to a few points across the centre clip and check every one — into
    // its own BOX, which is what "across the centre clip" means now that the
    // bar carries the whole collection.
    for (const ratio of [0.35, 0.5, 0.65]) {
      await settleStrip();
      scrubIntoBox(centreBox(), ratio);

      const centre = document.querySelector('[data-item-details-panel="centre"]')!;
      const line = await waitFor(() => {
        const found = centre.querySelector<HTMLElement>("[data-seam-playhead-line]");
        expect(found).not.toBeNull();
        return found!;
      });
      const window_ = centre.querySelector<HTMLElement>("[data-trim-overview-window]");
      expect(window_).not.toBeNull();

      const lineBox = line.getBoundingClientRect();
      const windowBox = window_!.getBoundingClientRect();
      const centreX = lineBox.left + lineBox.width / 2;
      // A pixel of slack for the line's own width and rounding; the window is
      // a third of this strip, so a line escaping it misses by far more.
      expect(centreX).toBeGreaterThanOrEqual(windowBox.left - 1);
      expect(centreX).toBeLessThanOrEqual(windowBox.right + 1);
    }
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
    scrubIntoBox(boxes[centreIndex - 1]!, 0.5, { hold: true });
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
    scrubIntoBox(centreBox());
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
    const onScreen = () =>
      Array.from(document.querySelectorAll("[data-item-details-panel]")).filter((panel) => {
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
    scrubIntoBox(centreBox());

    // Scrubbed: the neighbours pull back, in both opacity and colour…
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
 * EVERY CLIP IS SCRUBBABLE, AND THE COUNT HAS NOTHING TO DO WITH IT.
 *
 * This used to assert the opposite arithmetic: the bar covered the clips ON
 * SCREEN plus a lead into each neighbour, so widening the view lengthened the
 * run of time it reached, and the test measured that growth.
 *
 * That coupling was the bug. It meant the only clips you could scrub were the
 * ones you could already see, and a shot four cards away — visible on the bar,
 * plainly a box — did nothing when pressed. The clock covers the whole
 * collection now, so the bar's length is a property of the COLLECTION and the
 * count changes only how many cards are under it.
 *
 * Both halves are asserted, because either alone would pass for the wrong
 * reason: the total does not move when the count does, AND the far end of the
 * bar still scrubs at either count.
 */
export const WiderViewsScrubEveryWholeClip: Story = {
  render: () => <SeamHarness scene={LONG_SCENE} />,
  play: async () => {
    const picker = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-details-view-count]");
      expect(found).not.toBeNull();
      return found!;
    });
    const barMax = () => Number(seamTrack().getAttribute("aria-valuemax"));
    const at = () => Number(seamTrack().getAttribute("aria-valuenow"));
    const press = async (label: string) => {
      const button = Array.from(picker.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === label,
      )!;
      fireEvent.click(button);
      await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    };

    await press("3");
    const atThree = barMax();
    expect(atThree).toBeGreaterThan(0);
    // Every clip has a box, whatever is on screen.
    const boxCount = seamBoxes().length;
    expect(boxCount).toBeGreaterThan(3);

    // The LAST clip — as far from the middle as this collection goes, and
    // certainly without a card at three up.
    await settleStrip();
    scrubIntoBox(seamBoxes()[boxCount - 1]!, 0.5);
    await waitFor(() => expect(at()).toBeGreaterThan(atThree * 0.6));

    // Five up: more cards, same timeline.
    await press("5");
    expect(barMax()).toBe(atThree);
    expect(seamBoxes().length).toBe(boxCount);

    // And the far end still answers.
    await settleStrip();
    scrubIntoBox(seamBoxes()[boxCount - 1]!, 0.2);
    await waitFor(() => expect(at()).toBeGreaterThan(atThree * 0.5));
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
    // And every frame occupies exactly the same box.
    await waitFor(() => expect(new Set(geometry()).size).toBe(1));

    // Five up is the narrow end now: the controls go.
    await press("5");
    await waitFor(() => expect(visible("[data-trim-overview]")).toBe(false));
    expect(visible("[data-tag-editor]")).toBe(false);
    expect(visible("[data-item-details-undo]")).toBe(false);
    // Still aligned, and still identically bordered.
    expect(new Set(geometry()).size).toBe(1);
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
    expect(document.querySelectorAll("[data-seam-segment-live]").length).toBe(1);
    expect(centreBox().querySelector("[data-seam-marker]")).not.toBeNull();
  },
};

/**
 * THE MONITOR GROWS WHILE YOU DRAG THE BAR.
 *
 * At three panels the middle one is already most of the screen and nothing
 * happens. At nine it is a couple of hundred pixels — fine as a frame beside
 * its neighbours, useless as the thing you are watching while you drag a
 * playhead through a cut. Scrubbing is exactly when the monitor stops being
 * one of several pictures and becomes the only one that matters.
 *
 * It grows by TRANSFORM rather than by width: the strip's slide is computed
 * from a uniform panel width, so a centre panel that actually got wider would
 * put every landing off by the difference.
 */
export const TheMonitorGrowsWhileScrubbing: Story = {
  render: () => <SeamHarness scene={LONG_SCENE} />,
  play: async () => {
    const picker = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-details-view-count]");
      expect(found).not.toBeNull();
      return found!;
    });
    // The WIDEST count, read off the picker rather than typed: this story is
    // about the monitor growing out of a small panel, so it wants whatever the
    // narrowest panel currently is, not a number that was once the maximum.
    const widest = Array.from(picker.querySelectorAll("button")).at(-1)!;
    fireEvent.click(widest);
    await waitFor(() => expect(widest.getAttribute("aria-pressed")).toBe("true"));

    const centre = () => document.querySelector<HTMLElement>('[data-item-details-panel="centre"]')!;
    const width = () => Math.round(centre().getBoundingClientRect().width);

    const resting = width();
    expect(centre().hasAttribute("data-item-details-magnified")).toBe(false);

    // The middle of the track, held: the gesture is the drag, so the monitor
    // has to be up for as long as the pointer is down and not a moment past.
    const surface = seamSurface().getBoundingClientRect();
    const middle = surface.left + surface.width * 0.5;
    scrubToClientX(middle, { hold: true });

    // Bigger, and marked as such.
    await waitFor(() => expect(centre().hasAttribute("data-item-details-magnified")).toBe(true));
    await waitFor(() => expect(width()).toBeGreaterThan(resting + 10));

    // And back down when the drag ends — this is the gesture, not a mode.
    releaseScrub(middle);
    await waitFor(() => expect(centre().hasAttribute("data-item-details-magnified")).toBe(false));
    await waitFor(() => expect(width()).toBe(resting));

    // The neighbours never grow: they are the context you are looking PAST.
    const neighbours = Array.from(
      document.querySelectorAll('[data-item-details-panel="neighbour"]'),
    );
    scrubToClientX(middle, { hold: true });
    await waitFor(() => expect(centre().hasAttribute("data-item-details-magnified")).toBe(true));
    expect(neighbours.some((n) => n.hasAttribute("data-item-details-magnified"))).toBe(false);
    releaseScrub(middle);
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
    const onScreenPanels = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-item-details-panel]")).filter(
        (panel) => {
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
      expect(panel.querySelector("[data-item-details-frame]")!.contains(play)).toBe(true);
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
    scrubIntoBox(centreBox(), 0.5);
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
 * HOLDING AT AN EDGE RUNS THE STRIP UNDER THE POINTER.
 *
 * The track spans what is ON SCREEN, not what exists: on a project longer than
 * the bar can draw at the current zoom, the end of the track was the end of
 * the timeline you could reach in one gesture, with the rest of the order
 * sitting an inch off the side. You could step to it with the arrows or pan
 * there with the wheel first, both of which mean abandoning the drag you are
 * in the middle of.
 *
 * So the two ends of the track are a throttle. Hold inside 40px of the right
 * edge and the strip travels forward underneath; hold at the left and it
 * reverses. THE HAND DOES NOT MOVE during any of that, which is why this is a
 * frame loop and not something hung off pointermove — an implementation
 * reading the moves travels only while the hand jitters.
 *
 * Five claims, and the last three are what make it a control rather than a
 * hazard: the middle of the track does nothing, letting go stops it, and a
 * gesture that travelled this far is not mistaken for a tap on whatever
 * arrived under the finger.
 */
export const HoldingAtAnEdgeRunsTheStrip: Story = {
  render: () => <SeamHarness scene={OVERFLOWING_SCENE} />,
  play: async () => {
    const at = () => Number(seamTrack().getAttribute("aria-valuenow"));
    const stripLeft = () =>
      document.querySelector<HTMLElement>("[data-seam-strip]")!.getBoundingClientRect().left;
    const subject = () => centreBox().getAttribute("data-seam-segment");

    // Held presses with NO travel at all, which is the gesture: everything
    // that moves is moved by the bar, not by the hand.
    const press = (clientX: number) => {
      const surface = seamSurface();
      const box = surface.getBoundingClientRect();
      fireEvent.pointerDown(surface, pointerAt(clientX, box.top + box.height / 2));
    };
    const release = (clientX: number) => {
      const surface = seamSurface();
      const box = surface.getBoundingClientRect();
      fireEvent.pointerUp(surface, pointerAt(clientX, box.top + box.height / 2));
    };
    const rest = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    await waitFor(() => expect(document.querySelector("[data-seam-strip]")).not.toBeNull());
    await settleStrip();
    const startedOn = subject();

    // THE PRECONDITION THIS STORY IS ABOUT. If the strip fitted in the track
    // there would be nothing off the side to reach, and every assertion below
    // would pass for the wrong reason.
    const trackWidth = seamSurface().getBoundingClientRect().width;
    const pps = Number(seamTrack().getAttribute("data-seam-pps"));
    const totalPx = Number(seamTrack().getAttribute("aria-valuemax")) * pps;
    expect(totalPx).toBeGreaterThan(trackWidth * 1.5);

    // ── THE MIDDLE OF THE TRACK IS AN ORDINARY SCRUBBER ───────────────────
    const box = seamSurface().getBoundingClientRect();
    press(box.left + box.width / 2);
    const middleT = at();
    const middleX = stripLeft();
    await rest(300);
    expect(at()).toBe(middleT);
    expect(stripLeft()).toBe(middleX);
    release(box.left + box.width / 2);

    // ── THE RIGHT EDGE RUNS FORWARD ───────────────────────────────────────
    press(box.right - 12);
    const pressedAt = at();
    await waitFor(() => expect(at()).toBeGreaterThan(pressedAt + 1), { timeout: 2000 });

    // THE CLOCK ADVANCES BECAUSE THE STRIP MOVES, not because the press landed
    // further along. Measured between two readings taken once the run is
    // already going, so the press's own snap-to-cut is not inside the window —
    // and stated as the two AGREEING rather than as a pixel count, so the
    // claim survives a change of zoom instead of being calibrated to one.
    const fromAt = at();
    const fromX = stripLeft();
    await waitFor(() => expect(at()).toBeGreaterThan(fromAt + 2), { timeout: 2000 });
    const ranPx = fromX - stripLeft();
    expect(ranPx).toBeGreaterThan(5);
    expect(Math.abs(ranPx - (at() - fromAt) * pps)).toBeLessThan(2);

    // ── LETTING GO STOPS IT, AND LANDS ON WHAT IT RAN TO ──────────────────
    release(box.right - 12);
    const stoppedAt = at();
    const stoppedX = stripLeft();
    await rest(300);
    expect(at()).toBe(stoppedAt);
    expect(stripLeft()).toBe(stoppedX);
    // WHERE THE PLAYHEAD FINISHED, NOT WHERE THE HAND IS. The hand never
    // moved, so this is the case that would go wrong if the release resolved
    // a clip from the pointer's x: the strip ran a long way underneath a
    // stationary finger, and what is under it now is not what was under it
    // when the press began. The view answers from its own clock instead.
    expect(subject()).not.toBe(startedOn);

    // ── AND THE LEFT EDGE REVERSES ────────────────────────────────────────
    // MEASURED AGAIN. The release above landed the row on a new clip, and the
    // bar re-pans around it — so the geometry read at the top of this story
    // describes a bar that no longer exists.
    await settleStrip();
    const after = seamSurface().getBoundingClientRect();
    press(after.left + 12);
    const pressedBackAt = at();
    await waitFor(() => expect(at()).toBeLessThan(pressedBackAt - 1), { timeout: 2000 });
    const backFrom = at();
    const backFromX = stripLeft();
    await waitFor(() => expect(at()).toBeLessThan(backFrom - 2), { timeout: 2000 });
    const backPx = stripLeft() - backFromX;
    expect(backPx).toBeGreaterThan(5);
    expect(Math.abs(backPx - (backFrom - at()) * pps)).toBeLessThan(2);
    release(after.left + 12);
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
 * A SCRUB LANDING NEAR A CUT MEANS THE CUT.
 *
 * The cut is the thing anyone is ever aiming at on this bar — it is what the
 * whole view is for — and it is one pixel wide. Without a snap, "put the
 * playhead on the start of that shot" is a test of the reader's mouse hand,
 * and the answer is almost always a frame or two out in a direction they
 * cannot see.
 *
 * PIXELS, NOT SECONDS, is what makes it survive the zoom above: seven pixels
 * is seven pixels at 5px a second and at 40, where a tolerance in seconds
 * would swallow whole clips at one end and be unreachable at the other.
 */
export const AScrubNearACutTakesTheCut: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-strip]")).not.toBeNull());
    await settleStrip();
    const at = () => Number(seamTrack().getAttribute("aria-valuenow"));
    const pps = Number(seamTrack().getAttribute("data-seam-pps"));

    // A box with room either side of it, so "just before" and "just after" are
    // both inside the same clip's neighbourhood and not off the end of the bar.
    const target = seamBoxes()[4]!.getBoundingClientRect();
    // The cut is the box's own leading edge, less the inset every box is
    // pulled in by — see BOX_INSET_PX in the lane.
    const cut = target.left - 2.5;

    // HELD THROUGHOUT. These are three readings of one scale, so the bar
    // underneath them has to be the same bar: a release would land the row on
    // the clip just scrubbed to, and the next measurement would be taken
    // against a strip that had moved. Nothing here is about committing.
    scrubToClientX(cut - 3, { hold: true });
    const fromBefore = at();
    scrubToClientX(cut + 3, { hold: true });
    const fromAfter = at();

    // BOTH SIDES LAND ON THE SAME INSTANT, which is the cut. Six pixels apart
    // on screen, zero seconds apart on the clock.
    expect(fromBefore).toBe(fromAfter);

    // A press with room around it is left exactly where it was put, so the
    // snap is a tolerance and not a quantiser: 40px further along is 40px
    // further along, to the second.
    scrubToClientX(cut + 40, { hold: true });
    expect(at()).toBeGreaterThan(fromAfter);
    expect(Math.abs(at() - fromAfter - 40 / pps)).toBeLessThan(0.05);
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

    const surface = seamSurface();
    const target = seamBoxes()[3]!.getBoundingClientRect();
    const before = at();
    fireEvent.pointerMove(
      surface,
      pointerAt(target.left + target.width / 2, target.top + target.height / 2),
    );

    await waitFor(() => expect(preview()).not.toBeNull());
    expect(preview()!.textContent).toContain("Kitchen 3");
    // Which collection, and how far into the clip — the two facts a box
    // cannot carry itself.
    expect(preview()!.textContent).toContain("Kitchen Interior");
    // A ghost line marks WHERE, so the words and the position are one object.
    expect(document.querySelector("[data-seam-ghost]")).not.toBeNull();
    // LOOKING IS FREE.
    expect(at()).toBe(before);

    // `pointerOut` with a relatedTarget, not `pointerLeave`: React synthesises
    // enter/leave from delegated over/out events, so a bare `pointerleave`
    // reaches no handler and the preview would look sticky in a way it is not.
    fireEvent.pointerOut(surface, {
      ...pointerAt(target.left, target.top),
      relatedTarget: document.body,
    });
    await waitFor(() => expect(preview()).toBeNull());
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
 * LETTING GO IS THE COMMIT — AND YOU KEEP THE FRAME YOU LET GO ON.
 *
 * A drag and a press that does not travel are still told apart (distance, not
 * timing: a slow deliberate scrub must not count as a tap on wherever it
 * started). But they now LAND the same way, because they are the same
 * sentence: you put the playhead somewhere and took your hand off it.
 *
 * Scrubbing used to choose nothing, on the reasoning that looking ahead must
 * not cost you your place. The place is what changed: the row follows the
 * playhead now, and the clock comes WITH it rather than snapping to the new
 * clip's head — so you arrive on the exact frame you were judging, which is
 * the frame you went there to see. Losing it was what made the old rule feel
 * like a look rather than a move.
 *
 * THE CLOCK NOT MOVING IS THE ASSERTION. Every panel derives its picture from
 * `position`, which is `seamAt(timeline, barSeconds)` — so a bar reading the
 * same second before and after the row advances IS the centre panel holding
 * the frame. A jump here would be the reset this change removes.
 */
export const LettingGoOfTheBarLandsTheStrip: Story = {
  render: () => <SeamHarness scene={TWO_ROOMS_SCENE} />,
  play: async () => {
    await waitFor(() => expect(document.querySelector("[data-seam-strip]")).not.toBeNull());
    await settleStrip();
    const subject = () => centreBox().getAttribute("data-seam-segment");
    const at = () => Number(seamTrack().getAttribute("aria-valuenow"));
    const strip = () => document.querySelector<HTMLElement>("[data-details-strip]")!;
    const stripX = () => strip().getBoundingClientRect().left;
    const panels = () => document.querySelectorAll("[data-item-details-panel]").length;
    const boxIndex = () => seamBoxes().indexOf(centreBox());
    const shownFrame = () =>
      Number(
        document
          .querySelector<HTMLElement>('[data-item-details-panel="centre"]')!
          .getAttribute("data-item-details-at"),
      );

    // Hold the scrub, read the clock at the moment before the release, let go.
    const dragToBox = async (box: HTMLElement) => {
      const rect = box.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      scrubToClientX(x, { hold: true });
      await waitFor(() => expect(at()).toBeGreaterThan(0));
      // The frame the MONITOR is on at the moment of release — the thing the
      // landing has to preserve, and the only reading that survives the bar
      // being rebuilt around a new subject.
      const heldFrame = Number(
        document
          .querySelector<HTMLElement>("[data-item-details-at]")!
          .getAttribute("data-item-details-at"),
      );
      const surface = seamSurface();
      const surfaceBox = surface.getBoundingClientRect();
      fireEvent.pointerUp(surface, pointerAt(x, surfaceBox.top + surfaceBox.height / 2));
      return heldFrame;
    };

    expect(subject()).toBe("subject");
    const restingPanels = panels();

    // ── A SHORT LANDING TRAVELS, AND NOTHING EMPTY GOES PAST ──────────────
    const from = boxIndex();
    const near = seamBoxes()[from + 3]!;
    const letGoNear = await dragToBox(near);
    await waitFor(() => expect(subject()).not.toBe("subject"));

    // Still moving a beat later: three panels is a step you can follow, so it
    // is shown as one.
    const travellingFrom = stripX();
    // MORE PANELS ARE REAL THAN USUALLY ARE. The resting mount window is two
    // either side; the cards being crossed live outside it, and without the
    // widening they would be the empty placeholders the row is made of —
    // including the one you just left, which would blink out and slide away.
    expect(panels()).toBeGreaterThan(restingPanels);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(stripX()).not.toBe(travellingFrom);

    await settleStrip();
    await settleRow();
    expect(subject()).toBe(near.getAttribute("data-seam-segment"));
    // THE FRAME CAME WITH IT. Read off the panel rather than off the bar:
    // the bar is a window with a reach either side of the subject, so it is
    // rebuilt around wherever you land and its own seconds are not comparable
    // across the journey. The panel reports the clip's OWN time, which is.
    expect(shownFrame()).toBeCloseTo(letGoNear, 2);
    // And the window let go again once it had arrived.
    await waitFor(() => expect(panels()).toBe(restingPanels));

    // ── A LONG ONE ARRIVES THE SAME WAY, FROM THE SIDE ────────────────────
    // THE SEAT IS READ HERE, not at the top of the story. The row is a
    // different shape on its first paint — panels are still arriving — so its
    // resting x then is not the resting x it keeps. Taken between the two
    // landings, both readings describe the same row.
    const seatX = () =>
      document
        .querySelector<HTMLElement>('[data-item-details-panel="centre"]')!
        .getBoundingClientRect().left;
    const restingCentreX = seatX();
    const landedOn = subject();
    const far = seamBoxes()[boxIndex() + 8]!;
    // THE PRECONDITION: far enough that sliding the whole way would be
    // obvious, and inside the default reach so there is a box there to aim at.
    expect(far).not.toBeUndefined();
    const letGoFar = await dragToBox(far);
    await waitFor(() => expect(subject()).not.toBe(landedOn));

    // IT COMES IN FROM THE SIDE, NOT FROM WHERE IT WAS. Eight clips along,
    // but the row is never displaced by more than the approach — so the
    // distance travelled says which side you came from and nothing else.
    // Sliding the whole way would start this eight panel-widths out and spend
    // half a second blurring six cards nobody can read.
    const step = document
      .querySelector<HTMLElement>('[data-item-details-panel="centre"]')!
      .getBoundingClientRect().width + 16;
    const displaced = Math.abs(seatX() - restingCentreX);
    expect(displaced).toBeGreaterThan(1);
    expect(displaced).toBeLessThan(step * 2 + 8);

    // And it is MOVING, not placed.
    const slidingFrom = seatX();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(seatX()).not.toBe(slidingFrom);

    await settleStrip();
    await settleRow();
    expect(seatX()).toBeCloseTo(restingCentreX, 0);
    expect(subject()).toBe(far.getAttribute("data-seam-segment"));
    expect(shownFrame()).toBeCloseTo(letGoFar, 2);

    // THE SCRIM NEVER SCROLLS. It crops a row thousands of pixels wide, so if
    // it were a scroll container there would be a great deal for the browser
    // to scroll it by — and it would, because landing moves focus to the new
    // panel's menu button and a hidden overflow is still scrolled to reveal
    // what is focused. That scroll would land on top of the transform the row
    // has already made and put the chosen card off the left edge. Zero here is
    // `overflow-clip` doing its job.
    expect(strip().parentElement!.scrollLeft).toBe(0);
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
    const miniColours = colours("[data-seam-mini-segment]");
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
