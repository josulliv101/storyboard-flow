import type {Metadata} from 'next';
import './globals.css';
import { Outfit } from "next/font/google";
import { cn } from "@/lib/utils";

const outfit = Outfit({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'Storyboard Workbench',
  description: 'Storyboard Workbench',
};

import { TooltipProvider, Toaster } from "@storyboard/ui"
import { TimelineProvider } from '@/lib/timeline-context';
import { ThemeProvider } from '@/components/theme-provider';

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={cn("font-sans", outfit.variable)} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <TimelineProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </TimelineProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
