/**
 * How often a "your team was further behind at 10 than usual against this lineup" line would show on real
 * drafts, from the matchup cache (richer Game Story proposal, step 1: measure first):
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run lead-report
 *
 * For each cached hero and position with at least 5 enemies, it draws random 5 enemy drafts, pools their games
 * as a card would, and compares their lead at 10 and 20 minutes with the same hero's games against the other
 * cached enemies (matchup-leads.ts). It prints the games per draft, the show rate per minute, the size of shown
 * gaps, and a placebo gate: the line may ship only if the real show rate beats the 95th percentile of placebo
 * runs (random games of the same hero in place of the lineup's) and under 20% of shown lines would be noise.
 * Reads the cache only; makes no STRATZ calls.
 */
import { createClient } from "@supabase/supabase-js";
import { seeded } from "../src/engine/item-odds";
import { LEAD_MINUTES, leadGap, placeboDraft } from "../src/engine/matchup-leads";
import { type MatchupGame, poolGames } from "../src/engine/matchup-talents";
import { drawSets } from "./item-odds-report";

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

/** One draft: its pooled games and the hero's games against every other cached enemy. */
interface Draft {
  games: MatchupGame[];
  others: MatchupGame[];
  first: boolean;
}

function drafts(rows: Row[]): Draft[] {
  const byHero = new Map<string, Map<number, MatchupGame[]>>();
  for (const r of rows) {
    // Written only by save_matchup_guides with games from toMatchupGame; rows from before 2026-11-04 have no lead.
    const games = (r.games as MatchupGame[]).filter((g) => Array.isArray(g.lead) && g.lead.length > 0);
    const k = `${r.hero_id}:${r.position}`;
    const enemies = byHero.get(k) ?? new Map<number, MatchupGame[]>();
    enemies.set(r.enemy_id, games);
    byHero.set(k, enemies);
  }
  const random = seeded(1);
  const out: Draft[] = [];
  for (const enemies of byHero.values()) {
    drawSets([...enemies.keys()], ENEMIES, DRAFTS_PER_HERO, random).forEach((set, i) => {
      const inSet = new Set(set);
      const games = poolGames(set.flatMap((e) => enemies.get(e) ?? []));
      const others = poolGames([...enemies].filter(([e]) => !inSet.has(e)).flatMap(([, g]) => g));
      out.push({ games, others, first: i === 0 });
    });
  }
  return out;
}

async function main() {
  const all = await readCache();
  const version = Math.max(0, ...all.map((r) => r.game_version));
  const list = drafts(all.filter((r) => r.game_version === version));
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const sizes = list.map((d) => d.games.length).sort((x, y) => x - y);
  const at = (p: number) => sizes[Math.floor((sizes.length - 1) * p)] ?? 0;
  console.log(`version ${version}: ${list.length} drafts; games per draft: 10th ${at(0.1)}, median ${at(0.5)}, 90th ${at(0.9)}`);

  for (const minute of LEAD_MINUTES) {
    const gaps = list.map((d) => leadGap(d.games, d.others, minute));
    const shown = gaps.filter((g) => g.shows);
    const median = [...shown.map((g) => Math.abs(g.gap))].sort((x, y) => x - y)[Math.floor(shown.length / 2)] ?? 0;
    console.log(`minute ${minute}: ${pct(shown.length / (gaps.length || 1))} of drafts show a line, median shown gap ${Math.round(median)} gold`);

    // Placebo on one draft per hero and position (drafts of the same hero overlap).
    const gate = list.filter((d) => d.first);
    const real = gate.filter((d) => leadGap(d.games, d.others, minute).shows).length / (gate.length || 1);
    const random = seeded(2);
    const runs = Array.from({ length: PLACEBO_RUNS }, () => {
      let shows = 0;
      for (const d of gate) {
        const fake = placeboDraft(d.games, d.others, random);
        if (fake && leadGap(fake, d.others, minute).shows) shows++;
      }
      return shows / (gate.length || 1);
    }).sort((x, y) => x - y);
    const p95 = runs[Math.floor(PLACEBO_RUNS * 0.95)] ?? 0;
    const noise = real ? runs.reduce((s, x) => s + x, 0) / PLACEBO_RUNS / real : 1;
    const passes = real > p95 && noise < MAX_NOISE;
    console.log(`  placebo: real ${pct(real)}, placebo 95th percentile ${pct(p95)}, noise share ${pct(noise)}: ${passes ? "passes" : "fails"}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
