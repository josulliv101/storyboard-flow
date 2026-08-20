/**
 * Whether the board draws LANES — the extra track rows under the picture, for
 * media that runs alongside it rather than after it (an audio bedding under a
 * cut being the case it was built for).
 *
 * OFF. The feature does not work well enough to be on, and this parks it
 * without deleting it: the model, the arithmetic, the drop targeting, the
 * compositing and their tests all stay exactly where they are, so turning it
 * back on is one environment variable rather than an archaeology exercise.
 * Deleting it was the other option on the table and is the worse one — the
 * lane data is in stored documents already (`trackIndex` on the clip), so the
 * code that understands it is the thing keeping those documents readable.
 *
 * Set `NEXT_PUBLIC_GSTUDIO_LANE_TRACKS=on` to restore it. Compared against the
 * string rather than truthiness, the same way `NEXT_PUBLIC_GSTUDIO_REMOTE_POLL`
 * is, so that `=off`, `=0` and `=false` all read as off instead of the reverse
 * — a bare `!!process.env.X` makes the word "off" mean on.
 *
 * WHAT HAPPENS TO A CLIP THAT IS ALREADY ON A LANE, which is the part worth
 * being exact about: it is drawn in the picture row with everything else, and
 * its lane badge is not drawn. It does NOT disappear. Hiding the lane rows and
 * leaving those clips in them would make a stored clip invisible on the board
 * while still counting toward the timeline's duration and still compositing
 * into a render — present in the file, absent from the screen, which is the
 * one outcome worse than the feature being wrong.
 *
 * WHAT THIS DOES NOT TURN OFF. The `set_lane` MCP tool still writes a lane,
 * and the export still composites a clip that has one. Neither is a display
 * decision, and both are reversible by the tool that made them; with the rows
 * off, a clip an agent puts on lane 3 simply draws in the picture row. If the
 * intent is to stop lanes being AUTHORED at all, that is a second change and a
 * larger one — it means a write gate, not a flag.
 */
export const LANE_TRACKS_ENABLED = process.env.NEXT_PUBLIC_GSTUDIO_LANE_TRACKS === "on";
