/**
 * Strengths and problems from a player's game summaries, each explained in five layers:
 * headline, what happened, the pattern across games, what it cost, and what to change.
 * Rules, not guesses: every finding needs enough games and a big enough gap, and every
 * sentence quotes the player's own numbers.
 */
import type { Position } from "../trends/games.ts";
import type { DeathFact, GameSummary, Percentiles } from "./summary.ts";
import { type FindingKind, type Role, tipFor } from "./tips.ts";

/** Games a trend finding needs behind it. */
export const MIN_TREND_GAMES = 4;
/** How far from the middle (0.5) a percentile must sit: 15 points over games, 25 in one game. */
export const TREND_GAP = 0.15;
export const SINGLE_GAME_GAP = 0.25;
/** Lane net worth gap at 10 minutes that counts, over games and in one game. */
const TREND_LANE_GOLD = 600;
const SINGLE_LANE_GOLD = 1000;
const EARLY_S = 10 * 60;
/** Power runes spawn at 6:00 and every 2 minutes after. */
const FIRST_POWER_RUNE_S = 6 * 60;
const RUNE_EVERY_S = 2 * 60;
const AFTER_RUNE_S = 60;
/** "With vs without" win % lines need this many games each side and this gap. */
const MIN_SIDE_GAMES = 5;
const MIN_WIN_GAP = 0.3;

export type Tone = "strength" | "problem";

export interface Finding {
  kind: FindingKind;
  tone: Tone;
  /** How strong the signal is, for ranking: the gap times the games behind it. */
  score: number;
  headline: string;
  /** The actual moments or numbers, one line each. */
  happened: string[];
  pattern: string | null;
  cost: string | null;
  /** A reviewed tip, for problems only. */
  change: string | null;
  matchIds: number[];
}

/** Hero names by id, for the text. */
export interface Names {
  hero: (heroId: number) => string;
}

const roleOf = (position: Position | null): Role => (position !== null && position >= 4 ? "support" : "core");
const pct = (p: number) => Math.round(p * 100);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** A percentile stat a finding can be built on, and for which roles it is fair. */
interface PercentileRule {
  kind: FindingKind;
  read: (p: Percentiles) => number | null;
  /** True when a high percentile is bad (deaths). */
  isLowerBetter?: boolean;
  roles: Role[];
  label: string;
  headlines: Record<Tone, string>;
  /** The habit a game is split on for the win % line, e.g. "below median farm". */
  weakHabit: string;
}

const PERCENTILE_RULES: PercentileRule[] = [
  {
    kind: "farm",
    read: (p) => average([p.goldPerMin, p.lastHitsPerMin]),
    roles: ["core"],
    label: "farm (GPM and last hits)",
    headlines: { strength: "Strong farm", problem: "Low farm" },
    weakHabit: "below median farm",
  },
  {
    kind: "damage",
    read: (p) => p.heroDamagePerMin,
    roles: ["core", "support"],
    label: "hero damage per minute",
    headlines: { strength: "High hero damage", problem: "Low hero damage" },
    weakHabit: "below median hero damage",
  },
  {
    kind: "deaths",
    read: (p) => p.deathsPerMin,
    isLowerBetter: true,
    roles: ["core", "support"],
    label: "deaths per minute",
    headlines: { strength: "You stay alive", problem: "Too many deaths" },
    weakHabit: "above median deaths",
  },
  {
    kind: "towers",
    read: (p) => p.towerDamage,
    roles: ["core"],
    label: "tower damage",
    headlines: { strength: "Strong tower pressure", problem: "Little tower damage" },
    weakHabit: "below median tower damage",
  },
];

/** The best strengths and problems over the player's games, at most `limit` of each. */
export function trendFindings(games: GameSummary[], names: Names, limit = 3): Finding[] {
  const found: Finding[] = [];
  for (const rule of PERCENTILE_RULES) {
    const f = percentileFinding(rule, games, TREND_GAP, MIN_TREND_GAMES, names);
    if (f) found.push(f);
  }
  const early = earlyDeathsFinding(games, names);
  if (early) found.push(early);
  const lane = laningFinding(games, TREND_LANE_GOLD, MIN_TREND_GAMES, names);
  if (lane) found.push(lane);
  return topByTone(found, limit);
}

/** Up to `limit` strengths and problems in one game; none when nothing stood out. */
export function gameFindings(game: GameSummary, names: Names, limit = 4): Finding[] {
  const found: Finding[] = [];
  for (const rule of PERCENTILE_RULES) {
    const f = percentileFinding(rule, [game], SINGLE_GAME_GAP, 1, names);
    if (f) found.push(f);
  }
  const lane = laningFinding([game], SINGLE_LANE_GOLD, 1, names);
  if (lane) found.push(lane);
  const early = (game.deaths ?? []).filter((d) => d.time < EARLY_S);
  if (early.length >= 2) {
    found.push({
      kind: "early_deaths",
      tone: "problem",
      score: early.length,
      headline: `${early.length} deaths before 10 minutes`,
      happened: early.map((d) => deathLine(d, names)),
      pattern: null,
      cost: `${sum(early.map((d) => d.goldLost))} gold lost and ${sum(early.map((d) => d.timeDead))} seconds dead.`,
      change: tipFor("early_deaths", roleOf(game.position), {
        killer: topKiller(early, names) ?? "the enemy",
        minute: "10",
      }),
      matchIds: [game.matchId],
    });
  }
  return topByTone(found, limit);
}

function percentileFinding(
  rule: PercentileRule,
  games: GameSummary[],
  gap: number,
  minGames: number,
  names: Names,
): Finding | null {
  const rows = games.flatMap((g) => {
    const value = g.percentiles ? rule.read(g.percentiles) : null;
    return value === null || !rule.roles.includes(roleOf(g.position)) ? [] : [{ g, value }];
  });
  if (rows.length < minGames) return null;
  const mean = average(rows.map((r) => r.value));
  const goodness = rule.isLowerBetter ? 1 - mean : mean;
  if (Math.abs(goodness - 0.5) < gap) return null;
  const tone: Tone = goodness > 0.5 ? "strength" : "problem";
  const heroes = [...new Set(rows.map((r) => names.hero(r.g.heroId)))].join(", ");
  const where = rows.length === 1 ? `this ${heroes} game` : `${rows.length} games on ${heroes}`;
  const comparison = !rule.isLowerBetter
    ? `higher ${rule.label} than ${pct(mean)}% of games on these heroes`
    : tone === "strength"
    ? `fewer ${rule.label} than ${pct(1 - mean)}% of games on these heroes`
    : `more ${rule.label} than ${pct(mean)}% of games on these heroes`;
  const role = roleOf(rows[0]?.g.position ?? null);
  return {
    kind: rule.kind,
    tone,
    score: Math.abs(goodness - 0.5) * rows.length,
    headline: rule.headlines[tone],
    happened: rows.map((r) => `${names.hero(r.g.heroId)}: ${pct(r.value)}th percentile for ${rule.label}`),
    pattern: `Across ${where}, you had ${comparison} on OpenDota (all ranks).`,
    cost: winSplit(
      rows.map((r) => r.g),
      (g) => rows.some((r) => r.g === g && (rule.isLowerBetter ? r.value > 0.5 : r.value < 0.5)),
      rule.weakHabit,
    ),
    change: tone === "problem"
      ? tipFor(rule.kind, role, { value: String(Math.round(average(rows.map((r) => r.g.card.deaths)))) })
      : null,
    matchIds: rows.map((r) => r.g.matchId),
  };
}

function laningFinding(games: GameSummary[], gold: number, minGames: number, names: Names): Finding | null {
  const rows = games.flatMap((g) => (g.laneNetWorthDiffAt10 === null ? [] : [{ g, diff: g.laneNetWorthDiffAt10 }]));
  if (rows.length < minGames) return null;
  const mean = Math.round(average(rows.map((r) => r.diff)));
  if (Math.abs(mean) < gold) return null;
  const tone: Tone = mean > 0 ? "strength" : "problem";
  return {
    kind: "laning",
    tone,
    score: (Math.abs(mean) / gold) * rows.length * 0.15,
    headline: tone === "strength" ? "You win your lanes" : "You fall behind in lane",
    happened: rows.map((r) =>
      `${names.hero(r.g.heroId)}: ${r.diff >= 0 ? "+" : ""}${r.diff} gold against your lane opponent at 10:00, ` +
      `${r.g.lastHitsAt10 ?? "?"} last hits and ${r.g.deniesAt10 ?? "?"} denies`
    ),
    pattern: rows.length > 1
      ? `On average you were ${Math.abs(mean)} gold ${
        mean > 0 ? "ahead of" : "behind"
      } your lane opponent at 10 minutes.`
      : null,
    cost: winSplit(games, (g) => (g.laneNetWorthDiffAt10 ?? 0) < 0, "a lost lane"),
    change: tone === "problem" ? tipFor("laning", roleOf(rows[0]?.g.position ?? null), { value: String(-mean) }) : null,
    matchIds: rows.map((r) => r.g.matchId),
  };
}

function earlyDeathsFinding(games: GameSummary[], names: Names): Finding | null {
  const parsed = games.filter((g) => g.deaths !== null);
  if (parsed.length < MIN_TREND_GAMES) return null;
  const early = parsed.flatMap((g) => (g.deaths ?? []).filter((d) => d.time < EARLY_S).map((d) => ({ g, d })));
  const gamesWithEarly = parsed.filter((g) => (g.deaths ?? []).some((d) => d.time < EARLY_S));
  const perGame = early.length / parsed.length;
  // A problem from one early death a game, on most games.
  if (perGame < 1 || gamesWithEarly.length / parsed.length < 0.6) return null;
  const deaths = early.map((e) => e.d);
  return {
    kind: "early_deaths",
    tone: "problem",
    score: perGame * parsed.length * 0.2,
    headline: "Early deaths are costing your lanes",
    happened: early.map((e) => `${names.hero(e.g.heroId)}: ${deathLine(e.d, names)}`),
    pattern: runePattern(deaths) ??
      `You died ${early.length} times before 10 minutes in ${gamesWithEarly.length} of your last ${parsed.length} games.`,
    cost: [
      `${sum(deaths.map((d) => d.goldLost))} gold lost and ${
        sum(deaths.map((d) => d.timeDead))
      } seconds dead before 10 minutes.`,
      winSplit(parsed, (g) => (g.deaths ?? []).some((d) => d.time < EARLY_S), "a death before 10 minutes"),
    ].filter(Boolean).join(" "),
    change: tipFor("early_deaths", roleOf(parsed[0]?.position ?? null), {
      killer: topKiller(deaths, names) ?? "the enemy",
      minute: "10",
    }),
    matchIds: gamesWithEarly.map((g) => g.matchId),
  };
}

/** Rotations after a power rune, only when they are most of the early deaths. */
export function runePattern(deaths: DeathFact[]): string | null {
  const afterRune = deaths.filter((d) =>
    d.isKillerFromMid === true && d.time >= FIRST_POWER_RUNE_S &&
    (d.time - FIRST_POWER_RUNE_S) % RUNE_EVERY_S <= AFTER_RUNE_S
  );
  if (afterRune.length < 3 || afterRune.length / deaths.length < 0.6) return null;
  return `${afterRune.length} of your ${deaths.length} early deaths came after a power rune spawn ` +
    `(6:00, 8:00), with the enemy mid getting the kill.`;
}

/** "In your games with X you won A%; in the others B%", only with enough games and a big gap. */
function winSplit(games: GameSummary[], hasIt: (g: GameSummary) => boolean, what: string): string | null {
  const withIt = games.filter(hasIt);
  const without = games.filter((g) => !hasIt(g));
  if (withIt.length < MIN_SIDE_GAMES || without.length < MIN_SIDE_GAMES) return null;
  const rate = (gs: GameSummary[]) => gs.filter((g) => g.isWin).length / gs.length;
  const [a, b] = [rate(withIt), rate(without)];
  if (Math.abs(a - b) < MIN_WIN_GAP) return null;
  return `In your games with ${what} you won ${pct(a)}%; in the others ${pct(b)}%.`;
}

function deathLine(d: DeathFact, names: Names): string {
  const killer = d.killerHeroId === null ? "" : ` to ${names.hero(d.killerHeroId)}`;
  const lost = d.buildingsLost.length ? `, ${d.buildingsLost.length} building(s) fell while you were dead` : "";
  return `died at ${clock(d.time)}${killer} (${d.goldLost} gold lost, ${d.timeDead}s dead${lost})`;
}

function topKiller(deaths: DeathFact[], names: Names): string | null {
  const counts = new Map<number, number>();
  for (const d of deaths) {
    if (d.killerHeroId !== null) counts.set(d.killerHeroId, (counts.get(d.killerHeroId) ?? 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best ? names.hero(best[0]) : null;
}

function topByTone(found: Finding[], limit: number): Finding[] {
  const pick = (tone: Tone) => found.filter((f) => f.tone === tone).sort((a, b) => b.score - a.score).slice(0, limit);
  return [...pick("strength"), ...pick("problem")];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
