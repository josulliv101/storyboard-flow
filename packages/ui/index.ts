// The package's nominal entry (package.json main/types), but NOT how anyone
// consumes it: every importer reaches in by subpath
// ("@storyboard/ui/dnd-collections", "@storyboard/ui/timeline/types"), and no
// file anywhere imports the bare "@storyboard/ui" — the only occurrence of
// that specifier in the repo is `transpilePackages` in the app's
// next.config.ts, which is build config.
//
// So an `export *` here was never evidence a module had consumers. This
// barrel used to re-export media-strip, wheel-picker, charts, drag-drop, the
// legacy timeline viewport and 60 shadcn primitives; every one of them turned
// out to be unreachable, and the re-export is the reason that went unnoticed.
// Before adding a line here, ask what would actually import it — and run
// `npm run audit:ui` before assuming anything below is used.
export * from "./lib/utils";
