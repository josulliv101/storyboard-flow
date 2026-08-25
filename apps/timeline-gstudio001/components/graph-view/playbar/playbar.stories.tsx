import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ClipDeck } from "./clip-deck";
import { FilmStrip } from "./film-strip";

/**
 * THE REFERENCE DESIGN, PORTED TO REACT (PL15-030).
 *
 * Two components, both real: JSX markup, hooks for behaviour, and a fixture
 * that is deterministic and fetches nothing. The stylesheet is the reference's
 * own — extracted rather than retyped, because the look is gradients, masks and
 * custom properties tuned to each other and a hand translation would be a
 * second opinion about the design.
 *
 * These replace the earlier embed, which ran the reference's page script
 * through `new Function` inside a React shell. That was a target to look at;
 * this is code to build on.
 *
 * NO `play` FUNCTIONS. Both stories are interactive by hand — panning, flinging
 * and swiping are the point — and a story that runs a play function on load is
 * one the e2e suite cannot drive (see CLAUDE.md).
 */
const meta: Meta = {
  title: "graph-view/Playbar",
  parameters: { layout: "fullscreen" },
};

export default meta;

/**
 * THE FILM STRIP: the ruler and its section lanes, the strip of shots, the
 * playhead with its timecode chip, and the minimap.
 *
 * Live: drag the strip to pan and FLICK IT TO THROW — the fling coasts under
 * exponential friction and stops at either end. Drag or hover the ruler to
 * scrub, click a section label to jump to it, drag the minimap window or click
 * the track to move, wheel to pan, and press space to play.
 */
export const FilmStripStory: StoryObj = {
  name: "Film strip",
  render: () => <FilmStrip />,
};

/**
 * THE THREE-UP CLIP DISPLAY: the deck, centre card active, each clip with its
 * frame, cut and source readouts, trim strip, in/out fields and tags.
 *
 * Live: drag the deck to sweep through the clips and flick to throw, tap a side
 * card to bring it to the centre, and drag either trim handle to change the
 * window — the cut duration, the source time and the in/out fields all follow.
 *
 * The "Takes" chip and the "17 takes · 02:00" count are deliberately absent.
 */
export const ClipDisplay: StoryObj = {
  name: "Clip display",
  render: () => <ClipDeck />,
};
