import Link from "next/link";
import type { Metadata } from "next";

import { ClientDndCollectionsShowcase } from "../../components/client-dnd-collections-showcase";

export const metadata: Metadata = {
  title: "DnD Collections Lab | StoryboardFlow",
  description:
    "An interactive showcase of command-driven collection reordering, nesting, palette creation, trash, and undo/redo.",
};

export default function DndCollectionsPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-8 px-5 py-8 md:px-8">
      <header className="flex flex-col gap-5 border-b border-border pb-6">
        <nav aria-label="Breadcrumb">
          <Link
            href="/collections/assembly"
            className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            Back to Media Strip
          </Link>
        </nav>

        <div className="max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
            StoryboardFlow component lab
          </p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight text-balance md:text-5xl">
            DnD Collections
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground text-pretty">
            A normalized collection graph projected into an interactive React board. Every move,
            nested drop, palette addition, undo, and redo travels through the same typed command and
            reversible-patch pipeline.
          </p>
        </div>
      </header>

      <ClientDndCollectionsShowcase />
    </main>
  );
}
