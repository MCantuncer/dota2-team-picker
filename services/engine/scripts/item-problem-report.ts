/**
 * Whether the enemies' problems change what high-rank winners buy, from the matchup cache (item engine
 * plan, step 4). Nothing reaches the site from this: it tells Can whether enemy-based core swaps are backed.
 *
 *   npm run pull-data
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run item-problem-report
 *
 * Or run the "Item reports" workflow. For each cached hero and position, each problem an enemy can bring
 * (threatsOf in item-build.ts, still partly hand-kept lists: a null result means "not shown with these
 * labels") and each big item the hero buys in at least CANDIDATE_SHARE of its games, it compares games
 * against enemies with the problem to games against enemies without it (item-problems.ts). Then:
 * - placebo: the same count with the problem moved to random enemies, PLACEBO_RUNS times. The real passes
 *   must beat the shuffled 95th percentile, and the mean shuffled count must be under 20% of the real one;
 * - held out: cells found on players with even account ids are checked on odd ones (the cache keeps no
 *   earlier weeks), against the same step on shuffled labels.
 * Reads the cache only; makes no STRATZ calls.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { threatsOf, type Threat } from "../src/engine/item-build";
import { bigItemCheck, hasItems, type ItemGame, seeded } from "../src/engine/item-odds";
import {
  type EnemyGames,
  HORIZON,
  MIN_LIFT,
  MIN_LOSSES,
  MIN_WINS,
  type MinGames,
  type PooledGame,
  type ProblemCell,
  poolByMatch,
  problemCell,
  share,
  shuffledProblem,
  usualMinute,
} from "../src/engine/item-problems";
import type { MatchupGame } from "../src/engine/matchup-talents";
import type { Snapshot } from "../src/engine/types";

const PAGE = 1000;
/** An item is a candidate when the hero buys it in at least this share of its cached games. */
const CANDIDATE_SHARE = 0.1;
const PLACEBO_RUNS = 100;
const MAX_NOISE = 0.2;
const SHOW_CELLS = 40;
const PROBLEMS: Threat[] = [
  "disable", "magicBurst", "heal", "evasion", "illusions", "invisible", "passives", "physicalCarry", "unattackable",
];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
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

interface Group {
  hero: number;
  position: number;
  games: PooledGame[];
  enemies: number[];
  /** Candidate items with their usual minute. */
  candidates: { item: number; minute: number }[];
}

interface Found {
  group: Group;
  problem: Threat;
  item: number;
  cell: ProblemCell;
}

/** Whether a game had a cached enemy with the problem, per game of the group. */
type Label = (group: Group, problem: Threat) => (enemy: number) => boolean;

/** Every passing cell, and how many cells had enough games, over the games `pick` keeps. */
function count(groups: Group[], label: Label, pick: (g: PooledGame) => boolean = () => true, min?: MinGames) {
  const found: Found[] = [];
  let judged = 0;
  for (const group of groups) {
    const games = group.games.filter(pick);
    for (const problem of PROBLEMS) {
      const hasProblem = label(group, problem);
      const isCase = games.map((g) => g.enemies.some(hasProblem));
      if (!isCase.includes(true) || !isCase.includes(false)) continue;
      for (const { item, minute } of group.candidates) {
        const cell = problemCell(games, isCase, item, minute, min);
        if (!cell) continue;
        judged++;
        if (cell.passes) found.push({ group, problem, item, cell });
      }
    }
  }
  return { found, judged };
}

const evenPlayer = (g: PooledGame) => g.game.account % 2 === 0;
const oddPlayer = (g: PooledGame) => !evenPlayer(g);
const HALF: MinGames = { wins: Math.ceil(MIN_WINS / 2), losses: Math.ceil(MIN_LOSSES / 2) };

/** Cells found on even players that still show on odd ones: a raw lift of half MIN_LIFT, more among wins. */
function heldOut(groups: Group[], label: Label) {
  const found = count(groups, label, evenPlayer, HALF).found;
  const held = found.filter(({ group, problem, item }) => {
    const minute = group.candidates.find((c) => c.item === item)?.minute;
    if (minute === undefined) throw new Error(`No usual minute for item ${item}`);
    const games = group.games.filter(oddPlayer);
    const hasProblem = label(group, problem);
    const cell = problemCell(games, games.map((g) => g.enemies.some(hasProblem)), item, minute, HALF);
    if (!cell) return false;
    const winLift = share(cell.caseWins) - share(cell.controlWins);
    return winLift >= MIN_LIFT / 2 && winLift > share(cell.caseLosses) - share(cell.controlLosses);
  });
  return { found: found.length, held: held.length };
}

async function main() {
  // The snapshot file is written by pull-data in the Snapshot shape.
  const snapshot = JSON.parse(readFileSync("data/snapshot.json", "utf8")) as Snapshot;
  const { items } = snapshot;
  if (!items) throw new Error("data/snapshot.json has no items; run npm run pull-data");
  const isBig = bigItemCheck(items);
  const name = (id: number) => items[String(id)]?.name ?? `item ${id}`;
  const heroName = (id: number) => snapshot.heroes[id]?.name ?? `hero ${id}`;
  const threats = new Map<number, Set<Threat>>();
  const has = (enemy: number, problem: Threat) => {
    const hero = snapshot.heroes[enemy];
    if (!hero) return false;
    if (!threats.has(enemy)) threats.set(enemy, threatsOf(hero));
    return threats.get(enemy)?.has(problem) ?? false;
  };

  const all = await readCache();
  const version = Math.max(0, ...all.map((r) => r.game_version));
  // Says why a cache gives few cells: empty rows (lookups that found no games) or games cached without items.
  const latest = all.filter((r) => r.game_version === version);
  // Written only by save_matchup_guides with games from toMatchupGame.
  const latestGames = latest.flatMap((r) => (Array.isArray(r.games) ? (r.games as MatchupGame[]) : []));
  console.log(
    `cache rows: ${all.length}, ${latest.length} for version ${version}, ${latest.filter((r) => Array.isArray(r.games) && r.games.length).length} with games; ` +
      `${latestGames.length} games, ${latestGames.filter(hasItems).length} with items, duration and lead`,
  );
  const shapes = new Map<string, number>();
  for (const r of latest) {
    const shape = Array.isArray(r.games) ? `array of ${Math.min(r.games.length, 3)}${r.games.length >= 3 ? "+" : ""}` : typeof r.games;
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
  }
  console.log(`row game lists: ${[...shapes].map(([k, n]) => `${k}: ${n}`).join(", ")}`);
  const byGroup = new Map<string, EnemyGames[]>();
  for (const r of all) {
    if (r.game_version !== version || r.position < 1 || r.position > 5) continue;
    // Written only by save_matchup_guides with games from toMatchupGame.
    const games = (r.games as MatchupGame[]).filter(hasItems);
    if (!games.length) continue;
    const k = `${r.hero_id}:${r.position}`;
    const rows = byGroup.get(k) ?? [];
    rows.push({ enemy: r.enemy_id, games });
    byGroup.set(k, rows);
  }
  const groups: Group[] = [...byGroup].map(([k, rows]) => {
    const [hero = 0, position = 0] = k.split(":").map(Number);
    const games = poolByMatch(rows, isBig);
    const counts = new Map<number, number>();
    for (const g of games) for (const id of g.bought.keys()) counts.set(id, (counts.get(id) ?? 0) + 1);
    const candidates = [...counts]
      .filter(([, n]) => n >= games.length * CANDIDATE_SHARE)
      .flatMap(([item]): { item: number; minute: number }[] => {
        const minute = usualMinute(games, item);
        return minute === undefined ? [] : [{ item, minute }];
      });
    return { hero, position, games, enemies: rows.map((r) => r.enemy), candidates };
  });

  const real: Label = (_, p) => (enemy) => has(enemy, p);
  const { found, judged } = count(groups, real);
  const gamesTotal = groups.reduce((s, g) => s + g.games.length, 0);
  console.log(`cache version ${version}: ${groups.length} heroes and positions with item data, ${gamesTotal} games after pooling`);
  for (const p of PROBLEMS) {
    let cases = 0;
    for (const g of groups) cases += g.games.filter((x) => x.enemies.some((e) => has(e, p))).length;
    console.log(`  ${p}: ${((cases / (gamesTotal || 1)) * 100).toFixed(0)}% of games are case games`);
  }
  console.log(`cells with enough games (${MIN_WINS}+ wins and ${MIN_LOSSES}+ losses on each side): ${judged}`);
  console.log(`cells that pass: ${found.length}`);

  const random = seeded(7);
  const shuffledLabel = (): Label => {
    const labels = new Map<string, (enemy: number) => boolean>();
    return (g, p) => {
      const k = `${g.hero}:${g.position}:${p}`;
      let f = labels.get(k);
      if (!f) labels.set(k, (f = shuffledProblem(g.enemies, (e) => has(e, p), random)));
      return f;
    };
  };
  const shuffledCounts: number[] = [];
  const shuffledHeld: number[] = [];
  for (let i = 0; i < PLACEBO_RUNS; i++) {
    const label = shuffledLabel();
    shuffledCounts.push(count(groups, label).found.length);
    shuffledHeld.push(heldOut(groups, label).held);
  }
  const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? 0;
  const mean = (xs: number[]) => xs.reduce((s, n) => s + n, 0) / (xs.length || 1);
  const noise = found.length ? mean(shuffledCounts) / found.length : 1;
  const placeboPasses = found.length > p95(shuffledCounts) && noise < MAX_NOISE;
  console.log(
    `placebo: shuffled mean ${mean(shuffledCounts).toFixed(1)}, 95th percentile ${p95(shuffledCounts)}, ` +
      `mean shuffled over real ${(noise * 100).toFixed(0)}%: ${placeboPasses ? "passes" : "fails"}`,
  );
  const held = heldOut(groups, real);
  console.log(
    `held out: ${held.found} cells found on even players, ${held.held} hold on odd ones; ` +
      `shuffled labels hold ${mean(shuffledHeld).toFixed(1)} on average, 95th percentile ${p95(shuffledHeld)}: ` +
      `${held.held > p95(shuffledHeld) ? "passes" : "fails"}`,
  );

  console.log(`\nstrongest passing cells (of ${found.length}):`);
  const lift = (f: Found) => f.cell.shrunk - share(f.cell.controlWins);
  for (const f of [...found].sort((a, b) => lift(b) - lift(a)).slice(0, SHOW_CELLS)) {
    const { caseWins: w, caseLosses: l, controlWins: c, controlLosses: cl } = f.cell;
    const holders = f.group.enemies.filter((e) => has(e, f.problem)).map(heroName);
    const minute = f.group.candidates.find((x) => x.item === f.item)?.minute;
    if (minute === undefined) throw new Error(`No usual minute for item ${f.item}`);
    console.log(
      `  ${heroName(f.group.hero)} pos ${f.group.position}, against ${f.problem} (${holders.slice(0, 4).join(", ")}${holders.length > 4 ? ", ..." : ""}): ` +
        `${name(f.item)} by ${Math.round(minute) + HORIZON} min in ${w.bought} of ${w.games} wins and ${l.bought} of ${l.games} losses; ` +
        `otherwise ${c.bought} of ${c.games} wins and ${cl.bought} of ${cl.games} losses`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
