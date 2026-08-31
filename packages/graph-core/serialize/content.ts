// Graph — The content trust boundary.
//
// Split out of the former single-file `serialize.ts`; see ./index.ts.

import {
  describeThrown,
  deepFreezeBounded,
  structurallyEqualBounded,
  describeValue,
  type EngineContext,
  type IngressError,
  type Issue,
  quoteFromWire,
  type NodeId,
  type ParseCtx,
  type QuarantineReason,
  type Result,
} from "../types";



// 2. The content trust boundary
// ---------------------------------------------------------------------------

function ingressError(
  nodeId: NodeId,
  kind: string,
  reason: QuarantineReason,
  issues: readonly Issue[],
): Result<never, IngressError> {
  return { ok: false, error: { nodeId, kind, reason, issues } };
}

/**
 * Runs migrations (ascending, keyed by TARGET, BEFORE parse) and then the
 * kind's `parse`. THE one content trust boundary.
 *
 * `args.container` is what the engine is ABOUT to treat this node as, and is
 * simply forwarded into `ParseCtx`. This function does not cross-check it
 * against `nodeType.container` — the caller computes it from the registry (for a
 * registered kind) or from the wire (for an unregistered one) and owns that
 * decision, so a check here would either be a tautology or a second opinion
 * that can disagree with the node actually built.
 */
/**
 * The two content dev checks, run together because they share a value and an
 * order: FREEZE FIRST, then round-trip. Freezing first is what makes the
 * round-trip safe — the extra `serialize` call it introduces is consumer code,
 * and a node type that normalises in place would otherwise mutate a value the
 * engine is about to store, making the graph differ between `devChecks: true`
 * and `false`. Frozen, that mutation throws into the try/catch and is reported.
 *
 * REPORTED, NEVER THROWN, and never converted into an `IngressError`. A node
 * that quarantines under `devChecks: true` and loads clean under `false` would
 * make the flag change what the document IS, which is the one thing a
 * diagnostic must not do.
 *
 * RE-ENTRY, and nothing structural prevents it: `reparse` MUST call the
 * node type's own `parse` directly. Routing the second parse back through
 * `parseNodeData` reaches this same gate and recurses without bound, once per
 * node, on every load.
 */
export function runContentDevChecks(
  devChecks: boolean,
  what: string,
  value: unknown,
  serializeValue: () => unknown,
  reparse: (raw: unknown) => Result<unknown, readonly Issue[]>,
  skipRoundTrip: boolean,
): void {
  // FIRST STATEMENT, before any allocation — the same discipline `auditIfDev`
  // follows in ./engine. Everything below is dev-only cost.
  if (!devChecks) return;

  deepFreezeBounded(value);
  if (skipRoundTrip) return;

  let wire: unknown;
  try {
    wire = serializeValue();
  } catch (thrown) {
    console.error(
      `graph dev check: ${what} threw while serializing during the round-trip audit. ` +
        `Nothing is stored differently; the audit is skipped for this value. ` +
        describeThrown(thrown),
    );
    return;
  }

  let again: Result<unknown, readonly Issue[]>;
  try {
    again = reparse(wire);
  } catch (thrown) {
    console.error(
      `graph dev check: ${what} threw while re-parsing its own serialize output. ` +
        describeThrown(thrown),
    );
    return;
  }
  if (!again.ok) {
    console.error(
      `graph dev check: ${what} produced serialize output its own parse refuses. ` +
        `Its serialize and its parse disagree — the value stored is the ORIGINAL parse, ` +
        `so nothing is corrupted, but this document will not survive a save/load cycle.`,
      again.error,
    );
    return;
  }

  const verdict = structurallyEqualBounded(value, again.value);
  // "unknown" is silence. A comparator that could not see the whole value has
  // not found a violation, and reporting one would train the reader to ignore
  // this message.
  if (verdict !== false) return;
  // WORDING MATTERS: a non-idempotent `parse` produces this too, and it is a
  // different bug from a lossy `serialize`. Say what was observed, print both
  // halves, and let the reader decide which.
  console.error(
    `graph dev check: ${what} did not survive a parse(serialize(d)) round trip. ` +
      `Either serialize drops something parse keeps, or parse is not idempotent. ` +
      `before=${describeValue(value)} after=${describeValue(again.value)}`,
  );
}

export function parseNodeData<S>(
  ctx: EngineContext<S>,
  args: Readonly<{
    nodeId: NodeId;
    kind: string;
    container: boolean;
    /** The version the document declares for this kind. */
    schemaVersion: number;
    raw: unknown;
    /**
     * DEV CHECKS ONLY. Set by the edit door, where `raw` is already this
     * node type's own `serialize` output rather than wire data. The generic
     * `parse(serialize(d))` comparison is provably vacuous there — it would
     * re-derive a value from the same bytes it just came from — and costs two
     * consumer node-type calls per edited node on the interactive path. The edit
     * door runs its own, stronger comparison instead.
     */
    rawIsSerializeOutput?: boolean;
  }>,
): Result<
  Readonly<{
    data: unknown;
    migratedFrom: number | null;
    warnings: readonly Issue[];
  }>,
  IngressError
> {
  const nodeType = ctx.registry.get(args.kind);
  if (nodeType === undefined) {
    return ingressError(args.nodeId, args.kind, "unknown-kind", [
      {
        path: "$.kind",
        message: `No node type is registered for kind ${quoteFromWire(args.kind)}`,
      },
    ]);
  }

  const migration = runMigrations(
    args.raw,
    args.schemaVersion,
    nodeType.schemaVersion,
    nodeType.migrations,
  );
  if (!migration.ok) {
    return ingressError(args.nodeId, args.kind, "parse-failed", [
      migration.error,
    ]);
  }

  const warnings: Issue[] = [];
  const parseCtx: ParseCtx = {
    nodeId: args.nodeId,
    container: args.container,
    schemaVersion: nodeType.schemaVersion,
    warn(issue: Issue): void {
      warnings.push(issue);
    },
  };

  // A node type is consumer code, and an ingress door that throws takes the whole
  // document down — the exact failure quarantine exists to prevent. A thrown
  // parse is reported as the refusal it evidently is.
  let parsed: Result<unknown, readonly Issue[]>;
  try {
    parsed = nodeType.parse(migration.value.data, parseCtx);
  } catch (thrown) {
    return ingressError(args.nodeId, args.kind, "parse-failed", [
      {
        path: "$",
        message: `parse threw: ${describeThrown(thrown)}`,
      },
    ]);
  }

  if (!parsed.ok) {
    return ingressError(args.nodeId, args.kind, "parse-failed", parsed.error);
  }

  // Captured, not re-read inside the closures: TypeScript loses the `parsed.ok`
  // narrowing across a callback boundary, and the ternary that works around it
  // reads as though the failure case were reachable here. It is not.
  const parsedValue: unknown = parsed.value;
  runContentDevChecks(
    ctx.devChecks,
    `the ${quoteFromWire(args.kind)} node type (node ${quoteFromWire(args.nodeId)})`,
    parsedValue,
    () => nodeType.serialize(parsedValue),
    // DIRECTLY, never through `parseNodeData` — see the re-entry note above.
    // The second parse gets a THROWAWAY warn sink: reusing `warnings` would
    // double the entries `LoadReport.warnings` receives, so the report itself
    // would differ between dev-check modes.
    (raw) =>
      nodeType.parse(raw, {
        nodeId: args.nodeId,
        container: args.container,
        schemaVersion: nodeType.schemaVersion,
        warn: () => undefined,
      }),
    args.rawIsSerializeOutput === true,
  );

  return {
    ok: true,
    value: {
      data: parsed.value,
      migratedFrom: migration.value.migratedFrom,
      warnings,
    },
  };
}

/**
 * Applies every migration whose TARGET version lies in `(from, to]`, in
 * ascending order.
 *
 * The keys are collected and sorted rather than counted up from `from + 1`:
 * version numbers are consumer-chosen and may be sparse (1, 2, 7) or large
 * (a date-shaped 20260101), and a counting loop over a large gap would hang
 * the load path on a document that is merely unusual.
 */
function runMigrations(
  raw: unknown,
  from: number,
  to: number,
  migrations: Readonly<Record<number, (raw: unknown) => unknown>> | undefined,
): Result<Readonly<{ data: unknown; migratedFrom: number | null }>, Issue> {
  // `from > to` means the document was written by a NEWER build than this one.
  // No migration can walk backwards, so nothing runs and the value goes
  // straight to `parse` — a node type that tolerates unknown additive fields reads
  // it fine, and one that does not quarantines the node loudly. Refusing here
  // instead would turn every rolling deploy into a document that will not open.
  if (migrations === undefined || from >= to) {
    return { ok: true, value: { data: raw, migratedFrom: null } };
  }

  const targets: number[] = [];
  for (const key of Object.keys(migrations)) {
    const target = Number(key);
    if (!Number.isFinite(target)) continue;
    if (target > from && target <= to) targets.push(target);
  }
  if (targets.length === 0) {
    return { ok: true, value: { data: raw, migratedFrom: null } };
  }
  targets.sort((a, b) => a - b);

  let data = raw;
  for (const target of targets) {
    const migrate = migrations[target];
    if (migrate === undefined) continue;
    try {
      data = migrate(data);
    } catch (thrown) {
      // Reported as a parse failure with an Issue at `$.schemaVersion` rather
      // than earning a third `QuarantineReason`: the consumer-visible fact is
      // "we could not build this node", and the Issue carries which step lost.
      return {
        ok: false,
        error: {
          path: "$.schemaVersion",
          message: `Migration to version ${target} threw: ${describeThrown(thrown)}`,
        },
      };
    }
  }

  return { ok: true, value: { data, migratedFrom: from } };
}
