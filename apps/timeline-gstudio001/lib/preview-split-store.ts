/**
 * WHERE THE USER PUT THE SPLIT, remembered per project (PL16-007).
 *
 * The split between the preview and the board below it is a working
 * preference, not a document fact: two people opening the same project want
 * different amounts of picture, and the same person wants a different amount
 * on a laptop than on a monitor. So it lives in `localStorage` — per browser,
 * per project — rather than in the timeline document.
 *
 * PER PROJECT, not one global number, because the right split follows the
 * material. A project of long takes wants the picture; a project being
 * assembled from a hundred stills wants the board.
 *
 * EVERY PATH IS GUARDED AND SILENT. `localStorage` throws rather than returning
 * null in a private window and under a blocked-cookies setting, and a resize
 * that raised an exception would be a pane that stops moving for a preference
 * nobody would miss. A read that cannot answer returns `undefined`, which is
 * exactly what "no remembered height" already means to the pane.
 */
const KEY_PREFIX = "storyboard:preview-split:";

/** The same bounds the pane clamps to, restated here because a stored value is
 *  UNTRUSTED INPUT: it survives a release that changed the layout, and it can
 *  be edited by hand. A number outside this range is discarded rather than
 *  clamped — it is evidence the value is stale, not that it is slightly off. */
const MIN_REMEMBERED = 80;
const MAX_REMEMBERED = 2000;

export function readPreviewSplit(projectId: string): number | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${projectId}`);
    if (raw === null) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) return undefined;
    if (value < MIN_REMEMBERED || value > MAX_REMEMBERED) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function writePreviewSplit(projectId: string, height: number): void {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(height)) return;
  try {
    // ROUNDED. The pane's height is a float mid-drag, and storing 380.3921875
    // means the restored pane is a subpixel off the one that was left — which
    // the sticky stack above it then has to resolve against a fractional edge.
    window.localStorage.setItem(`${KEY_PREFIX}${projectId}`, String(Math.round(height)));
  } catch {
    // A preference that cannot be saved is not worth an error to the user.
  }
}
