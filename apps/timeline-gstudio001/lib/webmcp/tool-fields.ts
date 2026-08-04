import { z } from "zod";

// ONE definition of the fields both MCP transports accept.
//
// The same edit tools are exposed twice — as in-page WebMCP tools against the
// live CollectionsStore (`lib/webmcp/tools.ts`) and as remote MCP tools against
// Firestore (`app/api/mcp/route.ts`). Their schemas were written independently,
// and the halves diverged in the way that matters least visibly and most:
//
//   trimInSeconds, in-page : "Video only."
//   trimInSeconds, remote  : "Video only: seconds removed from the START.
//                             0 keeps the opening."
//
// The CONSTRAINTS agreed (`minimum: 0` both sides), so nothing validated
// differently and no test could have caught it. But for a tool an LLM calls,
// the description IS the contract: "Video only." never says that trimInSeconds
// is seconds REMOVED rather than a start timestamp, so the in-page tool invited
// exactly the wrong call. That is the cost of two definitions, and it is why
// these live in one place now.
//
// WHAT IS NOT SHARED, deliberately:
//   - `timelineId` — remote only. There is no "focused" timeline without a
//     browser, so every server-side call must name its root. In-page, the focus
//     IS the context.
//   - `select` — in-page only. Selection is a UI concept; the remote transport
//     has no viewport to reveal anything in.
//   - `read_timeline` — not the same tool on both sides. In-page it walks the
//     live graph from the focused node (`collectionId`, `depth`); remote it
//     serves one stored document (`timelineId`). Sharing a schema there would
//     be forcing two different operations into one shape.
//
// The remote wording won wherever the two disagreed: it was written later,
// against real agent use, and it is the one that explains the semantics.

/** The node an edit acts on. */
export const nodeIdField = z.string().min(1).describe("The clip or collection to act on.");

/**
 * Where a moved node lands. Callers give at MOST one of these — the mutual
 * exclusion is a runtime check in `resolveMovePlacement`, not a schema union,
 * so that a caller sending two gets a sentence explaining the conflict rather
 * than a schema rejection it cannot read.
 */
export const placementFields = {
  after: z.string().optional().describe("Place directly after this sibling."),
  before: z.string().optional().describe("Place directly before this sibling."),
  position: z.enum(["start", "end"]).optional().describe("Place at the start or end."),
} as const;

/** The collection a node moves into. Omit to reorder where it already is. */
export const intoField = z
  .string()
  .optional()
  .describe("Target collection id. Omit to reorder within the current parent.");

/**
 * How much of a clip plays. Videos trim from each end; images just hold.
 *
 * The "seconds REMOVED" wording is load-bearing — an untrimmed clip is 0/0, not
 * 0/duration — and it is the exact thing the in-page copy had lost.
 */
export const trimFields = {
  trimInSeconds: z
    .number()
    .min(0)
    .optional()
    .describe("Video only: seconds removed from the START. 0 keeps the opening."),
  trimOutSeconds: z
    .number()
    .min(0)
    .optional()
    .describe("Video only: seconds removed from the END. 0 keeps the ending."),
  durationSeconds: z
    .number()
    .positive()
    .optional()
    .describe("Image only: how long it stays on screen."),
} as const;

/** A user-facing name. Empty is not a name — it would silently unlabel a card. */
export const nameField = z.string().min(1).describe("The new name.");

/**
 * The in-page transport wants JSON Schema, the remote one wants zod. This is
 * the one-way door between them.
 *
 * `additionalProperties: false` (via `.strict()`) is preserved from the
 * hand-written schemas: an unknown key is far more likely a caller confusing
 * two tools than a forward-compatible extension, and failing loudly beats
 * silently ignoring the argument someone meant to pass.
 */
export function jsonSchemaFor(shape: z.ZodRawShape): unknown {
  return z.toJSONSchema(z.object(shape).strict());
}
