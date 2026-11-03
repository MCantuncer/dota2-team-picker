/**
 * The words on a hero pool card: a question and a reason that quotes the player's own
 * numbers. Rates are shown as one win %, never as raw won-lost pairs.
 */
import type { BenchmarkStat } from "./benchmarks.ts";
import type { Position } from "./games.ts";
import type { PoolCandidate } from "./rules.ts";

/** Position names as the site shows them (pos 1 to 5). */
export const POSITION_NAMES: Record<Position, string> = {
  1: "carry",
  2: "mid",
  3: "offlane",
  4: "soft support",
  5: "hard support",
};

const STAT_LABELS: Record<BenchmarkStat, string> = {
  gold_per_min: "GPM",
  xp_per_min: "XPM",
  last_hits_per_min: "last hits per minute",
  hero_damage_per_min: "hero damage per minute",
  kills_per_min: "kills per minute",
  hero_healing_per_min: "healing per minute",
};

export interface PoolCardText {
  question: string;
  reason: string;
}

/** The card's question and reason, e.g. for Monkey King at pos 1. */
export function poolCardText(candidate: PoolCandidate, heroName: string): PoolCardText {
  const role = POSITION_NAMES[candidate.position];
  const where = candidate.isPositionFromDraftsOnly
    ? `as ${role} in your drafts`
    : `as ${role} (pos ${candidate.position})`;
  const winPct = Math.round((candidate.wins / candidate.games) * 100);
  const lines = [`You won ${winPct}% of your last ${candidate.games} ${heroName} games ${where}.`];
  const standout = standoutLine(candidate, heroName);
  if (standout) lines.push(standout);
  return { question: `Add ${heroName} to your ${role} heroes?`, reason: lines.join(" ") };
}

function standoutLine({ standout }: PoolCandidate, heroName: string): string | null {
  if (!standout) return null;
  if (standout.kind === "imp") {
    const imp = Math.round(standout.averageImp);
    return `Your STRATZ IMP averaged ${imp > 0 ? "+" : ""}${imp} (0 is an average game).`;
  }
  const value = standout.averageValue >= 100
    ? String(Math.round(standout.averageValue))
    : standout.averageValue.toFixed(1);
  const pct = Math.round(standout.averagePercentile * 100);
  return `Your ${
    STAT_LABELS[standout.stat]
  } averaged ${value}, higher than ${pct}% of ${heroName} games on OpenDota (all ranks).`;
}
