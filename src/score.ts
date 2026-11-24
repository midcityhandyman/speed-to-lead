import type { Config } from "./config";
import type { Lead, ScoreResult, Tier } from "./types";

type ScoreConfig = Pick<Config, "serviceAreaPrefixes" | "highValueServices" | "urgencyKeywords">;

export interface Rule {
  id: string;
  points: number;
  description: string;
  applies(lead: Lead, config: ScoreConfig): boolean;
}

export function inServiceArea(lead: Lead, config: Pick<Config, "serviceAreaPrefixes">): boolean {
  const code = lead.postalCode;
  return code !== undefined && config.serviceAreaPrefixes.some((prefix) => code.startsWith(prefix));
}

/**
 * The whole scoring model. Each rule is a plain predicate with fixed points, so
 * a score can always be explained by listing the rules that fired.
 */
export const RULES: Rule[] = [
  { id: "has_phone", points: 15, description: "Phone number provided", applies: (l) => !!l.phone },
  { id: "has_email", points: 5, description: "Email provided", applies: (l) => !!l.email },
  {
    id: "urgent_language",
    points: 25,
    description: "Message uses urgent wording",
    applies: (l, c) => c.urgencyKeywords.some((k) => l.message.toLowerCase().includes(k)),
  },
  {
    id: "high_value_service",
    points: 20,
    description: "Service is on the high value list",
    applies: (l, c) => c.highValueServices.includes(l.service),
  },
  { id: "in_service_area", points: 15, description: "Postal code is inside the service area", applies: inServiceArea },
  { id: "referral_source", points: 15, description: "Came from a referral", applies: (l) => l.source === "referral" },
  { id: "budget_5k_plus", points: 15, description: "Stated budget of 5000 or more", applies: (l) => (l.budget ?? 0) >= 5000 },
  { id: "detailed_message", points: 5, description: "Message has 40 or more characters", applies: (l) => l.message.length >= 40 },
  {
    id: "no_message",
    points: -10,
    description: "No message at all",
    applies: (l) => l.message.length === 0,
  },
];

export const TIER_THRESHOLDS = { hot: 60, warm: 30 } as const;

export function tierFor(score: number): Tier {
  if (score >= TIER_THRESHOLDS.hot) return "hot";
  if (score >= TIER_THRESHOLDS.warm) return "warm";
  return "cold";
}

export function scoreLead(lead: Lead, config: ScoreConfig, rules: Rule[] = RULES): ScoreResult {
  const fired = rules
    .filter((rule) => rule.applies(lead, config))
    .map(({ id, points, description }) => ({ id, points, description }));
  const score = Math.max(0, fired.reduce((sum, rule) => sum + rule.points, 0));
  return { score, tier: tierFor(score), fired };
}
