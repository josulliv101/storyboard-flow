import type {Metadata} from 'next';
import { TimelineRouteFadeController } from '@/components/timeline/timeline-route-fade';
import { TimelineSidebar } from '@/components/timeline/timeline-sidebar';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'My Google AI Studio App',
  description: 'My Google AI Studio App',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <TimelineRouteFadeController />
        <div className="relative flex min-h-screen bg-zinc-950 text-white font-sans overflow-x-hidden">
          <TimelineSidebar />
          <main className="flex-1 px-8 py-10 overflow-y-auto max-h-screen">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
