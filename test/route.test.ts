import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS } from "../src/config";
import { Deduper } from "../src/dedupe";
import { Router } from "../src/route";
import { lead } from "./helpers";

test("specialists share leads for a service, least loaded first", () => {
  const router = new Router(DEFAULTS);
  const owners = [1, 2, 3, 4].map(() => router.assign(lead({ service: "bathroom" }), "hot").ownerId);
  assert.deepEqual(owners, ["owner-1", "owner-2", "owner-1", "owner-2"]);
});

test("unknown service goes to a generalist who takes the tier", () => {
  const router = new Router(DEFAULTS);
  const a = router.assign(lead({ service: "gutters" }), "warm");
  assert.equal(a.ownerId, "owner-3");
  assert.match(a.reason, /generalist/);
});

test("cold lead for a specialist service still goes to someone who takes cold", () => {
  const router = new Router(DEFAULTS);
  assert.equal(router.assign(lead({ service: "kitchen" }), "cold").ownerId, "owner-3");
});

test("out of area postal code goes to the nurture queue", () => {
  const router = new Router(DEFAULTS);
  const a = router.assign(lead({ service: "kitchen", postalCode: "99999" }), "hot");
  assert.equal(a.ownerId, "queue-nurture");
  assert.match(a.reason, /outside the service area/);
});

test("no owner takes the tier: falls back to least loaded owner", () => {
  const router = new Router({ ...DEFAULTS, owners: [{ id: "o", name: "Morgan Testcase", services: ["kitchen"], tiers: ["hot"] }] });
  assert.match(router.assign(lead({ service: "painting" }), "cold").reason, /fallback/);
});

test("deduper matches on phone or email inside the window only", () => {
  const dedupe = new Deduper(60_000);
  assert.equal(dedupe.check(lead({ phone: "5555550101", email: "a@example.com" }), "lead_1", 0), undefined);
  assert.equal(dedupe.check(lead({ phone: "5555550101" }), "lead_2", 1000), "lead_1");
  assert.equal(dedupe.check(lead({ email: "a@example.com", phone: "5555550199" }), "lead_3", 2000), "lead_1");
  assert.equal(dedupe.check(lead({ phone: "5555550101" }), "lead_4", 60_001), undefined);
  assert.equal(dedupe.check(lead({ phone: "5555550150" }), "lead_5", 3000), undefined);
});
