/**
 * The lane and the farm of one game, saved minute by minute so their feedback names this game's
 * heroes and numbers: who the player laned against, when the gap opened, and how their last
 * hits grew against the enemy's best farmer. No advice: the cards say what happened. Pure: no
 * network or database.
 */
import type { MatchPlayer } from "../report/match.ts";
import { clock } from "./deaths.ts";
import type { Finding, Names, Tone } from "./findings.ts";
import type { GameSummary } from "./summary.ts";

const LANE_MINUTE = 10;
/** The minute a lane gap first reaches this size is named as when it opened. */
const GAP_OPENED_GOLD = 500;
/** Farm is shown at every tenth minute the game reached. */
const FARM_EVERY_MIN = 10;

/** A hero's totals at each minute from 0 to 10. */
export interface LaneLine {
  heroId: number;
  netWorth: number[];
  lastHits: number[];
}

export interface LaneDetail {
  me: LaneLine;
  /** The enemies who laned with the player, not roaming. */
  rivals: LaneLine[];
}

export interface FarmDetail {
  /** 10, 20, 30... up to the last full tenth minute of the game. */
  minutes: number[];
  lastHits: number[];
  /** The enemy with the most last hits at the end, and theirs at the same minutes. */
  topEnemy: { heroId: number; lastHits: number[] } | null;
}

const upTo10 = (xs: number[] | null) => (xs && xs.length > LANE_MINUTE ? xs.slice(0, LANE_MINUTE + 1) : null);

function laneLine(p: MatchPlayer): LaneLine | null {
  const netWorth = upTo10(p.netWorthByMinute);
  const lastHits = upTo10(p.lastHitsByMinute);
  return netWorth && lastHits ? { heroId: p.heroId, netWorth, lastHits } : null;
}

/** The player's lane to minute 10. Null for the jungle, a roamer, an unknown lane or a short game. */
export function laneDetail(me: MatchPlayer, enemies: MatchPlayer[]): LaneDetail | null {
  if (me.lane === null || me.lane === 4 || me.isRoaming) return null;
  const mine = laneLine(me);
  const rivals = enemies.filter((p) => p.lane === me.lane && p.isRoaming !== true).flatMap((p) => laneLine(p) ?? []);
  return mine && rivals.length ? { me: mine, rivals } : null;
}

/** The player's last hits at every tenth minute, next to the enemy's best farmer. Null without the log. */
export function farmDetail(me: MatchPlayer, enemies: MatchPlayer[], durationS: number): FarmDetail | null {
  const marks = Array.from({ length: Math.floor(durationS / 60 / FARM_EVERY_MIN) }, (_, i) => (i + 1) * FARM_EVERY_MIN);
  const at = (xs: number[] | null) => (xs ? marks.map((m) => xs[m]).filter((x): x is number => x !== undefined) : []);
  const lastHits = at(me.lastHitsByMinute);
  if (!marks.length || lastHits.length !== marks.length) return null;
  const top = [...enemies].sort((a, b) => b.lastHits - a.lastHits)[0];
  const theirs = top ? at(top.lastHitsByMinute) : [];
  return {
    minutes: marks,
    lastHits,
    topEnemy: top && theirs.length === marks.length ? { heroId: top.heroId, lastHits: theirs } : null,
  };
}

const gold = (n: number) => n.toLocaleString("en-US");
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * The lane card for one game: the player against each lane rival at 10:00 and when the gap
 * opened, with the lane deaths as what it cost. Null when the summary has no lane detail or the
 * gap at 10:00 is under `minGold`.
 */
export function laneFinding(game: GameSummary, names: Names, minGold: number): Finding | null {
  const lane = game.lane;
  if (!lane) return null;
  const at10 = (l: LaneLine) => l.netWorth[LANE_MINUTE] ?? 0;
  const richest = lane.rivals.reduce((a, b) => (at10(b) > at10(a) ? b : a));
  const diffAt = (m: number) => (lane.me.netWorth[m] ?? 0) - (richest.netWorth[m] ?? 0);
  const diff = diffAt(LANE_MINUTE);
  if (Math.abs(diff) < minGold) return null;
  const tone: Tone = diff > 0 ? "strength" : "problem";
  const rivals = list(lane.rivals.map((r) => names.hero(r.heroId)));
  const opened = Array.from({ length: LANE_MINUTE + 1 }, (_, m) => m).find((m) =>
    tone === "problem" ? diffAt(m) <= -GAP_OPENED_GOLD : diffAt(m) >= GAP_OPENED_GOLD
  );
  const line = (l: LaneLine) => `${l.lastHits[LANE_MINUTE]} last hits and ${gold(at10(l))} net worth`;
  const happened = [
    `10:00: you had ${line(lane.me)}; ${lane.rivals.map((r) => `${names.hero(r.heroId)} had ${line(r)}`).join(", ")}.`,
    ...(opened === undefined ? [] : [
      `The gap first reached ${gold(GAP_OPENED_GOLD)} gold at ${opened}:00 and was ${gold(Math.abs(diff))} at 10:00.`,
    ]),
  ];
  return {
    kind: "laning",
    tone,
    score: (Math.abs(diff) / minGold) * 0.15,
    headline: tone === "strength" ? `Won Your Lane Against ${rivals}` : `Lost Your Lane to ${rivals}`,
    happened,
    pattern: null,
    cost: tone === "problem" ? laneDeaths(game, names) : null,
    change: null,
    matchIds: [game.matchId],
  };
}

/** "Your 2 deaths before 10:00 (4:32 to Visage, 8:10 to Sniper) gave the enemy 693 gold." or the lack of them. */
function laneDeaths(game: GameSummary, names: Names): string | null {
  if (game.deaths === null) return null;
  const early = game.deaths.filter((d) => d.time >= 0 && d.time < LANE_MINUTE * 60);
  if (!early.length) return "You didn't die before 10:00.";
  const each = early.map((d) => [clock(d.time), d.killerHeroId === null ? null : names.hero(d.killerHeroId)]);
  const fed = early.every((d) => typeof d.goldFed === "number")
    ? ` gave the enemy ${gold(early.reduce((s, d) => s + (d.goldFed ?? 0), 0))} gold`
    : ` cost you ${gold(early.reduce((s, d) => s + d.goldLost, 0))} gold`;
  return `Your ${early.length === 1 ? "death" : `${early.length} deaths`} before 10:00 (${
    each.map(([at, by]) => (by ? `${at} to ${by}` : at)).join(", ")
  })${fed}.`;
}

/** The farm card's lines: last hits at each tenth minute next to the enemy's best farmer. */
export function farmLines(game: GameSummary, names: Names): string[] | null {
  const farm = game.farm;
  if (!farm) return null;
  const marks = farm.minutes.map((m, i) => `${farm.lastHits[i]} at ${m}:00`);
  const lines = [`Your last hits: ${marks.join(", ")}.`];
  if (farm.topEnemy) {
    lines.push(
      `${names.hero(farm.topEnemy.heroId)}, the enemy with the most last hits: ${
        farm.minutes.map((m, i) => `${farm.topEnemy?.lastHits[i]} at ${m}:00`).join(", ")
      }.`,
    );
  }
  return lines;
}
