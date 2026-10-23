import { personalScore, type Engine } from "./score";
import { NEED_LABELS, traitsOf, unmetNeeds, type Need } from "./traits";
import { POSITIONS, type GamesWins, type HeroInfo, type Position, type RankBracket } from "./types";

/**
 * WCST (Wombo-Combo Super Team): plan all five heroes of the captain's team at
 * once, then re-plan the open slots every time a hero is picked.
 *
 * Each open slot gets a short list of candidates scored on their own (meta,
 * position fit, the player's comfort, counters against known enemies). Then
 * every combination of candidates is tried and the five heroes that work best
 * together win: pairwise synergy plus how many team needs the full five cover.
 */

/** One position on the captain's team. */
export interface PlanSlot {
  position: Position;
  /** Who plays this position, passed back untouched so the caller can show it. */
  playerId?: string;
  /** The player's favorite heroes for this position. Planned first. */
  favorites?: number[];
  /** The player's own record per hero id, from their Steam match history. */
  personal?: Record<number, GamesWins>;
  /** The player's rank, if their Steam account is linked. */
  rankBracket?: RankBracket;
  /** Already picked in the draft: kept as is. */
  heroId?: number;
}

export interface PlanInput {
  /** Up to five slots with different positions; missing positions are planned without a player. */
  slots: PlanSlot[];
  /** Enemy picks entered so far. Empty before the draft. */
  enemies?: number[];
  bans?: number[];
  /** Used for slots without their own rank. Omit to use all ranks. */
  rankBracket?: RankBracket;
  /** Backup heroes per open slot, in case the planned one is banned or taken. Default 2. */
  alternatives?: number;
}

export interface PlanAlternative {
  heroId: number;
  name: string;
  /** One of the player's favorites for this position. */
  inPool: boolean;
  /** Team score change compared with the plan (0 or less). */
  scoreDelta: number;
}

export interface PlannedSlot {
  position: Position;
  playerId?: string;
  heroId: number;
  name: string;
  /** Picked already in the draft. */
  locked: boolean;
  inPool: boolean;
  reasons: string[];
  alternatives: PlanAlternative[];
}

export interface TeamPlan {
  /** Sorted by position, 1 to 5. */
  slots: PlannedSlot[];
  /** Team score in win-rate percentage points, like the single-hero score. */
  score: number;
  /** Things the planned five still lack, in plain words. */
  missing: string[];
}

const WEIGHTS = {
  /**
   * Bonus for a hero in the player's pool. A player is usually several
   * percent better on heroes they know, and the plan should be built around
   * them, so a hero from outside the pool only makes it when clearly better.
   */
  inPool: 5,
  /**
   * Share of each pair's synergy that counts. A team has 10 pairs and their
   * edges overlap, so adding them all in full overstates synergy and lets
   * noisy pairs take over the plan.
   */
  synergy: 0.5,
  /** Points lost per team need the final five leave uncovered. */
  missingNeed: 1.2,
};

/** Short names for what a finished team lacks. */
const MISSING_LABELS: Record<Need, string> = {
  disable: "stuns or disables",
  initiation: "an initiator",
  save: "a save",
  durable: "a tanky frontliner",
  push: "wave clear and pushing",
  magicDamage: "magic damage",
  physicalDamage: "right-click damage",
};

/** Candidates kept per open slot before trying combinations. 10^5 combinations at most. */
const CANDIDATES = 10;
/** Heroes played in a position less often than this are not planned for it, unless in the pool. */
const MIN_POSITION_FIT = 0.15;

interface Candidate {
  hero: HeroInfo;
  inPool: boolean;
  /** Score of the hero on its own, before synergy and team needs. */
  solo: number;
  reasons: { text: string; value: number }[];
}

interface Slot extends PlanSlot {
  locked: Candidate | undefined;
  candidates: Candidate[];
}

export function planTeam(engine: Engine, input: PlanInput): TeamPlan {
  const enemies = input.enemies ?? [];
  const seen = new Set<Position>();
  for (const s of input.slots) {
    if (seen.has(s.position)) throw new Error(`Position ${s.position} is listed twice`);
    seen.add(s.position);
  }
  const lockedIds = input.slots.flatMap((s) => (s.heroId === undefined ? [] : [s.heroId]));
  const taken = new Set([...lockedIds, ...enemies, ...(input.bans ?? [])]);

  const slots: Slot[] = POSITIONS.map((position) => {
    const given = input.slots.find((s) => s.position === position) ?? { position };
    const ctx = { ...given, rankBracket: given.rankBracket ?? input.rankBracket };
    if (given.heroId !== undefined) {
      return { ...given, locked: rate(engine, engine.hero(given.heroId), ctx, enemies), candidates: [] };
    }
    const pool = new Set(given.favorites ?? []);
    const rated = engine.heroes
      .filter((h) => !taken.has(h.id) && (pool.has(h.id) || engine.fit(h.id)[position] >= MIN_POSITION_FIT))
      .map((h) => rate(engine, h, ctx, enemies))
      .sort((a, b) => b.solo - a.solo);
    return { ...given, locked: undefined, candidates: rated.slice(0, CANDIDATES) };
  });

  const open = slots.filter((s) => !s.locked);
  for (const s of open) {
    if (!s.candidates.length) throw new Error(`No hero left for position ${s.position}`);
  }
  const fixed = slots.flatMap((s) => (s.locked ? [s.locked] : []));

  const synergyCache = new Map<string, number>();
  const synergy = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    let v = synergyCache.get(key);
    if (v === undefined) synergyCache.set(key, (v = engine.synergyEdge(a, b)));
    return v;
  };
  const teamScore = (team: Candidate[]) => {
    let score = 0;
    team.forEach((c, i) => {
      score += c.solo;
      for (let j = i + 1; j < team.length; j++) score += WEIGHTS.synergy * synergy(c.hero.id, team[j]!.hero.id);
    });
    return score - unmetNeeds(team.map((c) => c.hero)).length * WEIGHTS.missingNeed;
  };

  // Try every combination of candidates for the open slots, one hero per slot.
  let best: Candidate[] = [];
  let bestScore = -Infinity;
  const chosen: Candidate[] = [];
  const used = new Set<number>();
  const walk = (i: number) => {
    if (i === open.length) {
      const score = teamScore([...fixed, ...chosen]);
      if (score > bestScore) [best, bestScore] = [[...chosen], score];
      return;
    }
    for (const c of open[i]!.candidates) {
      if (used.has(c.hero.id)) continue;
      used.add(c.hero.id);
      chosen.push(c);
      walk(i + 1);
      chosen.pop();
      used.delete(c.hero.id);
    }
  };
  walk(0);
  if (bestScore === -Infinity) throw new Error("Not enough heroes left to fill every position");

  const planned = new Map(open.map((s, i) => [s.position, best[i]!]));
  const team = slots.map((s) => s.locked ?? planned.get(s.position)!);
  const teamIds = new Set(team.map((c) => c.hero.id));

  return {
    slots: slots.map((s, i) => {
      const pick = team[i]!;
      const others = team.filter((_, j) => j !== i);
      const alternatives = s.locked
        ? []
        : s.candidates
            .filter((c) => !teamIds.has(c.hero.id))
            .map((c) => ({ c, delta: teamScore([...others, c]) - bestScore }))
            .sort((a, b) => b.delta - a.delta)
            .slice(0, input.alternatives ?? 2)
            .map(({ c, delta }) => ({ heroId: c.hero.id, name: c.hero.name, inPool: c.inPool, scoreDelta: round(delta) }));
      return {
        position: s.position,
        playerId: s.playerId,
        heroId: pick.hero.id,
        name: pick.hero.name,
        locked: !!s.locked,
        inPool: pick.inPool,
        reasons: explain(engine, pick, others, unmetNeeds(others.map((c) => c.hero))),
        alternatives,
      };
    }),
    score: round(bestScore),
    missing: unmetNeeds(team.map((c) => c.hero)).map((n) => MISSING_LABELS[n]),
  };
}

/** Score a hero on its own for a slot. */
function rate(
  engine: Engine,
  hero: HeroInfo,
  slot: Pick<PlanSlot, "position" | "favorites" | "personal" | "rankBracket">,
  enemies: number[],
): Candidate {
  const reasons: Candidate["reasons"] = [];
  const inPool = slot.favorites?.includes(hero.id) ?? false;

  const edges = engine.counterEdges(hero.id, enemies, engine.laneChances(enemies, slot.position));
  const counter = edges.reduce((s, x) => s + x.edge, 0);
  const good = edges.filter((x) => x.edge >= 0.5).sort((a, b) => b.edge - a.edge);
  if (good.length) reasons.push({ text: `Strong against ${engine.names(good.map((x) => x.enemy))}`, value: counter });

  const meta = (engine.winRate(hero.id, slot.rankBracket) - 0.5) * 100;
  if (meta >= 1) reasons.push({ text: "Strong in the current meta", value: meta });

  const fit = engine.positionScore(hero.id, slot.position);

  let comfort = inPool ? WEIGHTS.inPool : 0;
  if (inPool) reasons.push({ text: "From the player's hero pool", value: WEIGHTS.inPool });
  const mine = slot.personal?.[hero.id];
  if (mine && mine.games > 0) {
    const personal = personalScore(mine);
    comfort += personal;
    if (personal >= 0.5) reasons.push({ text: `Player has won ${mine.wins} of ${mine.games} games on it`, value: personal });
  }

  return { hero, inPool, solo: counter + meta + fit + comfort, reasons };
}

/** The top reasons a hero is in the plan, including what it adds to the rest of the team. */
function explain(engine: Engine, pick: Candidate, others: Candidate[], needs: Need[]): string[] {
  const reasons = [...pick.reasons];
  const friends = others
    .map((c) => ({ id: c.hero.id, edge: engine.synergyEdge(pick.hero.id, c.hero.id) }))
    .filter((x) => x.edge >= 0.5)
    .sort((a, b) => b.edge - a.edge);
  if (friends.length) {
    reasons.push({ text: `Works well with ${engine.names(friends.map((x) => x.id))}`, value: friends.reduce((s, x) => s + x.edge, 0) });
  }
  const covered = needs.filter((n) => traitsOf(pick.hero).has(n));
  if (covered.length) {
    const text = covered.map((n) => NEED_LABELS[n]).join(", ");
    reasons.push({ text: text.charAt(0).toUpperCase() + text.slice(1), value: covered.length * WEIGHTS.missingNeed });
  }
  return reasons
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((r) => r.text);
}

const round = (x: number) => Math.round(x * 100) / 100;
