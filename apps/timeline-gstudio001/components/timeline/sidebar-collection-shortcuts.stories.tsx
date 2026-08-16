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
    // word is only one pixel tall.
    expect(heading).toHaveTextContent("Collections");
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
        <span data-opened>{opened.join(",")}</span>
      </Rail>
    );
  },
  play: async ({ canvasElement }) => {
    // Real: this project has two root collections both called "Cold Open".
    const user = userEvent.setup();
    const buttons = within(canvasElement).getAllByRole("button");
    await user.click(buttons[1]!);
    await user.click(buttons[0]!);
    expect(canvasElement.querySelector("[data-opened]")).toHaveTextContent("second,first");
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
