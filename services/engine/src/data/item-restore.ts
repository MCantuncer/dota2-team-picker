/**
 * Brings back the last whole STRATZ item data when the snapshot's is broken. A download that is not whole
 * is refused (see WHOLE_SHARE), but one already in the snapshot stays until a whole one replaces it: the
 * broken answer of 2026-11-21 went in before the check existed, and STRATZ may stay broken for days. The
 * daily copies in the bucket hold every earlier download.
 */
import type { Snapshot } from "../engine/types";
import { startsCoverage, startsWhole } from "./item-starts";
import { timingsCoverage, timingsWhole } from "./item-timings";

/** Daily copies to look back through, newest first. */
export const RESTORE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Puts the newest whole item timings and start items from the daily copies into `snapshot`, each only when
 * the snapshot's own are not whole. Whole is judged on today's positions, so a copy counts for the heroes
 * asked for now. Returns one line per restored part, for the log; empty when nothing was needed or found.
 */
export async function restoreItemData(snapshot: Snapshot, now: Date, load: (path: string) => Promise<Snapshot | null>): Promise<string[]> {
  let needTimings = !timingsWhole(snapshot);
  let needStarts = !startsWhole(snapshot);
  const lines: string[] = [];
  for (let day = 0; day <= RESTORE_DAYS && (needTimings || needStarts); day++) {
    const path = `daily/${new Date(now.getTime() - day * DAY_MS).toISOString().slice(0, 10)}.json`;
    let copy: Snapshot | null;
    try {
      copy = await load(path);
    } catch (err) {
      console.warn(`::warning::${(err as Error).message}`);
      continue;
    }
    if (!copy) continue;
    const timings = { positions: snapshot.positions, itemTimings: copy.itemTimings };
    if (needTimings && copy.itemTimings && timingsWhole(timings)) {
      const { usable, asked } = timingsCoverage(timings);
      snapshot.itemTimings = copy.itemTimings;
      // The copy's own date, so the timings stay due and the next run asks STRATZ again.
      snapshot.itemTimingsAt = copy.itemTimingsAt ?? copy.generatedAt;
      lines.push(`item timings from ${path} (${snapshot.itemTimingsAt}, ${usable} of ${asked} hero positions)`);
      needTimings = false;
    }
    const starts = { positions: snapshot.positions, itemStarts: copy.itemStarts };
    if (needStarts && copy.itemStarts && startsWhole(starts)) {
      const { usable, asked } = startsCoverage(starts);
      snapshot.itemStarts = copy.itemStarts;
      lines.push(`start items from ${path} (${usable} of ${asked} hero positions)`);
      needStarts = false;
    }
  }
  return lines;
}
