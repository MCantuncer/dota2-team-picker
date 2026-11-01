import { describe, expect, it } from "vitest";
import { STORY_WORDS, gameStory, wordCount, type StoryFacts, type Timing } from "../src/engine/story";

const facts = (over: Partial<StoryFacts> = {}): StoryFacts => ({ ourTiming: null, theirTiming: null, spikes: [], ...over });

describe("gameStory", () => {
  it("tells four chapters and names our item spikes in their window", () => {
    const story = gameStory(
      facts({
        wonLane: "safe lane",
        hardLane: "off lane",
        spikes: [
          { hero: "Magnus", item: "Blink Dagger", minute: 14 },
          { hero: "Juggernaut", item: "Battle Fury", minute: 16 },
          { hero: "Lion", item: "Aether Lens", minute: 12 },
          { hero: "Juggernaut", item: "Black King Bar", minute: 24 },
        ],
        combo: "Reverse Polarity into Sven's God's Strength cleave",
      }),
    );
    expect(story.chapters.map((c) => c.phase)).toEqual(["0 to 10 min", "10 to 20 min", "20 to 30 min", "30 min on"]);
    expect(story.chapters[0]!.text).toBe("Press the safe lane. Rotate to help the off lane.");
    // Two spikes at most, the earliest first.
    expect(story.chapters[1]!.text).toBe(
      "Lion has Aether Lens, Magnus has Blink Dagger. Fight around these items, opening with Reverse Polarity into Sven's God's Strength cleave.",
    );
    expect(story.chapters[2]!.text).toBe("Juggernaut has Black King Bar. Take Roshan when their carry is dead or far away.");
    expect(story.headline).toBe("Win the fights around your item timings.");
  });

  it("plays early against a late game team, and late against an early one", () => {
    const early = gameStory(facts({ theirTiming: "late", enemyCarry: "Medusa" }));
    expect(early.headline).toBe("Win before 30 minutes: their Medusa outscales us.");
    expect(early.chapters[2]!.text).toBe("Take Roshan and end with the Aegis before 30 minutes.");
    expect(early.chapters[3]!.text).toBe("They are stronger: fight only with buyback and a big opening spell.");

    const late = gameStory(facts({ theirTiming: "early" }));
    expect(late.headline).toBe("Survive their early pushes: we are stronger after 25 minutes.");
    expect(late.chapters[1]!.text).toBe("Their strongest time: defend towers together.");
    expect(late.chapters[3]!.text).toBe("You are stronger now: take Roshan, then end with the Aegis.");
  });

  it("never calls us stronger late when both teams are late game teams", () => {
    const story = gameStory(facts({ ourTiming: "late", theirTiming: "late" }));
    expect(story.chapters[3]!.text).toBe("They are stronger: fight only with buyback and a big opening spell.");
    expect(story.chapters[2]!.text).toBe("Take Roshan when their carry is dead or far away.");
  });

  it("stays within its word caps in the worst case, for every pair of team timings", () => {
    const long = "Outworld Devourer";
    // One key item per player, two in each of the busiest chapters.
    const spikes = [8, 9, 14, 16, 22].map((minute) => ({ hero: "Keeper of the Light", item: "Aghanim's Scepter", minute }));
    const timings: Timing[] = ["early", "late", null];
    for (const ourTiming of timings) {
      for (const theirTiming of timings) {
        const story = gameStory({
          ourTiming,
          theirTiming,
          wonLane: "safe lane",
          hardLane: "off lane",
          spikes,
          combo: "Reverse Polarity into Sven's God's Strength cleave",
          ourCarry: long,
          enemyCarry: long,
        });
        const label = `${ourTiming} vs ${theirTiming}`;
        expect(wordCount(story.headline), label).toBeLessThanOrEqual(STORY_WORDS.headline);
        expect(story.chapters.reduce((n, c) => n + wordCount(c.text), 0), label).toBeLessThanOrEqual(STORY_WORDS.chapters);
        for (const c of story.chapters) expect(c.text, label).not.toContain("—");
      }
    }
  });
});
