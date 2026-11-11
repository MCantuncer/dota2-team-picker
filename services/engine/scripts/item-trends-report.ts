/**
 * Items players buy more or less often lately, for every hero and position (item-trends.ts). Compares the
 * games between the daily snapshot copy DAYS*2 days ago and DAYS days ago with the games since:
 *
 *   DAYS=7 npm run item-trends-report
 *
 * Or run the "Item reports" workflow with item-trends-report. Reads the public daily copies only. Purchase
 * counts are in the snapshot from 2026-11-11, so the first full comparison (7 days) is due 2026-11-25.
 */
import { itemTrends, MIN_CHANGE, type Timings, TREND_Z } from "../src/engine/item-trends";
import type { Snapshot } from "../src/engine/types";

const BASE = "https://odigcdwsvajkbvcxeskj.supabase.co/storage/v1/object/public/hero-data";
const DAY_MS = 24 * 60 * 60 * 1000;
/** A missing day (no refresh ran) falls back to the day before, this many times. */
const DAYS_BACK = 2;

/** The daily copy of `date`, or of the closest day before it within DAYS_BACK days. */
async function dailyCopy(date: Date): Promise<{ day: string; snapshot: Snapshot } | undefined> {
  for (let back = 0; back <= DAYS_BACK; back++) {
    const day = new Date(date.getTime() - back * DAY_MS).toISOString().slice(0, 10);
    const res = await fetch(`${BASE}/daily/${day}.json`);
    if (res.status === 400 || res.status === 404) continue;
    if (!res.ok) throw new Error(`Downloading daily/${day}.json failed: HTTP ${res.status}`);
    // The daily copies are snapshots written by upload-data.
    return { day, snapshot: (await res.json()) as Snapshot };
  }
  return undefined;
}

async function main() {
  const days = Number(process.env.DAYS ?? 7);
  if (!Number.isSafeInteger(days) || days < 1) throw new Error("DAYS must be 1 or more");
  const now = Date.now();
  const copies = await Promise.all([2 * days, days, 0].map((d) => dailyCopy(new Date(now - d * DAY_MS))));
  const [first, second, third] = copies;
  if (!first || !second || !third) {
    console.log(`Not enough daily copies yet for a ${days} day comparison.`);
    return;
  }
  // itemTimings is keyed by hero id, then position, then slice key; Timings reads it with string keys.
  const timings = (s: Snapshot) => (s.itemTimings ?? {}) as unknown as Timings;
  const withShares = (s: Snapshot) => Object.values(timings(s)).some((p) => Object.values(p ?? {}).some((x) => x?.all?.shares));
  if (![first, second, third].every((c) => withShares(c.snapshot))) {
    console.log(`The copies of ${first.day}, ${second.day} and ${third.day} don't all have purchase counts yet (added 2026-11-11).`);
    return;
  }
  const items = third.snapshot.items ?? {};
  const name = (id: number) => items[String(id)]?.name ?? `item ${id}`;
  const heroName = (id: number) => third.snapshot.heroes[id]?.name ?? `hero ${id}`;
  const trends = itemTrends(timings(first.snapshot), timings(second.snapshot), timings(third.snapshot));
  const pct = (s: { bought: number; games: number }) => `${Math.round((s.bought / s.games) * 100)}% of ${s.games} games`;
  console.log(
    `Games from ${first.day} to ${second.day} against games from ${second.day} to ${third.day}: ` +
      `${trends.length} items moved by ${MIN_CHANGE * 100} points or more, past z ${TREND_Z}`,
  );
  for (const t of trends) {
    console.log(`  ${heroName(t.hero)} pos ${t.position}: ${name(t.item)} ${pct(t.older)}, now ${pct(t.newer)} (z ${t.z.toFixed(1)})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
