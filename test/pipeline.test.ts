import assert from "node:assert/strict";
import { test } from "node:test";
import { harness } from "./helpers";

const good = { name: "Alex Sample", phone: "(555) 555-0101", service: "kitchen", postalCode: "00010", message: "Kitchen leak, urgent" };

test("happy path: scored, routed, answered, and timed at every step", async () => {
  const { pipeline, channel, store } = harness({ latencyMs: 2000 });
  const record = await pipeline.handle(good);

  assert.equal(record.status, "responded");
  assert.equal(record.score?.tier, "hot");
  assert.equal(record.assignment?.ownerId, "owner-1");
  assert.deepEqual(record.timings.map((t) => t.step), ["validate", "dedupe", "score", "route", "respond"]);
  assert.equal(record.timeToFirstResponseMs, 2000);
  assert.equal(record.withinSla, true);
  assert.equal(record.response?.attempts, 1);

  assert.equal(channel.sent.length, 1);
  assert.equal(channel.sent[0]?.via, "sms");
  assert.equal(channel.sent[0]?.to, "5555550101");
  assert.match(channel.sent[0]?.body ?? "", /^Hi Alex, thanks for your kitchen request/);
  assert.equal(store.all().length, 1);
});

test("duplicate gets no second message and points at the original", async () => {
  const { pipeline, channel, clock } = harness();
  const first = await pipeline.handle(good);
  clock.advance(5 * 60_000);
  const second = await pipeline.handle({ ...good, name: "A. Sample", message: "Following up" });

  assert.equal(second.status, "duplicate");
  assert.equal(second.duplicateOf, first.id);
  assert.equal(second.timeToFirstResponseMs, undefined);
  assert.deepEqual(second.timings.map((t) => t.step), ["validate", "dedupe"]);
  assert.equal(channel.sent.length, 1);
});

test("same contact after the dedupe window is a new lead", async () => {
  const { pipeline, clock, channel } = harness({ config: { dedupeWindowMs: 60_000 } });
  await pipeline.handle(good);
  clock.advance(120_000);
  assert.equal((await pipeline.handle(good)).status, "responded");
  assert.equal(channel.sent.length, 2);
});

test("invalid lead is rejected, recorded, and sends nothing", async () => {
  const { pipeline, channel, store } = harness();
  const record = await pipeline.handle({ name: "", phone: "123" });
  assert.equal(record.status, "rejected");
  assert.ok(record.errors?.includes("name is required"));
  assert.equal(channel.sent.length, 0);
  assert.equal(store.all()[0]?.status, "rejected");
});

test("email only lead is answered by email", async () => {
  const { pipeline, channel } = harness();
  await pipeline.handle({ name: "Casey Placeholder", email: "casey@example.com" });
  assert.equal(channel.sent[0]?.via, "email");
  assert.equal(channel.sent[0]?.to, "casey@example.com");
});

test("one channel failure is retried and the retry time counts", async () => {
  const { pipeline } = harness({ latencyMs: 3000, failFirst: 1 });
  const record = await pipeline.handle(good);
  assert.equal(record.status, "responded");
  assert.equal(record.response?.attempts, 2);
  assert.equal(record.timeToFirstResponseMs, 6000);
});

test("channel that keeps failing marks the lead failed", async () => {
  const { pipeline, channel } = harness({ failFirst: 5 });
  const record = await pipeline.handle(good);
  assert.equal(record.status, "failed");
  assert.equal(record.timeToFirstResponseMs, undefined);
  assert.equal(channel.sent.length, 0);
});

test("slow send is flagged as outside the 60 second target", async () => {
  const { pipeline } = harness({ latencyMs: 75_000 });
  const record = await pipeline.handle(good);
  assert.equal(record.status, "responded");
  assert.equal(record.withinSla, false);
});
