// Graph — the reducer — the one mutation path.
//
// Split out of the former single-file `commands.ts`; see ./index.ts.

import {
  type Command,
  type EngineContext,
  type Graph,
  type Patch,
  type Rejection,
  type Result,
  type WidenedNodeType,
} from "../types";

import { foreignGraph } from "./queries";
import { applyMoveNodes } from "./move";
import { applyInsertNodes } from "./insert";
import { applyRemoveNodes } from "./remove";
import { applyEditNodes } from "./edit";

// The reducer
// ---------------------------------------------------------------------------

/**
 * THE ONLY mutation path.
 *
 * NOTE ON `commandPolicy`: the consumer's pre-commit veto is NOT run here — it
 * is not on `EngineContext`, and the engine wrapper runs it before delegating.
 * That keeps the veto strictly ahead of the reducer, which is the point: a
 * post-commit veto corrupts redo, because the push has already cleared the redo
 * branch and the following undo pushes the refused command onto it.
 */
export function applyCommandUnguarded<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  command: Command<Ts, S>,
  ctx: EngineContext<S>,
): Result<Readonly<{ graph: Graph<Ts, S>; patch: Patch<Ts, S> }>, Rejection> {
  const foreign = foreignGraph(graph, ctx);
  if (foreign !== null) return { ok: false, error: foreign };

  switch (command.type) {
    case "move-nodes":
      return applyMoveNodes(
        graph,
        command.nodeIds,
        command.toParentId,
        command.toIndex,
        ctx,
      );
    case "insert-nodes":
      return applyInsertNodes(
        graph,
        command.seeds,
        command.toParentId,
        command.toIndex,
        ctx,
      );
    case "remove-nodes":
      return applyRemoveNodes(
        graph,
        command.nodeIds,
        command.allowUnloaded ?? false,
        ctx,
      );
    case "edit-nodes":
      return applyEditNodes(graph, command.edits, ctx);
  }
}
