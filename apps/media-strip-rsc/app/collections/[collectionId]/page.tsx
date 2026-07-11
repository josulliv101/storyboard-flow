import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { ClientDemoMediaStrip } from "../../../components/client-demo-media-strip";
import {
  MEDIA_COLLECTIONS,
  getCollection,
  getCollectionRuntimeSeconds,
} from "../../../lib/collections";

type CollectionPageProps = Readonly<{
  params: Promise<{
    collectionId: string;
  }>;
}>;

export function generateStaticParams() {
  return MEDIA_COLLECTIONS.map((collection) => ({
    collectionId: collection.id,
  }));
}

export async function generateMetadata({
  params,
}: CollectionPageProps): Promise<Metadata> {
  const { collectionId } = await params;
  const collection = getCollection(collectionId);

  if (!collection) {
    return {
      title: "Collection Not Found",
    };
  }

  return {
    title: `${collection.name} | Media Strip RSC Starter`,
    description: collection.notes,
  };
}

export default async function CollectionPage({ params }: CollectionPageProps) {
  const { collectionId } = await params;
  const collection = getCollection(collectionId);

  if (!collection) {
    notFound();
  }

  const runtimeSeconds = getCollectionRuntimeSeconds(collection);

  return (
    <main className="starter-shell mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-8 px-5 py-8 md:px-8">
      <header className="flex flex-col gap-5 border-b border-white/10 pb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
              StoryboardFlow
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight text-balance md:text-5xl">
              {collection.name}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground text-pretty">
              {collection.notes}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <dt className="text-muted-foreground">Clips</dt>
              <dd className="mt-1 text-xl font-semibold">{collection.items.length}</dd>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <dt className="text-muted-foreground">Runtime</dt>
              <dd className="mt-1 text-xl font-semibold">{Math.round(runtimeSeconds)}s</dd>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <dt className="text-muted-foreground">Route ID</dt>
              <dd className="mt-1 truncate text-xl font-semibold">{collection.id}</dd>
            </div>
          </dl>
        </div>

        <nav aria-label="Collections" className="flex flex-wrap gap-2">
          {MEDIA_COLLECTIONS.map((navCollection) => {
            const isActive = navCollection.id === collection.id;
            return (
              <Link
                key={navCollection.id}
                href={`/collections/${navCollection.id}`}
                aria-current={isActive ? "page" : undefined}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/60 hover:text-foreground aria-current:border-primary aria-current:bg-primary/15 aria-current:text-foreground"
              >
                {navCollection.name}
              </Link>
            );
          })}
          <Link
            href="/dnd-collections"
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            DnD Collections Lab
          </Link>
        </nav>
      </header>

      <section className="starter-overview grid gap-5">
        <aside className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
            {collection.deck}
          </p>
          <h2 className="mt-3 text-lg font-semibold">Collection Contents</h2>
          <div className="mt-5 grid gap-2 text-sm text-muted-foreground">
            {collection.items.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 border-t border-white/10 pt-2"
              >
                <span className="truncate text-foreground">{item.name}</span>
                <span className="shrink-0 text-xs uppercase tracking-[0.14em]">
                  {item.kind}
                </span>
              </div>
            ))}
          </div>
        </aside>

        <ClientDemoMediaStrip
          key={collection.id}
          activeCollectionId={collection.id}
          collections={MEDIA_COLLECTIONS}
        />
      </section>
    </main>
  );
}
