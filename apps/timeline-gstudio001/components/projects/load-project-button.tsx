"use client";

import { useRef, useState } from "react";
import { LoaderCircle, Upload } from "lucide-react";

import { Button } from "@/components/core/button";
import { loadProjectFromFile } from "./load-project";

/**
 * "Load project" for the library page — the home this action should have had
 * first.
 *
 * Loading a project replaces the whole offline board, which makes it a LIBRARY
 * action, not a board one. Shipping it only in the board's `⋮` meant the only
 * route to it was to create a throwaway project so a board existed to open the
 * menu from. That is the bug this fixes, and it is worth naming rather than
 * quietly correcting: an action that operates on the project SET belongs where
 * the set is.
 *
 * Secondary to "New Project" on purpose — outline against that one's filled
 * blue. Both make a project appear in the list, but one is the everyday verb and
 * the other is recovery.
 *
 * Dev-only, like its twin in the board menu: the endpoint writes the offline
 * fixture file and 404s in production, so the control would be a button that can
 * only fail. `NODE_ENV` is inlined client-side by Next, so no public env var is
 * needed to know.
 */
export function LoadProjectButton() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  if (process.env.NODE_ENV === "production") return null;

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
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        data-project-load
        title="Load a project from an exported JSON file. Replaces the offline board."
        onClick={() => fileRef.current?.click()}
        className="h-9 shrink-0 gap-2 border-zinc-800 bg-zinc-950 px-3 text-xs font-bold uppercase tracking-widest text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
      >
        {busy ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        Load Project
      </Button>
    </>
  );
}
