import type { Lead } from "./types";

export type ValidationResult = { ok: true; lead: Lead } | { ok: false; errors: string[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns a 10 digit phone number, or undefined if the input is not one. */
export function normalizePhone(raw: string): string | undefined {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? digits : undefined;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function validateLead(raw: unknown): ValidationResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["body must be a JSON object"] };
  }
  const input = raw as Record<string, unknown>;
  const errors: string[] = [];

  const name = text(input.name, 120);
  if (!name) errors.push("name is required");

  const rawPhone = text(input.phone, 40);
  const phone = rawPhone ? normalizePhone(rawPhone) : undefined;
  if (rawPhone && !phone) errors.push("phone must have 10 digits");

  const rawEmail = text(input.email, 200).toLowerCase();
  const email = rawEmail && EMAIL.test(rawEmail) ? rawEmail : undefined;
  if (rawEmail && !email) errors.push("email is not valid");

  if (!rawPhone && !rawEmail) errors.push("phone or email is required");

  let budget: number | undefined;
  if (input.budget !== undefined && input.budget !== null && input.budget !== "") {
    const n = Number(input.budget);
    if (Number.isFinite(n) && n >= 0) budget = n;
    else errors.push("budget must be a non-negative number");
  }

  if (errors.length > 0) return { ok: false, errors };

  const postalCode = text(input.postalCode, 12).toUpperCase() || undefined;
  return {
    ok: true,
    lead: {
      name,
      phone,
      email,
      service: text(input.service, 60).toLowerCase() || "general",
      message: text(input.message, 2000),
      source: text(input.source, 60).toLowerCase() || "unknown",
      postalCode,
      budget,
    },
  };
}
