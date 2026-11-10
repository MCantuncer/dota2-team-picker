/**
 * Follows a few matchup lookups step by step to find where their games get lost (the cache holds rows
 * with no games). Asks STRATZ the same queries as the live lookup (matchup-builds, _shared/matchup/
 * queries.ts) for a handful of common slices and prints counts only: how many guide ids came back, how
 * many matches answered, and for each match the first check of toMatchupGame it fails. Nothing is saved.
 *
 *   STRATZ_TOKEN=... npm run matchup-probe
 *
 * Or run the "Item reports" workflow with matchup-probe. Two list queries and up to two match queries per
 * slice; keep it outside the refresh runs (02, 06, 10 and 14:17 UTC).
 */
import { postStratz } from "../src/data/stratz";
import {
  guideListQuery,
  guideMatchIds,
  MATCHES_PER_QUERY,
  matchesQuery,
  type Slice,
  sliceGames,
  toMatchupGame,
} from "../../accounts/supabase/functions/_shared/matchup/queries";

/** Common pairs this patch: Juggernaut carry vs Pudge, Lion support vs Phantom Assassin, Shadow Fiend mid vs Invoker. */
const SLICES: Slice[] = [
  { hero: 8, position: 1, enemy: 14 },
  { hero: 26, position: 5, enemy: 44 },
  { hero: 11, position: 2, enemy: 74 },
];
const POSITION_NAMES = ["POSITION_1", "POSITION_2", "POSITION_3", "POSITION_4", "POSITION_5"];

interface Player {
  heroId?: unknown;
  position?: unknown;
  isVictory?: unknown;
  isRadiant?: unknown;
  steamAccountId?: unknown;
  level?: unknown;
  abilities?: unknown;
  stats?: { itemPurchases?: unknown } | null;
}
interface Match {
  id?: unknown;
  gameVersionId?: unknown;
  durationSeconds?: unknown;
  players?: Player[];
}

/** The first check of toMatchupGame a match answer fails, in its order, or "ok". */
function firstFailure(answer: unknown, s: Slice, won: boolean): string {
  if (answer === null || answer === undefined) return "no answer";
  // Read field by field below, for the printout only.
  const m = answer as Match;
  if (typeof m.id !== "number" || typeof m.gameVersionId !== "number" || !Array.isArray(m.players)) {
    return `match fields (id ${typeof m.id}, version ${JSON.stringify(m.gameVersionId)}, players ${Array.isArray(m.players)})`;
  }
  if (typeof m.durationSeconds !== "number" || m.durationSeconds <= 0) return `duration ${JSON.stringify(m.durationSeconds)}`;
  const p = m.players.find((x) => x?.heroId === s.hero);
  if (!p) return "hero not in match";
  if (!m.players.some((x) => x?.heroId === s.enemy && x?.isVictory === !won)) {
    const e = m.players.find((x) => x?.heroId === s.enemy);
    return e ? `enemy on the same side (enemy isVictory ${JSON.stringify(e.isVictory)})` : "enemy not in match";
  }
  if (p.position !== POSITION_NAMES[s.position - 1]) return `hero at ${JSON.stringify(p.position)}`;
  if (p.isVictory !== won) return `hero isVictory ${JSON.stringify(p.isVictory)}`;
  if (typeof p.steamAccountId !== "number" || p.steamAccountId <= 0) return "anonymous account";
  if (typeof p.level !== "number") return `level ${JSON.stringify(p.level)}`;
  if (!Array.isArray(p.abilities)) return `abilities ${JSON.stringify(p.abilities)}`;
  if (!Array.isArray(p.stats?.itemPurchases)) return `itemPurchases ${p.stats ? JSON.stringify(p.stats.itemPurchases) : "no stats"}`;
  if (typeof p.isRadiant !== "boolean") return `isRadiant ${JSON.stringify(p.isRadiant)}`;
  return toMatchupGame(answer, s, won) ? "ok" : "an ability point without id or time";
}

const tally = (xs: string[]) => {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${k}: ${n}`).join(", ") || "none";
};

async function main() {
  const token = process.env.STRATZ_TOKEN;
  if (!token) throw new Error("STRATZ_TOKEN is not set");
  const lists = await postStratz<{ heroStats?: Record<string, unknown> | null }>(token, guideListQuery(SLICES), "guide lists");
  const stats = lists.heroStats ?? {};
  console.log(`guide list answer keys: ${Object.keys(stats).join(", ") || "none"}`);
  for (const [i, s] of SLICES.entries()) {
    const wins = guideMatchIds(stats[`w${i}`]);
    const losses = guideMatchIds(stats[`l${i}`]);
    console.log(`\nhero ${s.hero} pos ${s.position} vs ${s.enemy}: ${wins.length} win ids, ${losses.length} loss ids`);
    if (!wins.length && !losses.length) {
      console.log(`  raw w${i}: ${JSON.stringify(stats[`w${i}`]).slice(0, 300)}`);
      continue;
    }
    const ids = [...new Set([...wins, ...losses])];
    const answers = new Map<number, unknown>();
    for (let j = 0; j < ids.length; j += MATCHES_PER_QUERY) {
      const batch = ids.slice(j, j + MATCHES_PER_QUERY);
      const data = await postStratz<Record<string, unknown>>(token, matchesQuery(batch), "matches");
      batch.forEach((id, k) => answers.set(id, data[`m${k}`]));
    }
    const versions = [...answers.values()].map((a) => String((a as Match | null)?.gameVersionId));
    console.log(`  match answers: ${[...answers.values()].filter((a) => a).length} of ${ids.length}; game versions: ${tally(versions)}`);
    console.log(`  wins: ${tally(wins.map((id) => firstFailure(answers.get(id), s, true)))}`);
    console.log(`  losses: ${tally(losses.map((id) => firstFailure(answers.get(id), s, false)))}`);
    const games = [...wins.map((id) => toMatchupGame(answers.get(id), s, true)), ...losses.map((id) => toMatchupGame(answers.get(id), s, false))];
    const kept = games.filter((g) => g);
    console.log(`  games kept by toMatchupGame: ${kept.length}; after sliceGames from version 184: ${sliceGames(games, 184).length}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
