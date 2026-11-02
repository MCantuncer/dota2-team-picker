import type { GamePlan } from "../../src/engine/game-plan";
import type { BuildItem } from "../../src/engine/item-build";

/** One item as "Battle Fury 15/16 [reason]": usual minute, slower than most after, why. */
function itemText(item: BuildItem): string {
  const late = item.lateMinute ? `/${item.lateMinute}` : "";
  return `${item.name} ${item.minute}${late}${item.reason ? ` [${item.reason}]` : ""}`;
}

/** A Game Story as plain text, close to what the panel shows, so a reviewer can read it in a diff. */
export function storyText(title: string, plan: GamePlan, heroName: (id: number) => string): string {
  const lines = [`## ${title}`, "", `Headline: ${plan.story.headline}`, ""];
  for (const c of plan.story.chapters) lines.push(`- ${c.phase}: ${c.text}`);
  lines.push("", "Danger heroes:");
  for (const d of plan.danger) lines.push(`- ${d}`);
  lines.push("", "If the game goes wrong:");
  for (const f of plan.teamFallbacks) lines.push(`- ${f}`);
  lines.push("");
  for (const l of plan.lanes) {
    lines.push(`Lane ${l.name}: ${l.ours.map(heroName).join(" + ")} vs ${l.theirs.map(heroName).join(" + ")}, ${l.verdict}`);
  }
  for (const p of plan.players) {
    lines.push("", `### Pos ${p.position} ${heroName(p.heroId)}`);
    if (p.build) {
      lines.push(`Timings: ${p.build.timings}`);
      if (p.build.start.length) lines.push(`Start: ${p.build.start.map((i) => `${i.count ? `${i.count} ` : ""}${i.name}${i.draft ? ` [${i.reason}]` : ""}`).join(", ")}`);
      if (p.build.lane.length) lines.push(`Lane: ${p.build.lane.map(itemText).join(", ")}`);
      // The core by phase, as the roadmap board shows it.
      const inPhase = (phase: string) => p.build!.core.filter((i) => i.phase === phase).map(itemText).join(", ");
      const boots = inPhase("lane");
      if (boots) lines.push(`Boots: ${boots}${p.build.bootsOr ? `, or ${itemText(p.build.bootsOr)}` : ""}`);
      for (const [label, phase] of [["First", "first"], ["Next", "next"], ["Late", "late"]] as const) {
        const text = inPhase(phase);
        if (text) lines.push(`${label}: ${text}`);
      }
      const usual = (id: number | undefined) => p.build!.core.find((c) => c.itemId === id)?.name;
      if (p.build.situational.length) {
        lines.push(
          `If needed: ${p.build.situational.map((i) => `${itemText(i)}${i.replaces ? ` instead of ${usual(i.replaces)}` : ""}`).join(", ")}`,
        );
      }
    }
    lines.push(`Job: ${p.job}`);
    const itemName = (id: number) =>
      [...(p.build?.start ?? []), ...(p.build?.lane ?? []), ...(p.build?.core ?? []), ...(p.build?.situational ?? [])].find((i) => i.itemId === id)?.name;
    for (const e of p.enemies) {
      const where = e.inLane ? (e.laneSure ? " (lane)" : " (lane, guessed)") : "";
      const answer = e.answers.length ? `buy ${e.answers.map(itemName).join(", ")}` : e.tip;
      lines.push(`Vs ${heroName(e.heroId)}${where}: ${e.threat}. ${answer}.`);
    }
    for (const f of p.fallbacks) lines.push(`If it goes wrong: ${f}`);
  }
  return `${lines.join("\n")}\n`;
}
