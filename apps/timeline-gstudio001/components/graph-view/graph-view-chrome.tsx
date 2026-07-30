"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useContext, useSyncExternalStore } from "react";
import { useDroppable } from "@dnd-kit/core";

import {
  encodeDropTarget,
  parseNodeId,
  useCollectionsSelector,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/core/dropdown-menu";
import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { cn } from "@/lib/utils";
import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";
import { GraphViewNavContext } from "./graph-navigation";

/**
 * Navigate a crumb the way every OTHER focus change in this app already does.
 *
 * The trail was the last navigation still relying on a bare `next/link`, and a
 * Link cannot repaint the board until the App Router commits the new pathname
 * — which waits on an RSC request the board needs nothing from, since the
 * graph is already in memory. Measured in dev, where that round trip is local
 * and therefore as cheap as it will ever be: drilling INTO a collection
 * acknowledged the click in ~20ms, while a crumb sat silent for ~83ms and its
 * content change landed on the same millisecond as the URL, every time. In
 * production that round trip is a network hop, and a control that does
 * nothing at all for that long reads as broken rather than slow.
 *
 * `openTimeline` publishes the destination BEFORE it pushes, so the board
 * moves on the next frame and the URL catches up behind it.
 *
 * The `href` stays real, and this claims only the plain left click. Modified
 * and middle clicks still open a tab or a window — the reason these are
 * anchors and not buttons — and a false return (a crumb whose chain does not
 * reach this project) hands the click back to the browser rather than eating
 * it.
 */
function useCrumbNavigation(crumbId: string) {
  const nav = useContext(GraphViewNavContext);
  return (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (nav === null || event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (nav.openTimeline(parseNodeId(crumbId))) event.preventDefault();
  };
}

function useGraphPathTitles() {
  return useSyncExternalStore(
    graphDocumentsGateway.subscribe,
    graphDocumentsGateway.read,
    graphDocumentsGateway.read,
  );
}

function graphBase(projectId: string) {
  return `/timeline/${encodeURIComponent(projectId)}/graph`;
}

function focusedIdOf(projectId: string, timelinePath: readonly string[]) {
  return timelinePath[timelinePath.length - 1] ?? projectId;
}

type CrumbDropState = "idle" | "droppable" | "hovered";

function EditableCrumbName({
  crumbId,
  label,
}: Readonly<{
  crumbId: string;
  label: string;
}>) {
  const nodeName = useCollectionsSelector(
    (snapshot) => snapshot.graph.nodesById.get(crumbId as NodeId)?.name,
  );
  const displayName = nodeName ?? label;
  const rename = useInlineRename(crumbId as NodeId, displayName, "breadcrumb");

  if (rename.editing) {
    return (
      <InlineNameEditor
        initialValue={displayName}
        ariaLabel={`Rename ${displayName}`}
        onInput={rename.setDraft}
        onCommit={rename.commit}
        onCancel={rename.cancel}
        className="h-7 min-w-0 w-full max-w-[250px] truncate rounded-md bg-zinc-800 px-1.5 font-semibold text-zinc-100 outline-none ring-1 ring-sky-500/60"
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`Rename ${displayName}`}
      aria-current="page"
      title={`Rename ${displayName}`}
      onClick={rename.begin}
      className={cn(
        "min-w-0 max-w-[250px] shrink cursor-text truncate rounded-md px-1.5 py-1 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70",
        "font-semibold text-zinc-100 hover:bg-zinc-800/70",
      )}
    >
      {displayName}
    </button>
  );
}

/**
 * A breadcrumb crumb that DOUBLES AS a drop target while a card is dragged.
 * The trail already IS the ancestor chain (root … parent), so dropping a card
 * on any ancestor crumb moves it to THAT collection — up one level, or several,
 * all the way to the root, in a single motion. Idle it is a plain nav link;
 * during a drag every ancestor crumb reads as droppable (a dotted underline
 * over a faint fill), and the crumb under the pointer shows where the item will
 * land (a solid sky underline over a sky tint). The focused (current) crumb is
 * NOT one of these — the item already lives there.
 *
 * The fill was added in PL14-005's round (PL14-009): an underline alone is a
 * mark ON the text, and at a glance the trail still read as text rather than as
 * somewhere a card could go. A background says "region", which is what a drop
 * target is. Kept deliberately faint — it is a hint that something is possible
 * here, not a competitor to the hovered state or to the drop indicator.
 *
 * Still no geometry: decoration and background are both layout-neutral, so the
 * crumb's width never changes and nothing shifts as the states toggle. That
 * constraint is why this is a fill and not a border or a ring.
 */
function AncestorCrumb({
  crumbId,
  href,
  label,
}: Readonly<{ crumbId: string; href: string; label: string }>) {
  const { setNodeRef } = useDroppable({
    id: encodeDropTarget({ type: "panel", collectionId: parseNodeId(crumbId) }),
  });
  const navigate = useCrumbNavigation(crumbId);
  const state = useCollectionsSelector((snapshot): CrumbDropState => {
    if (!snapshot.interaction.isDragging) return "idle";
    const intent = snapshot.interaction.dropIntent;
    return intent?.type === "append-to-collection" && String(intent.collectionId) === crumbId
      ? "hovered"
      : "droppable";
  });
  return (
    <span
      ref={setNodeRef}
      data-graph-ancestor-drop={crumbId}
      className="flex min-w-0 shrink-[2]"
    >
      <Link
        href={href}
        onClick={navigate}
        className={cn(
          "block min-w-0 max-w-[180px] truncate rounded-md px-1.5 py-1 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70",
          state === "hovered"
            ? "bg-sky-500/15 text-sky-200 underline decoration-sky-400 decoration-2 underline-offset-4"
            : state === "droppable"
              ? "bg-zinc-800/50 text-zinc-300 underline decoration-dotted decoration-zinc-500 underline-offset-4"
              : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100",
        )}
      >
        {label}
      </Link>
    </span>
  );
}

/** How many ancestors the trail shows before it starts folding, and how many
 *  it keeps visible when it does. Counting rather than measuring: a
 *  width-driven collapse has to observe the header, re-measure on every rename
 *  and resize, and still picks a threshold — this picks one honestly, and the
 *  crumbs it does show already truncate at 180px each. */
const MAX_VISIBLE_ANCESTORS = 2;
const VISIBLE_TRAILING_ANCESTORS = 1;

type CrumbEntry = Readonly<{ id: string; href: string; label: string }>;

/**
 * The folded ancestors, behind one "…" control. A real menu, not an ellipsis
 * glyph: the whole point is that the hidden levels stay REACHABLE, so every
 * one of them is a link you can navigate to.
 *
 * These crumbs stop being drop targets while folded — a target you cannot see
 * is not one you can aim a card at. The visible crumbs keep theirs.
 */
/** One folded crumb. Its own component because the optimistic-navigation hook
 *  cannot be called from inside the map that renders these. */
function CollapsedCrumbLink({ crumb }: Readonly<{ crumb: CrumbEntry }>) {
  const navigate = useCrumbNavigation(crumb.id);
  return (
    <DropdownMenuItem asChild>
      <Link href={crumb.href} onClick={navigate}>
        {crumb.label}
      </Link>
    </DropdownMenuItem>
  );
}

function CollapsedCrumbs({ crumbs }: Readonly<{ crumbs: readonly CrumbEntry[] }>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-graph-crumb-overflow
          aria-label={`Show ${crumbs.length} hidden ${crumbs.length === 1 ? "timeline" : "timelines"}`}
          title="Hidden timelines"
          className="shrink-0 rounded-md px-1.5 py-1 text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70"
        >
          …
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {crumbs.map((crumb) => (
          <CollapsedCrumbLink key={crumb.id} crumb={crumb} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The up-one-level control. Inside the graph it is a crumb by another name and
 * navigates the same optimistic way; at the ROOT it leaves for the projects
 * page, which is a genuine document load with nothing to be optimistic about,
 * so it stays an ordinary link.
 */
function ParentLink({
  href,
  parentId,
  title,
}: Readonly<{ href: string; parentId: string | null; title: string }>) {
  // Called unconditionally, as a hook must be; the id it closes over is read
  // only when the handler runs, and the handler is only attached when there is
  // a parent timeline to go to.
  const navigate = useCrumbNavigation(parentId ?? "");
  return (
    <Link
      href={href}
      onClick={parentId === null ? undefined : navigate}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/50 text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
      title={title}
    >
      <ArrowLeft className="h-3.5 w-3.5" />
    </Link>
  );
}

/**
 * Where you ARE and how to go up — the navigation unit, rendered inside the
 * board's own header rather than as page chrome above it. It sits where a
 * paragraph of interaction hints used to: the trail is worth permanent space,
 * a list of things you can try is not. During a card drag the ancestor crumbs
 * become drop targets (see AncestorCrumb).
 */
export function GraphBreadcrumb({
  projectId,
  timelinePath,
}: Readonly<{
  projectId: string;
  timelinePath: readonly string[];
}>) {
  const documents = useGraphPathTitles();
  const base = graphBase(projectId);
  const focusedId = focusedIdOf(projectId, timelinePath);
  // The current crumb is renamable in place (R6 #10). Fall back to the graph
  // node name (not just the id) so the crumb reflects a rename immediately —
  // the store updates optimistically before the document write lands, exactly
  // as the collection card does.
  const focusedNodeName = useCollectionsSelector(
    (snapshot) => snapshot.graph.nodesById.get(focusedId as NodeId)?.name,
  );
  const focusedTitle = documents[focusedId]?.title ?? focusedNodeName ?? focusedId;
  // Every ancestor between the root crumb and the focused one, resolved once
  // so the overflow menu and the visible crumbs render the same thing.
  const ancestors = timelinePath.slice(0, -1).map((segment, index) => ({
    id: segment,
    href: `${base}/${timelinePath
      .slice(0, index + 1)
      .map(encodeURIComponent)
      .join("/")}`,
    label: documents[segment]?.title ?? segment,
  }));
  // Deep paths crowd the header out. Past the threshold the EARLIEST ancestors
  // fold into one "…" — the immediate parent stays put, because that is the
  // one the eye actually uses, and the root and focused crumbs are never
  // eligible (they are rendered outside this list).
  const collapse = ancestors.length > MAX_VISIBLE_ANCESTORS;
  const collapsedAncestors = collapse
    ? ancestors.slice(0, ancestors.length - VISIBLE_TRAILING_ANCESTORS)
    : [];
  const visibleAncestors = collapse
    ? ancestors.slice(ancestors.length - VISIBLE_TRAILING_ANCESTORS)
    : ancestors;
  const parentHref =
    timelinePath.length > 1
      ? `${base}/${timelinePath.slice(0, -1).map(encodeURIComponent).join("/")}`
      : timelinePath.length === 1
        ? base
        : "/";
  // The node the back arrow lands on, or null when it leaves the graph
  // entirely (at the root, "up" is the projects page). Mirrors parentHref
  // exactly — same three cases, so the two cannot point at different places.
  const parentCrumbId =
    timelinePath.length > 1
      ? timelinePath[timelinePath.length - 2]
      : timelinePath.length === 1
        ? projectId
        : null;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
      <ParentLink
        href={parentHref}
        parentId={parentCrumbId}
        title={focusedId === projectId ? "Go to Projects" : "Go to parent timeline"}
      />
      <nav
        aria-label="Timeline focus path"
        className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-xs text-zinc-400 select-none"
      >
        {/* The project is the ROOT crumb, not a child of a "Projects / Graph"
            chrome path: the trail reads as the timeline tree the user is
            standing in. At the root the project IS the focused crumb, so it
            renders once, as the current one. */}
        {focusedId !== projectId && (
          <>
            <AncestorCrumb
              crumbId={projectId}
              href={base}
              label={documents[projectId]?.title ?? projectId}
            />
            <span aria-hidden="true" className="shrink-0">/</span>
          </>
        )}
        {collapsedAncestors.length > 0 && (
          <span className="flex shrink-0 items-center gap-2">
            <CollapsedCrumbs crumbs={collapsedAncestors} />
            <span aria-hidden="true" className="shrink-0">/</span>
          </span>
        )}
        {visibleAncestors.map((ancestor) => (
          <span key={ancestor.id} className="flex min-w-0 shrink-[2] items-center gap-2">
            <AncestorCrumb crumbId={ancestor.id} href={ancestor.href} label={ancestor.label} />
            <span aria-hidden="true" className="shrink-0">/</span>
          </span>
        ))}
        <EditableCrumbName crumbId={focusedId} label={focusedTitle} />
      </nav>
    </div>
  );
}

// (The old GraphViewChrome row — a full-width strip holding only the
// "Storyboard view" link — is gone: the link lives in the board's overflow
// menu now, so the page starts at the preview itself.)
