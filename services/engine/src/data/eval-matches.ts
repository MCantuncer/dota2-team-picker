/**
 * Real ranked games saved for the engine backtest: the order heroes were picked in,
 * the bans, each player's position and who won. Kept apart from the snapshot so the
 * backtest can score the engine on games it never learned from.
 */
import type { PublicMatch } from "./fetch";
import type { ItemInfo, Position } from "../engine/types";

/** One saved ranked All Pick game. */
export interface EvalMatch {
  id: number;
  /** Unix seconds. */
  startTime: number;
  /** Average OpenDota rank tier of the ranked players (54 = Legend 4), when known. */
  rankTier: number | null;
  radiantWin: boolean;
  /**
   * All 10 picks in the order they were made. `position` is null when STRATZ could not tell. `items` holds the item
   * ids in the hero's six main slots when the game ended, and `neutral` its neutral item, for the Meta page's builds;
   * both are missing in games saved before 2026-11-21 and when OpenDota did not send them. `buys` holds the minute
   * each finished item was first bought, as [item id, minute], in games OpenDota has parsed (about half of high-rank
   * games); missing before 2026-11-22. `enchant` is the enchantment on the neutral item when the game ended, and
   * `crafts` each neutral craft of a parsed game as [artifact id, enchantment id or 0, minute], in order; both are
   * missing before 2026-11-25.
   */
  picks: {
    heroId: number;
    radiant: boolean;
    position: Position | null;
    items?: number[];
    neutral?: number;
    enchant?: number;
    buys?: [number, number][];
    crafts?: [number, number, number][];
  }[];
  /** Banned heroes. In ranked All Pick every ban is known before the first pick. */
  bans: number[];
}

/** The parts of OpenDota's /matches/{id} answer the backtest uses. */
export interface MatchDetail {
  match_id: number;
  radiant_win: boolean;
  duration: number;
  game_mode: number;
  lobby_type: number;
  start_time: number;
  picks_bans?: { is_pick: boolean; hero_id: number; team: number; order: number }[] | null;
  /** Each player's hero and the items they ended the game with (0 for an empty slot). */
  players?: MatchPlayer[] | null;
}

export interface MatchPlayer {
  hero_id: number;
  item_0?: number | null;
  item_1?: number | null;
  item_2?: number | null;
  item_3?: number | null;
  item_4?: number | null;
  item_5?: number | null;
  item_neutral?: number | null;
  /** The enchantment on the neutral item. */
  item_neutral2?: number | null;
  /** Each neutral craft of a parsed game: seconds from the horn, the artifact and the enchantment, by internal name. */
  neutral_item_history?: { time?: unknown; item_neutral?: unknown; item_neutral_enhancement?: unknown }[] | null;
  /** Seconds from the horn when each item was first bought, keyed by internal name; parsed games only. */
  first_purchase_time?: Record<string, number> | null;
}

const SLOTS = ["item_0", "item_1", "item_2", "item_3", "item_4", "item_5"] as const;
const isItemId = (x: unknown): x is number => Number.isInteger(x) && (x as number) > 0;

/** Each hero's end-of-game items from the players list: main slots without empty ones, the neutral item and its enchantment. */
export function finalItems(players: MatchDetail["players"]): Map<number, { items: number[]; neutral?: number; enchant?: number }> {
  const out = new Map<number, { items: number[]; neutral?: number; enchant?: number }>();
  for (const p of Array.isArray(players) ? players : []) {
    if (!isItemId(p?.hero_id)) continue;
    const items = SLOTS.map((slot) => p[slot]).filter(isItemId);
    out.set(p.hero_id, {
      items,
      ...(isItemId(p.item_neutral) ? { neutral: p.item_neutral } : {}),
      ...(isItemId(p.item_neutral) && isItemId(p.item_neutral2) ? { enchant: p.item_neutral2 } : {}),
    });
  }
  return out;
}

/**
 * Each hero's neutral crafts from a parsed game's history, as [artifact id, enchantment id or 0, minute] in order.
 * `ids` maps neutral items' internal names to ids (the snapshot's neutral pool); crafts of unknown artifacts are left out.
 */
export function neutralCrafts(players: MatchDetail["players"], ids: Map<string, number>): Map<number, [number, number, number][]> {
  const out = new Map<number, [number, number, number][]>();
  for (const p of Array.isArray(players) ? players : []) {
    const history = p?.neutral_item_history;
    if (!isItemId(p?.hero_id) || !Array.isArray(history)) continue;
    const crafts = history.flatMap((h): [number, number, number][] => {
      const artifact = typeof h?.item_neutral === "string" ? ids.get(h.item_neutral) : undefined;
      const enchant = typeof h?.item_neutral_enhancement === "string" ? (ids.get(h.item_neutral_enhancement) ?? 0) : 0;
      return artifact !== undefined && typeof h.time === "number" && Number.isFinite(h.time) ? [[artifact, enchant, Math.max(0, Math.round(h.time / 60))]] : [];
    });
    if (crafts.length) out.set(p.hero_id, crafts);
  }
  return out;
}

/** Items cheaper than this are consumables, wards and small parts; their buy minute says nothing about a build. */
export const MIN_BUY_COST = 400;

/**
 * The items whose buy minute is kept, by internal name: finished items from MIN_BUY_COST up (Magic Wand, Bracer,
 * Power Treads, Black King Bar) and basic items that are not part of another item (Blink Dagger). Parts like
 * Ogre Axe or Boots of Speed are left out: a build is read from what they become.
 */
export function buyItemIds(items: Record<string, ItemInfo>): Map<string, number> {
  const parts = new Set(Object.values(items).flatMap((it) => it.components));
  const out = new Map<string, number>();
  for (const [id, it] of Object.entries(items)) {
    if (it.cost >= MIN_BUY_COST && (it.components.length > 0 || !parts.has(Number(id)))) out.set(it.key, Number(id));
  }
  return out;
}

/** Each hero's first buy minute of every kept item, earliest first, from a parsed game's players. */
export function buyTimes(players: MatchDetail["players"], keep: Map<string, number>): Map<number, [number, number][]> {
  const out = new Map<number, [number, number][]>();
  for (const p of Array.isArray(players) ? players : []) {
    const times = p?.first_purchase_time;
    if (!isItemId(p?.hero_id) || typeof times !== "object" || times === null) continue;
    const buys = Object.entries(times)
      .flatMap(([key, s]): [number, number][] => {
        const id = keep.get(key);
        return id !== undefined && Number.isFinite(s) ? [[id, Math.max(0, Math.round(s / 60))]] : [];
      })
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    if (buys.length) out.set(p.hero_id, buys);
  }
  return out;
}

const RANKED_ALL_PICK = 22;
const RANKED_LOBBY = 7;
const MIN_DURATION_S = 15 * 60;

/** True for a finished ranked All Pick game with all 10 heroes known: worth asking OpenDota about. */
export function isCandidate(m: PublicMatch): boolean {
  return (
    m.game_mode === RANKED_ALL_PICK &&
    m.lobby_type === RANKED_LOBBY &&
    m.duration >= MIN_DURATION_S &&
    [m.radiant_team, m.dire_team].every((t) => t?.length === 5 && !t.includes(0))
  );
}

/**
 * Builds an EvalMatch from OpenDota's match details and STRATZ positions (hero id to
 * position). Returns null when the answer is not a complete ranked draft: wrong mode,
 * too short, or picks that are missing, repeated or not 5 a side. With `keep` (see
 * buyItemIds), picks of a parsed game get their buy minutes; with `neutralIds` (neutral items' internal names to ids),
 * their neutral crafts.
 */
export function toEvalMatch(
  detail: MatchDetail,
  rankTier: number | null,
  positions: Map<number, Position> | undefined,
  keep?: Map<string, number>,
  neutralIds?: Map<string, number>,
): EvalMatch | null {
  if (detail.game_mode !== RANKED_ALL_PICK || detail.lobby_type !== RANKED_LOBBY) return null;
  if (detail.duration < MIN_DURATION_S || typeof detail.radiant_win !== "boolean") return null;
  const rows = Array.isArray(detail.picks_bans) ? detail.picks_bans : [];
  const ended = finalItems(detail.players);
  const bought = keep ? buyTimes(detail.players, keep) : new Map<number, [number, number][]>();
  const crafted = neutralIds ? neutralCrafts(detail.players, neutralIds) : new Map<number, [number, number, number][]>();
  const valid = rows.filter((r) => Number.isInteger(r.hero_id) && r.hero_id > 0 && (r.team === 0 || r.team === 1));
  const picks = valid
    .filter((r) => r.is_pick)
    .sort((a, b) => a.order - b.order)
    .map((r) => {
      const buys = bought.get(r.hero_id);
      const crafts = crafted.get(r.hero_id);
      return {
        heroId: r.hero_id,
        radiant: r.team === 0,
        position: positions?.get(r.hero_id) ?? null,
        ...ended.get(r.hero_id),
        ...(buys ? { buys } : {}),
        ...(crafts ? { crafts } : {}),
      };
    });
  const heroes = new Set(picks.map((p) => p.heroId));
  if (picks.length !== 10 || heroes.size !== 10 || picks.filter((p) => p.radiant).length !== 5) return null;
  const bans = [...new Set(valid.filter((r) => !r.is_pick).map((r) => r.hero_id))].filter((id) => !heroes.has(id));
  return { id: detail.match_id, startTime: detail.start_time, rankTier, radiantWin: detail.radiant_win, picks, bans };
}

/** True when `x` has the shape of a saved game, for files read back from storage. */
export function isEvalMatch(x: unknown): x is EvalMatch {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  const pick = (p: unknown) => {
    const q = p as Record<string, unknown> | null;
    return (
      typeof q === "object" &&
      q !== null &&
      Number.isInteger(q.heroId) &&
      typeof q.radiant === "boolean" &&
      (q.position === null || [1, 2, 3, 4, 5].includes(q.position as number)) &&
      (q.items === undefined || (Array.isArray(q.items) && q.items.every(isItemId))) &&
      (q.neutral === undefined || isItemId(q.neutral)) &&
      (q.enchant === undefined || isItemId(q.enchant)) &&
      (q.crafts === undefined ||
        (Array.isArray(q.crafts) && q.crafts.every((c) => Array.isArray(c) && c.length === 3 && isItemId(c[0]) && Number.isInteger(c[1]) && c[1] >= 0 && Number.isInteger(c[2]) && c[2] >= 0))) &&
      (q.buys === undefined || (Array.isArray(q.buys) && q.buys.every((b) => Array.isArray(b) && b.length === 2 && isItemId(b[0]) && Number.isInteger(b[1]) && b[1] >= 0)))
    );
  };
  return (
    Number.isInteger(m.id) &&
    Number.isFinite(m.startTime) &&
    (m.rankTier === null || Number.isFinite(m.rankTier)) &&
    typeof m.radiantWin === "boolean" &&
    Array.isArray(m.picks) &&
    m.picks.every(pick) &&
    Array.isArray(m.bans) &&
    m.bans.every(Number.isInteger)
  );
}

/** Storage path for the month a match started in, such as `eval/matches-2026-10.json`. */
export function monthPath(startTime: number): string {
  return `eval/matches-${new Date(startTime * 1000).toISOString().slice(0, 7)}.json`;
}

/** Adds new matches to saved ones, skipping ids already saved, oldest first. */
export function mergeMatches(saved: EvalMatch[], added: EvalMatch[]): EvalMatch[] {
  const byId = new Map(saved.map((m) => [m.id, m]));
  for (const m of added) if (!byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.startTime - b.startTime || a.id - b.id);
}
