import { assertEquals } from "jsr:@std/assert@1";
import { poolCardText } from "./reason.ts";
import type { PoolCandidate } from "./rules.ts";

const card: PoolCandidate = {
  heroId: 114,
  position: 1,
  games: 7,
  wins: 6,
  strongGames: 5,
  winLowerBound: 0.55,
  lastPlayed: 0,
  isPositionFromDraftsOnly: false,
  standout: { kind: "stat", stat: "gold_per_min", averagePercentile: 0.78, averageValue: 640.4 },
};

Deno.test("quotes the win % and the stat that stood out", () => {
  assertEquals(poolCardText(card, "Monkey King"), {
    question: "Add Monkey King to your carry heroes?",
    reason: "You won 86% of your last 7 Monkey King games as carry (pos 1). " +
      "Your GPM averaged 640, higher than 78% of Monkey King games on OpenDota (all ranks).",
  });
});

Deno.test("says when the position came only from drafts, and quotes IMP", () => {
  const text = poolCardText(
    { ...card, position: 4, isPositionFromDraftsOnly: true, standout: { kind: "imp", averageImp: 27.4 } },
    "Monkey King",
  );
  assertEquals(text.question, "Add Monkey King to your soft support heroes?");
  assertEquals(
    text.reason,
    "You won 86% of your last 7 Monkey King games as soft support in your drafts. " +
      "Your STRATZ IMP averaged +27 (0 is an average game).",
  );
});

Deno.test("small per minute values keep one decimal, and no standout means one line", () => {
  const kills = {
    ...card,
    standout: { kind: "stat" as const, stat: "kills_per_min" as const, averagePercentile: 0.7, averageValue: 0.32 },
  };
  assertEquals(
    poolCardText(kills, "Lion").reason.endsWith(
      "Your kills per minute averaged 0.3, higher than 70% of Lion games on OpenDota (all ranks).",
    ),
    true,
  );
  assertEquals(
    poolCardText({ ...card, standout: null }, "Lion").reason,
    "You won 86% of your last 7 Lion games as carry (pos 1).",
  );
});

Deno.test("never uses the em dash", () => {
  const { question, reason } = poolCardText(card, "Monkey King");
  assertEquals(`${question}${reason}`.includes(String.fromCharCode(0x2014)), false);
});
