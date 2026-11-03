/**
 * The STRATZ queries behind the live matchup lookup (Game Story skill order plan, "Change 2
 * FINAL"), and the checks on their answers. For one of our heroes H at position P and one enemy E:
 * - wins: the latest high-rank guides of H at P against E, games H won;
 * - losses: the latest guides of E against H, games E won, so H lost.
 * Both lists are "a high-rank player won", so comparing two talents within them is fair (the
 * plan's case-control design). Each game keeps H's skill points in order, for the build and
 * the talents.
 */

/** One hero, position and enemy: a cache row of matchup_guides. */
export interface Slice {
  hero: number;
  position: number;
  enemy: number;
}

/** One game of H in a slice, as cached. */
export interface MatchupGame {
  match: number;
  account: number;
  won: boolean;
  /** H's hero level at the end of the game. */
  level: number;
  /** The STRATZ game version (patch letter). */
  version: number;
  /** H's skill points in the order taken: ability, talent or attribute bonus ids. */
  points: number[];
}

/** A guide list asks for this many games; STRATZ gives only the latest ones and ignores `skip`. */
export const GUIDES_PER_LIST = 10;
/** Slices per guide list query: two lists each, under STRATZ's 60 aliases per query. */
export const SLICES_PER_QUERY = 25;
/** Matches per match query. */
export const MATCHES_PER_QUERY = 20;
/** At most this many games of one Steam account in a slice, so one player can't fill it. */
export const GAMES_PER_ACCOUNT = 2;

const POSITION_NAMES = ["POSITION_1", "POSITION_2", "POSITION_3", "POSITION_4", "POSITION_5"];

const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

function checkSlice(s: Slice) {
  if (!isId(s.hero) || !isId(s.enemy) || s.hero === s.enemy || !POSITION_NAMES[s.position - 1]) {
    throw new Error(`Bad slice ${JSON.stringify(s)}`);
  }
}

/** One query with the win list (w) and the loss list (l) of each slice. */
export function guideListQuery(slices: Slice[]): string {
  if (slices.length === 0 || slices.length > SLICES_PER_QUERY) {
    throw new Error(`Expected 1 to ${SLICES_PER_QUERY} slices, got ${slices.length}`);
  }
  const lines = slices.flatMap((s, i) => {
    checkSlice(s);
    const position = POSITION_NAMES[s.position - 1];
    return [
      `    w${i}: guide(heroId: ${s.hero}, positionId: ${position}, againstHeroId: ${s.enemy}, take: ${GUIDES_PER_LIST}) { guides { matchId } }`,
      `    l${i}: guide(heroId: ${s.enemy}, againstHeroId: ${s.hero}, take: ${GUIDES_PER_LIST}) { guides { matchId } }`,
    ];
  });
  return `{\n  heroStats {\n${lines.join("\n")}\n  }\n}`;
}

/** The match ids of one guide list answer, unknown shapes dropped. */
export function guideMatchIds(answer: unknown): number[] {
  // Checked field by field below.
  const guides = (answer as { guides?: unknown } | null)?.guides;
  if (!Array.isArray(guides)) return [];
  return [...new Set(guides.map((g) => g?.matchId).filter(isId))];
}

/** One query for up to MATCHES_PER_QUERY matches, with every player (the loss lists name only E's player). */
export function matchesQuery(ids: number[]): string {
  if (ids.length === 0 || ids.length > MATCHES_PER_QUERY || !ids.every(isId)) {
    throw new Error(`Expected 1 to ${MATCHES_PER_QUERY} match ids, got ${ids.length}`);
  }
  const lines = ids.map((id, i) =>
    `  m${i}: match(id: ${id}) { id gameVersionId players { steamAccountId heroId position level isVictory abilities { abilityId time } } }`
  );
  return `{\n${lines.join("\n")}\n}`;
}

/**
 * H's game in one match answer at position P, or null when H isn't there at P, E isn't on the
 * other team, the result doesn't match the list (`won`), or a field is missing. Points are sorted by time.
 */
export function toMatchupGame(answer: unknown, s: Slice, won: boolean): MatchupGame | null {
  // Checked field by field below.
  const match = answer as { id?: unknown; gameVersionId?: unknown; players?: unknown } | null;
  if (!match || !isId(match.id) || !isId(match.gameVersionId) || !Array.isArray(match.players)) return null;
  // The enemy must be on the other team: their result is the opposite of H's.
  const enemyThere = match.players.some((p) => p?.heroId === s.enemy && p?.isVictory === !won);
  // Checked field by field below.
  const p = match.players.find((p) => p?.heroId === s.hero) as {
    steamAccountId?: unknown;
    position?: unknown;
    level?: unknown;
    isVictory?: unknown;
    abilities?: unknown;
  } | undefined;
  if (!p || !enemyThere || p.position !== POSITION_NAMES[s.position - 1] || p.isVictory !== won) return null;
  if (!isId(p.steamAccountId) || !isId(p.level) || !Array.isArray(p.abilities)) return null;
  const points = p.abilities.filter((a): a is { abilityId: number; time: number } =>
    isId(a?.abilityId) && typeof a?.time === "number"
  );
  // A point without its id or time would shift every later level, so the game is dropped.
  if (points.length !== p.abilities.length) return null;
  return {
    match: match.id,
    account: p.steamAccountId,
    won,
    level: p.level,
    version: match.gameVersionId,
    points: [...points].sort((a, b) => a.time - b.time).map((a) => a.abilityId),
  };
}

/**
 * A slice's games: this patch only (version at least `fromVersion`), each match once, at most
 * GAMES_PER_ACCOUNT per Steam account, in the order given (newest first from STRATZ).
 */
export function sliceGames(games: (MatchupGame | null)[], fromVersion: number): MatchupGame[] {
  const seen = new Set<number>();
  const perAccount = new Map<number, number>();
  return games.filter((g): g is MatchupGame => {
    if (!g || g.version < fromVersion || seen.has(g.match)) return false;
    const n = perAccount.get(g.account) ?? 0;
    if (n >= GAMES_PER_ACCOUNT) return false;
    seen.add(g.match);
    perAccount.set(g.account, n + 1);
    return true;
  });
}

/** STRATZ queries a lookup of `slices` uncached slices can take at most: one list query, then the matches. */
export function queriesNeeded(slices: number): number {
  if (slices <= 0) return 0;
  return Math.ceil(slices / SLICES_PER_QUERY) + Math.ceil((slices * 2 * GUIDES_PER_LIST) / MATCHES_PER_QUERY);
}
