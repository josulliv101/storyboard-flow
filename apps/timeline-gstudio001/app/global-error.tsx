"use client";

import { useEffect } from "react";

// The LAST resort: a throw in the root layout itself, which `app/error.tsx`
// cannot catch because that boundary only exists once the root layout has
// rendered. React replaces the entire document here, so this component has to
// supply its own <html> and <body> — and it cannot rely on the app's providers,
// fonts, or even globals.css being present, which is why the styling below is
// inline rather than Tailwind classes.
//
// Deliberately plain. Anything clever here risks throwing inside the handler
// for a throw, and there is no boundary left underneath to catch that.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error in the root layout:", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#09090b", color: "#d4d4d8", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: "34rem", margin: "0 auto", padding: "4rem 1.5rem" }}>
          <div
            role="alert"
            style={{
              border: "1px solid #27272a",
              background: "rgba(24,24,27,0.4)",
              borderRadius: "0.5rem",
              padding: "1rem",
              fontSize: "0.875rem",
              lineHeight: 1.5,
            }}
          >
            <p style={{ margin: 0, fontWeight: 600, color: "#f4f4f5" }}>
              The app could not start
            </p>
            <p style={{ marginTop: "0.25rem" }}>
              Something failed before the page could render. This is usually temporary —
              reloading often clears it.
            </p>
            {error.digest !== undefined && (
              <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#71717a" }}>
                Reference: <code>{error.digest}</code>
              </p>
            )}
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: "0.75rem",
                border: "1px solid #3f3f46",
                background: "rgba(39,39,42,0.6)",
                color: "#f4f4f5",
                borderRadius: "0.375rem",
                padding: "0.375rem 0.75rem",
                fontSize: "0.75rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
