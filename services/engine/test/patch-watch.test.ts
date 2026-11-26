import { describe, expect, it } from "vitest";
import {
  compareVersions,
  newestRelease,
  patchNoteReleases,
  valveReleases,
  VALVE_PATCHES_URL,
  watchRelease,
  type SavedRelease,
} from "../src/data/patch-watch";

const PATCH = { name: "7.42", startedAt: "2026-11-18T21:28:00.000Z" };
const NOW = new Date("2026-11-26T12:00:00.000Z");
const t = (iso: string) => Date.parse(iso) / 1000;

// Valve's list, as dota2.com/patches reads it.
const VALVE = {
  success: true,
  patches: [
    { patch_number: "7.41f", patch_name: "7.41f", patch_timestamp: t("2026-10-30T20:00:00Z") },
    { patch_number: "7.42", patch_name: "7.42", patch_timestamp: t("2026-11-18T21:28:00Z") },
    { patch_number: "7.42a", patch_name: "7.42a", patch_timestamp: t("2026-11-24T23:40:00Z") },
  ],
};

const NOTES = `"patch"
{
  "DOTA_Patch_7_41f_General_1"  "..."
  "DOTA_Patch_7_42_Abaddon_1"   "..."
  "DOTA_Patch_7_42a_Abaddon_1"  "..."
  "DOTA_Patch_7_42a_Dazzle_2"   "..."
}`;

describe("versions", () => {
  it("orders big and letter patches", () => {
    expect(compareVersions("7.42a", "7.42")).toBeGreaterThan(0);
    expect(compareVersions("7.42", "7.41f")).toBeGreaterThan(0);
    expect(compareVersions("7.42b", "7.42a")).toBeGreaterThan(0);
    expect(compareVersions("7.100", "7.99")).toBeGreaterThan(0);
    expect(compareVersions("7.42", "7.42")).toBe(0);
  });
});

describe("reading the release lists", () => {
  it("reads Valve's list with each release's time", () => {
    expect(valveReleases(VALVE).at(-1)).toEqual({ name: "7.42a", startedAt: "2026-11-24T23:40:00.000Z" });
    expect(() => valveReleases({ error: "x" })).toThrow("no patches");
    expect(() => valveReleases({ patches: [{ patch_name: "7.42" }] })).toThrow("no release with a time");
  });

  it("reads the releases named in the game files' patch notes", () => {
    expect(patchNoteReleases(NOTES).sort()).toEqual(["7.41f", "7.42", "7.42a"]);
  });
});

describe("newest release", () => {
  const valve = valveReleases(VALVE);

  it("takes Valve's newest release of this patch with its time", () => {
    expect(newestRelease(PATCH, undefined, valve, null, NOW)).toEqual({ name: "7.42a", startedAt: "2026-11-24T23:40:00.000Z", from: "valve" });
  });

  it("is the big patch itself before any letter patch", () => {
    const early = valve.filter((r) => r.name !== "7.42a");
    expect(newestRelease(PATCH, undefined, early, null, NOW)).toEqual({ ...PATCH, from: "valve" });
  });

  it("notices a big patch Valve lists before OpenDota", () => {
    const next = [...valve, { name: "7.43", startedAt: "2026-12-20T20:00:00.000Z" }];
    expect(newestRelease(PATCH, undefined, next, null, NOW).name).toBe("7.43");
  });

  it("ignores an older patch's letters once a new big patch is out", () => {
    const patch = { name: "7.43", startedAt: "2026-12-20T20:00:00.000Z" };
    const saved: SavedRelease = { name: "7.42a", startedAt: "2026-11-24T23:40:00.000Z", from: "valve" };
    expect(newestRelease(patch, saved, null, ["7.42", "7.42a", "7.43"], NOW)).toEqual({ ...patch, from: "game-files" });
  });

  it("starts a release found only in the game files when it was first seen, and keeps that time", () => {
    const first = newestRelease(PATCH, undefined, null, patchNoteReleases(NOTES), NOW);
    expect(first).toEqual({ name: "7.42a", startedAt: NOW.toISOString(), from: "game-files" });
    const later = new Date("2026-11-27T00:00:00.000Z");
    expect(newestRelease(PATCH, first, null, patchNoteReleases(NOTES), later)).toEqual(first);
  });

  it("keeps Valve's time when only the game files can be read later", () => {
    const saved: SavedRelease = { name: "7.42a", startedAt: "2026-11-24T23:40:00.000Z", from: "valve" };
    expect(newestRelease(PATCH, saved, null, ["7.42", "7.42a"], NOW)).toEqual(saved);
  });

  it("keeps the last release when nothing can be read", () => {
    const saved: SavedRelease = { name: "7.42a", startedAt: "2026-11-24T23:40:00.000Z", from: "valve" };
    expect(newestRelease(PATCH, saved, null, null, NOW)).toEqual(saved);
  });
});

describe("watching", () => {
  const fail = async (): Promise<never> => {
    throw new Error("HTTP 403");
  };

  it("reads Valve's list first", async () => {
    const getJson = async (url: string) => (url === VALVE_PATCHES_URL ? VALVE : null);
    const out = await watchRelease(PATCH, undefined, getJson, fail, NOW);
    expect(out.release.name).toBe("7.42a");
    expect(out.notes).toEqual([]);
  });

  it("falls back to the game files and says so", async () => {
    const out = await watchRelease(PATCH, undefined, fail, async () => NOTES, NOW);
    expect(out.release).toEqual({ name: "7.42a", startedAt: NOW.toISOString(), from: "game-files" });
    expect(out.notes[0]).toContain("Valve's patch list failed");
  });

  it("throws only when nothing can be read and nothing was saved", async () => {
    await expect(watchRelease(PATCH, undefined, fail, fail, NOW)).rejects.toThrow("HTTP 403");
    const saved: SavedRelease = { name: "7.42a", startedAt: "2026-11-24T23:40:00.000Z", from: "valve" };
    expect((await watchRelease(PATCH, saved, fail, fail, NOW)).release).toEqual(saved);
  });
});
