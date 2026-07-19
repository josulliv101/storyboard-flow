import type {Metadata} from 'next';
import { Suspense } from 'react';
import { AuthGate } from '@/components/auth/auth-gate';
import { AuthProvider } from '@/components/auth/auth-provider';
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
        <AuthProvider>
          <AuthGate>
            <div className="relative flex min-h-screen overflow-x-clip bg-zinc-950 font-sans text-white">
              <Suspense fallback={null}>
                <TimelineSidebar />
              </Suspense>
              <main
                className="min-w-0 flex-1 px-8 pt-6"
                style={{
                  paddingBottom: "var(--asset-library-height, 0px)",
                }}
              >
                {children}
              </main>
            </div>
          </AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}
