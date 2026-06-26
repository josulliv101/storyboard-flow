import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";
import { getTimelinePage } from "@/lib/timeline-documents";

export default function ThreeTimelinesPage() {
  const page = getTimelinePage("three");
  const timelines = page?.timelines ?? [];

  return (
    <main className="min-h-screen bg-zinc-950 px-8 py-10 text-white">
      <div className="mx-auto grid w-full max-w-[1400px] gap-16">
        {timelines.map((timeline) => (
          <section
            key={timeline.id}
            aria-label={timeline.title}
            className="grid"
          >
            <SmoothScrollList
              timelineId={timeline.id}
              timelineTitle={timeline.title}
              initialClips={timeline.clips}
              syncMediaDuration={false}
            />
          </section>
        ))}
      </div>
    </main>
  );
}
