"use client";

import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * The app's snackbar surface.
 *
 * Themed to `dark` outright rather than through `next-themes` (the shadcn
 * default): this app has no theme provider and renders one dark palette, so
 * reading a theme context that never changes would only add a dependency.
 * Classes are the app's own zinc scale for the same reason — the shadcn
 * `bg-background`/`text-foreground` tokens aren't defined here.
 */
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="dark"
    className="toaster group"
    position="bottom-right"
    toastOptions={{
      classNames: {
        toast:
          "group toast group-[.toaster]:bg-zinc-900 group-[.toaster]:text-zinc-100 group-[.toaster]:border group-[.toaster]:border-zinc-800 group-[.toaster]:shadow-lg",
        description: "group-[.toast]:text-zinc-400",
        actionButton: "group-[.toast]:bg-amber-400 group-[.toast]:text-zinc-950",
        cancelButton: "group-[.toast]:bg-zinc-800 group-[.toast]:text-zinc-400",
        error: "group-[.toaster]:border-red-900/60",
        success: "group-[.toaster]:border-emerald-900/60",
      },
    }}
    {...props}
  />
);

export { Toaster, toast };
