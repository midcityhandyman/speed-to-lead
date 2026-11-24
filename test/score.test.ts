import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS } from "../src/config";
import { RULES, scoreLead, tierFor } from "../src/score";
import { lead } from "./helpers";

test("score is the sum of fired rules and every fired rule is listed", () => {
  const result = scoreLead(
    lead({ phone: "5555550101", service: "kitchen", postalCode: "00012", message: "Pipe leak under the sink, need help today please" }),
    DEFAULTS,
  );
  assert.deepEqual(
    result.fired.map((r) => r.id),
    ["has_phone", "urgent_language", "high_value_service", "in_service_area", "detailed_message"],
  );
  assert.equal(result.score, 15 + 25 + 20 + 15 + 5);
  assert.equal(result.score, result.fired.reduce((sum, r) => sum + r.points, 0));
  assert.equal(result.tier, "hot");
});

test("email only lead with no message is cold and never negative", () => {
  const result = scoreLead(lead({ email: "casey@example.com" }), DEFAULTS);
  assert.deepEqual(result.fired.map((r) => r.id), ["has_email", "no_message"]);
  assert.equal(result.score, 0);
  assert.equal(result.tier, "cold");
});

test("referral with budget lands in warm", () => {
  const result = scoreLead(lead({ email: "jordan@example.com", source: "referral", budget: 8000, message: "Quote please" }), DEFAULTS);
  assert.equal(result.score, 35);
  assert.equal(result.tier, "warm");
});

test("tier thresholds are inclusive", () => {
  assert.equal(tierFor(60), "hot");
  assert.equal(tierFor(59), "warm");
  assert.equal(tierFor(30), "warm");
  assert.equal(tierFor(29), "cold");
});

test("rule ids are unique", () => {
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
});
