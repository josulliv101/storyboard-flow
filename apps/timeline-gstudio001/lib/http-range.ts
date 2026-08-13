// Pure HTTP Range parsing (RFC 7233 §2.1/§3.1) — no Firebase, no request
// object, so every branch is unit-testable in isolation. The media route is
// the only caller.

export type ParsedRange =
  /** A byte range the caller should serve as 206. `end` is INCLUSIVE. */
  | { readonly type: "satisfiable"; readonly start: number; readonly end: number }
  /** Well-formed but outside the resource — the caller must answer 416. */
  | { readonly type: "unsatisfiable" }
  /**
   * No range, malformed, or a form this server does not implement (multiple
   * ranges). The caller serves the FULL representation as 200, which is always
   * allowed: "A server MAY ignore the Range header field" (RFC 7233 §3.1).
   * 416 would be wrong here — a multi-range request is perfectly satisfiable,
   * just not by us, and 416 means "cannot be satisfied at all".
   */
  | { readonly type: "ignore" };

const IGNORE: ParsedRange = { type: "ignore" };
const UNSATISFIABLE: ParsedRange = { type: "unsatisfiable" };

/**
 * Parse a single `bytes=` range against a known resource size.
 *
 * The three forms, all of which were previously collapsed into one unanchored
 * regex that read `bytes=-500` as "the first 501 bytes" instead of "the last
 * 500":
 *
 * - `bytes=10-20` — explicit first and last byte position.
 * - `bytes=10-`   — from 10 to the end of the resource.
 * - `bytes=-500`  — SUFFIX: the final 500 bytes, not a start position.
 */
export function parseRangeHeader(header: string | null, size: number): ParsedRange {
  if (!header) return IGNORE;

  // The unit is case-insensitive; anything other than `bytes` must be ignored.
  const match = /^\s*bytes\s*=\s*(.*)$/i.exec(header);
  if (!match) return IGNORE;

  // The capture group is part of the pattern that just matched, so it is
  // present; IGNORE is the same answer the non-matching branch above gives.
  const spec = match[1]?.trim();
  if (spec === undefined) return IGNORE;
  // Multiple ranges (`bytes=0-1,5-6`) are valid but unimplemented — serve the
  // whole body rather than pretending the first part was the whole request,
  // which is what the old unanchored regex silently did.
  if (spec.includes(",")) return IGNORE;

  const parts = /^(\d*)-(\d*)$/.exec(spec);
  if (!parts) return IGNORE;

  const [, firstPos, lastPos] = parts;
  // `bytes=-` carries no positions at all: malformed, not a suffix of length 0.
  if (firstPos === "" && lastPos === "") return IGNORE;

  // A zero-length resource cannot satisfy any byte range.
  if (size <= 0) return UNSATISFIABLE;

  if (firstPos === "") {
    // Suffix form. `bytes=-0` asks for the last zero bytes — unsatisfiable.
    const suffixLength = Number(lastPos);
    if (suffixLength <= 0) return UNSATISFIABLE;
    return {
      type: "satisfiable",
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }

  const start = Number(firstPos);
  if (start >= size) return UNSATISFIABLE;

  // An absent or past-the-end last position is clamped to the final byte, so
  // `bytes=0-` and an over-long `bytes=0-99999` both mean "to the end".
  const end = lastPos === "" ? size - 1 : Math.min(Number(lastPos), size - 1);
  if (end < start) return UNSATISFIABLE;

  return { type: "satisfiable", start, end };
}
