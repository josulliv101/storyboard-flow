import { Skeleton } from "@/components/core/skeleton";

export default function TimelineLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading project"
      className="mx-auto grid w-full max-w-[1400px] gap-4"
    >
      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50">
        <div className="flex min-h-14 items-center justify-between gap-4 border-b border-zinc-800/70 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-8" />
          </div>
        </div>

        <div className="grid gap-4 p-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/70 p-2"
              >
                <Skeleton className="aspect-video w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
