import { describe, expect, it } from "vitest";

import { createGraphTools } from "./tools";
import type { GraphToolContext } from "./tools";

// The in-page tool schemas are GENERATED from zod now, and they are what an
// agent reads before calling. Two things have to hold, and neither is obvious
// from the generator:
//
//   1. the generated JSON Schema still says what the hand-written one said —
//      same required keys, same bounds, still closed to unknown properties;
//   2. the semantics that were LOST in the hand-written copy are present.
//
// (2) is the reason this refactor happened. The in-page `trimInSeconds` read
// "Video only." while the remote one explained that it is seconds REMOVED from
// the start, not a timestamp. The constraints agreed, so nothing validated
// differently and no test could fail — the only symptom was an agent being told
// less than it needed. Asserting on description text is unusual; here the
// description IS the contract.

/** The tools only need a context to close over; no schema test calls execute. */
const ctx = {} as GraphToolContext;

function schemaFor(name: string): Record<string, unknown> {
  const tool = createGraphTools(ctx).find((t) => t.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool.inputSchema as Record<string, unknown>;
}

function props(name: string): Record<string, Record<string, unknown>> {
  return schemaFor(name).properties as Record<string, Record<string, unknown>>;
}

describe("generated in-page tool schemas", () => {
  it("keeps trim_clip's shape, bounds and closedness", () => {
    const schema = schemaFor("trim_clip");
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["nodeId"]);
    // An unknown key is far more likely a caller confusing two tools than a
    // forward-compatible extension — failing loudly beats ignoring it.
    expect(schema.additionalProperties).toBe(false);

    const p = props("trim_clip");
    expect(p.trimInSeconds).toMatchObject({ type: "number", minimum: 0 });
    expect(p.trimOutSeconds).toMatchObject({ type: "number", minimum: 0 });
    // `.positive()` must land as EXCLUSIVE — a zero-length image is not a clip.
    expect(p.durationSeconds).toMatchObject({ type: "number", exclusiveMinimum: 0 });
  });

  it("tells the agent trims are seconds REMOVED, not a start timestamp", () => {
    // The regression this refactor exists to prevent. "Video only." passes
    // every structural assertion above and still invites the wrong call.
    const p = props("trim_clip");
    expect(p.trimInSeconds.description).toMatch(/removed from the START/i);
    expect(p.trimOutSeconds.description).toMatch(/removed from the END/i);
  });

  it("keeps move_clip's placement fields, and its in-page-only `select`", () => {
    const schema = schemaFor("move_clip");
    expect(schema.required).toEqual(["nodeId"]);
    const p = props("move_clip");
    expect(Object.keys(p).sort()).toEqual(
      ["after", "before", "into", "nodeId", "position", "select"].sort(),
    );
    expect(p.position).toMatchObject({ enum: ["start", "end"] });
    // Selection is a viewport concept; the remote transport has none, so this
    // field must NOT leak into the shared definition.
    expect(p.select).toMatchObject({ type: "boolean" });
  });

  it("keeps rename_item requiring a non-empty name", () => {
    expect(schemaFor("rename_item").required).toEqual(["nodeId", "name"]);
    // Empty is not a name — it would silently unlabel the card.
    expect(props("rename_item").name).toMatchObject({ type: "string", minLength: 1 });
  });

  it("keeps remove_clip to just a nodeId", () => {
    expect(Object.keys(props("remove_clip"))).toEqual(["nodeId"]);
    expect(schemaFor("remove_clip").required).toEqual(["nodeId"]);
  });

  it("leaves read_timeline alone — it is NOT the same tool as the remote one", () => {
    // In-page it walks the live graph from the focused node; remote it serves
    // one stored document by id. Sharing a schema would force two different
    // operations into one shape, so `timelineId` must not appear here.
    const p = props("read_timeline");
    expect(Object.keys(p).sort()).toEqual(["collectionId", "depth"]);
    expect(p.timelineId).toBeUndefined();
  });
});
