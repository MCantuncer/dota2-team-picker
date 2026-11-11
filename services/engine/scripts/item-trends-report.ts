/**
 * Items players buy more or less often lately, for every hero and position (item-trends.ts). Compares the
 * daily snapshot copy of today with the copy DAYS days before (7 or more, so the two STRATZ weeks differ):
 *
 *   DAYS=7 npm run item-trends-report
 *
 * Or run the "Item reports" workflow with item-trends-report. Reads the public daily copies only. Purchase
 * counts are in the snapshot from 2026-11-11, so the first comparison is possible about a week later.
 */
import { itemTrends, MIN_CHANGE, type Timings, TREND_CHANCE, TREND_Z } from "../src/engine/item-trends";
import type { Snapshot } from "../src/engine/types";

const BASE = "https://odigcdwsvajkbvcxeskj.supabase.co/storage/v1/object/public/hero-data";
const DAY_MS = 24 * 60 * 60 * 1000;
/** STRATZ's item counts restart weekly; copies closer than this can hold the same week. */
const WEEK_DAYS = 7;
/** A missing day (no refresh ran) falls back to an earlier day, this many times. */
const DAYS_BACK = 3;

/** The daily copy of `date`, or of the closest day before it within DAYS_BACK days. */
async function dailyCopy(date: Date): Promise<Snapshot | undefined> {
  for (let back = 0; back <= DAYS_BACK; back++) {
    const day = new Date(date.getTime() - back * DAY_MS).toISOString().slice(0, 10);
    const res = await fetch(`${BASE}/daily/${day}.json`);
    // Storage answers a missing public file with 400 and a not_found body.
    if (res.status === 404 || (res.status === 400 && (await res.text()).includes("not_found"))) continue;
    if (!res.ok) throw new Error(`Downloading daily/${day}.json failed: HTTP ${res.status}`);
    // The daily copies are snapshots written by upload-data.
    return (await res.json()) as Snapshot;
  }
  return undefined;
}

async function main() {
  const days = Number(process.env.DAYS || WEEK_DAYS);
  if (!Number.isSafeInteger(days) || days < WEEK_DAYS) throw new Error(`DAYS must be ${WEEK_DAYS} or more`);
  const newer = await dailyCopy(new Date());
  const newerAt = newer?.itemTimingsAt;
  if (!newer || !newerAt) {
    console.log("No recent daily copy with item timings.");
    return;
  }
  // From the day the newer copy's item data was fetched, so a carried-over fetch doesn't shrink the gap.
  const older = await dailyCopy(new Date(Date.parse(newerAt) - days * DAY_MS));
  const olderAt = older?.itemTimingsAt;
  if (!older || !olderAt) {
    console.log(`No daily copy with item timings from about ${days} days before ${newerAt}.`);
    return;
  }
  if (Date.parse(newerAt) - Date.parse(olderAt) < (WEEK_DAYS - 1) * DAY_MS) {
    console.log(`The copies' item data (${olderAt}, ${newerAt}) may be the same STRATZ week; not comparing.`);
    return;
  }
  // itemTimings is keyed by hero id, then position, then slice key; Timings reads it with string keys.
  const timings = (s: Snapshot) => (s.itemTimings ?? {}) as unknown as Timings;
  const result = itemTrends(timings(older), timings(newer));
  const items = newer.items ?? {};
  const name = (id: number) => items[String(id)]?.name ?? `item ${id}`;
  const heroName = (id: number) => newer.heroes[id]?.name ?? `hero ${id}`;
  console.log(
    `Item data of ${olderAt} against ${newerAt}: ${result.compared} heroes and positions compared, ` +
      `${result.tooFew} with too few games, ${result.noCounts} without purchase counts in one copy.`,
  );
  console.log(
    `${result.trends.length} items moved by ${MIN_CHANGE * 100} points or more past z ${TREND_Z}, ` +
      `from ${result.checks} checks (about ${(result.checks * TREND_CHANCE).toFixed(1)} expected by chance)`,
  );
  const pct = (c: { bought: number; games: number; atMost?: true }) =>
    `${c.atMost ? "under " : ""}${Math.round((c.bought / c.games) * 100)}% of ${c.games} games`;
  for (const t of result.trends) {
    console.log(`  ${heroName(t.hero)} pos ${t.position}: ${name(t.item)} ${pct(t.older)}, now ${pct(t.newer)} (z ${t.z.toFixed(1)})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
