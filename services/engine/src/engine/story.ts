/**
 * The Game Story: the game told in four timed chapters from our team's side, with a one-line
 * headline, built from the game plan's facts. Each chapter names our item spikes in its time
 * window, so every player knows when the team is strong. Kept short on purpose: the team has
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
  /** Lowercase lane names, like "safe lane". */
  wonLane?: string;
  hardLane?: string;
  spikes: Spike[];
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

/** Word caps, so the story stays a one-minute read with each player's card (Game Story plan). */
export const STORY_WORDS = { headline: 15, chapters: 80, danger: 30 } as const;

/** Spikes named in one chapter; more would crowd it. */
const SPIKES_PER_CHAPTER = 2;

const CHAPTERS = [
  { phase: "0 to 10 min", from: 0, to: 10 },
  { phase: "10 to 20 min", from: 10, to: 20 },
  { phase: "20 to 30 min", from: 20, to: 30 },
  { phase: "30 min on", from: 30, to: Infinity },
] as const;

function headline(f: StoryFacts): string {
  if (f.theirTiming === "late" && f.ourTiming !== "late") {
    return f.enemyCarry ? `Win before 30 minutes: their ${f.enemyCarry} outscales us.` : "Win before 30 minutes: they outscale us.";
  }
  if (f.ourTiming === "late" && f.theirTiming !== "late") {
    return f.ourCarry ? `Survive to 30 minutes: our ${f.ourCarry} outscales them.` : "Survive to 30 minutes: we outscale them.";
  }
  if (f.ourTiming === "early") return "End early: take towers before their carries are ready.";
  if (f.theirTiming === "early") return "Survive their early pushes: we are stronger after 25 minutes.";
  return "Win the fights around your item timings.";
}

/** "Juggernaut has Black King Bar, Magnus has Blink Dagger." for the spikes in a window. */
function spikeText(spikes: Spike[], from: number, to: number): string {
  const inWindow = spikes
    .filter((s) => s.minute >= from && s.minute < to)
    .sort((a, b) => a.minute - b.minute)
    .slice(0, SPIKES_PER_CHAPTER);
  return inWindow.length ? `${inWindow.map((s) => `${s.hero} has ${s.item}`).join(", ")}.` : "";
}

function action(chapter: number, f: StoryFacts): string {
  // Who is stronger early and who late; when both teams want the same, neither side counts.
  const earlyIsOurs = (f.ourTiming === "early" || f.theirTiming === "late") && f.ourTiming !== "late";
  const lateIsOurs = (f.ourTiming === "late" || f.theirTiming === "early") && f.theirTiming !== "late";
  switch (chapter) {
    case 0:
      return [
        f.wonLane ? `Press the ${f.wonLane}.` : "Farm and trade evenly.",
        f.hardLane ? `Rotate to help the ${f.hardLane}.` : "",
      ].filter(Boolean).join(" ");
    case 1:
      if (earlyIsOurs) return "Group up and take towers before their carries are ready.";
      if (f.theirTiming === "early") return "Their strongest time: defend towers together.";
      return f.combo ? `Fight around these items, opening with ${f.combo}.` : "Fight around these items.";
    case 2:
      if (earlyIsOurs) return "Take Roshan and end with the Aegis before 30 minutes.";
      if (lateIsOurs) return "Your items are in: take back the map with smoke ganks.";
      return "Take Roshan when their carry is dead or far away.";
    default:
      if (lateIsOurs) return "You are stronger now: take Roshan, then end with the Aegis.";
      if (f.theirTiming === "late") return "They are stronger: fight only with buyback and a big opening spell.";
      return "Catch one hero before each objective.";
  }
}

export function gameStory(facts: StoryFacts): Story {
  return {
    headline: headline(facts),
    chapters: CHAPTERS.map((c, i) => ({
      phase: c.phase,
      text: [spikeText(facts.spikes, c.from, c.to), action(i, facts)].filter(Boolean).join(" "),
    })),
  };
}

/** Words in a piece of text, as the word caps count them. */
export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
