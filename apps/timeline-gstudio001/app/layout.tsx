import type {Metadata} from 'next';
import { TimelineRouteFadeController } from '@/components/timeline/timeline-route-fade';
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
        {children}
      </body>
    </html>
  );
}
