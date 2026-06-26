import Link from "next/link";

import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";
import { getTimelineDocument } from "@/lib/timeline-documents";

export default function Home() {
  const document = getTimelineDocument("root");

  return (
    <main className="min-h-screen bg-zinc-950 p-8 text-white">
      <div className="mx-auto grid w-full max-w-[1400px] gap-5">
        <header>
          <div className="flex flex-wrap gap-3 text-xs font-medium">
            <Link href="/timeline/root" className="text-amber-300 hover:text-amber-200">
              Open root route
            </Link>
            <Link
              href="/timeline-pages/three"
              className="text-amber-300 hover:text-amber-200"
            >
              Open three timelines
            </Link>
          </div>
        </header>

        <SmoothScrollList
          timelineId={document?.id}
          timelineTitle={document?.title}
          initialClips={document?.clips}
          syncMediaDuration={false}
        />
      </div>
    </main>
  );
}
