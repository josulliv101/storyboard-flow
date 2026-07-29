import { describe, expect, it } from "vitest";

import { parseRangeHeader } from "./http-range";

const SIZE = 1000;

describe("parseRangeHeader", () => {
  it("reads an explicit first and last byte position, inclusive", () => {
    expect(parseRangeHeader("bytes=10-20", SIZE)).toEqual({
      type: "satisfiable",
      start: 10,
      end: 20,
    });
  });

  it("runs an open-ended range to the final byte", () => {
    expect(parseRangeHeader("bytes=0-", SIZE)).toEqual({
      type: "satisfiable",
      start: 0,
      end: 999,
    });
  });

  // The regression the old unanchored regex got backwards: it read the `500`
  // as an END position and served the FIRST 501 bytes.
  it("reads a suffix range as the LAST n bytes", () => {
    expect(parseRangeHeader("bytes=-500", SIZE)).toEqual({
      type: "satisfiable",
      start: 500,
      end: 999,
    });
  });

  it("clamps a suffix longer than the resource to the whole resource", () => {
    expect(parseRangeHeader("bytes=-5000", SIZE)).toEqual({
      type: "satisfiable",
      start: 0,
      end: 999,
    });
  });

  it("clamps a last position past the end to the final byte", () => {
    expect(parseRangeHeader("bytes=900-99999", SIZE)).toEqual({
      type: "satisfiable",
      start: 900,
      end: 999,
    });
  });

  it("serves the single final byte", () => {
    expect(parseRangeHeader("bytes=999-", SIZE)).toEqual({
      type: "satisfiable",
      start: 999,
      end: 999,
    });
  });

  it("tolerates whitespace and a capitalized unit", () => {
    expect(parseRangeHeader("  Bytes = 10-20 ", SIZE)).toEqual({
      type: "satisfiable",
      start: 10,
      end: 20,
    });
  });

  describe("unsatisfiable", () => {
    it("rejects a start at or past the end of the resource", () => {
      expect(parseRangeHeader("bytes=1000-", SIZE)).toEqual({ type: "unsatisfiable" });
      expect(parseRangeHeader("bytes=5000-6000", SIZE)).toEqual({ type: "unsatisfiable" });
    });

    it("rejects a last position before the first", () => {
      expect(parseRangeHeader("bytes=20-10", SIZE)).toEqual({ type: "unsatisfiable" });
    });

    it("rejects a zero-length suffix", () => {
      expect(parseRangeHeader("bytes=-0", SIZE)).toEqual({ type: "unsatisfiable" });
    });

    it("rejects any range against an empty resource", () => {
      expect(parseRangeHeader("bytes=0-", 0)).toEqual({ type: "unsatisfiable" });
      expect(parseRangeHeader("bytes=-500", 0)).toEqual({ type: "unsatisfiable" });
    });
  });

  describe("ignored — the caller serves the full body as 200", () => {
    it("ignores an absent header", () => {
      expect(parseRangeHeader(null, SIZE)).toEqual({ type: "ignore" });
    });

    // Valid per spec, but unimplemented. Answering 416 would claim the request
    // cannot be satisfied at all, which is false; ignoring it is allowed.
    it("ignores a multi-range request instead of serving only its first part", () => {
      expect(parseRangeHeader("bytes=0-1,5-6", SIZE)).toEqual({ type: "ignore" });
    });

    it("ignores a unit this server does not implement", () => {
      expect(parseRangeHeader("items=0-10", SIZE)).toEqual({ type: "ignore" });
    });

    it("ignores malformed specs", () => {
      expect(parseRangeHeader("bytes=abc", SIZE)).toEqual({ type: "ignore" });
      expect(parseRangeHeader("bytes=", SIZE)).toEqual({ type: "ignore" });
      expect(parseRangeHeader("bytes=-", SIZE)).toEqual({ type: "ignore" });
      expect(parseRangeHeader("bytes=1.5-2", SIZE)).toEqual({ type: "ignore" });
      expect(parseRangeHeader("bytes=-10-20", SIZE)).toEqual({ type: "ignore" });
    });
  });
});
