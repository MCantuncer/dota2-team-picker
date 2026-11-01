/**
 * The fight, enemy and draft parts of a report's facts. Pure, like facts.ts, which puts
 * them together.
 */
import { isRadiantSlot, type Match, type MatchPlayer } from "./match.ts";

const FIGHTS_SHOWN = 4;
const DAMAGE_SOURCES_SHOWN = 3;

export interface FightFact {
  startMinute: number;
  ourDeaths: number;
  theirDeaths: number;
  /** Gold our side gained in the fight minus what theirs gained. */
  goldSwing: number;
  /** Our heroes who did no damage, no healing and didn't die in it. */
  missingHeroes: number[];
}

export interface DamageSource {
  /** The enemy ability or item key, like `lina_laguna_blade`, or "attacks". */
  source: string;
  damage: number;
  /** Share (0 to 1) of all damage our heroes took. */
  share: number;
}

export interface EnemyBest {
  heroId: number;
  kills: number;
  deaths: number;
  assists: number;
  netWorth: number;
}

/** What one of our players was shown in the draft, from draft_suggestions. */
export interface ShownList {
  heroId: number;
  /** The heroes shown, best first. Empty when the player had no list. */
  shown: number[];
}

export interface DraftPickFact {
  heroId: number;
  /** 1 for the top suggestion. Null when the hero wasn't in the list. */
  suggestionRank: number | null;
  /** How many heroes were shown; 0 means no list. */
  listSize: number;
}

/** The fights that moved the most gold, in game order. */
export function keyFights(match: Match, isRadiant: boolean): FightFact[] | null {
  if (!match.teamfights) return null;
  const isOurs = match.players.map((p) => isRadiantSlot(p.playerSlot) === isRadiant);
  const fights = match.teamfights.map((t) => {
    let ourDeaths = 0, theirDeaths = 0, goldSwing = 0;
    const missingHeroes: number[] = [];
    t.players.forEach((f, i) => {
      const player = match.players[i];
      if (!player) return;
      if (isOurs[i]) {
        ourDeaths += f.deaths;
        goldSwing += f.goldDelta;
        if (f.damage === 0 && f.healing === 0 && f.deaths === 0) missingHeroes.push(player.heroId);
      } else {
        theirDeaths += f.deaths;
        goldSwing -= f.goldDelta;
      }
    });
    return { startMinute: Math.floor(t.startS / 60), ourDeaths, theirDeaths, goldSwing, missingHeroes };
  });
  return fights
    .sort((a, b) => Math.abs(b.goldSwing) - Math.abs(a.goldSwing))
    .slice(0, FIGHTS_SHOWN)
    .sort((a, b) => a.startMinute - b.startMinute);
}

/** The enemy abilities and items that did the most damage to our heroes. */
export function damageTaken(ours: MatchPlayer[]): DamageSource[] | null {
  const totals = new Map<string, number>();
  for (const p of ours) {
    if (!p.damageReceived) return null;
    for (const [key, damage] of Object.entries(p.damageReceived)) {
      const source = key === "null" ? "attacks" : key;
      totals.set(source, (totals.get(source) ?? 0) + damage);
    }
  }
  const all = [...totals.values()].reduce((a, b) => a + b, 0);
  if (all <= 0) return [];
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, DAMAGE_SOURCES_SHOWN)
    .map(([source, damage]) => ({ source, damage, share: Math.round((damage / all) * 100) / 100 }));
}

/** The enemy hero with the highest net worth. */
export function enemyBest(theirs: MatchPlayer[]): EnemyBest | null {
  const best = [...theirs].sort((a, b) => b.netWorth - a.netWorth)[0];
  return best
    ? { heroId: best.heroId, kills: best.kills, deaths: best.deaths, assists: best.assists, netWorth: best.netWorth }
    : null;
}

/** Where each of our picks was in the list its player was shown. */
export function draftReview(lists: ShownList[]): DraftPickFact[] {
  return lists.map(({ heroId, shown }) => {
    const index = shown.indexOf(heroId);
    return { heroId, suggestionRank: index === -1 ? null : index + 1, listSize: shown.length };
  });
}
