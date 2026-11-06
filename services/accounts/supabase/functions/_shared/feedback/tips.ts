/**
 * The only advice text feedback may show: a fixed, reviewed set of tips, one per finding kind
 * and role. Placeholders are filled with the player's own numbers and names, nothing else, so
 * feedback never invents advice.
 */

export type FindingKind = "early_deaths" | "deaths" | "laning" | "farm" | "damage" | "healing" | "towers";
export type Role = "core" | "support";

/**
 * {killer} is a hero name, {minute} a game minute, {value} a number from the player's games,
 * {deaths} how often they died ("6 times in this game", "about 4 times per game").
 */
export const TIPS: Record<FindingKind, Record<Role, string>> = {
  early_deaths: {
    core: "Most early deaths came from {killer}. Before minute {minute}, keep a Town Portal Scroll, stand behind " +
      "your creep wave and step back when the enemy mid goes missing after a rune.",
    support: "Most early deaths came from {killer}. Place an observer that sees the river before minute {minute}, " +
      "and pull or stack from the side your carry stands on, not alone.",
  },
  deaths: {
    core: "You died {deaths}. Check the minimap before farming a lane past the river, and " +
      "buy a defensive item before your next damage item when you die twice in a row.",
    support: "You died {deaths}. Ward in pairs with a teammate, and move to the next ward spot " +
      "through your own jungle, not the river.",
  },
  laning: {
    core: "You ended the lane about {value} gold behind. Ask a support to stay in lane until minute 5, and buy " +
      "regeneration before the lane so you can keep last hitting.",
    support: "Your lane ended about {value} gold behind. Pull the nearest neutral camp when the wave pushes " +
      "toward the enemy tower, so it comes back near yours for your carry.",
  },
  farm: {
    core: "Your farm was lower than most players on these heroes. Push out a wave, then farm the nearest jungle " +
      "camp before the next wave arrives, instead of waiting in one lane.",
    support: "Your farm was lower than most supports on these heroes. Take the lane's last hits your core misses, " +
      "and stack a camp around x:53 of a minute when you pass one.",
  },
  damage: {
    core: "Your hero damage was lower than most. Join fights when your key item is done instead of farming " +
      "through them, and hit heroes, not creeps, while a fight is on.",
    support: "Your hero damage was lower than most. Use your spells on heroes at the start of each fight, not " +
      "after it is decided.",
  },
  healing: {
    core: "Your healing was lower than most on this hero. Use your healing spells in fights, not only after them.",
    support: "Your healing was lower than most on this hero. Stay close to the teammate the enemy dives, and save " +
      "your heal for when they are under half health.",
  },
  towers: {
    core: "Your tower damage was lower than most. After a won fight, hit the closest tower before you go back " +
      "to farming.",
    support: "Your tower damage was lower than most. After a won fight, hit the closest tower with your team " +
      "before going back to warding.",
  },
};

/** The tip for a finding, with its placeholders filled. Unknown placeholders stay out of the text. */
export function tipFor(kind: FindingKind, role: Role, values: Record<string, string>): string {
  return TIPS[kind][role].replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}
