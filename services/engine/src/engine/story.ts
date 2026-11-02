/**
 * The Game Story: the game told in four timed chapters from our team's side, with a one-line
 * headline, built from the game plan's facts: the lane verdicts and their heroes, and our key
 * item minutes raced against theirs. Each chapter names both teams' spikes in its time window, so
 * every player knows when the team is strong and when the enemy is. Kept short on purpose: the team has
 * about a minute to read it (see STORY_WORDS).
 */

/** When a team is strongest, from its style (see game-plan.ts). */
export type Timing = "early" | "late" | null;

/** A player's first big item and about when it is bought. */
export interface Spike {
  hero: string;
  item: string;
  minute: number;
}

export interface StoryFacts {
  ourTiming: Timing;
  theirTiming: Timing;
  /** Lowercase lane names, like "safe lane" or "mid". */
  wonLane?: string;
  hardLane?: string;
  /** The enemy heroes in the hard lane, by name. */
  hardLaneEnemies?: string[];
  /** Our mid, who brings a power rune to the hard lane. */
  ourMid?: string;
  /** Our players' key items (see game-plan.ts keyItem). */
  spikes: Spike[];
  /** The enemy cores' key items, from their usual builds. */
  theirSpikes?: Spike[];
  /** Our first combo, like "Reverse Polarity into Sven's God's Strength cleave". */
  combo?: string;
  ourCarry?: string;
  enemyCarry?: string;
}

export interface Story {
  /** How we win and by when, in one short sentence. */
  headline: string;
  chapters: { phase: string; text: string }[];
}

/**
 * Word caps, so the story stays a one-minute read with each player's card (Game Story plan).
 * The chapters name heroes, items and minutes now, so they get 100 words (about 30 seconds).
 */
export const STORY_WORDS = { headline: 15, chapters: 100, danger: 30 } as const;

/** Our spikes named in one chapter, and theirs; more would crowd it. */
const SPIKES_PER_CHAPTER = 2;
const THEIR_SPIKES_PER_CHAPTER = 1;

const CHAPTERS = [
  { phase: "0 to 10 min", from: 0, to: 10 },
  { phase: "10 to 20 min", from: 10, to: 20 },
  { phase: "20 to 30 min", from: 20, to: 30 },
  { phase: "30 min on", from: 30, to: Infinity },
] as const;

/** Our team is ready to fight once this many of our key items are in. */
const READY_SPIKES = 2;
/** ...and ready for Roshan once this many are. */
const ROSHAN_SPIKES = 3;

/** Item timings this close count as the same time. */
const EVEN_MINUTES = 2;

/** The minute the `n`th of these spikes comes in, if it does. */
const byMinute = (spikes: Spike[]) => [...spikes].sort((a, b) => a.minute - b.minute);
const nthMinute = (spikes: Spike[], n: number) => byMinute(spikes)[n - 1]?.minute;

/** Their carry's key item, the timing our fights race against. */
const carrySpike = (f: StoryFacts) => f.theirSpikes?.find((s) => s.hero === f.enemyCarry);

function headline(f: StoryFacts): string {
  if (f.theirTiming === "late" && f.ourTiming !== "late") {
    return f.enemyCarry ? `Win before 30 minutes: their ${f.enemyCarry} outscales us.` : "Win before 30 minutes: they outscale us.";
  }
  if (f.ourTiming === "late" && f.theirTiming !== "late") {
    return f.ourCarry ? `Survive to 30 minutes: our ${f.ourCarry} outscales them.` : "Survive to 30 minutes: we outscale them.";
  }
  if (f.ourTiming === "early") return "End early: take towers before their carries are ready.";
  if (f.theirTiming === "early") return "Survive their early pushes: we are stronger after 25 minutes.";
  // No clear style: race our first two items against their carry's.
  const ready = nthMinute(f.spikes, READY_SPIKES);
  const theirs = carrySpike(f);
  if (ready !== undefined && theirs) {
    if (ready + EVEN_MINUTES <= theirs.minute) return `Fight from ${ready} min, before ${theirs.hero} has ${theirs.item} at ${theirs.minute}.`;
    if (theirs.minute + EVEN_MINUTES <= ready) return `${theirs.hero} has ${theirs.item} at ${theirs.minute}: hold fights until ${ready} min.`;
    return `Both teams are ready at ${ready} min: fight once your items are in, not before.`;
  }
  return "Win the fights around your item timings.";
}

/**
 * "Juggernaut: Battle Fury at 14, Mars: Blink Dagger at 15." for the first `max` spikes in a
 * window, taken in the given order and told by minute.
 */
function spikeText(spikes: Spike[], from: number, to: number, max: number): string {
  const inWindow = spikes
    .filter((s) => s.minute >= from && s.minute < to)
    .slice(0, max)
    .sort((a, b) => a.minute - b.minute);
  return inWindow.length ? `${inWindow.map((s) => `${s.hero}: ${s.item} at ${s.minute}`).join(", ")}.` : "";
}

function laneText(f: StoryFacts): string {
  const hard =
    f.hardLane &&
    `The ${f.hardLane} is hard${f.hardLaneEnemies?.length ? ` against ${f.hardLaneEnemies.join(" and ")}` : ""}${
      f.ourMid && f.hardLane !== "mid" ? `: ${f.ourMid} brings the 6 min rune there.` : "."
    }`;
  return [f.wonLane ? `Press the ${f.wonLane}.` : "", hard ?? ""].filter(Boolean).join(" ") || "Every lane is even: the better last hits win.";
}

function action(chapter: number, f: StoryFacts): string {
  // Who is stronger early and who late; when both teams want the same, neither side counts.
  const earlyIsOurs = (f.ourTiming === "early" || f.theirTiming === "late") && f.ourTiming !== "late";
  const lateIsOurs = (f.ourTiming === "late" || f.theirTiming === "early") && f.theirTiming !== "late";
  const theirs = carrySpike(f);
  const roshan = nthMinute(f.spikes, ROSHAN_SPIKES);
  switch (chapter) {
    case 0:
      return laneText(f);
    case 1:
      if (earlyIsOurs) return theirs ? `Take towers before ${theirs.hero}'s ${theirs.item} at ${theirs.minute}.` : "Group up and take towers before their carries are ready.";
      if (f.theirTiming === "early") return f.ourCarry ? `Their strongest time: defend towers together while ${f.ourCarry} farms.` : "Their strongest time: defend towers together.";
      return f.combo ? `Open fights with ${f.combo}.` : "";
    case 2:
      if (earlyIsOurs) return "Take Roshan and end with the Aegis before 30 minutes.";
      // Not inside their strongest time (see the early headline).
      if (roshan !== undefined && roshan < 30) return `Roshan from ${Math.max(roshan, f.theirTiming === "early" ? 25 : 20)} min, once three key items are in.`;
      if (lateIsOurs) return "Your items are in: take back the map.";
      return "";
    default:
      if (lateIsOurs) return "You are stronger now: take Roshan, then end with the Aegis.";
      if (f.theirTiming === "late") return "They are stronger: fight only with buyback and a big opening spell.";
      return f.enemyCarry ? `Fight when ${f.enemyCarry} is dead or far from the fight.` : "";
  }
}

export function gameStory(facts: StoryFacts): Story {
  return {
    headline: headline(facts),
    chapters: CHAPTERS.map((c, i) => {
      // Their carry's item first: it is the timing our fights race against.
      const carryFirst = [...(facts.theirSpikes ?? [])].sort((a, b) => Number(b.hero === facts.enemyCarry) - Number(a.hero === facts.enemyCarry));
      // The lane chapter is about lanes: items under 10 min show on the player cards and danger list.
      const isLane = i === 0;
      const theirs = isLane ? "" : spikeText(carryFirst, c.from, c.to, THEIR_SPIKES_PER_CHAPTER);
      return {
        phase: c.phase,
        text: [
          isLane ? "" : spikeText(byMinute(facts.spikes), c.from, c.to, SPIKES_PER_CHAPTER),
          theirs && `Their ${theirs}`,
          action(i, facts),
        ]
          .filter(Boolean)
          .join(" "),
      };
    }).filter((c) => c.text),
  };
}

/** Words in a piece of text, as the word caps count them. */
export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
