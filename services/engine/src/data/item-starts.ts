/**
 * What players start the game with and which boots they buy, per hero and main position, from
 * STRATZ, for the start and boots of each player's item path. Every rank together: starting items
 * barely change with rank, and one slice per hero and position keeps it to about 9 queries a day.
 */
import { isUpgradedBoots } from "../engine/item-build";
import type { ItemInfo, ItemStart, Position, Snapshot } from "../engine/types";
import { timingRequests } from "./item-timings";

/** Two aliases (start items and boots) per hero and position. */
export const STARTS_PER_QUERY = 30;
/** An item is part of the start when this share of games buy it at the horn... */
const START_SHARE = 0.3;
/** ...and a second or third copy counts when this share buy that copy too. */
const COPY_SHARE = 0.5;
const START_ITEMS = 6;
/** Boots bought after this minute (Travel, Bearing) are late items, not the lane boots. */
const BOOTS_LAST_MINUTE = 20;
/** A second pair of boots is shown as "or" when this share of boot buyers pick it. */
const BOOTS_OR_SHARE = 0.2;
const BOOTS_KEPT = 2;

export interface StartRequest {
  heroId: number;
  position: Position;
}

/** One row of STRATZ's itemStartingPurchase. */
export interface StartRow {
  itemId: number;
  /** Marked as given by STRATZ, like a support's spare Tango. Counted with the bought copies. */
  wasGiven: boolean;
  /** 0 for the first copy, 1 for the second. */
  instance: number;
  matchCount: number;
  winCount: number;
}

/** One row of STRATZ's itemBootPurchase. */
export interface BootRow {
  itemId: number;
  /** Seconds into the game, summed over all its purchases. */
  time: number;
  matchCount: number;
  winCount: number;
}

/** Each hero's main positions (see timingRequests), once each. */
export function startRequests(positions: NonNullable<Snapshot["positions"]>): StartRequest[] {
  return timingRequests(positions)
    .filter((r) => r.slice === "all")
    .map(({ heroId, position }) => ({ heroId, position }));
}

/** One query with two aliases per request: a0/b0 for the first, a1/b1 for the second, ... */
export function itemStartsQuery(requests: StartRequest[]): string {
  if (requests.length === 0 || requests.length > STARTS_PER_QUERY) {
    throw new Error(`Expected 1 to ${STARTS_PER_QUERY} heroes, got ${requests.length}`);
  }
  const lines = requests.flatMap((r, i) => {
    if (!Number.isSafeInteger(r.heroId)) throw new Error(`Bad hero id ${r.heroId}`);
    const args = `heroId: ${r.heroId}, positionIds: [POSITION_${r.position}]`;
    return [
      `    a${i}: itemStartingPurchase(${args}) { itemId wasGiven instance matchCount winCount }`,
      `    b${i}: itemBootPurchase(${args}) { itemId time matchCount winCount }`,
    ];
  });
  return `{\n  heroStats {\n${lines.join("\n")}\n  }\n}`;
}

/** Keeps the rows that have the expected shape; STRATZ is a third party. */
function validRows<T>(rows: unknown, keys: string[]): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (r): r is T =>
      typeof r === "object" && r !== null && keys.every((k) => typeof (r as Record<string, unknown>)[k] === (k === "wasGiven" ? "boolean" : "number")),
  );
}

/** Turns one hero and position's rows into its usual start and boots, or null without start data. */
export function toItemStart(starts: StartRow[], boots: BootRow[], items: Record<string, ItemInfo>): ItemStart | null {
  // STRATZ marks some copies as given (a support's spare Tango, half of all second Iron Branches).
  // They are in the player's hands at the horn either way, so they count with the bought ones.
  const held = new Map<string, number>();
  for (const r of starts) {
    if (r.matchCount <= 0 || !items[r.itemId]) continue;
    const key = `${r.itemId}-${r.instance}`;
    held.set(key, (held.get(key) ?? 0) + r.matchCount);
  }
  if (held.size === 0) return null;
  const games = Math.max(...held.values());
  const share = (id: number, instance: number) => (held.get(`${id}-${instance}`) ?? 0) / games;
  const start = [...new Set(starts.filter((r) => held.has(`${r.itemId}-${r.instance}`)).map((r) => r.itemId))]
    .filter((id) => share(id, 0) >= START_SHARE)
    .sort((a, b) => share(b, 0) - share(a, 0))
    .slice(0, START_ITEMS)
    .map((id): [number, number] => {
      let count = 1;
      while (share(id, count) >= COPY_SHARE) count++;
      return [id, count];
    });
  const pairs = boots.filter((r) => r.matchCount > 0 && isUpgradedBoots(items[r.itemId]));
  const buyers = pairs.reduce((n, r) => n + r.matchCount, 0);
  const kept = pairs
    .map((r) => ({ id: r.itemId, minute: r.time / r.matchCount / 60, share: r.matchCount / buyers }))
    .filter((b) => b.minute <= BOOTS_LAST_MINUTE)
    .sort((a, b) => b.share - a.share)
    .filter((b, i) => i === 0 || b.share >= BOOTS_OR_SHARE)
    .slice(0, BOOTS_KEPT)
    .map((b): [number, number, number] => [b.id, Math.round(b.minute), Math.round(b.share * 100) / 100]);
  return { games, start, boots: kept };
}

/** Downloads the start items and boots of every hero's main positions into the snapshot. */
export async function fetchItemStarts(
  snapshot: Snapshot,
  post: (query: string) => Promise<{ heroStats?: Record<string, unknown> | null }>,
) {
  const items = snapshot.items;
  if (!snapshot.positions || !items) throw new Error("Start items need positions and items first");
  const requests = startRequests(snapshot.positions);
  const out: NonNullable<Snapshot["itemStarts"]> = {};
  for (let i = 0; i < requests.length; i += STARTS_PER_QUERY) {
    const batch = requests.slice(i, i + STARTS_PER_QUERY);
    const stats = (await post(itemStartsQuery(batch))).heroStats;
    if (!stats) throw new Error("STRATZ start items failed: no heroStats in the answer");
    batch.forEach((r, j) => {
      const start = toItemStart(
        validRows<StartRow>(stats[`a${j}`], ["itemId", "wasGiven", "instance", "matchCount", "winCount"]),
        validRows<BootRow>(stats[`b${j}`], ["itemId", "time", "matchCount", "winCount"]),
        items,
      );
      if (start) (out[r.heroId] ??= {})[r.position] = start;
    });
  }
  snapshot.itemStarts = out;
}
