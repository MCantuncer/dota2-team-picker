/**
 * Builds one TrendGame per match from every source we have: our saved drafts, STRATZ and
 * OpenDota. STRATZ knows real positions and IMP; OpenDota only lanes and raw stats; a draft
 * knows the planned position, which we use only when no match data tells the position.
 */
import { type HeroBenchmarks, isStrongImp, judgeByBenchmarks } from "./benchmarks.ts";
import { type Position, positionFromLane, type RecentMatch, statValuesOf, type TrendGame } from "./games.ts";

/** A game from our saved drafts where the hero really was the player's (hero_source 'account'). */
export interface DraftGame {
  matchId: number;
  heroId: number;
  startTime: number;
  isWin: boolean;
  position: Position;
}

/** A game from STRATZ, already limited to the counted modes and lobbies. */
export interface StratzGame {
  matchId: number;
  heroId: number;
  startTime: number;
  isWin: boolean;
  position: Position | null;
  imp: number | null;
}

/** A counted OpenDota game and its hero's benchmarks, when we have them. */
export interface OpenDotaGame {
  match: RecentMatch;
  benchmarks: HeroBenchmarks | undefined;
}

/**
 * One game per match, newest first.
 * - Hero and result: STRATZ, then OpenDota, then the draft. A source that names another hero
 *   for the match is ignored, since a draft may hold the pick entered for the position.
 * - Position: STRATZ, then OpenDota lanes, then the draft.
 * - Strength: STRATZ IMP, then OpenDota stats against the benchmarks for that position.
 */
export function mergeGames(drafts: DraftGame[], stratz: StratzGame[], openDota: OpenDotaGame[]): TrendGame[] {
  const ids = new Set([...drafts, ...stratz].map((g) => g.matchId));
  for (const g of openDota) ids.add(g.match.matchId);
  const draftById = new Map(drafts.map((g) => [g.matchId, g]));
  const stratzById = new Map(stratz.map((g) => [g.matchId, g]));
  const openDotaById = new Map(openDota.map((g) => [g.match.matchId, g]));

  const games: TrendGame[] = [];
  for (const id of ids) {
    const s = stratzById.get(id);
    const o = openDotaById.get(id);
    const d = draftById.get(id);
    const base = s ?? o?.match ?? d;
    if (!base) continue;
    const heroId = base.heroId;
    const od = o && o.match.heroId === heroId ? o : undefined;
    const draft = d && d.heroId === heroId ? d : undefined;
    games.push(buildGame(base, s, od, draft));
  }
  return games.sort((a, b) => b.startTime - a.startTime);
}

function buildGame(
  base: { matchId: number; heroId: number; startTime: number; isWin: boolean },
  s: StratzGame | undefined,
  o: OpenDotaGame | undefined,
  d: DraftGame | undefined,
): TrendGame {
  const lanePosition = o ? positionFromLane(o.match) : null;
  const [position, positionSource] = s?.position
    ? [s.position, "stratz" as const]
    : lanePosition
    ? [lanePosition, "opendota" as const]
    : d
    ? [d.position, "draft" as const]
    : [null, null];

  const game: TrendGame = {
    matchId: base.matchId,
    heroId: base.heroId,
    startTime: base.startTime,
    isWin: base.isWin,
    position,
    positionSource,
    isStrong: null,
    imp: s?.imp ?? null,
    percentiles: null,
    statValues: o ? statValuesOf(o.match) : null,
  };
  if (game.imp !== null) {
    game.isStrong = isStrongImp(game.imp);
  } else if (o?.benchmarks && position && game.statValues) {
    const verdict = judgeByBenchmarks(position, game.statValues, o.benchmarks);
    game.isStrong = verdict?.isStrong ?? null;
    game.percentiles = verdict?.percentiles ?? null;
  }
  return game;
}
