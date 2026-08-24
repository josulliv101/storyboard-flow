import { StrictMode } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "storybook/test";

import { MediaDropTarget } from "./graph-tool-buttons";

// The drag path's second half: a drop parked a position, and now it needs
// files.
//
// STRICTMODE IS HERE BUT DOES NOT DO WHAT THIS FILE WAS WRITTEN TO ASSUME.
//
// The app runs with `reactStrictMode: true`, and `MediaDropTarget` opens the OS
// file picker from a mount effect — so the theory for PL15-019 (one drop, two
// pickers) was StrictMode's deliberate double-invoke of mount effects running
// that unguarded side effect twice.
//
// THIS STORY DOES NOT PROVE THAT, and the check that says so is worth keeping:
// with the `autoOpenedRef` guard REMOVED, it still counts exactly one click.
// React only double-invokes effects in a development build of React, and the
// build behind these stories does not, so wrapping the tree in `StrictMode`
// changes nothing here. A story cannot reproduce the reported bug.
//
// What it does assert is narrower and still worth having: one mount asks for
// the picker exactly ONCE, and the no-activation branch focuses the prompt
// instead. Read it as a guard against this effect gaining a second trigger —
// not as evidence that what the owner saw is fixed. That needs watching the
// real dev app, or a production build to see whether it doubles there too.
//
// NO REAL PICKER OPENS HERE. Headless Chromium does not surface a file dialog,
// so `input.click()` dispatches the click and nothing else happens — which is
// exactly what needs counting.

const meta = {
  title: "Graph view/Media drop target",
  component: MediaDropTarget,
  parameters: { layout: "centered" },
} satisfies Meta<typeof MediaDropTarget>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Clicks on the hidden file input, counted from BEFORE the component mounts.
 *
 * ARMED IN `render`, NOT IN `play`, and that is the whole reason this file
 * catches anything. `play` runs after the tree has mounted and its effects have
 * fired — so a listener attached there has already missed the clicks it exists
 * to count, and the story reads 0 whether the bug is present or not. It would
 * pass against the broken code, which is worse than not testing it.
 *
 * One module-level counter, reset each time a story renders: the listener is
 * attached once for the page's lifetime, so a per-render closure would leak one
 * listener per story and count clicks from stories that had already finished.
 */
let inputClicks = 0;
let listening = false;

function armInputClickCounter(): void {
  inputClicks = 0;
  if (listening) return;
  listening = true;
  document.addEventListener(
    "click",
    (event) => {
      if ((event.target as HTMLElement | null)?.hasAttribute?.("data-media-drop-input")) {
        inputClicks += 1;
      }
    },
    true,
  );
}

/**
 * ONE MOUNT ASKS FOR THE PICKER ONCE.
 *
 * NOT a regression test for PL15-019 — see the note at the top of this file.
 * Removing the `autoOpenedRef` guard leaves this passing, because the React
 * build here does not double-invoke the effect the guard exists for.
 */
export const OpensThePickerExactlyOnce: Story = {
  render: () => {
    armInputClickCounter();
    return (
      <StrictMode>
        <MediaDropTarget
          hadUserActivation
          clientX={40}
          clientY={40}
          onFiles={() => {}}
          onDismiss={() => {}}
        />
      </StrictMode>
    );
  },
  play: async () => {
    await waitFor(() =>
      expect(document.querySelector("[data-media-drop-input]")).not.toBeNull(),
    );
    // Wait for the picker to have been asked for at all before asserting how
    // MANY times — otherwise a count of 1 could be an early read of a sequence
    // that reaches 2 a frame later, which is exactly the bug.
    await waitFor(() => expect(inputClicks).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(inputClicks).toBe(1);
  },
};

/**
 * WITHOUT ACTIVATION THE PROMPT IS FOCUSED INSTEAD, and no picker is opened.
 *
 * This is the branch that makes the drop reachable without a mouse at all: a
 * browser refuses a programmatic picker without user activation, so the drop
 * offers a button to ask again rather than failing silently.
 */
export const WithoutActivationItFocusesThePrompt: Story = {
  render: () => (
    <StrictMode>
      <MediaDropTarget
        hadUserActivation={false}
        clientX={40}
        clientY={40}
        onFiles={() => {}}
        onDismiss={() => {}}
      />
    </StrictMode>
  ),
  play: async () => {
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-media-drop-prompt")).not.toBeNull(),
    );
  },
};
