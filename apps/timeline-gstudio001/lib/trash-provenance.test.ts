import { describe, expect, it } from "vitest";

import { formatTrashedAgo, trashRowCaption } from "./trash-provenance";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatTrashedAgo", () => {
  it("drops resolution as the age grows", () => {
    expect(formatTrashedAgo(ago(5 * SECOND), NOW)).toBe("just now");
    expect(formatTrashedAgo(ago(59 * SECOND), NOW)).toBe("just now");
    expect(formatTrashedAgo(ago(MINUTE), NOW)).toBe("1m ago");
    expect(formatTrashedAgo(ago(59 * MINUTE), NOW)).toBe("59m ago");
    expect(formatTrashedAgo(ago(HOUR), NOW)).toBe("1h ago");
    expect(formatTrashedAgo(ago(23 * HOUR), NOW)).toBe("23h ago");
    expect(formatTrashedAgo(ago(DAY), NOW)).toBe("1d ago");
    expect(formatTrashedAgo(ago(7 * DAY), NOW)).toBe("7d ago");
  });

  it("switches to a date past a week, rather than making the reader do arithmetic", () => {
    const old = formatTrashedAgo(ago(23 * DAY), NOW);
    expect(old).not.toMatch(/ago/);
    expect(old).toBeTruthy();
  });

  it("reads a FUTURE stamp as 'just now' instead of negative time", () => {
    // Clock skew between the client that wrote it and the one reading it is
    // ordinary; "-3m ago" is not.
    const future = new Date(NOW.getTime() + 3 * MINUTE).toISOString();
    expect(formatTrashedAgo(future, NOW)).toBe("just now");
  });

  it("degrades to null on absent or unparseable input rather than throwing", () => {
    expect(formatTrashedAgo(undefined, NOW)).toBeNull();
    expect(formatTrashedAgo("", NOW)).toBeNull();
    expect(formatTrashedAgo("not a date", NOW)).toBeNull();
  });
});

describe("trashRowCaption", () => {
  it("joins both halves, and prints the separator ONLY between two", () => {
    expect(trashRowCaption({ title: "Bank Heist" }, ago(2 * HOUR), NOW)).toBe(
      "from Bank Heist · 2h ago",
    );
    expect(trashRowCaption({ title: "Bank Heist" }, undefined, NOW)).toBe("from Bank Heist");
    expect(trashRowCaption(undefined, ago(2 * HOUR), NOW)).toBe("2h ago");
  });

  it("is null when neither half is known, so the row prints nothing", () => {
    // Clips trashed before provenance was recorded land here — the drawer must
    // show them normally, not with an empty caption line.
    expect(trashRowCaption(undefined, undefined, NOW)).toBeNull();
    expect(trashRowCaption({ title: "" }, undefined, NOW)).toBeNull();
  });
});
