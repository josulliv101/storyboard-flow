import { describe, expect, it } from "vitest";

import { daysUntilDeletion, deletionWindowLabel } from "./asset-deletion-window";

const NOW = Date.UTC(2026, 6, 29, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe("daysUntilDeletion", () => {
  it("rounds UP, so a partial day still counts", () => {
    // 19.5 days left is honestly "20", never "19": the deadline is when
    // deletion becomes allowed, and the file is safe until then.
    expect(daysUntilDeletion(NOW + 19.5 * DAY, NOW)).toBe(20);
    expect(daysUntilDeletion(NOW + 0.1 * DAY, NOW)).toBe(1);
  });

  it("is exact on whole days", () => {
    expect(daysUntilDeletion(NOW + 30 * DAY, NOW)).toBe(30);
    expect(daysUntilDeletion(NOW + DAY, NOW)).toBe(1);
  });

  it("floors at zero for a deadline already passed", () => {
    // A due tombstone waits for the next sweep; it must never read as a
    // negative countdown.
    expect(daysUntilDeletion(NOW, NOW)).toBe(0);
    expect(daysUntilDeletion(NOW - 5 * DAY, NOW)).toBe(0);
  });
});

describe("deletionWindowLabel", () => {
  it("counts down in days, singular at one", () => {
    expect(deletionWindowLabel(NOW + 30 * DAY, NOW)).toBe("Deletes in 30 days");
    expect(deletionWindowLabel(NOW + 2 * DAY, NOW)).toBe("Deletes in 2 days");
    expect(deletionWindowLabel(NOW + DAY, NOW)).toBe("Deletes in 1 day");
  });

  it("does not say '0 days' when the window has run out", () => {
    // Deletion happens on the sweep's schedule, and is still refused if the
    // asset came back into use — so the words must be neither a countdown nor
    // an obituary.
    expect(deletionWindowLabel(NOW - DAY, NOW)).toBe("Deletes any time now");
  });
});
