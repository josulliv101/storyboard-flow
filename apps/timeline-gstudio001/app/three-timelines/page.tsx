import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";

const timelines = [
  { label: "Timeline 1", itemCount: 1000 },
  { label: "Timeline 2", itemCount: 1000 },
  { label: "Timeline 3", itemCount: 1000 },
];

export default function ThreeTimelinesPage() {
  return (
    <main className="min-h-screen bg-zinc-950 px-8 py-10 text-white">
      <div className="mx-auto grid w-full max-w-[1400px] gap-16">
        {timelines.map((timeline) => (
          <section
            key={timeline.label}
            aria-label={timeline.label}
            className="grid gap-3"
          >
            <h2 className="text-sm font-semibold text-zinc-300">
              {timeline.label}
            </h2>
            <SmoothScrollList
              itemCount={timeline.itemCount}
              syncMediaDuration={false}
            />
          </section>
        ))}
      </div>
    </main>
  );
}
