import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { ClipDeck } from "./clip-deck";

/**
 * THE DECK BECOMES THE PREVIEW WHILE SOMEONE SCRUBS (PL16-001).
 *
 * ITS OWN FILE, and not added to `playbar.stories.tsx`, which states as a rule
 * that it carries NO play functions: its two stories are driven by hand, and
 * the e2e suite needs stories that do not run a `play` on load — Storybook's
 * synthetic pointerup kills a concurrently running real-mouse drag. Putting an
 * asserted story in there would either break that rule or quietly weaken it.
 *
 * DRIVEN BY A BUTTON RATHER THAN BY THE FILM STRIP. What is under test is the
 * deck's response to `previewing`, and the strip's playhead already has its own
 * coverage for producing the signal. Wiring the real strip in would test the
 * two together and tell us less about either when it broke.
 */
const PREVIEW_POSTER = "https://example.invalid/frame-at-4.25s.png";

function PreviewHarness() {
  const [previewing, setPreviewing] = useState(false);
  return (
    <div>
      <button type="button" data-testid="toggle" onClick={() => setPreviewing((on) => !on)}>
        {previewing ? "release" : "scrub"}
      </button>
      <ClipDeck previewing={previewing} previewPoster={PREVIEW_POSTER} />
    </div>
  );
}

const meta: Meta = {
  title: "graph-view/Playbar/Deck preview",
  parameters: { layout: "fullscreen" },
};

export default meta;

/**
 * Grabbing the playhead collapses the deck into a preview screen, and releasing
 * it puts the three cards back.
 *
 * Asserted on the three things the feature actually promises, because each can
 * break without the others: the neighbours ARRIVE at the subject (they slide in
 * and go under it), the subject GROWS and drops its chrome, and the picture is
 * the frame the playhead is on rather than the card's own.
 */
export const CollapsesWhileScrubbing: StoryObj = {
  name: "Collapses while scrubbing",
  render: () => <PreviewHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const deck = canvasElement.querySelector<HTMLElement>(".deck")!;
    const subject = () => canvasElement.querySelector<HTMLElement>(".deck .clip.active")!;
    const neighbours = () =>
      [...canvasElement.querySelectorAll<HTMLElement>(".deck .clip")].filter(
        (card) => !card.classList.contains("active"),
      );
    const centreOf = (card: HTMLElement) => {
      const rect = card.getBoundingClientRect();
      return Math.round(rect.x + rect.width / 2);
    };
    const chrome = () => subject().querySelector<HTMLElement>(".c-head")!;

    // The deck lays out on a rAF, so nothing is measurable until it has.
    await waitFor(() => expect(subject().getBoundingClientRect().width).toBeGreaterThan(0));

    const restWidth = Math.round(subject().getBoundingClientRect().width);
    const restCentre = centreOf(subject());
    // APART TO BEGIN WITH. A deck whose neighbours already sat on the subject
    // would pass the collapse assertion without collapsing.
    const spreadAtRest = neighbours()
      .map((card) => Math.abs(centreOf(card) - restCentre))
      .filter((distance) => distance > 0);
    expect(Math.max(...spreadAtRest)).toBeGreaterThan(40);

    await userEvent.click(canvas.getByTestId("toggle"));

    await waitFor(() => expect(deck.className).toContain("previewing"));
    await waitFor(
      () => {
        // EVERY neighbour has arrived at the subject — under it, which the
        // subject's raised z-index is what makes true, and invisible.
        for (const card of neighbours()) {
          expect(Math.abs(centreOf(card) - centreOf(subject()))).toBeLessThan(4);
        }
        // The subject is a screen now: wider than it was, and its chrome gone.
        expect(Math.round(subject().getBoundingClientRect().width)).toBeGreaterThan(restWidth);
        expect(Number(getComputedStyle(chrome()).opacity)).toBe(0);
      },
      { timeout: 3000 },
    );

    // And it is showing the PLAYHEAD's frame, not the card's own.
    expect(subject().querySelector<HTMLElement>(".c-frame")!.style.background).toContain(
      PREVIEW_POSTER,
    );

    await userEvent.click(canvas.getByTestId("toggle"));

    await waitFor(() => expect(deck.className).not.toContain("previewing"));
    await waitFor(
      () => {
        // Back out from behind the subject, to where they started.
        const spread = neighbours()
          .map((card) => Math.abs(centreOf(card) - centreOf(subject())))
          .filter((distance) => distance > 0);
        expect(Math.max(...spread)).toBeGreaterThan(40);
        expect(Math.round(subject().getBoundingClientRect().width)).toBe(restWidth);
        expect(Number(getComputedStyle(chrome()).opacity)).toBe(1);
      },
      { timeout: 3000 },
    );
  },
};
