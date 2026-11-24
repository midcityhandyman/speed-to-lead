import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { MockChannel, systemClock } from "../src/channel";
import { DEFAULTS, loadConfig } from "../src/config";
import { LeadStore, Pipeline } from "../src/pipeline";
import { createApp } from "../src/server";

const config = { ...DEFAULTS, webhookSecret: "test-secret" };
const store = new LeadStore();
const channel = new MockChannel({ clock: systemClock, latencyMs: () => 5 });
const server = createApp(new Pipeline({ config, clock: systemClock, channel, store }), store, config);
let base = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

function post(body: string, secret = "test-secret") {
  return fetch(`${base}/webhook/lead`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-secret": secret },
    body,
  });
}

const payload = JSON.stringify({ name: "Jordan Example", phone: "555-555-0142", service: "roofing", postalCode: "00177", message: "Roof leak" });

test("webhook requires the shared secret when one is configured", async () => {
  assert.equal((await post(payload, "wrong")).status, 401);
  assert.equal(store.all().length, 0);
});

test("webhook: 201 for a new lead, 200 for a duplicate, 422 invalid, 400 bad JSON", async () => {
  const created = await post(payload);
  assert.equal(created.status, 201);
  const record = (await created.json()) as { status: string; timeToFirstResponseMs: number; assignment: { ownerId: string } };
  assert.equal(record.status, "responded");
  assert.equal(record.assignment.ownerId, "owner-2");
  assert.ok(record.timeToFirstResponseMs >= 4 && record.timeToFirstResponseMs < 60_000);

  const dup = await post(payload);
  assert.equal(dup.status, 200);
  assert.equal(((await dup.json()) as { status: string }).status, "duplicate");

  assert.equal((await post(JSON.stringify({ name: "No Contact" }))).status, 422);
  assert.equal((await post("{not json")).status, 400);
  assert.equal(channel.sent.length, 1);
});

test("metrics endpoints report what the webhook recorded", async () => {
  const json = (await (await fetch(`${base}/metrics.json`)).json()) as {
    total: number;
    byStatus: Record<string, number>;
    firstResponse: { count: number; medianMs: number; p90Ms: number };
  };
  assert.equal(json.total, 3);
  assert.deepEqual(json.byStatus, { responded: 1, duplicate: 1, rejected: 1, failed: 0 });
  assert.equal(json.firstResponse.count, 1);
  assert.equal(json.firstResponse.medianMs, json.firstResponse.p90Ms);

  const page = await fetch(`${base}/metrics`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  const html = await page.text();
  assert.match(html, /p90 time to first response/);
  assert.ok(!html.includes("5555550142"), "metrics page must not show contact details");
});

test("health and unknown routes", async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});

test("loadConfig reads env values and refuses unknown channel modes", () => {
  const c = loadConfig({ PORT: "4100", SLA_SECONDS: "30", DEDUPE_WINDOW_MINUTES: "10", WEBHOOK_SECRET: "s" });
  assert.equal(c.port, 4100);
  assert.equal(c.slaMs, 30_000);
  assert.equal(c.dedupeWindowMs, 600_000);
  assert.equal(c.webhookSecret, "s");
  assert.equal(loadConfig({}).slaMs, 60_000);
  assert.throws(() => loadConfig({ CHANNEL_MODE: "sms" }), /not implemented/);
});
