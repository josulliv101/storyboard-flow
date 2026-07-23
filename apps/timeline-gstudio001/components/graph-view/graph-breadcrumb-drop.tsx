"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { FolderInput, Trash2 } from "lucide-react";

import {
  encodeDropTarget,
  getChildren,
  parseNodeId,
  useCollectionsContainer,
  useCollectionsSelector,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { announceGraphTrashArrival, setGraphTrashDropHover } from "@/lib/graph-view-events";

// The graph's card-drag drop targets live CENTRED IN THE BREADCRUMB ROW now,
// appearing while a card is being dragged (they were the sidebar tool
// palette's morph before). Two wide rectangular zones:
//
//   - MOVE TO PARENT — drop a card to promote it one level up, into the
//     focused collection's parent. Hidden at the root (nowhere up to go).
//   - TRASH — drop a card to move it to the trash root (undoable).
//
// Both are `panel` drop targets, which DndCollections resolves to the same
// append-to-collection move the sidebar trash used — so undo restores and
// nothing is deleted. They render INSIDE the board header (inside the
// provider), so their useDroppable joins the same DndContext as every card;
// no portal is needed anymore.

type ZoneState = "idle" | "over" | "invalid";

/** The live drop state for one target collection, read off the shared drag
 *  interaction: "over" when the current intent points here, "invalid" when it
 *  points here but the engine would refuse it. */
function useZoneState(targetId: NodeId): ZoneState {
  return useCollectionsSelector((s): ZoneState => {
    const intent = s.interaction.dropIntent;
    if (intent?.type !== "append-to-collection" || intent.collectionId !== targetId) return "idle";
    return s.interaction.dropIntentInvalid ? "invalid" : "over";
  });
}

/** The collection the current drag would drop INTO, named for display. Live
 *  only while a card drag points at an append-to-collection target (a
 *  breadcrumb crumb, a collection card, or the trash) — null otherwise. The
 *  ghost sits on the cursor and hides whatever the pointer is over, so this
 *  feeds a readout ELSEWHERE (the trash slot) that says where the drop lands.
 *  Each selector returns a primitive so no per-call allocation reaches the
 *  store's snapshot comparison. */
type DropDestination = Readonly<{ id: string; name: string; invalid: boolean }>;

function useDropDestination(): DropDestination | null {
  const documents = useSyncExternalStore(
    graphDocumentsGateway.subscribe,
    graphDocumentsGateway.read,
    graphDocumentsGateway.read,
  );
  const id = useCollectionsSelector((s) => {
    const intent = s.interaction.dropIntent;
    return intent?.type === "append-to-collection" ? String(intent.collectionId) : null;
  });
  const graphName = useCollectionsSelector((s) =>
    id !== null ? (s.graph.nodesById.get(id as NodeId)?.name ?? null) : null,
  );
  const invalid = useCollectionsSelector((s) =>
    id !== null ? s.interaction.dropIntentInvalid : false,
  );
  if (id === null) return null;
  // Prefer the document title (what the crumb itself shows) so the readout
  // matches the label the user is aiming at; fall back to the graph node name.
  return { id, name: documents[id]?.title ?? graphName ?? "here", invalid };
}

/**
 * Fades its children OUT while a card drag is live and back IN on drop. The
 * trash/destination readout takes over the header's right side during a drag,
 * so the toolbar icons and the centre summary underneath it would show through;
 * fading them keeps that surface clean and returns them when the drag ends.
 *
 * It subscribes to `isDragging` itself so the (large) board header need not —
 * only this wrapper re-renders on the drag edges, and `children` keep their
 * identity across that, so the controls inside never re-render. Opacity, not
 * unmount, so nothing reflows: the breadcrumb keeps its position and the wings
 * stay balanced. Left click-through (`pointer-events-none`) while hidden so a
 * faded control can't be hit under the readout.
 */
export function DragChromeFade({
  className,
  children,
}: Readonly<{ className?: string; children: ReactNode }>) {
  const isDragging = useCollectionsSelector((s) => s.interaction.isDragging);
  return (
    <div
      aria-hidden={isDragging || undefined}
      data-drag-chrome-fade=""
      data-faded={isDragging ? "true" : "false"}
      className={[
        className ?? "",
        "transition-opacity duration-200 motion-reduce:transition-none",
        isDragging ? "pointer-events-none opacity-0" : "opacity-100",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

const ZONE_BASE =
  "flex h-10 min-w-[150px] items-center justify-center gap-2 rounded-md border text-xs font-medium transition-all duration-200";

type ZoneAccent = Readonly<{ over: string; icon: string }>;

/** One wide rectangular drop zone. Always mounted (so dnd-kit measures its
 *  rect at drag start) but only VISIBLE + interactive while a card drag is
 *  live — invisible and click-through otherwise, so it never covers the
 *  breadcrumb or the toolbar controls it sits over. */
function DropZone({
  targetId,
  active,
  icon: Icon,
  label,
  accent,
  dataAttr,
  onOverChange,
  destinationHint,
}: Readonly<{
  targetId: NodeId;
  active: boolean;
  icon: typeof Trash2;
  label: string;
  accent: ZoneAccent;
  dataAttr: string;
  /** Notified whenever this zone becomes the hovered drop target (or stops
   *  being it) — the trash zone uses it to animate the sidebar icon. */
  onOverChange?: (over: boolean) => void;
  /** When the drag points at some OTHER collection (a breadcrumb crumb or a
   *  card) rather than this zone, borrow the zone's pixels to name that
   *  destination — the ghost is covering it, so this is where the user reads
   *  where the drop will land. Ignored while this zone is itself the target. */
  destinationHint?: DropDestination | null;
}>) {
  const state = useZoneState(targetId);
  const { setNodeRef } = useDroppable({
    id: encodeDropTarget({ type: "panel", collectionId: targetId }),
  });

  useEffect(() => {
    onOverChange?.(state === "over");
  }, [state, onOverChange]);
  // Belt-and-braces: clear the signal if the zone unmounts mid-hover.
  useEffect(() => () => onOverChange?.(false), [onOverChange]);

  // Borrow the zone for the destination readout only when it is NOT itself the
  // target ("over"/"invalid" mean the pointer is here — show its own affordance
  // then). The droppable ref stays mounted either way, so the hit rect is never
  // lost while the label morphs.
  const hint = active && state === "idle" ? (destinationHint ?? null) : null;

  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-hidden={!active}
      {...{ [dataAttr]: targetId as string }}
      data-drop-state={hint ? "hint" : state}
      className={[
        ZONE_BASE,
        active ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
        hint
          ? hint.invalid
            ? "border-zinc-700 bg-zinc-900/90 text-zinc-500"
            : "border-sky-400 bg-sky-950/80 text-sky-100"
          : state === "over"
            ? accent.over
            : state === "invalid"
              ? "border-zinc-700 bg-zinc-900/90 text-zinc-600"
              : "border-dashed border-zinc-600 bg-zinc-950/85 text-zinc-300 backdrop-blur-sm",
      ].join(" ")}
    >
      {hint ? (
        <>
          <FolderInput aria-hidden="true" className="h-4 w-4 shrink-0" />
          {/* One line that GROWS the box to fit — the readout must always be the
              right size for the name. The generous cap only engages for an
              absurdly long name, so it can never overflow the header. */}
          <span className="max-w-[min(70vw,420px)] truncate whitespace-nowrap">
            {hint.invalid ? "Can’t drop into " : "Drop into "}
            <span className="font-semibold">{hint.name}</span>
          </span>
        </>
      ) : (
        <>
          <Icon aria-hidden="true" className={["h-4 w-4", state === "over" ? accent.icon : ""].join(" ")} />
          {label}
        </>
      )}
    </div>
  );
}

/** Arms on drag start (snapshotting the trash count) and fires the sidebar
 *  drawer's arrival pop on the first count GROWTH during the armed window —
 *  the drop's commit. Ported verbatim from the old sidebar trash target so
 *  the drawer animation still plays after the target moved. */
function useTrashArrivalAnnounce(trashId: NodeId) {
  const isDragging = useCollectionsSelector((s) => s.interaction.isDragging);
  const count = useCollectionsSelector((s) =>
    s.graph.nodesById.get(trashId)?.kind === "collection"
      ? getChildren(s.graph, trashId).length
      : 0,
  );
  const dragStartCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (isDragging) {
      dragStartCountRef.current = count;
      return;
    }
    if (dragStartCountRef.current === null) return;
    const disarm = setTimeout(() => {
      dragStartCountRef.current = null;
    }, 400);
    return () => clearTimeout(disarm);
    // Snapshot only on the drag EDGE — mid-drag count changes must not
    // re-snapshot (that would hide the very growth this watches for).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);
  useEffect(() => {
    if (dragStartCountRef.current !== null && count > dragStartCountRef.current) {
      dragStartCountRef.current = null;
      announceGraphTrashArrival();
    }
  }, [count]);
}

/**
 * The trash card-drag drop zone, right-aligned over the board header (opposite
 * the breadcrumb). The "move up a level" targets are the ancestor breadcrumb
 * crumbs themselves now (see AncestorCrumb) — dropping on a crumb moves the
 * card to that collection, up to the root — so only trash lives here. Shown
 * only while a card drag is live. Also registers the trash id for the keyboard
 * controller (Alt+Delete), which the old sidebar portal used to own.
 */
export function BreadcrumbDropZones({
  trashId,
}: Readonly<{ trashId: string | null }>) {
  const { trashRef } = useCollectionsContainer();
  const isDragging = useCollectionsSelector((s) => s.interaction.isDragging);
  const destination = useDropDestination();
  const trashNodeId = trashId !== null ? parseNodeId(trashId) : null;
  // Feed the readout only when the drop lands somewhere OTHER than trash — the
  // trash keeps its own affordance when it is the target.
  const destinationHint = destination !== null && destination.id !== trashId ? destination : null;

  // Keep the keyboard trash path (Alt+Delete) working now that the sidebar
  // portal that used to register this is gone.
  useEffect(() => {
    if (trashNodeId === null) return;
    trashRef.current = trashNodeId;
    return () => {
      if (trashRef.current === trashNodeId) trashRef.current = null;
    };
  }, [trashRef, trashNodeId]);

  useTrashArrivalAnnounce(trashNodeId ?? parseNodeId("__none__"));

  if (trashNodeId === null) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-end px-4">
      <DropZone
        targetId={trashNodeId}
        active={isDragging}
        icon={Trash2}
        label="Move to trash"
        dataAttr="data-graph-sidebar-trash"
        accent={{ over: "border-zinc-200 bg-zinc-700 text-zinc-50", icon: "text-zinc-100" }}
        onOverChange={setGraphTrashDropHover}
        destinationHint={destinationHint}
      />
    </div>
  );
}
