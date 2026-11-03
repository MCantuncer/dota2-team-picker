/**
 * The words on a suggestion card. Every line says why the hero fits this draft and carries the
 * number behind it, in win-rate points ("+3.1" = about 3.1% more likely to win).
 */
import type { Position, ScoreBreakdown } from "./types";

/** One candidate line: `draft` lines come from the picks and bans, `base` lines hold in any draft. */
export interface Line {
  text: string;
  value: number;
  kind: "draft" | "base";
}

/** Lines on a card, before the one warning. */
const MAX_LINES = 4;
/** Fixed (meta, flex) lines kept once the draft gives reasons of its own. */
const MAX_BASE_WITH_DRAFT = 1;

export const ROLE_NAMES: Record<Position, string> = {
  1: "carry",
  2: "mid",
  3: "offlaner",
  4: "soft support",
  5: "hard support",
};

export const RANK_NAMES = ["Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"];

/** "+3.1" or "-2.4". */
export const points = (x: number) => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(1)}`;

export const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
};

/** "A", "A and B", "A, B and C". */
export const list = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? ""));

/** "Axe (+3.1, likely your lane)" for each hero, the biggest first, at most `max`. */
export function namedPoints(items: { name: string; value: number; note?: string }[], max = 2): string {
  return list(
    [...items]
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, max)
      .map((x) => `${x.name} (${points(x.value)}${x.note ? `, ${x.note}` : ""})`),
  );
}

/**
 * Up to MAX_LINES lines: the draft's own reasons first, biggest first, then the fixed ones (all of
 * them only while the draft gives none), and the biggest warning last.
 */
export function pickLines(lines: Line[], warnings: { text: string; value: number }[]): string[] {
  const byValue = (a: { value: number }, b: { value: number }) => b.value - a.value;
  const draft = lines.filter((l) => l.kind === "draft").sort(byValue).slice(0, MAX_LINES);
  const baseRoom = draft.length ? Math.min(MAX_BASE_WITH_DRAFT, MAX_LINES - draft.length) : MAX_LINES;
  const base = lines.filter((l) => l.kind === "base").sort(byValue).slice(0, baseRoom);
  const warn = [...warnings].sort(byValue).slice(0, 1).map((w) => `Watch out: ${w.text.charAt(0).toLowerCase()}${w.text.slice(1)}`);
  return [...draft, ...base].map((l) => l.text).concat(warn);
}

/** One line on where the score comes from: this draft, or what holds in any draft. */
export function summaryOf(b: ScoreBreakdown): string {
  const draft = b.counter + b.synergy + b.teamNeeds + b.pickSafety;
  const base = b.meta + b.positionFit + b.comfort + b.flex;
  return `Score ${points(draft + base)}: ${points(draft)} from this draft, ${points(base)} from meta, role and comfort`;
}
