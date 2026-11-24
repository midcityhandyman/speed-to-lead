import type { LeadRecord, LeadStatus, StepName } from "./types";

/** Nearest-rank percentile. p is 0 to 100. Returns null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

/** Median as the mean of the two middle values when the count is even. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface MetricsSummary {
  slaMs: number;
  total: number;
  byStatus: Record<LeadStatus, number>;
  firstResponse: { count: number; medianMs: number | null; p90Ms: number | null; maxMs: number | null; withinSlaPct: number | null };
  steps: Array<{ step: StepName; count: number; medianMs: number | null; p90Ms: number | null }>;
}

const STEPS: StepName[] = ["validate", "dedupe", "score", "route", "respond"];

export function summarize(records: readonly LeadRecord[], slaMs: number): MetricsSummary {
  const byStatus: Record<LeadStatus, number> = { responded: 0, duplicate: 0, rejected: 0, failed: 0 };
  for (const r of records) byStatus[r.status] += 1;

  const ttfr = records.flatMap((r) => (r.timeToFirstResponseMs === undefined ? [] : [r.timeToFirstResponseMs]));
  const within = ttfr.filter((ms) => ms <= slaMs).length;

  return {
    slaMs,
    total: records.length,
    byStatus,
    firstResponse: {
      count: ttfr.length,
      medianMs: median(ttfr),
      p90Ms: percentile(ttfr, 90),
      maxMs: ttfr.length ? Math.max(...ttfr) : null,
      withinSlaPct: ttfr.length ? (100 * within) / ttfr.length : null,
    },
    steps: STEPS.map((step) => {
      const durations = records.flatMap((r) => r.timings.filter((t) => t.step === step).map((t) => t.durationMs));
      return { step, count: durations.length, medianMs: median(durations), p90Ms: percentile(durations, 90) };
    }),
  };
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "n/a";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return ms >= 10 ? `${ms.toFixed(0)} ms` : `${ms.toFixed(2)} ms`;
}

function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Small server-rendered page. Shows lead ids only, never contact details. */
export function renderMetricsPage(summary: MetricsSummary, records: readonly LeadRecord[]): string {
  const fr = summary.firstResponse;
  const card = (label: string, value: string) => `<div class="card"><div class="v">${esc(value)}</div><div>${esc(label)}</div></div>`;
  const stepRows = summary.steps
    .map((s) => `<tr><td>${s.step}</td><td>${s.count}</td><td>${esc(formatMs(s.medianMs))}</td><td>${esc(formatMs(s.p90Ms))}</td></tr>`)
    .join("");
  const recentRows = records
    .slice(-15)
    .reverse()
    .map(
      (r) =>
        `<tr><td>${esc(r.id)}</td><td>${r.status}</td><td>${esc(r.score ? `${r.score.tier} (${r.score.score})` : "")}</td>` +
        `<td>${esc(r.assignment?.ownerName ?? "")}</td><td>${esc(formatMs(r.timeToFirstResponseMs))}</td>` +
        `<td>${r.withinSla === undefined ? "" : r.withinSla ? "yes" : "NO"}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Speed to lead metrics</title>
<style>
body{font:15px/1.4 system-ui,sans-serif;margin:2rem auto;max-width:860px;padding:0 1rem;color:#1c2430}
.cards{display:flex;flex-wrap:wrap;gap:12px;margin:1rem 0}
.card{border:1px solid #d5dbe3;border-radius:8px;padding:12px 16px;min-width:130px}
.v{font-size:1.6rem;font-weight:600}
table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #e3e7ec}
</style></head><body>
<h1>Speed to lead</h1>
<p>Time to first response is measured from webhook receipt to confirmed send. Target: ${esc(formatMs(summary.slaMs))}.</p>
<div class="cards">
${card("median time to first response", formatMs(fr.medianMs))}
${card("p90 time to first response", formatMs(fr.p90Ms))}
${card("within target", fr.withinSlaPct === null ? "n/a" : `${fr.withinSlaPct.toFixed(0)}%`)}
${card("leads received", String(summary.total))}
</div>
<p>Responded ${summary.byStatus.responded}, duplicates ${summary.byStatus.duplicate}, rejected ${summary.byStatus.rejected}, failed ${summary.byStatus.failed}.</p>
<h2>Step timings</h2>
<table><tr><th>step</th><th>runs</th><th>median</th><th>p90</th></tr>${stepRows}</table>
<h2>Recent leads</h2>
<table><tr><th>id</th><th>status</th><th>tier (score)</th><th>owner</th><th>first response</th><th>in target</th></tr>${recentRows}</table>
</body></html>`;
}
