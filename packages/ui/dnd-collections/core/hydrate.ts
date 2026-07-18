// Re-export shim: the framework-free engine core lives in
// @storyboard/collections-core (extracted so domain/server packages can
// depend on it without pulling this UI package). Kept so every existing
// "./core/hydrate" and "@storyboard/ui/dnd-collections/core/hydrate" path still works.
export * from "@storyboard/collections-core/hydrate";
