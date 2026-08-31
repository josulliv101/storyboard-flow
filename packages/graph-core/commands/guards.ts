// Graph — the key-hook guard, and the public doors.
//
// Split out of the former single-file `commands.ts`; see ./index.ts.

import {
  type Command,
  type EditOf,
  type EngineContext,
  type Graph,
  type History,
  type NodeId,
  type Patch,
  type Rejection,
  type Result,
  type WidenedNodeType,
} from "../types";
import {
  KeyHookFailure,
  keyHookMessage,
} from "../graph";

import { fail } from "./internals";
import { applyCommandUnguarded } from "./reducer";
import { applyNonUndoableWriteEditsUnguarded } from "./non-undoable-write";

// The key-hook guard
// ---------------------------------------------------------------------------

/**
 * `contentKey` / `sourceKey` are the two consumer hooks this module reads
 * without a wrapper of their own, because ./graph deliberately refuses to
 * swallow their throw into `null` — see the block comment above `contentKeyOf`.
 * `null` means "no key", and a node type that threw has not said that.
 *
 * So it arrives here as `KeyHookFailure` and becomes a REFUSAL, which is what
 * both halves of this file's header promise: "Nothing here throws; every
 * failure is Result-shaped", and "nothing is ever partially applied". Measured
 * before the guard: a throwing `contentKey` escaped `dispatch` for edit, insert
 * AND remove, which is precisely the failure review3 describes — "an unhandled
 * exception out of a React event handler, at every call site that correctly
 * wrote `if (!result.ok)`".
 *
 * `instanceof` the private tag, never a bare `catch`. A bare catch would report
 * a bug inside this engine as the consumer's fault and hide it behind a
 * rejection the consumer cannot act on; anything that is not the tag still
 * crashes loudly.
 */
function guardKeyHooks<T>(run: () => Result<T, Rejection>): Result<T, Rejection> {
  try {
    return run();
  } catch (thrown) {
    if (thrown instanceof KeyHookFailure) {
      return fail("node-type-threw", keyHookMessage(thrown), {
        kind: thrown.kind,
        ...(thrown.nodeId === null ? {} : { nodeIds: [thrown.nodeId] }),
      });
    }
    throw thrown;
  }
}

export function applyCommand<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  command: Command<Ts, S>,
  ctx: EngineContext<S>,
): Result<Readonly<{ graph: Graph<Ts, S>; patch: Patch<Ts, S> }>, Rejection> {
  return guardKeyHooks(() => applyCommandUnguarded<Ts, S>(graph, command, ctx));
}

export function applyNonUndoableWriteEdits<
  Ts extends readonly WidenedNodeType[],
  S,
>(
  graph: Graph<Ts, S>,
  history: History<Ts, S>,
  edits: readonly EditOf<Ts>[],
  ctx: EngineContext<S>,
): Result<
  Readonly<{
    graph: Graph<Ts, S>;
    history: History<Ts, S>;
    scrubbed: readonly NodeId[];
  }>,
  Rejection
> {
  return guardKeyHooks(() =>
    applyNonUndoableWriteEditsUnguarded<Ts, S>(graph, history, edits, ctx),
  );
}
