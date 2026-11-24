/**
 * Offline simulator. Pushes synthetic leads through the real pipeline with a
 * virtual clock and a seeded mock channel, so the output is the same on every
 * run and the whole thing finishes in well under a second.
 *
 * Usage: npm run demo   (prints the report and writes demo/output.txt)
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MockChannel } from "../src/channel";
import { DEFAULTS } from "../src/config";
import { formatMs, summarize } from "../src/metrics";
import { LeadStore, Pipeline } from "../src/pipeline";
import type { Clock } from "../src/types";

class VirtualClock implements Clock {
  private t = Date.UTC(2030, 0, 7, 14, 0, 0);
  now = () => this.t;
  advance = (ms: number) => void (this.t += ms);
}

/** Small seeded PRNG (mulberry32) so the demo is reproducible. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = prng(42);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

// Everything below is invented. Phones use the 555-01xx fiction range.
const FIRST = ["Alex", "Jordan", "Casey", "Riley", "Morgan", "Taylor", "Jamie", "Quinn"];
const LAST = ["Sample", "Example", "Placeholder", "Testcase", "Demo"];
const SERVICES = ["kitchen", "bathroom", "roofing", "plumbing", "painting", "gutters"];
const SOURCES = ["web_form", "referral", "paid_ad", "phone_app"];
const POSTAL = ["00012", "00044", "00107", "00163", "99801"];
const MESSAGES = [
  "Water leak under the sink, need someone today if possible.",
  "Looking for a quote on a full remodel this spring, flexible on dates.",
  "Urgent: ceiling stain is spreading after last night's rain.",
  "Quote please",
  "",
  "Two rooms need repainting before the end of the month, walls are in good shape.",
];

function syntheticLead(i: number): Record<string, unknown> {
  const first = pick(FIRST);
  const last = pick(LAST);
  const lead: Record<string, unknown> = {
    name: `${first} ${last}`,
    service: pick(SERVICES),
    source: pick(SOURCES),
    postalCode: pick(POSTAL),
    message: pick(MESSAGES),
  };
  if (random() < 0.8) lead.phone = `555-555-01${String(i).padStart(2, "0")}`;
  if (!lead.phone || random() < 0.5) lead.email = `${first}.${last}.${i}@example.com`.toLowerCase();
  if (random() < 0.4) lead.budget = pick([1500, 4000, 7500, 20000]);
  return lead;
}

async function main(): Promise<void> {
  const clock = new VirtualClock();
  const config = { ...DEFAULTS };
  const store = new LeadStore();
  // Simulated provider latency: usually 1 to 12 seconds, about one send in ten is very slow.
  const channel = new MockChannel({
    clock,
    latencyMs: () => (random() < 0.1 ? 45_000 + random() * 50_000 : 1000 + random() * 11_000),
    wait: async (ms) => clock.advance(ms),
  });
  const pipeline = new Pipeline({ config, clock, channel, store });

  const inbound: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= 24; i += 1) {
    const lead = syntheticLead(i);
    inbound.push(lead);
    if (i % 8 === 0) inbound.push({ ...lead, message: "Just checking you got my request" }); // double submit
  }
  inbound.splice(5, 0, { name: "Quinn Demo", message: "call me" }); // no contact details
  inbound.splice(17, 0, { name: "Riley Testcase", phone: "555-01", service: "plumbing" }); // truncated phone

  const out: string[] = [];
  const row = (cols: string[], widths: number[]) => cols.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  const widths = [9, 10, 9, 10, 14, 9, 6];
  out.push("speed-to-lead offline simulation (synthetic leads, virtual clock, seeded mock channel)");
  out.push("");
  out.push(row(["lead", "status", "tier", "service", "owner", "response", "target"], widths));
  out.push(row(widths.map((w) => "-".repeat(w)), widths));

  for (const body of inbound) {
    clock.advance(20_000 + random() * 600_000); // gap between arrivals
    const r = await pipeline.handle(body);
    const detail =
      r.status === "duplicate" ? `duplicate of ${r.duplicateOf}` : r.status === "rejected" ? (r.errors ?? []).join("; ") : "";
    out.push(
      row(
        [
          r.id,
          r.status,
          r.score ? `${r.score.tier} ${r.score.score}` : "",
          r.lead?.service ?? "",
          r.assignment?.ownerName ?? "",
          r.timeToFirstResponseMs === undefined ? "" : formatMs(r.timeToFirstResponseMs),
          r.withinSla === undefined ? detail : r.withinSla ? "ok" : "MISSED",
        ],
        widths,
      ),
    );
  }

  const sample = store.all().find((r) => r.score?.tier === "hot");
  if (sample?.score && sample.assignment && sample.response) {
    out.push("", `Why ${sample.id} scored ${sample.score.score} (${sample.score.tier}):`);
    for (const rule of sample.score.fired) out.push(`  ${((rule.points > 0 ? "+" : "") + rule.points).padStart(3)}  ${rule.id}: ${rule.description}`);
    out.push(`Routed to ${sample.assignment.ownerName}: ${sample.assignment.reason}`);
    out.push(`First response (${sample.response.via}): "${sample.response.body}"`);
  }

  const s = summarize(store.all(), config.slaMs);
  const fr = s.firstResponse;
  out.push("", "Summary");
  out.push(`  leads received            ${s.total}`);
  out.push(`  responded                 ${s.byStatus.responded}`);
  out.push(`  duplicates suppressed     ${s.byStatus.duplicate}`);
  out.push(`  rejected (invalid)        ${s.byStatus.rejected}`);
  out.push(`  failed                    ${s.byStatus.failed}`);
  out.push(`  messages sent             ${channel.sent.length}`);
  out.push(`  median first response     ${formatMs(fr.medianMs)}`);
  out.push(`  p90 first response        ${formatMs(fr.p90Ms)}`);
  out.push(`  slowest first response    ${formatMs(fr.maxMs)}`);
  out.push(`  within ${formatMs(s.slaMs)} target      ${fr.withinSlaPct?.toFixed(0)}%`);
  out.push("", "Note: latency here is simulated by the mock channel. These numbers show the", "measurement working, not the speed of any real provider.");

  const text = out.join("\n") + "\n";
  process.stdout.write(text);
  writeFileSync(fileURLToPath(new URL("./output.txt", import.meta.url)), text, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
