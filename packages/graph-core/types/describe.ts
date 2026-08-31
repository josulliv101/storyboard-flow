// Graph — part of the former single-file `types.ts`; see ./index.ts.

// ---------------------------------------------------------------------------
// Describing a throw
// ---------------------------------------------------------------------------

/**
 * The message to put in an `Issue` when consumer code threw instead of
 * returning.
 *
 * It lives HERE, in the module that imports nothing, because all four modules
 * that call into consumer code need it — ./serialize wraps `parse` and the
 * summary type, ./commands wraps `applyEdit` and `serialize`, ./patches wraps
 * the `serialize` pair that replay verification compares on. One
 * implementation, so the three cannot drift into describing the same throw
 * three different ways.
 *
 * NOT re-exported from ./index: a consumer never calls this, it only ever reads
 * the strings it produces.
 *
 * `String(thrown)` rather than `JSON.stringify`: a thrown value is arbitrary,
 * `stringify` is recursive and can itself throw on a cycle or a BigInt, and a
 * helper whose whole job is to describe a failure must not have a failure mode
 * of its own.
 */
/**
 * `describeThrown`'s sibling, for an untrusted VALUE rather than a thrown one.
 *
 * `JSON.parse` is ITERATIVE in V8 and `JSON.stringify` is RECURSIVE, so a
 * payload that parsed perfectly well can still blow the stack while the engine
 * composes the refusal that rejects it — a throw out of a function whose whole
 * contract is a `Result`. It does not take an exotic input: ~6,000 levels is a
 * 12 KB request body, and the failure lands on the trust boundary where every
 * hostile document arrives.
 *
 * Also CLAMPED, which is a second and smaller problem the same edit closes: an
 * unclamped describer echoes a 5 MB string straight into a message a consumer
 * will log.
 *
 * NOT re-exported from ./index — a consumer reads the strings it produces and
 * never calls it.
 */
export function describeValue(value: unknown): string {
  if (value === null) return "null";
  // Primitives cannot nest, so they need no walk. `String` is safe on a symbol
  // where a template literal is not, and a function's source can be long, so
  // everything here still goes through the same clamp.
  if (typeof value !== "object" && typeof value !== "string") {
    return clamp(String(value));
  }
  try {
    const text = JSON.stringify(value);
    // `stringify` answers `undefined` for a function or a bare symbol.
    if (text === undefined) return typeof value;
    return clamp(text);
  } catch {
    // Stack exhaustion, or a cycle. Either way the shape is all that can be
    // said safely, and the stack is fully usable again once the frame unwinds.
    return Array.isArray(value) ? "[deeply nested array]" : "[deeply nested object]";
  }
}

const DESCRIBE_LIMIT = 120;

function clamp(text: string): string {
  return text.length > DESCRIBE_LIMIT
    ? `${text.slice(0, DESCRIBE_LIMIT - 3)}...`
    : text;
}

/**
 * Quote a string that came OFF THE WIRE, for a refusal message.
 *
 * `JSON.stringify(node.id)` was the pattern at every ingress refusal, and a
 * `NodeId` is any string except whitespace-only — including one the sender chose
 * the length of. Measured before this existed: a 1 MB id in a `dangling-child`
 * payload produced a 1,000,049-character `error.message`, which the consumer
 * then puts in a log line, a toast, or an error report.
 *
 * CLAMPS BEFORE IT QUOTES, not after. Quoting first would allocate the full
 * megabyte and escape every character of it before throwing the result away,
 * which is most of the cost the bound is for.
 *
 * For ids and kinds specifically — `describeValue` is the one for arbitrary
 * consumer VALUES, and this one keeps the plain `"..."` shape a reader expects
 * around a name.
 */
export function quoteFromWire(value: string): string {
  return JSON.stringify(clamp(value));
}

export function describeThrown(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message;
  return String(thrown);
}
