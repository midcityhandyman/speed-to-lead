import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePhone, validateLead } from "../src/validate";

test("normalizePhone accepts common formats and rejects short numbers", () => {
  assert.equal(normalizePhone("(555) 555-0101"), "5555550101");
  assert.equal(normalizePhone("+1 555.555.0102"), "5555550102");
  assert.equal(normalizePhone("555-0101"), undefined);
});

test("valid lead is normalized with defaults", () => {
  const result = validateLead({ name: "  Alex Sample ", phone: "555-555-0101", email: "ALEX@Example.com", service: "Kitchen" });
  assert.ok(result.ok);
  assert.deepEqual(result.lead, {
    name: "Alex Sample",
    phone: "5555550101",
    email: "alex@example.com",
    service: "kitchen",
    message: "",
    source: "unknown",
    postalCode: undefined,
    budget: undefined,
  });
});

test("missing name and contact are both reported", () => {
  const result = validateLead({ message: "hello" });
  assert.ok(!result.ok);
  assert.deepEqual(result.errors, ["name is required", "phone or email is required"]);
});

test("bad phone, bad email and bad budget are rejected", () => {
  const result = validateLead({ name: "Riley Demo", phone: "12345", email: "not-an-email", budget: "lots" });
  assert.ok(!result.ok);
  assert.deepEqual(result.errors, ["phone must have 10 digits", "email is not valid", "budget must be a non-negative number"]);
});

test("non-object bodies are rejected", () => {
  for (const body of [null, "text", 42, []]) {
    const result = validateLead(body);
    assert.ok(!result.ok);
  }
});

test("one usable contact is enough: a mistyped second contact is dropped, not fatal", () => {
  const badPhone = validateLead({ name: "Riley Demo", phone: "555-01", email: "riley@example.com" });
  assert.ok(badPhone.ok);
  assert.equal(badPhone.lead.phone, undefined);
  assert.equal(badPhone.lead.email, "riley@example.com");

  const badEmail = validateLead({ name: "Riley Demo", phone: "555-555-0107", email: "riley@" });
  assert.ok(badEmail.ok);
  assert.equal(badEmail.lead.phone, "5555550107");
  assert.equal(badEmail.lead.email, undefined);
});
