/**
 * How often item odds would show, over every cached matchup (item journey plan, PR 9):
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run item-odds-report -- [--data data/snapshot.json]
 *
 * For each hero and position in the cache, the games against all enemies are pooled and asked:
 * - each slot of the weekly build: the usual item against the most bought other big item there;
 * - the first core item with a late minute: switching against keeping going once it is late.
 * It prints the show rate per question kind, the simulated bar, and the placebo gate: the real show rate
 * must be above the 95th percentile of shuffled runs before any item number is shown.
 * Reads the cache only; makes no STRATZ calls.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { isCoreItem } from "../src/engine/item-build";
import {
  fallbackOdds,
  hasItems,
  type ItemGame,
  type ItemOdds,
  placeboPassRates,
  seeded,
  slotItem,
  slotOdds,
  type PlaceboQuestion,
} from "../src/engine/item-odds";
import { showRate } from "../src/engine/item-odds-sim";
import type { MatchupGame } from "../src/engine/matchup-talents";
import type { Snapshot } from "../src/engine/types";

const PLACEBO_RUNS = 200;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** The questions for one hero and position, with the weekly build's slots and late minute. */
export function questionsFor(
  games: ItemGame[],
  build: [number, number, number][],
  isBig: (id: number) => boolean,
): (PlaceboQuestion & { kind: "slot" | "fallback" })[] {
  const slots = [...build].sort((x, y) => x[1] - y[1]);
  const out: (PlaceboQuestion & { kind: "slot" | "fallback" })[] = [];
  slots.forEach(([usual, minute], i) => {
    // The 6 minute window is centred on the usual minute.
    const m = Math.max(Math.floor(minute) - 3, 0);
    const counts = new Map<number, number>();
    for (const g of games) {
      const id = slotItem(g, i + 1, m, isBig);
      if (id !== undefined && id !== usual) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const other = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0];
    if (other === undefined) return;
    const q = { slot: i + 1, minute: m, a: usual, b: other };
    out.push({ kind: "slot", games, minute: m, ask: (g) => slotOdds(g, q, isBig) });
  });
  const key = slots.find(([, minute, late]) => late > minute);
  if (key) {
    const late = Math.round(key[2]);
    out.push({ kind: "fallback", games, minute: late, ask: (g) => fallbackOdds(g, key[0], late, isBig) });
  }
  return out;
}

async function main() {
  const { values } = parseArgs({ options: { data: { type: "string", default: "data/snapshot.json" } } });
  // The snapshot file is written by pull-data in the Snapshot shape.
  const snapshot = JSON.parse(readFileSync(values.data!, "utf8")) as Snapshot;
  const isBig = (id: number) => isCoreItem(snapshot.items?.[String(id)]);
  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
  const { data, error } = await supabase.from("matchup_guides").select("hero_id, position, games");
  if (error) throw new Error(`Reading the cache failed: ${error.message}`);

  const pooled = new Map<string, ItemGame[]>();
  for (const row of data ?? []) {
    // Written only by save_matchup_guides with games from toMatchupGame.
    const games = (row.games as MatchupGame[]).filter(hasItems);
    const k = `${row.hero_id}:${row.position}`;
    pooled.set(k, [...(pooled.get(k) ?? []), ...games]);
  }
  const questions = [...pooled].flatMap(([k, games]) => {
    const [hero, position] = k.split(":");
    const build = snapshot.itemTimings?.[hero!]?.[position!]?.all?.items ?? [];
    // A game against two of the enemies came back for both.
    const unique = [...new Map(games.map((g) => [g.match, g])).values()];
    return questionsFor(unique, build, isBig);
  });

  const rate = (odds: ItemOdds[]) => (odds.length ? odds.filter((o) => o.shows).length / odds.length : 0);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  for (const kind of ["slot", "fallback"] as const) {
    const odds = questions.filter((q) => q.kind === kind).map((q) => q.ask(q.games));
    const sizes = odds.map((o) => o.games).sort((x, y) => x - y);
    console.log(
      `${kind}: ${odds.length} questions, ${pct(rate(odds))} show, median ${sizes[sizes.length >> 1] ?? 0} games`,
    );
  }
  const real = rate(questions.map((q) => q.ask(q.games)));
  const shuffled = placeboPassRates(questions, PLACEBO_RUNS, seeded(1)).sort((x, y) => x - y);
  const p95 = shuffled[Math.floor(PLACEBO_RUNS * 0.95)] ?? 0;
  console.log(`placebo: real ${pct(real)} against shuffled 95th percentile ${pct(p95)}: ${real > p95 ? "passes" : "fails"}`);
  console.log("simulated show rate at a true odds ratio of 1, 1.5, 2, 3:");
  for (const n of [30, 50, 100]) console.log(`  ${n} games: ${[1, 1.5, 2, 3].map((or) => pct(showRate(n, or, 1000))).join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
