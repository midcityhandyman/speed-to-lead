import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMs, median, percentile, renderMetricsPage, summarize } from "../src/metrics";
import type { LeadRecord } from "../src/types";

test("median handles odd, even and empty lists", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("percentile uses nearest rank", () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(values, 90), 90);
  assert.equal(percentile(values, 50), 50);
  assert.equal(percentile(values, 100), 100);
  assert.equal(percentile([7], 90), 7);
  assert.equal(percentile([], 90), null);
});

function responded(id: string, ms: number): LeadRecord {
  return {
    id,
    receivedAt: 0,
    status: "responded",
    timings: [{ step: "respond", startedAt: 0, durationMs: ms }],
    timeToFirstResponseMs: ms,
    withinSla: ms <= 60_000,
  };
}

test("summarize counts statuses and computes first response stats", () => {
  const records: LeadRecord[] = [
    responded("lead_0001", 2000),
    responded("lead_0002", 4000),
    responded("lead_0003", 6000),
    responded("lead_0004", 90_000),
    { id: "lead_0005", receivedAt: 0, status: "duplicate", timings: [] },
    { id: "lead_0006", receivedAt: 0, status: "rejected", timings: [] },
  ];
  const s = summarize(records, 60_000);
  assert.equal(s.total, 6);
  assert.deepEqual(s.byStatus, { responded: 4, duplicate: 1, rejected: 1, failed: 0 });
  assert.equal(s.firstResponse.medianMs, 5000);
  assert.equal(s.firstResponse.p90Ms, 90_000);
  assert.equal(s.firstResponse.withinSlaPct, 75);
  assert.equal(s.steps.find((x) => x.step === "respond")?.count, 4);
});

test("empty store summarizes without errors", () => {
  const s = summarize([], 60_000);
  assert.equal(s.firstResponse.medianMs, null);
  assert.match(renderMetricsPage(s, []), /n\/a/);
});

test("metrics page shows the headline numbers and escapes content", () => {
  const record = responded("lead_<b>", 2500);
  const html = renderMetricsPage(summarize([record], 60_000), [record]);
  assert.match(html, /median time to first response/);
  assert.match(html, /2\.5 s/);
  assert.ok(!html.includes("lead_<b>"));
  assert.equal(formatMs(0.5), "0.50 ms");
});

test("failed sends count as misses in the within target percentage", () => {
  const records: LeadRecord[] = [
    responded("lead_0001", 2000),
    { id: "lead_0002", receivedAt: 0, status: "failed", timings: [] },
  ];
  const s = summarize(records, 60_000);
  assert.equal(s.firstResponse.count, 1);
  assert.equal(s.firstResponse.withinSlaPct, 50);
  assert.equal(summarize([records[1]!], 60_000).firstResponse.withinSlaPct, 0);
});
