"use client";

import { MoreHorizontal } from "lucide-react";

import { InlineNameEditor } from "./graph-inline-rename";
import { ItemDisableToggle } from "./graph-item-disable-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/core/dropdown-menu";

/**
 * One panel's heading: what this clip IS, in two lines.
 *
 * A META ROW AND A TITLE ROW, rather than one row of everything. The old
 * header put the name, the duration, a disable toggle, a history pair and a
 * close button on a single line, and then hid four of them below 30rem —
 * so a narrow panel was a title with a lot of missing furniture. Splitting
 * the line means the small, fixed-width facts (which clip, how much of it)
 * keep their place at every width, and the name gets the full width it
 * needs to be readable, which is what the panel cannot do without.
 *
 * WHAT LEFT. Undo, redo and close moved to the view's own header — there is
 * one dialog, so there is one of each. Disable moved into the `⋯` menu: it is
 * a real action on this clip, but not one you reach for often enough to spend
 * permanent width on, and a menu is where infrequent per-item actions go.
 */
export function ItemDetailsPanelHeader({
  name,
  clipLabel,
  trimReadout,
  nodeId,
  rename,
}: Readonly<{
  name: string;
  /** `clip 4` — its position in playback order, not its index in the row. */
  clipLabel: string | null;
  /** `7.83 / 10.13s`, or just the duration where there is no source window. */
  trimReadout: string;
  nodeId: string;
  rename: Readonly<{
    editing: boolean;
    begin: () => void;
    setDraft: (value: string) => void;
    commit: () => void;
    cancel: () => void;
  }>;
}>) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-zinc-500">{clipLabel}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="font-mono text-[11px] tabular-nums text-zinc-400">{trimReadout}</span>
          <DropdownMenu>
            <DropdownMenuTrigger
              data-item-details-menu
              aria-label={`More actions for ${name}`}
              title="More actions"
              className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70"
            >
              <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40 p-1">
              <ItemDisableToggle nodeId={nodeId} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* The name, editable in place (PL10-010) — the same hook the card,
          breadcrumb and sub-row rename through. Enter commits, Escape
          cancels, blur commits. Opens on a SINGLE click (PL14-010): nothing
          here has a competing click meaning, so the cheaper gesture is free,
          and the button wears `cursor-text` so the field is discoverable
          without a double click nobody would guess at. */}
      {rename.editing ? (
        <InlineNameEditor
          initialValue={name}
          onInput={rename.setDraft}
          onCommit={rename.commit}
          onCancel={rename.cancel}
          ariaLabel="Clip name"
          className="w-full rounded-sm bg-zinc-900 px-1 py-0.5 text-sm font-semibold text-zinc-100 outline-none ring-1 ring-blue-500/70"
        />
      ) : (
        <button
          type="button"
          onClick={rename.begin}
          aria-label={`Rename ${name}`}
          title={`Rename ${name}`}
          className={[
            "w-full cursor-text truncate rounded-md px-1 py-0.5 text-left",
            "text-sm font-semibold text-zinc-100 transition-colors hover:bg-zinc-800/70",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70",
          ].join(" ")}
        >
          {name}
        </button>
      )}
    </div>
  );
}
