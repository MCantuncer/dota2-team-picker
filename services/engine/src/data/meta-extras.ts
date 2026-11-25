/**
 * The Meta page's hero card extras, added to meta.json next to the daily numbers (see meta.ts):
 *
 * - Builds: the items each hero ended its games with this patch, per position, from the saved ranked games
 *   (eval-matches.ts keeps each pick's end-of-game items). Only the share of games is kept, not a win rate per
 *   item: an item a hero finished is a sign the game went well, so its win rate says more about the game than
 *   the item (finished Diffusal Blade won 47% and Disperser 70% in the same games).
 * - New items: the items in the item list now that were not in it the day before the patch, and the heroes
 *   that end games with them.
 * - Matchups: the enemies each hero wins and loses most against, from the snapshot's matchups, which are this
 *   patch's games while the patch is young (see patch-matchups.ts).
 * - Patch notes: each hero's biggest changes in the patch (see patch-notes.ts).
 */
import type { EvalMatch } from "./eval-matches";
import type { MetaFile } from "./meta";
import type { HeroPatchNotes } from "./patch-notes";
import type { GamesWins, ItemInfo, NeutralItem, Snapshot } from "../engine/types";

export interface MetaExtras {
  /** Saved ranked games of this patch with end-of-game items: the games the builds and new items come from. */
  buildGames: number;
  builds: Builds;
  newItems: NewItem[];
  matchups: Record<string, { best: Matchup[]; worst: Matchup[] }>;
  /** The shop data of every item in the builds and new items, for the page's item cards. Neutral items have none. */
  items: Record<string, ItemInfo>;
  /** The tooltip of every neutral item in the builds (tier, spell, bonuses), for the page's item cards. */
  neutralItems: Record<string, NeutralItem>;
  /** Each hero's biggest changes in the patch; empty when the notes could not be read. */
  patchNotes: HeroPatchNotes;
}

/** A hero's games in a position, and how many of them ended with each item: [item id, games], most first. */
export interface HeroBuild {
  games: number;
  items: [number, number][];
  neutral: [number, number][];
  /** Games with buy minutes (parsed games); the buy minute fields are left out when there are too few. */
  buyGames?: number;
  /** The usual minute each item in `items` is first bought: [item id, median minute]. */
  minutes?: [number, number][];
  /** Items under EARLY_MAX_COST bought by EARLY_MINUTE: [item id, games of buyGames], most first. */
  early?: [number, number][];
}

/** Per hero id, per position "1" to "5" and "0" for every position. */
export type Builds = Record<string, Record<string, HeroBuild>>;

/** A position's games needed to show its build; fewer and one game moves a share by several points. */
export const MIN_BUILD_GAMES = 40;
/** Items that end at least this share of a position's games are kept, at most BUILD_ITEMS of them. */
export const MIN_ITEM_SHARE = 0.05;
export const BUILD_ITEMS = 12;
export const NEUTRAL_ITEMS = 6;
/**
 * Items that cost less are left out of builds: branches, tangos, wards and the parts of an unfinished item say
 * where a game stopped, not what the hero builds. Magic Wand (450) and Boots of Speed (500) stay in.
 */
export const MIN_BUILD_COST = 400;
/** Games with buy minutes a position needs before its minutes and early items show. */
export const MIN_BUY_GAMES = 10;
/** Buys of an item needed for its usual minute. */
export const MIN_ITEM_BUYS = 3;
/** Early items: cheaper than this, bought by this minute, in at least EARLY_SHARE of the games, at most EARLY_ITEMS. */
export const EARLY_MAX_COST = 2000;
export const EARLY_MINUTE = 12;
export const EARLY_SHARE = 0.15;
export const EARLY_ITEMS = 4;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

const count = (map: Map<number, number>, id: number) => map.set(id, (map.get(id) ?? 0) + 1);
const top = (map: Map<number, number>, games: number, share: number, max: number): [number, number][] =>
  [...map]
    .filter(([, n]) => n >= games * share)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, max);

/**
 * Each hero's builds from the saved games that started at or after `since` (Unix seconds). Picks without items
 * (games saved before items were kept) are skipped. Items missing from `items` (recipes, removed items) and
 * cheaper than MIN_BUILD_COST are left out. A used-up neutral item (Disgraced Regalia) counts as the one it was.
 */
export function heroBuilds(games: EvalMatch[], since: number, items: Record<string, ItemInfo>, neutrals: Record<string, NeutralItem> = {}): Builds {
  type Count = { games: number; items: Map<number, number>; neutral: Map<number, number>; buyGames: number; minutes: Map<number, number[]>; early: Map<number, number> };
  const counts = new Map<string, Count>();
  for (const game of games) {
    if (game.startTime < since) continue;
    for (const pick of game.picks) {
      if (!pick.items) continue;
      for (const position of pick.position ? [0, pick.position] : [0]) {
        const key = `${pick.heroId}:${position}`;
        const c: Count = counts.get(key) ?? { games: 0, items: new Map(), neutral: new Map(), buyGames: 0, minutes: new Map(), early: new Map() };
        counts.set(key, c);
        c.games++;
        // An item held twice (two Bracers) counts once: the share is of games.
        for (const id of new Set(pick.items)) if ((items[id]?.cost ?? 0) >= MIN_BUILD_COST) count(c.items, id);
        if (pick.neutral) count(c.neutral, neutrals[pick.neutral]?.brokenOf ?? pick.neutral);
        if (pick.buys) {
          c.buyGames++;
          for (const [id, minute] of pick.buys) {
            c.minutes.set(id, [...(c.minutes.get(id) ?? []), minute]);
            if (minute <= EARLY_MINUTE && (items[id]?.cost ?? Infinity) < EARLY_MAX_COST) count(c.early, id);
          }
        }
      }
    }
  }
  const out: Builds = {};
  for (const [key, c] of counts) {
    if (c.games < MIN_BUILD_GAMES) continue;
    const [hero, position] = key.split(":") as [string, string];
    const build: HeroBuild = {
      games: c.games,
      items: top(c.items, c.games, MIN_ITEM_SHARE, BUILD_ITEMS),
      neutral: top(c.neutral, c.games, MIN_ITEM_SHARE, NEUTRAL_ITEMS),
    };
    if (c.buyGames >= MIN_BUY_GAMES) {
      build.buyGames = c.buyGames;
      build.minutes = build.items.flatMap(([id]): [number, number][] => {
        const m = c.minutes.get(id) ?? [];
        return m.length >= MIN_ITEM_BUYS ? [[id, median(m)]] : [];
      });
      build.early = top(c.early, c.buyGames, EARLY_SHARE, EARLY_ITEMS);
    }
    (out[hero] ??= {})[position] = build;
  }
  return out;
}

/** A new item: the games of this patch that ended with it, and the heroes holding it most: [hero id, games]. */
export interface NewItem {
  id: number;
  games: number;
  heroes: [number, number][];
}

/** Heroes listed per new item. */
export const NEW_ITEM_HEROES = 5;

/** Ids in the item list now that the list from before the patch did not have. */
export function newItemIds(now: Record<string, ItemInfo>, before: Record<string, ItemInfo>): number[] {
  return Object.keys(now)
    .filter((id) => !(id in before))
    .map(Number)
    .sort((a, b) => a - b);
}

/** How often each new item ended a game this patch, and on which heroes, most played first. */
export function newItemUse(ids: number[], games: EvalMatch[], since: number): NewItem[] {
  const wanted = new Set(ids);
  const byItem = new Map<number, Map<number, number>>(ids.map((id) => [id, new Map()]));
  for (const game of games) {
    if (game.startTime < since) continue;
    for (const pick of game.picks) {
      for (const id of new Set([...(pick.items ?? []), ...(pick.neutral ? [pick.neutral] : [])])) {
        if (wanted.has(id)) count(byItem.get(id)!, pick.heroId);
      }
    }
  }
  return ids
    .map((id) => {
      const heroes = byItem.get(id)!;
      return { id, games: [...heroes.values()].reduce((a, b) => a + b, 0), heroes: top(heroes, 0, 0, NEW_ITEM_HEROES) };
    })
    .sort((a, b) => b.games - a.games || a.id - b.id);
}

/** An enemy as [hero id, the hero's win rate against it in percent to one decimal, games]. */
export type Matchup = [number, number, number];

/** Enemies listed per side, and the games a pair needs to be listed. */
export const MATCHUPS_SHOWN = 5;
export const MIN_PAIR_GAMES = 500;

/**
 * Per hero, the enemies it wins most and least against, adjusted for each enemy's strength: the gap between the
 * win rate against an enemy and the hero's own average, plus how far that enemy's overall win rate is from 50%.
 * So an enemy that beats everyone does not show as a counter, and a weak enemy a hero still loses to does.
 * The best side lists enemies the hero beats more than its average, the worst side those it beats less.
 */
export function heroMatchups(matchups: Record<string, Record<string, GamesWins>>): Record<string, { best: Matchup[]; worst: Matchup[] }> {
  const pairsOf = (hero: string) => Object.entries(matchups[hero] ?? {}).filter(([id, gw]) => id !== hero && gw.games >= MIN_PAIR_GAMES && gw.wins <= gw.games);
  // Each hero's win rate over all its listed matchups.
  const overall = new Map<number, number>();
  for (const hero of Object.keys(matchups)) {
    const pairs = pairsOf(hero);
    const games = pairs.reduce((n, [, gw]) => n + gw.games, 0);
    if (games > 0) overall.set(Number(hero), pairs.reduce((n, [, gw]) => n + gw.wins, 0) / games);
  }
  const out: Record<string, { best: Matchup[]; worst: Matchup[] }> = {};
  for (const hero of Object.keys(matchups)) {
    const pairs = pairsOf(hero);
    const average = overall.get(Number(hero));
    if (pairs.length < MATCHUPS_SHOWN * 2 || average === undefined) continue;
    const rows = pairs
      .map(([id, gw]) => {
        const rate = gw.wins / gw.games;
        return { id: Number(id), rate, games: gw.games, score: rate - average + ((overall.get(Number(id)) ?? 0.5) - 0.5) };
      })
      .sort((a, b) => b.score - a.score || a.id - b.id);
    const row = (r: (typeof rows)[number]): Matchup => [r.id, Math.round(r.rate * 1000) / 10, r.games];
    out[hero] = {
      best: rows.filter((r) => r.rate > average).slice(0, MATCHUPS_SHOWN).map(row),
      worst: rows.filter((r) => r.rate < average).reverse().slice(0, MATCHUPS_SHOWN).map(row),
    };
  }
  return out;
}

export interface ExtrasDeps {
  /** The saved ranked games that started from `since` to `now` (Unix seconds). */
  games: (since: number, now: number) => Promise<EvalMatch[]>;
  /** The item list from the hero data of the day before `patchStart`, or null when there is no copy of that day. */
  itemsBefore: (patchStart: number) => Promise<Record<string, ItemInfo> | null>;
  /** Each hero's patch notes for the patch; throws when they cannot be read. */
  patchNotes: (patch: string) => Promise<HeroPatchNotes>;
}

/**
 * The hero card extras at `now`. The new items found for this patch in `last` (the published file) are kept, so
 * the item list from before the patch is read once per patch.
 */
export async function buildExtras(
  deps: ExtrasDeps,
  snapshot: Pick<Snapshot, "patch" | "items" | "matchups" | "neutrals">,
  now: number,
  last: MetaFile | null,
): Promise<MetaExtras> {
  if (!snapshot.patch) throw new Error("The snapshot has no patch");
  const since = Date.parse(snapshot.patch.startedAt) / 1000;
  if (!Number.isFinite(since)) throw new Error(`Patch ${snapshot.patch.name} has no start time`);
  const items = snapshot.items ?? {};
  const games = (await deps.games(since, now)).filter((g) => g.startTime >= since);
  const samePatch = last?.patch.name === snapshot.patch.name && last.patch.startedAt === snapshot.patch.startedAt;
  let ids = samePatch ? (last.extras?.newItems.map((n) => n.id) ?? []) : [];
  if (ids.length === 0) {
    const before = await deps.itemsBefore(since);
    ids = before ? newItemIds(items, before) : [];
  }
  let notes: HeroPatchNotes;
  try {
    notes = await deps.patchNotes(snapshot.patch.name);
  } catch (err) {
    // The rest of the extras still go out; the notes of the last run of this patch are kept.
    console.warn(`Patch notes failed, keeping the last ones: ${(err as Error).message}`);
    notes = samePatch ? (last.extras?.patchNotes ?? {}) : {};
  }
  const neutrals = snapshot.neutrals?.items ?? {};
  const builds = heroBuilds(games, since, items, neutrals);
  const newItems = newItemUse(ids, games, since);
  const used = new Set([
    ...newItems.map((n) => n.id),
    ...Object.values(builds).flatMap((byPosition) => Object.values(byPosition).flatMap((b) => [...b.items, ...(b.early ?? [])].map(([id]) => id))),
  ]);
  return {
    buildGames: games.filter((g) => g.picks.some((p) => p.items)).length,
    builds,
    newItems,
    matchups: heroMatchups(snapshot.matchups ?? {}),
    items: Object.fromEntries([...used].sort((a, b) => a - b).flatMap((id) => (items[id] ? [[String(id), items[id]]] : []))),
    neutralItems: Object.fromEntries(
      [...new Set(Object.values(builds).flatMap((byPosition) => Object.values(byPosition).flatMap((b) => b.neutral.map(([id]) => id))))]
        .sort((a, b) => a - b)
        .flatMap((id) => (neutrals[id] ? [[String(id), neutrals[id]]] : [])),
    ),
    patchNotes: notes,
  };
}
