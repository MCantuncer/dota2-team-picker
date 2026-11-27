/**
 * Finds the game's newest release, letter patches included. OpenDota's patch list only has the big patches (7.42, not
 * 7.42a), so the counts reset on those alone; this tells the rest of the refresh when the newest release came out.
 *
 * - First choice: Valve's own patch list, the one dota2.com/patches reads, with each release's day. Valve stamps a
 *   release with midnight Pacific of its day (7.42a: 08:00 UTC on Nov 24, while it came out at 23:40 UTC), so a
 *   release stamped that way starts at the end of its day: the counts then miss a few hours of its games rather than
 *   mix in a day of the release before.
 * - When Valve's list can't be read: the game files' patch notes, which hold every release's notes
 *   ("DOTA_Patch_7_42a_..."). They have no times, so a release first seen this way starts when it was first seen;
 *   the refresh runs twice a day, so that is at most about 12 hours late.
 */

import { GAME_FILES_URL } from "./talent-texts";

/** Valve's patch list, newest last. */
export const VALVE_PATCHES_URL = "https://www.dota2.com/datafeed/patchnoteslist?language=english";
export const PATCH_NOTES_FILE = "resource/localization/patchnotes/patchnotes_english.txt";

/** A release and when it came out. */
export interface Release {
  name: string;
  startedAt: string;
}

/** The newest release, where it came from, as the snapshot keeps it. */
export interface SavedRelease extends Release {
  from: "valve" | "game-files";
}

/** "7.42a" as [7, 42, 1], "7.42" as [7, 42, 0]. Null when it isn't a version. */
export function versionOf(name: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)([a-z]?)$/.exec(name.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), m[3] ? m[3].charCodeAt(0) - 96 : 0];
}

/** Below zero when a is older than b. Names that aren't versions sort first. */
export function compareVersions(a: string, b: string): number {
  const va = versionOf(a);
  const vb = versionOf(b);
  if (!va || !vb) return (va ? 1 : 0) - (vb ? 1 : 0);
  return va[0] - vb[0] || va[1] - vb[1] || va[2] - vb[2];
}

const PACIFIC = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const DAY_MS = 86_400_000;

/**
 * When a release of Valve's list can be counted from: its time, or the end of its day when the time is only the
 * day (midnight Pacific).
 */
export function valveStart(ms: number): number {
  return PACIFIC.format(new Date(ms)) === "00:00:00" ? ms + DAY_MS : ms;
}

/** The releases in Valve's patch list. Throws when it isn't the list. */
export function valveReleases(body: unknown): Release[] {
  const rows = (body as { patches?: unknown })?.patches;
  if (!Array.isArray(rows)) throw new Error("Valve's patch list has no patches");
  const out: Release[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const name = typeof row?.patch_name === "string" ? row.patch_name : row?.patch_number;
    const time = Number(row?.patch_timestamp);
    if (typeof name !== "string" || !versionOf(name) || !Number.isFinite(time) || time <= 0) continue;
    out.push({ name, startedAt: new Date(valveStart(time * 1000)).toISOString() });
  }
  if (!out.length) throw new Error("Valve's patch list has no release with a time");
  return out;
}

/** Every release named in the game files' patch notes. */
export function patchNoteReleases(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/"DOTA_Patch_(\d+)_(\d+)([a-z]?)_/g)) names.add(`${m[1]}.${m[2]}${m[3]}`);
  return [...names];
}

const newest = (names: string[]) => names.reduce<string | null>((a, b) => (a === null || compareVersions(b, a) > 0 ? b : a), null);

/**
 * The newest release of the patch the counts are on (OpenDota's), or of a newer one OpenDota doesn't list yet. Older
 * patches' releases are left out: their notes stay in the game files.
 */
export function newestRelease(
  patch: Release,
  saved: SavedRelease | undefined,
  valve: Release[] | null,
  gameFiles: string[] | null,
  now: Date,
): SavedRelease {
  const current = (name: string) => compareVersions(name, patch.name) >= 0;
  if (valve) {
    const found = valve.filter((r) => current(r.name));
    const name = newest(found.map((r) => r.name));
    const release = found.find((r) => r.name === name);
    if (release) {
      // A letter patch can't start before its big patch.
      const startedAt = Date.parse(release.startedAt) < Date.parse(patch.startedAt) ? patch.startedAt : release.startedAt;
      return { name: release.name, startedAt, from: "valve" };
    }
  }
  const name = gameFiles ? newest(gameFiles.filter(current)) : null;
  if (name && compareVersions(name, patch.name) > 0) {
    // Seen before: keep the time it was first seen (or Valve's, from an earlier run).
    if (saved?.name === name) return saved;
    return { name, startedAt: now.toISOString(), from: "game-files" };
  }
  // Nothing newer than the big patch, or nothing read: the big patch itself, unless the last run knew better.
  if (saved && current(saved.name) && !(valve || gameFiles)) return saved;
  return { name: patch.name, startedAt: patch.startedAt, from: valve ? "valve" : "game-files" };
}

type GetJson = (url: string) => Promise<unknown>;
type GetText = (url: string) => Promise<string>;

/**
 * Reads both lists (each one may fail) and returns the newest release with notes for the log. Throws only when
 * neither can be read and nothing was saved.
 */
export async function watchRelease(
  patch: Release,
  saved: SavedRelease | undefined,
  getJson: GetJson,
  getText: GetText,
  now: Date,
): Promise<{ release: SavedRelease; notes: string[] }> {
  const notes: string[] = [];
  let valve: Release[] | null = null;
  try {
    valve = valveReleases(await getJson(VALVE_PATCHES_URL));
  } catch (err) {
    notes.push(`Valve's patch list failed, reading the game files instead: ${(err as Error).message}`);
  }
  let gameFiles: string[] | null = null;
  if (!valve) {
    try {
      gameFiles = patchNoteReleases(await getText(`${GAME_FILES_URL}${PATCH_NOTES_FILE}`));
      if (!gameFiles.length) throw new Error("no release named in the patch notes");
    } catch (err) {
      gameFiles = null;
      notes.push(`The game files' patch notes failed too: ${(err as Error).message}`);
    }
  }
  if (!valve && !gameFiles && !saved) throw new Error(notes.join(" "));
  return { release: newestRelease(patch, saved, valve, gameFiles, now), notes };
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export const getJson: GetJson = async (url) => (await fetchOk(url)).json();
export const getText: GetText = async (url) => (await fetchOk(url)).text();
