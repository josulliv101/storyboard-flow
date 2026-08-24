"use client";

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
import { cn } from "@/lib/utils";

/**
 * The project's `⋮` — export the open project as one JSON file.
 *
 * Export writes the whole project (root plus every collection under it) in the
 * FIXTURE format, which the library page's "Load Project" reads back into the
 * offline store. The pair is a save/load loop that touches Firebase once, at
 * export: from then on a project can be reloaded, edited and reloaded again for
 * nothing, which is the point of it — the free tier is 50,000 reads a day and
 * entering a board spends one per collection.
 *
 * LOAD IS NOT HERE, and used to be (PL15-002). The argument for keeping it in
 * both places was that deciding to swap projects usually happens while looking
 * at one. The argument against, and the one that won: loading replaces the
 * WHOLE offline board, so it acts on the project SET rather than on the project
 * you have open — a library verb that happened to be reachable from inside a
 * board. It lives on the projects page, once. Export stays because it genuinely
 * is a board action: it exports the project in front of you.
 *
 * NOT the gear beside it. "Board options" holds settings you set once and leave
 * (thumbnail size, render format); this is a verb that acts on the project as a
 * whole and produces a file. Same row, different question — which is also why
 * this is a `⋮` and that is a `⚙`: an ellipsis says "more things to DO here", a
 * cog says "how this is configured".
 *
 * The other `⋮` in this header belongs to select mode, which REPLACES this row
 * while a selection is being assembled, so the two are never on screen together.
 */
export function GraphProjectMenu({ projectId }: Readonly<{ projectId: string }>) {
  return (
    /* Non-modal, for the reason the other menus in this header are: Radix's
       modal default puts pointer-events:none on the body, which stops the
       trigger receiving the click that should close its own menu. */
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Project options"
          title="Project — export"
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
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
