import { describe, expect, it } from "vitest";
import { waitBeforeCalls } from "../src/data/mark-refresh";

const NOW = Date.parse("2026-11-04T02:17:00Z");

describe("waitBeforeCalls", () => {
  it("waits until the time the database gives", () => {
    expect(waitBeforeCalls("2026-11-04T02:20:00+00:00", NOW)).toBe(
      3 * 60 * 1000,
    );
  });
  it("doesn't wait for a time already past, or for a bad answer", () => {
    expect(waitBeforeCalls("2026-11-04T02:00:00+00:00", NOW)).toBe(0);
    expect(waitBeforeCalls(null, NOW)).toBe(0);
    expect(waitBeforeCalls("soon", NOW)).toBe(0);
  });
  it("waits 15 minutes at most", () => {
    expect(waitBeforeCalls("2026-11-04T05:00:00+00:00", NOW)).toBe(
      15 * 60 * 1000,
    );
  });
});
