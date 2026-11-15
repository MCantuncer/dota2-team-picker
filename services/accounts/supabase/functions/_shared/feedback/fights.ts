/**
 * How each of a player's deaths went, from every death of all ten players: the fight it was
 * part of, how many heroes each side lost in it, and the observer wards each side had up at
 * that moment. Pure: no network or database.
 */
import { isRadiantSlot, type Match, type MatchPlayer } from "../report/match.ts";

/** Deaths this close to the one before join the same fight, as OpenDota groups teamfights. */
export const FIGHT_GAP_S = 15;

/**
 * caught_alone: the player was the only hero to die (1 for 0). lost_fight: their side lost more
 * heroes. even_trade: both sides lost the same. close_win: their side lost one hero fewer.
 * good_trade: two or more fewer.
 */
export type FightLabel = "caught_alone" | "lost_fight" | "even_trade" | "close_win" | "good_trade";

export interface FightScore {
  /** First and last death of the fight, in seconds from the horn. */
  startS: number;
  endS: number;
  /** Heroes each side lost in the fight, this player's death included. */
  ourDeaths: number;
  theirDeaths: number;
  label: FightLabel;
}

/** Observer wards standing anywhere on the map for each side. */
export interface WardsUp {
  ours: number;
  theirs: number;
}

interface HeroDeath {
  timeS: number;
  isRadiant: boolean;
  /** Which player died and which entry of their deaths log it is. */
  player: number;
  entry: number;
}

/** The label for a fight one side lost `ours` heroes in and the other `theirs`. */
export function fightLabel(ours: number, theirs: number): FightLabel {
  if (ours === 1 && theirs === 0) return "caught_alone";
  if (ours > theirs) return "lost_fight";
  if (ours === theirs) return "even_trade";
  return theirs - ours === 1 ? "close_win" : "good_trade";
}

/**
 * The fight score of each entry in `me.deathsLog`, in the same order. Null when the match has
 * no deaths log for the player. Players without a deaths log count as never dying.
 */
export function scoreDeaths(match: Match, me: MatchPlayer): FightScore[] | null {
  const mine = match.players.indexOf(me);
  if (mine < 0 || !me.deathsLog) return null;
  const all: HeroDeath[] = match.players.flatMap((p, player) =>
    (p.deathsLog ?? []).map((d, entry) => ({ timeS: d.time, isRadiant: isRadiantSlot(p.playerSlot), player, entry }))
  ).sort((a, b) => a.timeS - b.timeS);

  const scores: FightScore[] = new Array(me.deathsLog.length);
  const isOurs = isRadiantSlot(me.playerSlot);
  for (const fight of chain(all)) {
    const ourDeaths = fight.filter((d) => d.isRadiant === isOurs).length;
    const theirDeaths = fight.length - ourDeaths;
    const first = fight[0];
    const last = fight[fight.length - 1];
    if (!first || !last) continue;
    for (const d of fight) {
      if (d.player !== mine) continue;
      scores[d.entry] = {
        startS: first.timeS,
        endS: last.timeS,
        ourDeaths,
        theirDeaths,
        label: fightLabel(ourDeaths, theirDeaths),
      };
    }
  }
  return scores;
}

/** Deaths in time order, split where the gap to the previous death is over FIGHT_GAP_S. */
function chain(deaths: HeroDeath[]): HeroDeath[][] {
  const fights: HeroDeath[][] = [];
  let current: HeroDeath[] = [];
  for (const d of deaths) {
    const previous = current[current.length - 1];
    if (previous && d.timeS - previous.timeS > FIGHT_GAP_S) {
      fights.push(current);
      current = [];
    }
    current.push(d);
  }
  if (current.length) fights.push(current);
  return fights;
}

/**
 * The observer wards each side had standing at `timeS`, seen from the side `isRadiant`. Null
 * when no player in the match has a ward log, so "0 wards" is never claimed without data.
 */
export function wardsUpAt(match: Match, isRadiant: boolean, timeS: number): WardsUp | null {
  if (match.players.every((p) => p.observerWards === null)) return null;
  const up = { ours: 0, theirs: 0 };
  for (const p of match.players) {
    const standing = (p.observerWards ?? []).filter((w) => w.placedS <= timeS && w.goneS > timeS).length;
    if (isRadiantSlot(p.playerSlot) === isRadiant) up.ours += standing;
    else up.theirs += standing;
  }
  return up;
}

/** Power runes are taken this long before a kill to count toward it. */
export const RUNE_BEFORE_KILL_S = 60;

/**
 * Whether `killer` took a power rune in the minute before `timeS`. Null when the match has no
 * rune log for them.
 */
export function tookRuneBefore(killer: MatchPlayer, timeS: number): boolean | null {
  if (killer.powerRunesS === null) return null;
  return killer.powerRunesS.some((t) => t <= timeS && timeS - t <= RUNE_BEFORE_KILL_S);
}
