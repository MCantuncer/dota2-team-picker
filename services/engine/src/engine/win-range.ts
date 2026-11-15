import type { Snapshot } from "./types";

export type WinRangeModel = NonNullable<Snapshot["winRange"]>;

/** What teams with a draft edge like this really won, as a share (0-1) and its 95% range. */
export interface WinRange {
  won: number;
  low: number;
  high: number;
  /** Fair public games the range comes from. */
  games: number;
}

/**
 * The win range for one side once all 10 heroes are picked. `radiantEdge` is Radiant's draft edge
 * over Dire (draftEdge with Radiant's heroes first). The bands are Radiant's real win rates, so
 * Radiant's own head start is counted; Dire gets the other side of the same band. Null when there
 * is no checked model, so nothing unchecked is shown.
 */
export function winRange(model: WinRangeModel | undefined, radiantEdge: number, radiant: boolean): WinRange | null {
  if (!model || !Number.isFinite(radiantEdge)) return null;
  const band = model.bands[bandOf(model.cuts, radiantEdge)];
  if (!band) return null;
  if (radiant) return { won: band.won, low: band.low, high: band.high, games: band.games };
  const flip = (x: number) => Math.round((1 - x) * 10000) / 10000;
  return { won: flip(band.won), low: flip(band.high), high: flip(band.low), games: band.games };
}

/** The band an edge falls in: band i holds edges from cuts[i - 1] up to (not including) cuts[i]. */
export function bandOf(cuts: number[], edge: number): number {
  let index = 0;
  while (index < cuts.length && edge >= cuts[index]!) index++;
  return index;
}
