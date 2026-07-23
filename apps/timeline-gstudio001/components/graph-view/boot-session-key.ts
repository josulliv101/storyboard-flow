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
 * The key is intentionally derived only from the signed-in uid, the projectId,
 * and a rebuild counter: it must stay stable across ordinary renders and route
 * drill-in (navigating within the same project/user must NOT remount — that
 * would drop selection and undo history on every drill). This value is stored
 * alongside the built graph in the boot-ready state so the key changes
 * atomically with the graph it describes, never before it.
 *
 * `generation` is the deliberate remount lever, for the rare case where the
 * mounted store holds nodes that no longer exist server-side and cannot be
 * removed by any command — today: the trash bin being permanently emptied
 * from the sidebar drawer, whose items are nodes under this graph's trash
 * root. Callers bump it; every other input stays untouched.
 */
export function bootSessionKey(
  uid: string | null,
  projectId: string,
  generation = 0,
): string {
  // Encode presence explicitly (`0` = signed-out, `1` + encoded uid =
  // signed-in) so a signed-out (null) session never collapses onto a
  // signed-in session whose uid happens to be the empty string. Both parts are
  // encoded unambiguously so no uid/projectId pair can collide with another (a
  // literal separator in either value can't fake a boundary).
  const uidPart = uid === null ? "0" : `1${encodeURIComponent(uid)}`;
  return `${uidPart}:${encodeURIComponent(projectId)}:${generation}`;
}
