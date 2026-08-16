import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";

import type { CollectionShortcut } from "@/lib/collection-shortcuts";

import { CollectionShortcutsGroup } from "./sidebar-collection-shortcuts";
import { RAIL_CLASS, RAIL_OPEN_WIDTH_PX, RAIL_WIDTH_PX } from "./sidebar-icon-styles";
import { SidebarLabelsInlineContext } from "./sidebar-tooltip-label";

// The rail's shortcuts into a project's top-level collections.
//
// Driven through the PRESENTATIONAL half: the connected wrapper reads the
// documents gateway, which is a module singleton a story could only exercise
// by seeding global state.
//
// A VISIBLE frame, inline — deterministic fake data only, and no network.
//
// It was a 1x1 transparent gif, which satisfied "an <img> is present" and
// showed nothing at all: the thumbnail case and the empty case looked
// identical on screen, which is exactly the distinction two of these stories
// exist to demonstrate. A story you cannot tell apart by looking is not
// covering the thing it claims to.
const FRAME =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="36">` +
      `<rect width="64" height="36" fill="#3f6212"/>` +
      `<circle cx="20" cy="14" r="9" fill="#a3e635"/>` +
      `<rect y="26" width="64" height="10" fill="#1a2e05"/>` +
      `</svg>`,
  );

const shortcut = (over: Partial<CollectionShortcut> = {}): CollectionShortcut => ({
  nodeId: "scenes",
  title: "Scenes",
  itemCount: 3,
  thumbnail: FRAME,
  thumbnailAlt: "first shot",
  ...over,
});

/** The rail's own frame: it carries `RAIL_CLASS`, which every tile style here
 *  selects on, so a story without it would render un-inset tiles that look
 *  nothing like the real thing. */
function Rail({
  open,
  children,
}: Readonly<{ open?: boolean; children: React.ReactNode }>) {
  return (
    <SidebarLabelsInlineContext.Provider value={open === true}>
      {/* On a DARK page, opaque. The rail's own fill is `bg-zinc-900/50`,
          which is correct in the app because it sits over a near-black
          document — and over Storybook's white default it resolved to a mid
          grey that made every label and glyph illegible. Matching the app's
          ground is what makes this story reviewable by looking at it, which is
          the only reason it exists. Same wrapper `RenderFormatMenu` uses. */}
      <div className="graph-view-theme flex min-h-[320px] items-start bg-zinc-950 p-4">
        <div
          className={`${RAIL_CLASS} flex flex-col items-stretch rounded-md bg-zinc-900 py-2`}
          style={{ width: open ? RAIL_OPEN_WIDTH_PX : RAIL_WIDTH_PX }}
        >
          {children}
        </div>
      </div>
    </SidebarLabelsInlineContext.Provider>
  );
}

const meta: Meta<typeof CollectionShortcutsGroup> = {
  title: "timeline/CollectionShortcutsGroup",
  component: CollectionShortcutsGroup,
};
export default meta;
type Story = StoryObj<typeof CollectionShortcutsGroup>;

/** The ordinary case: a thumbnail per collection, in board order. */
export const CollapsedShowsThumbnails: Story = {
  render: () => (
    <Rail>
      <CollectionShortcutsGroup
        shortcuts={[
          shortcut({ nodeId: "a", title: "Scenes" }),
          shortcut({ nodeId: "b", title: "Locations" }),
          shortcut({ nodeId: "c", title: "Characters" }),
        ]}
        onOpen={() => {}}
      />
    </Rail>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getAllByRole("button")).toHaveLength(3);
    // Order is the board's, not alphabetical.
    expect(canvas.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open Scenes",
      "Open Locations",
      "Open Characters",
    ]);
    // The heading belongs to the group, so it is here whenever the group is —
    // wearing its RULE shape, since there is no room for the word.
    const heading = canvasElement.querySelector('[data-sidebar-section="collections"]');
    expect(heading).not.toBeNull();
    expect(heading).toHaveAttribute("data-sidebar-section-state", "rule");
    // Still real text, so the group is named for a screen reader even when the
    // words are only one pixel tall.
    expect(heading).toHaveTextContent("Collection shortcuts");
  },
};

/** EXPANDED the same thumbnails gain their names — the rail's whole bargain. */
export const ExpandedShowsNames: Story = {
  render: () => (
    <Rail open>
      <CollectionShortcutsGroup
        shortcuts={[
          shortcut({ nodeId: "a", title: "Scenes" }),
          shortcut({ nodeId: "b", title: "Locations" }),
        ]}
        onOpen={() => {}}
      />
    </Rail>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvasElement.querySelector('[data-sidebar-section="collections"]')).toHaveAttribute(
      "data-sidebar-section-state",
      "heading",
    );
    expect(canvas.getByText("Scenes")).toBeVisible();
    expect(canvas.getByText("Locations")).toBeVisible();
    // Inline, so it is a label rather than a tooltip.
    expect(canvas.getByText("Scenes").getAttribute("role")).toBeNull();
  },
};

/**
 * THE HEADING IS AS WIDE AS ITS WORDS, and nothing wider.
 *
 * It collapses into the divider, and the divider is this same element with a
 * 1px height and a background — so its width IS the rule's length. Left to
 * stretch it filled the rail's gutter (207px measured, against 125px of
 * lettering), and the collapse drew a bar 82px longer than the label it was
 * replacing. Reported twice; the first fix made the morph one element, which
 * was right and did not touch the length.
 *
 * Asserted as a RELATIONSHIP — box against its own text — rather than against
 * a pixel count, which would only pin today's font and today's wording.
 *
 * Two rules make it hold and BOTH are load-bearing, which is why this checks
 * the outcome rather than the class list: `self-start` (the rail is a column
 * flex with `items-stretch`, so `w-fit` alone is inert) and a max-width (a
 * `truncate`d box cannot shrink below `min-content`, which `nowrap` makes
 * equal to `max-content`).
 */
export const TheHeadingIsAsWideAsItsWords: Story = {
  render: () => (
    <Rail open>
      <CollectionShortcutsGroup
        shortcuts={[shortcut({ nodeId: "a", title: "Scenes" })]}
        onOpen={() => {}}
      />
    </Rail>
  ),
  play: async ({ canvasElement }) => {
    const heading = canvasElement.querySelector<HTMLElement>(
      '[data-sidebar-section="collections"]',
    )!;
    const rail = heading.parentElement!;
    const headingWidth = heading.getBoundingClientRect().width;
    const gutter = rail.getBoundingClientRect().width;

    // It fits its own lettering: no leftover box either side of the words.
    expect(headingWidth).toBeCloseTo(heading.scrollWidth, 0);
    // And it is meaningfully NARROWER than the space it is allowed, which is
    // the part stretching broke — the numbers were identical before.
    expect(headingWidth).toBeLessThan(gutter - 32);
  },
};

/** A collection with nothing in it yet keeps a target the same size as its
 *  neighbours — a gap in the column reads as a MISSING item, not an empty one. */
export const EmptyCollectionGetsAStandIn: Story = {
  render: () => (
    <Rail>
      <CollectionShortcutsGroup
        shortcuts={[
          shortcut({ nodeId: "a", title: "Scenes" }),
          shortcut({ nodeId: "b", title: "New Timeline", itemCount: 0, thumbnail: undefined }),
        ]}
        onOpen={() => {}}
      />
    </Rail>
  ),
  play: async ({ canvasElement }) => {
    const buttons = within(canvasElement).getAllByRole("button");
    expect(buttons[0]!.querySelector("img")).not.toBeNull();
    expect(buttons[1]!.querySelector("img")).toBeNull();
    // Same box either way.
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)}`;
    };
    expect(box(buttons[0]!)).toBe(box(buttons[1]!));
  },
};

/** Two collections may share a NAME. They must not share a target. */
export const SameNameStaysTwoTargets: Story = {
  render: function Render() {
    const [opened, setOpened] = useState<string[]>([]);
    return (
      <Rail>
        <CollectionShortcutsGroup
          shortcuts={[
            shortcut({ nodeId: "first", title: "Cold Open" }),
            shortcut({ nodeId: "second", title: "Cold Open" }),
          ]}
          onOpen={(nodeId) => setOpened((current) => [...current, nodeId])}
        />
        {/* The story's own readout. Styled, because an unstyled span inherits
            near-black on this dark ground and is invisible — the play function
            could still read it, but a person opening the story to see WHICH
            card they just clicked could not. A contrast sweep across these
            stories flagged it at 1.1:1. */}
        <span data-opened className="mt-3 block font-mono text-xs text-zinc-300">
          opened: {opened.join(", ") || "nothing yet"}
        </span>
      </Rail>
    );
  },
  play: async ({ canvasElement }) => {
    // Real: this project has two top-level collections both called "Cold Open".
    const user = userEvent.setup();
    const buttons = within(canvasElement).getAllByRole("button");
    await user.click(buttons[1]!);
    await user.click(buttons[0]!);
    // Order matters: the SECOND card was clicked first. Two collections may
    // share a name, so this is what proves they do not share a target.
    expect(canvasElement.querySelector("[data-opened]")).toHaveTextContent(
      "opened: second, first",
    );
  },
};

/** A NEW PROJECT has no top-level collections — so no group, and no rule
 *  above one. A separator with nothing under it reads as a failed load. */
export const NoCollectionsDrawsNothing: Story = {
  render: () => (
    <Rail>
      <CollectionShortcutsGroup shortcuts={[]} onOpen={() => {}} />
    </Rail>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryAllByRole("button")).toHaveLength(0);
    // The heading goes with the group it names — a divider (or a word) with
    // nothing under it reads as something that failed to load.
    expect(canvasElement.querySelector("[data-sidebar-section]")).toBeNull();
    expect(canvasElement.querySelector("[data-sidebar-collection-shortcuts]")).toBeNull();
  },
};
