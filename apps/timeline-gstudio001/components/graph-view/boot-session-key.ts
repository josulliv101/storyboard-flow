/**
 * Identity of a booted graph session, used as the React `key` on
 * `<DndCollections>`.
 *
 * `DndCollections` consumes `initialGraph` initial-ONLY by design (its store
 * is the source of truth thereafter — see
 * `packages/ui/dnd-collections/react/DndCollections.tsx`). So a boot re-run
 * that rebuilds the graph for a DIFFERENT session (a soft user switch:
 * sign out and into another account without a full navigation) would leave
 * the mounted store holding the previous user's graph. Keying the provider on
 * the session identity forces a remount when — and only when — the session
 * changes, recreating the store from the fresh `initialGraph`.
 *
 * The key is intentionally derived only from the signed-in uid and the
 * projectId: it must stay stable across ordinary renders and route drill-in
 * (navigating within the same project/user must NOT remount — that would drop
 * selection and undo history on every drill). This value is stored alongside
 * the built graph in the boot-ready state so the key changes atomically with
 * the graph it describes, never before it.
 */
export function bootSessionKey(uid: string | null, projectId: string): string {
  // Encode both parts unambiguously so no uid/projectId pair can collide with
  // another (a literal separator in either value can't fake a boundary).
  return `${encodeURIComponent(uid ?? "")}:${encodeURIComponent(projectId)}`;
}
