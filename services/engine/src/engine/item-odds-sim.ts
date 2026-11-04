/**
 * Simulated slot questions, to pick a bar the real samples can reach (item journey plan, PR 9).
 *
 * The lookup's samples are skewed by construction: our hero's guide wins are mostly ahead at minute m and
 * the enemies' guide wins (our losses) mostly behind, and players who are behind buy the defensive item more.
 * The simulation copies that: half wins, half losses, lead buckets by result, item B more likely when behind,
 * and a true odds ratio of B against A inside each bucket.
 */
import { type Bucket, type ItemGame, seeded, slotOdds } from "./item-odds";

/** Share of each bucket at minute m, by result. */
const BUCKETS: Record<"won" | "lost", [Bucket, number][]> = {
  won: [["ahead", 0.55], ["even", 0.3], ["behind", 0.15]],
  lost: [["ahead", 0.15], ["even", 0.3], ["behind", 0.55]],
};
/** Chance of buying B (the defensive item) by state, before the item's own effect. */
const B_SHARE: Record<Bucket, number> = { ahead: 0.3, even: 0.5, behind: 0.7 };
const LEAD: Record<Bucket, number> = { ahead: 6000, even: 0, behind: -6000 };
const MINUTE = 15;
const A = 1;
const B = 2;

function pick<T>(choices: [T, number][], r: number): T {
  let acc = 0;
  for (const [value, share] of choices) {
    acc += share;
    if (r < acc) return value;
  }
  return choices[choices.length - 1]![0];
}

/** `n` games of one question with a true odds ratio `oddsRatio` of B against A in every bucket. */
export function simulateGames(n: number, oddsRatio: number, random: () => number): ItemGame[] {
  return Array.from({ length: n }, (_, i) => {
    const won = i % 2 === 0;
    const bucket = pick(BUCKETS[won ? "won" : "lost"], random());
    const base = B_SHARE[bucket] / (1 - B_SHARE[bucket]);
    const odds = base * Math.sqrt(oddsRatio) ** (won ? 1 : -1);
    const item = random() < odds / (1 + odds) ? B : A;
    return {
      match: i + 1,
      account: i + 1,
      won,
      level: 25,
      version: 190,
      points: [],
      items: [[item, (MINUTE + 1) * 60]],
      duration: (MINUTE + 20) * 60,
      lead: Array.from({ length: MINUTE + 1 }, () => LEAD[bucket]),
    };
  });
}

/** The share of `runs` simulated questions of `n` games that show a line, at a true odds ratio. */
export function showRate(n: number, oddsRatio: number, runs: number, seed = 1): number {
  const random = seeded(seed);
  let shown = 0;
  for (let r = 0; r < runs; r++) {
    const odds = slotOdds(simulateGames(n, oddsRatio, random), { slot: 1, minute: MINUTE, a: A, b: B }, () => true);
    if (odds.shows) shown++;
  }
  return shown / runs;
}
