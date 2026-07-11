import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "StoryboardFlow UI Labs",
  description:
    "Next.js React Server Components showcases for the StoryboardFlow media strip and DnD collections packages.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
