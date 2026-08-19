"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
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
    graphDocumentsGateway.readServerSnapshot,
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
        // h-8 to match the crumb's new line height, and the width ceilings
        // below go up with the type: 14px text in a 250px box truncates a name
        // that fitted at 12px, so holding the old ceiling would have traded
        // legibility for ellipses on exactly the crumb you are reading.
        className="h-8 min-w-0 w-full max-w-[280px] truncate rounded-md bg-zinc-800 px-1.5 font-semibold text-zinc-100 outline-none ring-1 ring-sky-500/60"
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
        "min-w-0 max-w-[280px] shrink cursor-text truncate rounded-md px-1.5 py-1 text-left transition-colors",
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
          "block min-w-0 max-w-[200px] truncate rounded-md px-1.5 py-1 transition-colors",
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

/**
 * The trail folds on MEASURED WIDTH, not on a fixed count.
 *
 * It used to fold past two ancestors whatever the window was doing, on the
 * reasoning that measuring costs a ResizeObserver and a re-measure per rename.
 * That reasoning traded the wrong thing away: on a wide screen the row had
 * hundreds of empty pixels beside a trail that had hidden levels behind a "…"
 * for no reason. Space that exists should be used.
 *
 * Same shape as `useFittedVerbCount` in graph-board — hidden ruler, two passes,
 * one ResizeObserver — so there is one way this is done in the app, not two.
 *
 * Only ANCESTORS fold. The root and the focused crumb render outside the list
 * and are never eligible; the immediate parent is kept longest, because it is
 * the one the eye actually uses.
 */
const MIN_VISIBLE_ANCESTORS = 1;
/** `gap-2` between a crumb and its separator, as a number. */
const CRUMB_GAP_PX = 8;

function useFittedAncestorCount(
  ancestors: readonly CrumbEntry[],
): Readonly<{
  navRef: RefObject<HTMLElement | null>;
  rulerRef: RefObject<HTMLDivElement | null>;
  visibleCount: number;
}> {
  const navRef = useRef<HTMLElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(ancestors.length);

  // The labels, as ONE string: the effect must re-measure when a rename changes
  // a crumb's width, and the array identity changes on every render.
  const signature = ancestors.map((ancestor) => ancestor.label).join(" ");

  useEffect(() => {
    const nav = navRef.current;
    const ruler = rulerRef.current;
    if (!nav || !ruler) return;

    const measure = () => {
      // The budget is the WING's width, not the nav's.
      //
      // The trail is deliberately content-width so the save status sits beside
      // the last crumb rather than an inch away (see the note on the root
      // below), which means the nav reports the width of its own contents and
      // can never tell you there is room to grow. So: take the wing, subtract
      // everything in it that is not the trail, and what is left is what the
      // trail may use. Falls back to the nav's own width if the wing marker is
      // missing, which folds exactly as it did before rather than crashing.
      const wing = nav.closest("[data-crumb-wing]");
      let budget = nav.clientWidth;
      if (wing instanceof HTMLElement) {
        let taken = 0;
        for (const child of Array.from(wing.children)) {
          if (!(child instanceof HTMLElement)) continue;
          // The trail's own root counts only for the parts that are NOT the
          // nav — the back arrow and the gap beside it.
          taken += child.contains(nav)
            ? child.offsetWidth - nav.offsetWidth
            : child.offsetWidth;
        }
        budget = wing.clientWidth - taken;
      }
      // 0 while the row is not laid out (the other header face is showing) —
      // keep the last answer rather than folding everything for one frame.
      if (budget <= 0) return;
      const children = Array.from(ruler.children).map((child) =>
        Math.ceil((child as HTMLElement).getBoundingClientRect().width),
      );
      // Ruler order: [...ancestors+separators, "…"]. It holds ONLY the crumbs
      // that can be hidden.
      //
      // The root and focused crumbs are measured from the REAL elements
      // instead, because they are always on screen — and because duplicating
      // their text into a hidden box makes `getByText(...).first()` resolve to
      // the invisible copy, which is exactly how this broke an unrelated
      // drill-in test. Never put text in the ruler that something else queries.
      const overflowWidth = children[children.length - 1] ?? 0;
      const ancestorWidths = children.slice(0, ancestors.length);
      const fixed = Array.from(nav.querySelectorAll("[data-crumb-fixed]")).reduce(
        (total, element) => total + Math.ceil(element.getBoundingClientRect().width),
        0,
      );

      // PASS 1 — everything, with no "…" drawn at all. Asked first and against
      // the FULL budget: when the trail fits there is no overflow control to
      // reserve room for, and reserving it anyway is what folds a crumb purely
      // to make space for the menu holding the crumb it just folded.
      const whole = ancestorWidths.reduce((total, width) => total + width + CRUMB_GAP_PX, fixed);
      if (whole <= budget) {
        setVisibleCount(ancestors.length);
        return;
      }

      // PASS 2 — it does not fit, so the "…" is going to be drawn and costs
      // width like anything else. Keep the LAST ancestors (nearest the focused
      // crumb) and fold the earliest, which is the direction the eye reads.
      const reduced = budget - overflowWidth - CRUMB_GAP_PX - fixed;
      let used = 0;
      let fitted = 0;
      for (let index = ancestorWidths.length - 1; index >= 0; index -= 1) {
        const next = used + (ancestorWidths[index] ?? 0) + CRUMB_GAP_PX;
        if (next > reduced) break;
        used = next;
        fitted += 1;
      }
      setVisibleCount(Math.max(MIN_VISIBLE_ANCESTORS, fitted));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [signature, ancestors.length]);

  return { navRef, rulerRef, visibleCount };
}

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
      // h-8/w-8 with a 16px glyph, up from 28px/14px — the same square as
      // every other control in this row (HeaderToggle, HEADER_SELECTION_SIZE).
      // It was the one 28px control among 32px ones, which is why it read as
      // slightly sunk; matching them also means the enlarged trail does NOT
      // make the row taller, since h-8 was already setting the height.
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/50 text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
      title={title}
    >
      <ArrowLeft className="h-4 w-4" />
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
  // Deep paths crowd the header out — but only when they actually run out of
  // room. What does not fit folds into one "…", earliest first, and everything
  // that does fit is drawn.
  const { navRef, rulerRef, visibleCount } = useFittedAncestorCount(ancestors);
  const shown = Math.min(visibleCount, ancestors.length);
  const collapsedAncestors = ancestors.slice(0, ancestors.length - shown);
  const visibleAncestors = ancestors.slice(ancestors.length - shown);
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

  // CONTENT-WIDTH, not stretched.
  //
  // This and the nav below used to carry `flex-1`, which made the trail claim
  // its whole wing however short the path was — so the save status that trails
  // it (see GraphSaveStatus) rendered hundreds of pixels away from the last
  // crumb, hard against the centre readout, instead of beside the crumb. The
  // WING still has `flex-1` in the board's header, which is what keeps the
  // centre readout centred; the trail itself only needs to be as wide as it is.
  //
  // `min-w-0` and `overflow-hidden` stay: they are what let a long path shrink
  // and truncate inside the wing rather than pushing it open.
  return (
    <div className="flex min-w-0 items-center gap-3 overflow-hidden">
      <ParentLink
        href={parentHref}
        parentId={parentCrumbId ?? null}
        title={focusedId === projectId ? "Go to Projects" : "Go to parent timeline"}
      />
      <nav
        ref={navRef}
        aria-label="Timeline focus path"
        // Still CONTENT-WIDTH, deliberately — see the root's note. `relative`
        // is new, so the measuring ruler below positions against this box
        // instead of some ancestor.
        // `text-sm` (14px), up from `text-xs`. This is the trail you read to
        // know where you are, and at 12px in a row full of 32px icons it was
        // the smallest thing on screen carrying the most important sentence.
        //
        // Set HERE, on the nav, which is what keeps the fit honest: the
        // measuring ruler below is a child of this element, so it inherits the
        // same size and `useFittedAncestorCount` still measures the crumbs at
        // the width they actually render. Sizing the visible crumbs instead
        // would have left the ruler measuring 12px text and folding a crumb
        // too late.
        className="relative flex min-w-0 items-center gap-2 overflow-hidden text-sm text-zinc-400 select-none"
      >
        {/* THE RULER — every crumb at its natural width, laid out but not
            painted, in the order the measure reads them:
            [root+separator, ...ancestors+separators, focused, "…"].
            `visibility: hidden` rather than `display: none`, because a
            display-none box measures as zero; `absolute` so it cannot widen the
            box being measured; `inert` so a duplicate trail is not a second set
            of tab stops for a keyboard or a screen reader. */}
        <div
          ref={rulerRef}
          aria-hidden="true"
          inert
          data-crumb-ruler=""
          className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-2"
        >
          {ancestors.map((ancestor) => (
            <span key={ancestor.id} className="flex shrink-0 items-center gap-2">
              {/* Mirrors `AncestorCrumb`'s CEILING (200px with the type bump)
                  but deliberately NOT its `px-1.5`.

                  I added that padding on the reasoning that the ruler must
                  match the real crumb exactly or it under-measures. The
                  reasoning was never demonstrated — no test failed without it
                  — and it broke CI: 12px × every ancestor made the fit
                  arithmetic eager enough that a 1600px viewport folded a crumb
                  it has room for, in CI's font environment. Reverted.

                  If the under-measurement is ever shown to be real, the fix
                  belongs in the BUDGET, not here: the padding is a constant
                  per crumb and the fold is already tuned against a ruler that
                  omits it. Do not re-add this without a failing test. */}
              <span className="max-w-[200px] truncate">{ancestor.label}</span>
              <span>/</span>
            </span>
          ))}
          <span className="shrink-0" data-crumb-overflow-ruler>
            &hellip;
          </span>
        </div>
        {/* The project is the ROOT crumb, not a child of a "Projects / Graph"
            chrome path: the trail reads as the timeline tree the user is
            standing in. At the root the project IS the focused crumb, so it
            renders once, as the current one. */}
        {focusedId !== projectId && (
          <span data-crumb-fixed className="flex shrink-0 items-center gap-2">
            <AncestorCrumb
              crumbId={projectId}
              href={base}
              label={documents[projectId]?.title ?? projectId}
            />
            <span aria-hidden="true">/</span>
          </span>
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
        <span data-crumb-fixed className="flex min-w-0 items-center">
          <EditableCrumbName crumbId={focusedId} label={focusedTitle} />
        </span>
      </nav>
    </div>
  );
}

// (The old GraphViewChrome row — a full-width strip holding only the
// "Storyboard view" link — is gone: the link lives in the board's overflow
// menu now, so the page starts at the preview itself.)
