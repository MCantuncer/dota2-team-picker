/**
 * How each data source did on the last refreshes, kept in the snapshot (Snapshot.sourceHealth), so a patch needs nobody
 * to read the logs: Data Status shows what is still catching up, and the refresh opens one GitHub issue only when a
 * source has kept failing for BROKEN_DAYS (scripts/source-health.ts). A source that fails once and works on the next
 * run never shows up.
 *
 * Two kinds of trouble:
 * - "fail": the download or check failed and the last data was kept. Counted as broken after BROKEN_DAYS.
 * - "lag": the source works but hasn't caught up with the patch yet (STRATZ not listing it, OpenDota's constants
 *   behind the game files). Shown, never an issue: it fixes itself when the source updates.
 */
import type { SourceState } from "../engine/types";

/** Days a source has to keep failing before the refresh opens an issue. */
export const BROKEN_DAYS = 2;
/**
 * Hours since the published data was built after which the refresh itself counts as broken. GitHub starts the
 * 4-a-day schedule late and skips some runs (about 2 runs a day, up to 17 hours apart, in late November 2026), so a
 * day without a successful upload means runs failed, not that GitHub was slow.
 */
export const STALE_HOURS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The issue line for published data older than STALE_HOURS (a run that fails as a whole uploads nothing and records no
 * source), or null when it is fresh. An unreadable time counts as stale.
 */
export function staleData(generatedAt: string | undefined, now: Date, hours = STALE_HOURS): string | null {
  const age = (now.getTime() - Date.parse(generatedAt ?? "")) / 3_600_000;
  if (Number.isFinite(age) && age < hours) return null;
  const since = Number.isFinite(age) ? `${Math.floor(age)} hours ago (${generatedAt})` : "at an unknown time";
  return `- **Hero data refresh**: the published hero data was last built ${since}. The refresh runs keep failing before they upload; see the "Refresh hero data" workflow runs.`;
}

export type SourceHealth = Record<string, SourceState>;

/** Records this run's result for one source: `since` is kept from the first run of an unbroken failing or lagging spell. */
export function record(health: SourceHealth, name: string, state: "ok" | "fail" | "lag", now: Date, note?: string): void {
  const last = health[name];
  const at = now.toISOString();
  if (state === "ok") {
    health[name] = { state, at };
    return;
  }
  const since = last?.state === state && last.since ? last.since : at;
  health[name] = { state, at, since, ...(note ? { note: note.slice(0, 300) } : {}) };
}

/** Sources failing for BROKEN_DAYS or more, oldest failure first. Lagging sources are left out. */
export function brokenSources(health: SourceHealth | undefined, now: Date, days = BROKEN_DAYS): [string, SourceState][] {
  return Object.entries(health ?? {})
    .filter(([, s]) => s.state === "fail" && s.since !== undefined && now.getTime() - Date.parse(s.since) >= days * DAY_MS)
    .sort(([, a], [, b]) => Date.parse(a.since!) - Date.parse(b.since!));
}

/** The issue body for the broken sources: what fails, since when, the last error, and that the last data is kept. */
export function issueBody(broken: [string, SourceState][], now: Date, stale: string | null = null): string {
  const days = (s: SourceState) => Math.floor((now.getTime() - Date.parse(s.since!)) / DAY_MS);
  return [
    "The hero data refresh keeps the last good data for these sources, so the site still works, but they have kept failing:",
    "",
    ...(stale ? [stale] : []),
    ...broken.map(([name, s]) => `- **${name}**: failing for ${days(s)} days, since ${s.since}. Last error: ${s.note ?? "none given"}`),
    "",
    "This issue closes itself when every source works again.",
  ].join("\n");
}
