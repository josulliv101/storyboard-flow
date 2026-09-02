"use client";

import { MediaMonsterMark } from "@/components/brand/media-monster-mark";
import { toast } from "@/components/core/sonner";

/**
 * A placeholder, and a smoke test for the shell.
 *
 * Every piece the shell brought over is exercised here on purpose: the monster
 * renders (so a broken port shows up as a missing creature rather than as
 * nothing), the wordmark uses the loaded font at the weight it was loaded at,
 * the dark palette paints, and the button proves the toast surface is mounted.
 *
 * It is meant to be replaced by the first real view. Nothing else should import
 * from it.
 */
export default function Home() {
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center gap-10">
      <div className="flex items-center gap-3">
        <MediaMonsterMark scale={2.4} />
        <span
          className="font-bold text-4xl"
          style={{ fontFamily: "var(--font-grandstander)" }}
        >
          media<span className="text-blue-400">monster</span>
        </span>
      </div>

      <p className="max-w-md text-center text-sm text-zinc-400">
        The shell is up. Components come over from{" "}
        <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
          timeline-gstudio001
        </code>{" "}
        one at a time, onto the{" "}
        <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
          nested-collections
        </code>{" "}
        engine.
      </p>

      <button
        type="button"
        onClick={() => toast.success("The toast surface is mounted.")}
        className="rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 transition-colors hover:bg-zinc-800"
      >
        Test the toaster
      </button>
    </div>
  );
}
