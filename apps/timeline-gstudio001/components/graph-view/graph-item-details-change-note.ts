// WHAT THAT UNDO JUST DID, in words.
//
// Undo in this view is scoped to one clip (see `useScopedHistory`), which
// makes it safe — but not legible. Pressing it moves a number somewhere in a
// panel that may be half a screen away from the button, and if the change was
// small, or the panel scrolled, nothing observable happens at all. The button
// then reads as broken, and the honest response to that is not a bigger button
// but a sentence: WHICH clip, WHAT changed, and FROM what TO what.
//
// Everything needed is already recorded. A `HistoryEntry` carries the command
// and the patch it produced, and a `nodes-updated` patch carries the whole
// node `before` and `after` — so the note is read out of history rather than
// tracked alongside it. Nothing here observes an edit; it describes one that
// already happened.

// Through the UI package's subpath rather than `@storyboard/collections-core`
// direct: both resolve, and every other file in this view takes the types from
// here, so a second path would be a second answer to "where do graph types
// come from" for no gain.
import type { CollectionsPatch, CollectionItemNode } from "@storyboard/ui/dnd-collections";

/** Which way through history the note is describing. */
export type ChangeDirection = "undo" | "redo";

export type ChangeNote = Readonly<{
  /** `Undid trim` — the verb and the kind of edit, together. */
  action: string;
  /** `clip 6`, or the node's name when the row cannot place it. */
  subject: string;
  /** `out 5.042 → 5.167`. Empty when the change has no two numbers to show. */
  detail: string;
}>;

/**
 * A clip's OUT POINT, which is not what the model stores.
 *
 * `trimOutSeconds` is how much is cut off the END; the number a person sets
 * and reads is how far into the source the clip runs to. Reporting the stored
 * field would be truthful and unrecognisable — someone who dragged the right
 * grip from 5.042 to 5.167 would be told a number went DOWN by 0.125.
 */
function outPointOf(node: CollectionItemNode): number | null {
  if (node.kind !== "media") return null;
  if (!("trimOutSeconds" in node) || !("fullDurationSeconds" in node)) return null;
  return node.fullDurationSeconds - node.trimOutSeconds;
}

function inPointOf(node: CollectionItemNode): number | null {
  if (node.kind !== "media") return null;
  if (!("trimInSeconds" in node)) return null;
  return node.trimInSeconds;
}

/** Thousandths: this is a report on an edit, and a trim lands on a frame. */
const at = (seconds: number): string => seconds.toFixed(3);

/**
 * The first field that actually moved, as `field from → to`.
 *
 * IN BEFORE OUT, and only one of them. A trim gesture moves one grip, so
 * naming both would mean naming one that did not change — and the whole point
 * of the note is to say what did. A drag that somehow moved both reports the
 * in-point, because that is the edge the eye is already on.
 */
function trimDetail(before: CollectionItemNode, after: CollectionItemNode): string {
  const inFrom = inPointOf(before);
  const inTo = inPointOf(after);
  if (inFrom !== null && inTo !== null && inFrom !== inTo) {
    return `in ${at(inFrom)} → ${at(inTo)}`;
  }
  const outFrom = outPointOf(before);
  const outTo = outPointOf(after);
  if (outFrom !== null && outTo !== null && outFrom !== outTo) {
    return `out ${at(outFrom)} → ${at(outTo)}`;
  }
  return "";
}

/** The `nodes-updated` entry for one node, or null when the patch is structural. */
function updateFor(
  patch: CollectionsPatch,
  nodeId: string,
): Readonly<{ before: CollectionItemNode; after: CollectionItemNode }> | null {
  if (patch.type !== "nodes-updated") return null;
  const found = patch.updates.find((update) => (update.nodeId as string) === nodeId);
  return found === undefined ? null : { before: found.before, after: found.after };
}

/**
 * Describe one history entry, or null when it is not the kind of edit this
 * view makes.
 *
 * NULL RATHER THAN A VAGUE STRING. `useScopedHistory` already refuses to step
 * over anything but these three commands, so an entry this cannot name is an
 * entry the button could not have reached — and inventing "Undid a change" for
 * it would put a notice on screen for something that did not happen here.
 *
 * @param label how the row names this clip (`clip 6`); the flat order belongs
 *   to the carousel, so it is passed in rather than derived.
 */
export function describeChange({
  command,
  patch,
  direction,
  label,
  name,
}: Readonly<{
  command: Readonly<{ type: string; nodeId?: string; nodeIds?: readonly string[] }>;
  patch: CollectionsPatch;
  direction: ChangeDirection;
  label: string | null;
  name: string | null;
}>): ChangeNote | null {
  const verb = direction === "undo" ? "Undid" : "Redid";
  const nodeId =
    command.nodeId ?? (command.nodeIds?.length === 1 ? command.nodeIds[0] : undefined);
  if (nodeId === undefined) return null;
  const subject = label ?? name ?? "clip";
  const update = updateFor(patch, nodeId);

  if (command.type === "update-media") {
    return {
      action: `${verb} trim`,
      subject,
      detail: update === null ? "" : trimDetail(update.before, update.after),
    };
  }
  if (command.type === "rename-node") {
    return {
      action: `${verb} rename`,
      subject,
      // Names are text, so they are quoted rather than formatted — an unquoted
      // rename to an empty-looking value would read as a missing detail.
      detail:
        update === null ? "" : `"${update.before.name}" → "${update.after.name}"`,
    };
  }
  if (command.type === "set-node-disabled") {
    // WHICH WAY IT WENT, read off the node rather than off the command: the
    // command names a target state, and after an undo the state that matters
    // is the one that was restored.
    const nowDisabled =
      update !== null && update.after.kind === "media" ? update.after.disabled === true : null;
    if (nowDisabled === null) return { action: `${verb} skip`, subject, detail: "" };
    return {
      action: `${verb} ${nowDisabled ? "skip" : "unskip"}`,
      subject,
      detail: nowDisabled ? "now skipped at play" : "now plays",
    };
  }
  return null;
}
