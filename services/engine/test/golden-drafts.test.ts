import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gamePlan } from "../src/engine/game-plan";
import { chooseTimingSlice } from "../src/engine/item-timing-slice";
import { Engine } from "../src/engine/score";
import type { Snapshot } from "../src/engine/types";
import { GOLDEN_DRAFTS } from "./golden/drafts";
import { storyText } from "./golden/render";

// Real data cut down to the golden heroes (scripts/golden-fixture.ts).
const snapshot = JSON.parse(readFileSync(new URL("./fixtures/golden-snapshot.json", import.meta.url), "utf8")) as Snapshot;
const engine = new Engine(snapshot);
/** "Legend teamfight mirror" is stored in golden/stories/legend-teamfight-mirror.md. */
const storyFile = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.md`;
const plans = GOLDEN_DRAFTS.map((draft) => ({
  draft,
  plan: gamePlan(engine, {
    ours: draft.ours.map((heroId, i) => ({ heroId, position: (i + 1) as 1 | 2 | 3 | 4 | 5 })),
    theirs: draft.theirs,
    rankBracket: draft.rankBracket,
  }),
}));

describe("golden drafts", () => {
  // One file per draft, so pull requests that change different drafts' stories don't conflict.
  it.each(plans)("keep the story a strong player has read: $draft.name (review its file when it changes)", async ({ draft, plan }) => {
    const text = storyText(draft.name, plan, (id) => engine.hero(id).name);
    await expect(text).toMatchFileSnapshot(`./golden/stories/${storyFile(draft.name)}`);
  });

  it("give every draft its own story file", () => {
    const files = GOLDEN_DRAFTS.map((d) => storyFile(d.name));
    expect(new Set(files).size).toBe(files.length);
  });

  it("buy core items one after another, never two at the same minute", () => {
    for (const { draft, plan } of plans) {
      for (const p of plan.players) {
        const minutes = p.build?.core.map((c) => c.minute) ?? [];
        expect(minutes, `${draft.name}, pos ${p.position}`).toEqual([...minutes].sort((a, b) => a - b));
        expect(new Set(minutes).size, `${draft.name}, pos ${p.position}: ${minutes.join(", ")}`).toBe(minutes.length);
      }
    }
  });

  it("never put an item earlier than players really buy it", () => {
    for (const { draft, plan } of plans) {
      for (const p of plan.players) {
        const slice = chooseTimingSlice(snapshot, p.heroId, p.position, draft.rankBracket)?.slice;
        const usual = new Map(slice?.items.map(([id, minute]) => [id, minute]));
        for (const item of p.build?.core ?? []) {
          const minute = usual.get(item.itemId);
          if (minute !== undefined) expect(item.minute, `${draft.name}: ${item.name}`).toBeGreaterThanOrEqual(minute);
        }
      }
    }
  });
});
