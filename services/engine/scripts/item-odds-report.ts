/**
 * How often item odds would show on real drafts, from the matchup cache (item journey plan, PR 9b):
 *
 *   npm run pull-data
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run item-odds-report
 *
 * For each cached hero and position with at least 5 enemies, it draws random 5 enemy drafts, pools their
 * games as a card would (each match once, at most 2 wins and 2 losses per account), and asks the card's
 * questions (item-questions.ts). It prints the sample sizes, the show rate per question kind, the real lead
 * bucket shares by result (to check the simulation's guess), the Phase Boots against Power Treads check, and
 * the placebo gate: item numbers may ship only if the real show rate beats the 95th percentile of shuffled
 * runs and under 20% of shown lines would be noise. Reads the cache only; makes no STRATZ calls.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { hasItems, type ItemGame, isBigItem, leadBucket, placeboPassRates, seeded } from "../src/engine/item-odds";
import { fallbackQuestion, type ItemQuestion, slotQuestions } from "../src/engine/item-questions";
import { type MatchupGame, poolGames } from "../src/engine/matchup-talents";
import type { Snapshot } from "../src/engine/types";
import { simulate } from "./item-odds-sim";

const DRAFTS_PER_HERO = 20;
const ENEMIES = 5;
const PAGE = 1000;
const PLACEBO_RUNS = 200;
const MAX_NOISE = 0.2;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Up to `count` random sets of `size` distinct entries, drawn with `random`. */
export function drawSets<T>(xs: T[], size: number, count: number, random: () => number): T[][] {
  if (xs.length < size) return [];
  return Array.from({ length: count }, () => {
    const pool = [...xs];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      // i and j are inside pool.
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    return pool.slice(0, size);
  });
}

interface Row {
  hero_id: number;
  position: number;
  enemy_id: number;
  game_version: number;
  games: unknown;
}

async function readCache(): Promise<Row[]> {
  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("matchup_guides")
      .select("hero_id, position, enemy_id, game_version, games")
      .order("hero_id")
      .order("position")
      .order("enemy_id")
      .order("game_version")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading the cache failed: ${error.message}`);
    // The select above names exactly Row's columns.
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) return rows;
  }
}

async function main() {
  // The snapshot file is written by pull-data in the Snapshot shape.
  const snapshot = JSON.parse(readFileSync("data/snapshot.json", "utf8")) as Snapshot;
  const { items, itemTimings } = snapshot;
  if (!items || !itemTimings) throw new Error("data/snapshot.json has no items or item timings; run npm run pull-data");
  const isBig = (id: number) => isBigItem(items[String(id)]);
  const cost = (id: number) => items[String(id)]?.cost;
  const keyOf = (key: string) => Number(Object.entries(items).find(([, i]) => i.key === key)?.[0]);

  const all = await readCache();
  const version = Math.max(0, ...all.map((r) => r.game_version));
  const byHero = new Map<string, Map<number, ItemGame[]>>();
  for (const r of all.filter((r) => r.game_version === version)) {
    // Written only by save_matchup_guides with games from toMatchupGame.
    const games = (r.games as MatchupGame[]).filter(hasItems);
    const k = `${r.hero_id}:${r.position}`;
    const enemies = byHero.get(k) ?? new Map<number, ItemGame[]>();
    enemies.set(r.enemy_id, games);
    byHero.set(k, enemies);
  }

  const random = seeded(1);
  const asked: { q: ItemQuestion; games: ItemGame[] }[] = [];
  const sizes: number[] = [];
  for (const [k, enemies] of byHero) {
    const [hero, position] = k.split(":");
    const timings = itemTimings[hero ?? ""]?.[position ?? ""];
    const build = timings?.["4"] ?? timings?.all;
    for (const set of drawSets([...enemies.keys()], ENEMIES, DRAFTS_PER_HERO, random)) {
      // Pooled as a card pools them.
      const games = poolGames(set.flatMap((e) => enemies.get(e) ?? []));
      sizes.push(games.length);
      const fallback = fallbackQuestion(build, isBig);
      for (const q of [...slotQuestions(games, isBig, cost), ...(fallback ? [fallback] : [])]) asked.push({ q, games });
    }
  }

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const sorted = [...sizes].sort((x, y) => x - y);
  const at = (p: number) => sorted[Math.floor((sorted.length - 1) * p)] ?? 0;
  console.log(`version ${version}: ${byHero.size} heroes and positions, ${sizes.length} drafts`);
  console.log(`games per draft: 10th ${at(0.1)}, median ${at(0.5)}, 90th ${at(0.9)}`);

  const results = asked.map(({ q, games }) => ({ q, odds: q.ask(games) }));
  for (const kind of ["slot", "fallback"] as const) {
    const mine = results.filter((r) => r.q.kind === kind);
    const shown = mine.filter((r) => r.odds.shows);
    const printed = shown.length ? Math.exp(shown.reduce((s, r) => s + Math.log(r.odds.oddsRatio), 0) / shown.length) : NaN;
    console.log(`${kind}: ${mine.length} questions, ${pct(mine.length ? shown.length / mine.length : 0)} show` +
      (shown.length ? `, shown lines print ${printed.toFixed(1)}x on average` : ""));
  }

  const games = [...byHero.values()].flatMap((m) => [...m.values()].flat());
  for (const minute of [10, 15, 20]) {
    const share = (won: boolean) => {
      const mine = games.filter((g) => g.won === won && leadBucket(g.lead, minute));
      const n = (b: string) => mine.filter((g) => leadBucket(g.lead, minute) === b).length / (mine.length || 1);
      return `ahead ${pct(n("ahead"))}, even ${pct(n("even"))}, behind ${pct(n("behind"))}`;
    };
    console.log(`minute ${minute}: wins ${share(true)}; losses ${share(false)}`);
  }

  const phase = keyOf("phase_boots");
  const treads = keyOf("power_treads");
  const boots = results.filter((r) => r.q.kind === "slot" && [phase, treads].includes(r.q.a) && [phase, treads].includes(r.q.b));
  console.log(`Phase Boots against Power Treads: ${boots.length} questions, ${pct(boots.length ? boots.filter((r) => r.odds.shows).length / boots.length : 0)} show`);

  const slots = asked.filter(({ q }) => q.kind === "slot");
  const real = slots.length ? slots.filter(({ q, games }) => q.ask(games).shows).length / slots.length : 0;
  const shuffled = placeboPassRates(slots.map(({ q, games }) => ({ games, minute: q.minute, ask: q.ask })), PLACEBO_RUNS, seeded(2));
  const sortedRuns = [...shuffled].sort((x, y) => x - y);
  const p95 = sortedRuns[Math.floor(PLACEBO_RUNS * 0.95)] ?? 0;
  const noise = shuffled.reduce((s, x) => s + x, 0) / PLACEBO_RUNS / (real || 1);
  const passes = real > p95 && noise < MAX_NOISE;
  console.log(`placebo (slots): real ${pct(real)}, shuffled 95th percentile ${pct(p95)}, noise share ${pct(noise)}: ${passes ? "passes" : "fails"}`);

  console.log("simulated, 100 games a draft, B in half: true 1x, 1.5x, 2x, 3x show");
  console.log(`  ${[1, 1.5, 2, 3].map((or) => pct(simulate({ games: 100, inWindow: 0.6, bShare: 0.5 }, or, 1000).shows)).join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
