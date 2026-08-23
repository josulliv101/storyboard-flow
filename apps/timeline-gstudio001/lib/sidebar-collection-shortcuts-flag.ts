/**
 * Whether the rail lists a project's TOP-LEVEL COLLECTIONS under the home
 * shortcut.
 *
 * OFF. The group keeps its heading and the home shortcut — "back to the top of
 * the project" is the one destination that is always worth a permanent place —
 * and the per-collection buttons under it are gone.
 *
 * WHY. The rail's job is "where am I" and "where else", and it answers the
 * second with a handful of fixed destinations. Collections are neither fixed
 * nor few: the list is every top-level collection with no cap, so it is a
 * different length in every project and a different length again after any
 * edit. A navigator whose height depends on your data is a navigator you
 * cannot learn — the trash and the assets folder move down the rail because a
 * scene was added somewhere else entirely.
 *
 * They are also the one group here that duplicates something. The board is a
 * complete view of the same collections, one click away and showing their
 * contents rather than a 32px crop of one frame.
 *
 * Set `NEXT_PUBLIC_GSTUDIO_SIDEBAR_COLLECTIONS=on` to restore them. Compared
 * against the string rather than truthiness, the same way
 * `NEXT_PUBLIC_GSTUDIO_BAR_COLOURS` is, so `=off`, `=0` and `=false` all read
 * as off instead of the reverse — a bare `!!process.env.X` makes the word
 * "off" mean on.
 *
 * WHAT IS PARKED AND WHAT IS NOT. `collectionShortcuts` still walks the
 * document and still returns the list; this only decides whether the rail
 * draws it. So the thumbnail's punched-in crop, the collection badge, and the
 * per-shortcut tooltips do not rot while the flag is off, and turning them
 * back on is one environment variable rather than a revert.
 *
 * FLAG OFF IS A STATE THIS ALREADY HAD. A project with no top-level
 * collections has always rendered exactly this — heading, home, nothing else —
 * so nothing new is being drawn and the empty case is not a special path.
 */
export const SIDEBAR_COLLECTION_SHORTCUTS_ENABLED =
  process.env.NEXT_PUBLIC_GSTUDIO_SIDEBAR_COLLECTIONS === "on";
