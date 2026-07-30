"use client";

import { Ban, CircleCheck } from "lucide-react";

import {
  parseNodeId,
  useCollectionsSelector,
  useCollectionsStore,
} from "@storyboard/ui/dnd-collections";

/**
 * Disable/enable the one item a details modal is showing (PL14-001).
 *
 * An ACTION whose label flips, not a switch — the same shape the rail's item
 * actions already use (`Ban` + "Disable" / `CircleCheck` + "Enable"). Two
 * controls for one concept should look like one concept, and the rail got
 * there first.
 *
 * Dispatched as `set-node-disabled` over a single-node list, which is exactly
 * what the modal's scoped history already recognises (`useScopedHistory`
 * accepts that command when it names one node, and that node is this one) — so
 * the modal's own undo covers this without any further wiring.
 *
 * No toast. The rail toasts because its selection can be forty items and the
 * board may not show what changed; here the button's own label flips and the
 * item is on screen, so a toast would narrate something the user is looking
 * at.
 *
 * Shared by both dialogs — the clip modal and the collection one. Disabling a
 * collection means the same thing it means anywhere: the item keeps its slot
 * and its span, and playback skips it (see playback-skip.ts).
 */
export function ItemDisableToggle({ nodeId }: Readonly<{ nodeId: string }>) {
  const store = useCollectionsStore();
  const disabled = useCollectionsSelector(
    (snapshot) => snapshot.graph.nodesById.get(parseNodeId(nodeId))?.disabled === true,
  );
  const Icon = disabled ? CircleCheck : Ban;
  const label = disabled ? "Enable" : "Disable";

  return (
    <button
      type="button"
      data-item-details-disable
      aria-pressed={disabled}
      onClick={() => {
        store.dispatch({
          type: "set-node-disabled",
          nodeIds: [parseNodeId(nodeId)],
          disabled: !disabled,
        });
      }}
      aria-label={`${label} this item`}
      title={
        disabled
          ? "Enable — play this item again"
          : "Disable — keep the slot, skip it on playback"
      }
      className={[
        "flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1",
        "text-[11px] font-medium transition-colors",
        disabled
          ? "text-amber-300 hover:bg-zinc-800 hover:text-amber-200"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
      ].join(" ")}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
