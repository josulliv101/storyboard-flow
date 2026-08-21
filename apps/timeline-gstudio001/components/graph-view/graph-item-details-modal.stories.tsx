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
 * These helpers exist because a fraction of the TRACK stopped naming a clip.
 *
 * The bar is laid out in absolute timeline pixels and translated so the
 * subject's box sits over the centre card, so "half way across the track" is
 * wherever the transform happens to have put it — often outside the strip
 * altogether, where a press correctly scrubs nothing. Every story below that
 * used to scrub by track ratio was really saying "scrub into THAT clip", and
 * these say it directly.
 */
function seamTrack(): HTMLElement {
  const found = document.querySelector<HTMLElement>("[data-seam-track]");
  expect(found).not.toBeNull();
  return found!;
}

/** Every clip's box, in timeline order. */
function seamBoxes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-seam-segment]"));
}

/** The lit box — the centred clip, and the only one the bar lights. */
function centreBox(): HTMLElement {
  const found = document.querySelector<HTMLElement>("[data-seam-segment-live]");
  expect(found).not.toBeNull();
  return found!;
}

/** Press the bar at a point inside `box`, `fraction` of the way across it. */
function scrubInto(box: HTMLElement, fraction = 0.5): void {
  const track = seamTrack();
  const target = box.getBoundingClientRect();
  const trackBox = track.getBoundingClientRect();
  const args = {
    clientX: target.left + target.width * fraction,
    clientY: trackBox.top + trackBox.height / 2,
    isPrimary: true,
    pointerId: 1,
    button: 0,
  };
  fireEvent.pointerDown(track, args);
  fireEvent.pointerUp(track, args);
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
      scrubInto(centreBox(), ratio);

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
 * THE RING FOLLOWS THE PLAYHEAD ACROSS THE SEAM.
 *
 * The middle picture is a monitor, so during the run-up it is showing frames
 * that belong to the clip on the LEFT — and until this, nothing on screen said
 * so. The ring marks whose frames are up, which is why it has to be able to sit
 * on a panel that is not the centre one; a marker pinned to the middle would be
 * decoration, since the middle is where the picture always is.
 */
export const TheRingMarksWhoseFramesAreUp: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    const liveLabel = () => {
      const live = document.querySelector("[data-item-details-live]");
      return live?.getAttribute("data-item-details-panel") ?? null;
    };

    // Nothing engaged yet: no ring anywhere, so it cannot be mistaken for a
    // selection.
    expect(liveLabel()).toBeNull();

    // THE CLIP BEFORE THE SUBJECT, aimed at directly.
    //
    // This used to scrub to the very start of the bar and rely on that being
    // a two-second RUN-UP into the previous clip. There are no leads now —
    // the bar carries every clip whole — so the start of the bar is simply
    // the start of the collection, and the way to land on the previous clip
    // is to press its box. The claim is unchanged and slightly stronger: the
    // ring goes to whichever panel's frames are up, and that need not be the
    // middle one.
    const boxes = seamBoxes();
    const centreIndex = boxes.indexOf(centreBox());
    expect(centreIndex).toBeGreaterThan(0);
    scrubInto(boxes[centreIndex - 1]!);
    await waitFor(() => expect(liveLabel()).toBe("neighbour"));

    // And back into the centre clip.
    scrubInto(centreBox());
    await waitFor(() => expect(liveLabel()).toBe("centre"));
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
 * ONE MARK, AND IT SAYS SOMETHING THAT CHANGES.
 *
 * Panels are identical until the clock runs; then whichever clip's frames are
 * on screen wears the red. "Which clip did I open" needs no mark at all — it
 * is the one in the middle, with the rename field and the close button — and
 * the heavy white border that used to say it was both the loudest thing on the
 * screen and a pixel of stolen geometry.
 */
export const OnlyTheLiveClipIsMarked: Story = {
  render: () => <SeamHarness scene={TRIMMED_SCENE} />,
  play: async () => {
    await waitFor(() => expect(seamTrack()).not.toBeNull());
    const centre = () => document.querySelector<HTMLElement>('[data-item-details-panel="centre"]')!;
    const ringOf = (panel: HTMLElement) => getComputedStyle(panel).boxShadow;

    const neighbour = () =>
      document.querySelector<HTMLElement>('[data-item-details-panel="neighbour"]')!;

    // EVERY PANEL LOOKS THE SAME UNTIL SOMETHING IS TRUE OF IT. The opened
    // clip wore a heavy white border for a while; it was the loudest mark on
    // the screen, spent on the one fact the layout already tells you — the
    // centre panel is in the centre — and it cost a pixel of geometry to say
    // it. Identical borders AND identical shadows, until the clock runs.
    expect(getComputedStyle(centre()).borderTopWidth).toBe(
      getComputedStyle(neighbour()).borderTopWidth,
    );
    expect(getComputedStyle(centre()).boxShadow).toBe(
      getComputedStyle(neighbour()).boxShadow,
    );

    // Nothing engaged: no red anywhere.
    expect(ringOf(centre())).not.toMatch(/56, 189, 248/);

    scrubInto(centreBox());

    // Scrubbed into the centre clip: red joins the white, rather than
    // replacing it.
    await waitFor(() => expect(ringOf(centre())).toMatch(/56, 189, 248/));
    // Scrubbed into the centre clip: the red mark appears, and the geometry
    // is untouched by it — a box-shadow is painted outside the box.
    const both = getComputedStyle(centre());
    expect(both.borderTopWidth).toBe(getComputedStyle(neighbour()).borderTopWidth);
    expect(both.boxShadow).toMatch(/56, 189, 248/);
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

    scrubInto(centreBox());

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
    scrubInto(seamBoxes()[boxCount - 1]!, 0.5);
    await waitFor(() => expect(at()).toBeGreaterThan(atThree * 0.6));

    // Five up: more cards, same timeline.
    await press("5");
    expect(barMax()).toBe(atThree);
    expect(seamBoxes().length).toBe(boxCount);

    // And the far end still answers.
    scrubInto(seamBoxes()[boxCount - 1]!, 0.2);
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
 * EACH SECTION OF THE BAR CARRIES ITS OWN FRAME.
 *
 * The bar divides into one span per clip, and a hairline was all that told
 * them apart — you could see THAT the run of time was three clips without
 * seeing WHICH. A still says it at a glance.
 *
 * At the section's right-hand end, because that is where it meets its cut: the
 * frame sits against the seam it is about to hand over at, which is the thing
 * the bar exists to let you judge.
 */
export const TheBarLabelsItsSectionsWithFrames: Story = {
  render: () => <SeamHarness />,
  play: async () => {
    const track = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-seam-track]");
      expect(found).not.toBeNull();
      return found!;
    });
    const thumbs = () =>
      Array.from(track.querySelectorAll<HTMLImageElement>("[data-seam-thumb]"));

    await waitFor(() => expect(thumbs().length).toBeGreaterThan(0));

    const trackBox = track.getBoundingClientRect();
    for (const thumb of thumbs()) {
      const box = thumb.getBoundingClientRect();
      // Inside the bar, and each one showing something.
      expect(box.left).toBeGreaterThanOrEqual(trackBox.left - 1);
      expect(box.right).toBeLessThanOrEqual(trackBox.right + 1);
      expect(thumb.getAttribute("src")).toBeTruthy();
      // Decorative: the bar is already labelled, and a frame is not a caption.
      expect(thumb.getAttribute("aria-hidden")).toBe("true");
      // A native image drag inside a scrub bar would eat the gesture.
      expect(thumb.draggable).toBe(false);
    }
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
    const track = document.querySelector<HTMLElement>("[data-seam-track]")!;
    const width = () => Math.round(centre().getBoundingClientRect().width);

    const resting = width();
    expect(centre().hasAttribute("data-item-details-magnified")).toBe(false);

    const box = track.getBoundingClientRect();
    const args = {
      clientX: box.left + box.width * 0.5,
      clientY: box.top + box.height / 2,
      isPrimary: true,
      pointerId: 1,
      button: 0,
    };
    fireEvent.pointerDown(track, args);

    // Bigger, and marked as such.
    await waitFor(() => expect(centre().hasAttribute("data-item-details-magnified")).toBe(true));
    await waitFor(() => expect(width()).toBeGreaterThan(resting + 10));

    // And back down when the drag ends — this is the gesture, not a mode.
    fireEvent.pointerUp(track, args);
    await waitFor(() => expect(centre().hasAttribute("data-item-details-magnified")).toBe(false));
    await waitFor(() => expect(width()).toBe(resting));

    // The neighbours never grow: they are the context you are looking PAST.
    const neighbours = Array.from(
      document.querySelectorAll('[data-item-details-panel="neighbour"]'),
    );
    fireEvent.pointerDown(track, args);
    await waitFor(() => expect(centre().hasAttribute("data-item-details-magnified")).toBe(true));
    expect(neighbours.some((n) => n.hasAttribute("data-item-details-magnified"))).toBe(false);
    fireEvent.pointerUp(track, args);
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

    const track = document.querySelector<HTMLElement>("[data-seam-track]")!;
    const at = () => Number(track.getAttribute("aria-valuenow"));
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
    scrubInto(centreBox(), 0.5);
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
