/**
 * Hero damage, tower damage and healing of all ten heroes in one game, so the damage, towers and
 * healing cards can put the player's numbers next to their side's and the enemy's in that game.
 * These are end of game totals every match has, parsed or not. No advice: the cards say what
 * happened. Pure: no network or database.
 */
import { isRadiantSlot, type Match, type MatchPlayer } from "../report/match.ts";
import type { FindingKind, Names } from "./findings.ts";
import type { GameSummary } from "./summary.ts";

export interface HeroTotals {
  heroId: number;
  heroDamage: number;
  towerDamage: number;
  heroHealing: number;
}

export interface TeamDetail {
  /** The player's side, the player included, and the other side, in slot order. */
  ours: HeroTotals[];
  theirs: HeroTotals[];
}

const totals = (p: MatchPlayer): HeroTotals => ({
  heroId: p.heroId,
  heroDamage: p.heroDamage,
  towerDamage: p.towerDamage,
  heroHealing: p.heroHealing,
});

/** Both sides' totals, seen from the side `isRadiant`. */
export function teamDetail(match: Match, isRadiant: boolean): TeamDetail {
  return {
    ours: match.players.filter((p) => isRadiantSlot(p.playerSlot) === isRadiant).map(totals),
    theirs: match.players.filter((p) => isRadiantSlot(p.playerSlot) !== isRadiant).map(totals),
  };
}

type Stat = "heroDamage" | "towerDamage" | "heroHealing";
const STATS: Partial<Record<FindingKind, { stat: Stat; words: string }>> = {
  damage: { stat: "heroDamage", words: "hero damage" },
  towers: { stat: "towerDamage", words: "tower damage" },
  healing: { stat: "heroHealing", words: "healing" },
};

const amount = (n: number) => n.toLocaleString("en-US");
/** Places on one side run 1 to 5, so no 11th to 13th. */
const ordinal = (n: number) => `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n] ?? "th"}`;

/**
 * This game's lines for a damage, towers or healing card: the player's total, their share and
 * place on their side, who did the most on each side. Null for other kinds or without the detail.
 */
export function teamLines(game: GameSummary, kind: FindingKind, names: Names): string[] | null {
  const team = game.team;
  const words = STATS[kind];
  if (!team || !words) return null;
  const { stat } = words;
  const mine = team.ours.find((h) => h.heroId === game.heroId);
  if (!mine) return null;
  const sideTotal = team.ours.reduce((s, h) => s + h[stat], 0);
  const place = 1 + team.ours.filter((h) => h[stat] > mine[stat]).length;
  const share = sideTotal > 0 ? `, ${Math.round((mine[stat] / sideTotal) * 100)}% of your side's` : "";
  const lines = [`Your ${words.words}: ${amount(mine[stat])}${share}, ${ordinal(place)} of ${team.ours.length}.`];
  const best = (side: HeroTotals[]) => side.reduce((a, b) => (b[stat] > a[stat] ? b : a));
  const ourBest = best(team.ours);
  if (ourBest.heroId !== mine.heroId) {
    lines.push(`Most on your side: ${names.hero(ourBest.heroId)} with ${amount(ourBest[stat])}.`);
  }
  if (team.theirs.length) {
    const theirBest = best(team.theirs);
    lines.push(`Most on the enemy side: ${names.hero(theirBest.heroId)} with ${amount(theirBest[stat])}.`);
  }
  if (kind === "damage" && game.card.teamfightShare !== null) {
    lines.push(`You took part in ${Math.round(game.card.teamfightShare * 100)}% of your side's kills.`);
  }
  return lines;
}
