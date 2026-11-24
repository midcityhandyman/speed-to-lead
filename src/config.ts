import type { Owner } from "./types";

export interface Config {
  port: number;
  webhookSecret: string;
  slaMs: number;
  dedupeWindowMs: number;
  channelMode: "mock";
  mockChannelLatencyMs: number;
  maxSendAttempts: number;
  /** Postal code prefixes that count as inside the service area. */
  serviceAreaPrefixes: string[];
  highValueServices: string[];
  urgencyKeywords: string[];
  owners: Owner[];
  /** Where out-of-area leads go. They still get a first response. */
  nurtureQueue: Owner;
}

// Synthetic defaults. Every name and postal code here is invented.
export const DEFAULTS: Config = {
  port: 3000,
  webhookSecret: "",
  slaMs: 60_000,
  dedupeWindowMs: 24 * 60 * 60_000,
  channelMode: "mock",
  mockChannelLatencyMs: 150,
  maxSendAttempts: 2,
  serviceAreaPrefixes: ["000", "001"],
  highValueServices: ["kitchen", "bathroom", "roofing"],
  urgencyKeywords: ["urgent", "asap", "today", "emergency", "leak", "flood", "no heat"],
  owners: [
    { id: "owner-1", name: "Robin Fixture", services: ["kitchen", "bathroom"], tiers: ["hot", "warm"] },
    { id: "owner-2", name: "Sky Mockwell", services: ["roofing", "plumbing", "bathroom"], tiers: ["hot", "warm"] },
    { id: "owner-3", name: "Dana Stubman", services: ["*"], tiers: ["hot", "warm", "cold"] },
  ],
  nurtureQueue: { id: "queue-nurture", name: "Nurture Queue", services: ["*"], tiers: ["hot", "warm", "cold"] },
};

function positiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const mode = (env.CHANNEL_MODE ?? "mock").trim().toLowerCase();
  if (mode !== "mock") {
    throw new Error(`CHANNEL_MODE "${mode}" is not implemented. Only "mock" is available.`);
  }
  return {
    ...DEFAULTS,
    port: positiveNumber(env.PORT, DEFAULTS.port),
    webhookSecret: env.WEBHOOK_SECRET ?? "",
    slaMs: positiveNumber(env.SLA_SECONDS, DEFAULTS.slaMs / 1000) * 1000,
    dedupeWindowMs: positiveNumber(env.DEDUPE_WINDOW_MINUTES, DEFAULTS.dedupeWindowMs / 60_000) * 60_000,
    mockChannelLatencyMs: positiveNumber(env.MOCK_CHANNEL_LATENCY_MS, DEFAULTS.mockChannelLatencyMs),
  };
}
