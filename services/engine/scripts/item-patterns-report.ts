/**
 * Item patterns for every cached hero and position (item-patterns.ts): how often each item is bought, wins
 * against losses, the lane state it is bought in, what it moves, the enemies it is bought against and the
 * newer games against the older ones. Nothing reaches the site from this.
 *
 *   npm run pull-data
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run item-patterns-report
 *   FOCUS=93 prints every checked item of one hero, flagged or not.
 *
 * Or run the "Item reports" workflow with item-patterns-report. Reads the cache only; no STRATZ calls.
 */
import { readFileSync } from "node:fs";
import { isConsumable } from "../src/engine/item-build";
import { hasItems, type IsBig } from "../src/engine/item-odds";
import { CHANCE, flagCount, type ItemPattern, itemPatterns, Z_FLAG } from "../src/engine/item-patterns";
import { type EnemyGames, HORIZON, poolByMatch, type Share } from "../src/engine/item-problems";
import type { MatchupGame } from "../src/engine/matchup-talents";
import type { Snapshot } from "../src/engine/types";
import { readCache } from "./matchup-cache";

/** Items from this cost up are checked: lane items like Soul Ring too, not Magic Wand or plain boots. */
const MIN_COST = 500;

const pct = (s: Share) => `${s.bought} of ${s.games} (${s.games ? Math.round((s.bought / s.games) * 100) : 0}%)`;
const z = (n: number | undefined) => (n === undefined ? "too few games to test" : `z ${n.toFixed(1)}`);
const gold = (n: number | undefined) => (n === undefined ? "?" : `${n > 0 ? "+" : ""}${Math.round(n)}`);

async function main() {
  // The snapshot file is written by pull-data in the Snapshot shape.
  const snapshot = JSON.parse(readFileSync("data/snapshot.json", "utf8")) as Snapshot;
  const { items } = snapshot;
  if (!items) throw new Error("data/snapshot.json has no items; run npm run pull-data");
  const name = (id: number) => items[String(id)]?.name ?? `item ${id}`;
  const heroName = (id: number) => snapshot.heroes[id]?.name ?? `hero ${id}`;
  const tracked: IsBig = (id) => {
    const item = items[String(id)];
    return item !== undefined && !isConsumable(item) && item.key !== "boots" && item.cost >= MIN_COST;
  };
  tracked.componentsOf = (id) => items[String(id)]?.components ?? [];

  const all = await readCache();
  // A reduce, not Math.max(...all): spreading a cache of 100k+ rows overflows the call stack.
  const version = all.reduce((m, r) => Math.max(m, r.game_version), 0);
  const byGroup = new Map<string, EnemyGames[]>();
  for (const r of all) {
    if (r.game_version !== version || r.position < 1 || r.position > 5 || !Array.isArray(r.games)) continue;
    // Written only by save_matchup_guides with games from toMatchupGame.
    const games = (r.games as MatchupGame[]).filter(hasItems);
    if (!games.length) continue;
    const k = `${r.hero_id}:${r.position}`;
    byGroup.set(k, [...(byGroup.get(k) ?? []), { enemy: r.enemy_id, games }]);
  }

  const describe = (p: ItemPattern) => {
    const lines = [
      `${name(p.item)}: ${pct(p.all)} of games, first bought at ${p.minute.toFixed(0)} min`,
      `    by ${(p.minute + HORIZON).toFixed(0)} min: wins ${pct(p.wins)}, losses ${pct(p.losses)}, ${z(p.winZ)}`,
      ...(p.leadWith === undefined ? [] : [`    team lead when bought ${gold(p.leadWith)}, without it at that minute ${gold(p.leadWithout)}`]),
      `    older games ${pct(p.older)}, newer ${pct(p.newer)}, ${z(p.trendZ)}`,
    ];
    if (p.moved.length) {
      lines.push(`    with it (descriptive, not tested): ${p.moved.map((m) => `${name(m.item)} ${m.with.toFixed(0)} min (${m.without.toFixed(0)} without)`).join(", ")}`);
    }
    for (const e of p.enemies) {
      lines.push(`    against ${heroName(e.enemy)}: ${pct(e.against)}, other games ${pct(e.others)}, z ${e.z.toFixed(1)}`);
    }
    return lines.join("\n");
  };

  const focus = Number(process.env.FOCUS ?? 0);
  let checked = 0;
  let tests = 0;
  let flags = 0;
  const summary: string[] = [];
  for (const [k, rows] of [...byGroup].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    const [hero = 0, position = 0] = k.split(":").map(Number);
    const games = poolByMatch(rows, tracked);
    const patterns = itemPatterns(games).sort((a, b) => b.all.bought - a.all.bought);
    checked += patterns.length;
    const groupTests = patterns.reduce((n, p) => n + p.tests, 0);
    const groupFlags = patterns.reduce((n, p) => n + flagCount(p), 0);
    tests += groupTests;
    flags += groupFlags;
    // Each block says how many of its flags chance alone would give, so a lone enemy flag isn't read as a pattern.
    const header = `${heroName(hero)} pos ${position}: ${games.length} games, ${rows.length} enemies; ` +
      `${groupFlags} flags from ${groupTests} checks, about ${(groupTests * CHANCE).toFixed(1)} expected by chance`;
    if (hero === focus) {
      console.log(`\n${header}`);
      for (const p of patterns) console.log(`  ${describe(p)}`);
    }
    const flagged = patterns.filter((p) => flagCount(p) > 0);
    if (flagged.length) {
      summary.push(`\n${header}`);
      for (const p of flagged) summary.push(`  ${describe(p)}`);
    }
  }
  console.log(
    `\ncache version ${version}: ${byGroup.size} heroes and positions, ${checked} items checked, ` +
      `${flags} flags past z ${Z_FLAG} from ${tests} checks; about ${Math.round(tests * CHANCE)} are expected by chance alone`,
  );
  console.log(summary.join("\n"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
