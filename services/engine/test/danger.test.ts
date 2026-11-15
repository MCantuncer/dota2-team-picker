import { describe, expect, it } from "vitest";
import { chooseDangerHeroes, dangerLine } from "../src/engine/danger";
import { STORY_WORDS, wordCount } from "../src/engine/story";

describe("chooseDangerHeroes", () => {
  it("names the biggest threat, then their carry, at most two", () => {
    expect(chooseDangerHeroes([67, 30, 31], 1)).toEqual([
      { id: 67, kind: "threat" },
      { id: 1, kind: "carry" },
    ]);
  });

  it("counts a carry who is also the biggest threat once, as a threat", () => {
    expect(chooseDangerHeroes([1, 30], 1)).toEqual([
      { id: 1, kind: "threat" },
      { id: 30, kind: "threat" },
    ]);
  });

  it("fills up with the cores who start their fights, after threats and carry", () => {
    expect(chooseDangerHeroes([], undefined, [29, 2])).toEqual([
      { id: 29, kind: "initiator" },
      { id: 2, kind: "initiator" },
    ]);
    expect(chooseDangerHeroes([67], 1, [29])).toEqual([
      { id: 67, kind: "threat" },
      { id: 1, kind: "carry" },
    ]);
  });

  it("warns about their carry alone when nobody beats our team", () => {
    expect(chooseDangerHeroes([], 1)).toEqual([{ id: 1, kind: "carry" }]);
    expect(chooseDangerHeroes([], undefined)).toEqual([]);
  });
});

describe("dangerLine", () => {
  it("gives the item minute and nothing hand-written", () => {
    expect(dangerLine({ hero: "Faceless Void", kind: "carry", item: { name: "Black King Bar", minute: 21 }, isSure: true })).toBe(
      "Faceless Void: Black King Bar at 21 min.",
    );
    expect(dangerLine({ hero: "Tidehunter", kind: "initiator", item: { name: "Blink Dagger", minute: 19 }, isSure: true })).toBe(
      "Tidehunter: Blink Dagger at 19 min.",
    );
  });

  it("says around when the enemy's position is a close guess", () => {
    expect(dangerLine({ hero: "Lion", kind: "threat", item: { name: "Blink Dagger", minute: 14 }, isSure: false, beats: ["Puck"] })).toBe(
      "Lion: Blink Dagger around 14 min. Strong against Puck.",
    );
  });

  it("names the heroes a threat beats, or the team when no single matchup is clear", () => {
    expect(dangerLine({ hero: "Bristleback", kind: "threat", isSure: true, beats: ["Puck", "Mars", "Lina"] })).toBe(
      "Bristleback: Strong against Puck, Mars and Lina.",
    );
    expect(dangerLine({ hero: "Bristleback", kind: "threat", isSure: true, beats: [] })).toBe("Bristleback: Strong against your team.");
  });

  it("still names the danger without item data", () => {
    expect(dangerLine({ hero: "Medusa", kind: "carry", isSure: false })).toBe("Medusa: Likely enemy carry.");
    expect(dangerLine({ hero: "Magnus", kind: "initiator", isSure: false })).toBe("Magnus: Starts the enemy's fights.");
  });

  it("keeps two danger heroes with the longest names inside the word budget", () => {
    const lines = [
      dangerLine({
        hero: "Outworld Devourer",
        kind: "threat",
        item: { name: "Aghanim's Scepter", minute: 25 },
        isSure: false,
        beats: ["Keeper of the Light", "Ancient Apparition", "Shadow Fiend"],
      }),
      dangerLine({ hero: "Keeper of the Light", kind: "carry", item: { name: "Eye of Skadi", minute: 31 }, isSure: true }),
    ];
    expect(lines.reduce((n, l) => n + wordCount(l), 0)).toBeLessThanOrEqual(STORY_WORDS.danger);
  });
});
