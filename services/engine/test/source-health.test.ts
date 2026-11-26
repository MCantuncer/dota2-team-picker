import { describe, expect, it } from "vitest";
import { brokenSources, issueBody, record, type SourceHealth } from "../src/data/source-health";

const at = (iso: string) => new Date(iso);

describe("source health", () => {
  it("keeps when a failing spell started, and forgets it once the source works", () => {
    const health: SourceHealth = {};
    record(health, "STRATZ matchups", "fail", at("2026-11-25T02:00:00Z"), "HTTP 502");
    record(health, "STRATZ matchups", "fail", at("2026-11-25T08:00:00Z"), "HTTP 503");
    expect(health["STRATZ matchups"]).toEqual({ state: "fail", at: "2026-11-25T08:00:00.000Z", since: "2026-11-25T02:00:00.000Z", note: "HTTP 503" });
    record(health, "STRATZ matchups", "ok", at("2026-11-25T14:00:00Z"));
    expect(health["STRATZ matchups"]).toEqual({ state: "ok", at: "2026-11-25T14:00:00.000Z" });
  });

  it("starts a new spell when a source goes from lagging to failing", () => {
    const health: SourceHealth = {};
    record(health, "STRATZ patch list", "lag", at("2026-11-19T02:00:00Z"));
    record(health, "STRATZ patch list", "fail", at("2026-11-20T02:00:00Z"), "x");
    expect(health["STRATZ patch list"]?.since).toBe("2026-11-20T02:00:00.000Z");
  });

  it("calls a source broken after 2 days of failing, never a lagging one", () => {
    const health: SourceHealth = {
      a: { state: "fail", at: "2026-11-27T00:00:00Z", since: "2026-11-24T00:00:00Z", note: "HTTP 500" },
      b: { state: "fail", at: "2026-11-27T00:00:00Z", since: "2026-11-26T00:00:00Z" },
      c: { state: "lag", at: "2026-11-27T00:00:00Z", since: "2026-11-19T00:00:00Z" },
      d: { state: "ok", at: "2026-11-27T00:00:00Z" },
    };
    const now = at("2026-11-27T00:00:00Z");
    const broken = brokenSources(health, now);
    expect(broken.map(([n]) => n)).toEqual(["a"]);
    expect(issueBody(broken, now)).toContain("**a**: failing for 3 days, since 2026-11-24T00:00:00Z. Last error: HTTP 500");
    expect(brokenSources(undefined, now)).toEqual([]);
  });
});
