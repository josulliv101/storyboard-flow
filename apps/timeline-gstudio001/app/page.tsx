import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-zinc-950 text-white">
      <SmoothScrollList />
    </main>
  );
}
