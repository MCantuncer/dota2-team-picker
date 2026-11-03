import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/score";
import { fixture } from "./fixture";

describe("blind pick risk", () => {
  // Mid Three beats Offlane Five, so Offlane Five is at risk while Mid Three can still be picked.
  const engine = new Engine(fixture(), { hardCounters: [] });
  const offlaneFive = (bans: number[]) => engine.suggest({ myPosition: 3, allies: [], enemies: [], bans }).find((s) => s.heroId === 5)!;

  it("warns about the counter still open and gets safer when it is banned", () => {
    const open = offlaneFive([]);
    const banned = offlaneFive([3]);
    expect(open.reasons.at(-1)).toMatch(/^Watch out: easy to punish: Mid Three can still be picked \(-\d+\.\d\)$/);
    expect(banned.breakdown.pickSafety).toBeGreaterThan(open.breakdown.pickSafety + 1);
    expect(banned.reasons.join()).toMatch(/Safer now: Mid Three is banned \(\+\d+\.\d\)/);
  });

  it("has no risk once the enemy has picked all five", () => {
    const full = engine.suggest({ myPosition: 3, allies: [], enemies: [1, 2, 4, 6, 7] }).find((s) => s.heroId === 5)!;
    expect(full.breakdown.pickSafety).toBe(0);
  });

  it("counts the lane partner's synergy extra when its position is known", () => {
    const data = fixture();
    data.synergy["4-5"] = { games: 2000, wins: 1200 };
    const withPartner = new Engine(data, { hardCounters: [] });
    const synergy = (position?: 4 | 5) =>
      withPartner.suggest({ myPosition: 3, allies: [{ heroId: 4, position }], enemies: [] }).find((s) => s.heroId === 5)!.breakdown.synergy;
    expect(synergy(4)).toBeCloseTo(synergy(undefined) * 1.5, 1);
    expect(synergy(5)).toBeCloseTo(synergy(undefined), 5);
  });
});
