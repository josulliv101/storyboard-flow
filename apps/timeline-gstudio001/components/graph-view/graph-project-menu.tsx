"use client";

import { useRef, useState } from "react";
import { EllipsisVertical } from "lucide-react";

import { Button } from "@/components/core/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/core/dropdown-menu";
import { loadProjectFromFile } from "@/components/projects/load-project";
import { cn } from "@/lib/utils";

/**
 * The project's `⋮` — export the open project, or swap it for one from a file.
 *
 * Export writes the whole project (root plus every collection under it) as one
 * JSON file in the FIXTURE format, and Load reads that file back into the
 * offline store. The pair is a save/load loop that touches Firebase once, at
 * export: from then on a project can be reloaded, edited and reloaded again for
 * nothing, which is the point of it — the free tier is 50,000 reads a day and
 * entering a board spends one per collection.
 *
 * NOT the gear beside it. "Board options" holds settings you set once and leave
 * (thumbnail size, render format); these are two verbs that act on the project
 * as a whole and produce a file. Same row, different question — which is also
 * why this is a `⋮` and that is a `⚙`: an ellipsis says "more things to DO
 * here", a cog says "how this is configured".
 *
 * LOAD IS ALSO ON THE LIBRARY PAGE, and that is the more important of the two
 * homes: this menu only exists inside a board, so offering load only here meant
 * you had to create a throwaway project before you could load one — which is
 * exactly how it was first shipped, and wrong. It stays here as well because
 * deciding to swap projects usually happens while looking at one.
 *
 * The other `⋮` in this header belongs to select mode, which REPLACES this row
 * while a selection is being assembled, so the two are never on screen together.
 */
export function GraphProjectMenu({ projectId }: Readonly<{ projectId: string }>) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  // Load is a DEV affordance: the endpoint it calls writes the offline fixture
  // file and 404s in production, so a button that could only ever fail there
  // should not be on screen. `NODE_ENV` is inlined into the client bundle by
  // Next, so this needs no public env var of its own.
  const loadable = process.env.NODE_ENV !== "production";

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        tabIndex={-1}
        aria-hidden="true"
        data-project-import-input
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset BEFORE handing off so picking the same file twice running
          // fires `change` again — an input compares against its own value and
          // an unchanged one is silently inert.
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          void loadProjectFromFile(file).finally(() => setBusy(false));
        }}
      />
      {/* Non-modal, for the reason the other menus in this header are: Radix's
          modal default puts pointer-events:none on the body, which stops the
          trigger receiving the click that should close its own menu. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Project options"
            title="Project — export or load"
            data-project-menu
            className={cn("h-8 w-8 shrink-0", "text-zinc-400 hover:text-zinc-100")}
          >
            <EllipsisVertical aria-hidden className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" className="w-64 p-2">
          <DropdownMenuLabel className="px-0.5 pb-2 pt-0.5">Project</DropdownMenuLabel>
          <DropdownMenuGroup>
            {/* A real link, so it downloads through the browser's own machinery
                — right-click, middle-click and keyboard activation all behave,
                and the response's Content-Disposition does the rest. Fetching
                it into a blob would buy nothing and break all three. */}
            <DropdownMenuItem asChild>
              <a
                href={`/api/timelines/${encodeURIComponent(projectId)}/export`}
                download
                data-project-export
              >
                Export project…
              </a>
            </DropdownMenuItem>
            {loadable ? (
              <DropdownMenuItem
                data-project-load
                disabled={busy}
                // Kept open on select so the picker opens over a menu that is
                // still there to retry from. Failures are reported by toast, so
                // nothing depends on this menu surviving — an earlier version
                // rendered the error inside it, and picking a file dismissed the
                // menu and the message with it.
                onSelect={(event) => {
                  event.preventDefault();
                  fileRef.current?.click();
                }}
              >
                {busy ? "Loading…" : "Load project from file…"}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
