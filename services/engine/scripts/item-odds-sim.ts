/**
 * Simulated slot questions, to check the bar against the sample one draft really gives (item journey plan,
 * PR 9). Run it with `npm run item-odds-sim`.
 *
 * The lookup gives about 100 games for our hero against 5 enemies, half wins and half losses. Only some of
 * them buy the slot in its 6 minute window (`inWindow`), and of those the second item is usually a minority
 * (`bShare`). Wins are mostly ahead at the minute and losses mostly behind, and players who are behind buy the
 * defensive item more. The bucket shares are a guess until the PR 9b report prints the real ones.
 */
import { type Bucket, type ItemGame, seeded, slotOdds } from "../src/engine/item-odds";

/** Share of each bucket at minute m, by result. */
const BUCKETS: Record<"won" | "lost", [Bucket, number][]> = {
  won: [["ahead", 0.55], ["even", 0.3], ["behind", 0.15]],
  lost: [["ahead", 0.15], ["even", 0.3], ["behind", 0.55]],
};
/** How much more often B is bought when behind, and less when ahead, as an odds factor. */
const STATE_PULL: Record<Bucket, number> = { ahead: 0.5, even: 1, behind: 2 };
const LEAD: Record<Bucket, number> = { ahead: 6000, even: 0, behind: -6000 };
const MINUTE = 15;
const A = 1;
const B = 2;
const OTHER = 3;

function pick<T>(choices: [T, number][], r: number): T {
  let acc = 0;
  for (const [value, share] of choices) {
    acc += share;
    if (r < acc) return value;
  }
  // choices is never empty here (BUCKETS rows have three entries).
  return choices[choices.length - 1]![0];
}

export interface SimSample {
  /** Pooled games of the draft. */
  games: number;
  /** Share of them that bought the slot in the window. */
  inWindow: number;
  /** Share of those that bought B instead of A, before the state and the item's own effect. */
  bShare: number;
}

/** One draft's games with a true odds ratio `oddsRatio` of B against A in every bucket. */
export function simulateGames(s: SimSample, oddsRatio: number, random: () => number): ItemGame[] {
  return Array.from({ length: s.games }, (_, i) => {
    const won = i % 2 === 0;
    const bucket = pick(BUCKETS[won ? "won" : "lost"], random());
    const odds = (s.bShare / (1 - s.bShare)) * STATE_PULL[bucket] * Math.sqrt(oddsRatio) ** (won ? 1 : -1);
    const item = random() >= s.inWindow ? OTHER : random() < odds / (1 + odds) ? B : A;
    // OTHER is bought after the window, so the game is not in this slot's comparison.
    const at = item === OTHER ? (MINUTE + 10) * 60 : (MINUTE + 1) * 60;
    return {
      match: i + 1,
      account: i + 1,
      won,
      level: 25,
      version: 190,
      points: [],
      items: [[item, at]],
      duration: (MINUTE + 20) * 60,
      lead: Array.from({ length: MINUTE + 1 }, () => LEAD[bucket]),
    };
  });
}

/** Of `runs` simulated drafts: the share that show a line, and the geometric mean odds ratio the shown lines print. */
export function simulate(s: SimSample, oddsRatio: number, runs: number, seed = 1): { shows: number; printed: number } {
  const random = seeded(seed);
  const shown: number[] = [];
  for (let r = 0; r < runs; r++) {
    const odds = slotOdds(simulateGames(s, oddsRatio, random), { slot: 1, minute: MINUTE, a: A, b: B }, () => true);
    if (odds.shows) shown.push(Math.log(odds.oddsRatio));
  }
  const printed = shown.length ? Math.exp(shown.reduce((x, y) => x + y, 0) / shown.length) : NaN;
  return { shows: shown.length / runs, printed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  for (const games of [100, 200, 400]) {
    for (const bShare of [0.5, 0.2]) {
      const row = [1, 1.5, 2, 3].map((or) => {
        const r = simulate({ games, inWindow: 0.6, bShare }, or, 2000);
        return `${or}x: ${pct(r.shows)}${Number.isNaN(r.printed) ? "" : ` (prints ${r.printed.toFixed(1)}x)`}`;
      });
      console.log(`${games} games, B ${pct(bShare)}: ${row.join(", ")}`);
    }
  }
}
