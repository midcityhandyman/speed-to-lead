export type Tier = "hot" | "warm" | "cold";
export type StepName = "validate" | "dedupe" | "score" | "route" | "respond";
export type LeadStatus = "responded" | "duplicate" | "rejected" | "failed";

/** A lead after validation: trimmed, lower-cased where it matters, phone as 10 digits. */
export interface Lead {
  name: string;
  phone?: string;
  email?: string;
  service: string;
  message: string;
  source: string;
  postalCode?: string;
  budget?: number;
}

export interface FiredRule {
  id: string;
  points: number;
  description: string;
}

export interface ScoreResult {
  score: number;
  tier: Tier;
  fired: FiredRule[];
}

export interface Owner {
  id: string;
  name: string;
  /** Services this owner takes. "*" means any service. */
  services: string[];
  tiers: Tier[];
}

export interface Assignment {
  ownerId: string;
  ownerName: string;
  reason: string;
  /** True when the lead went to the nurture queue instead of a named owner. */
  queued?: boolean;
}

export interface OutboundMessage {
  leadId: string;
  via: "sms" | "email";
  to: string;
  body: string;
}

export interface SendReceipt {
  messageId: string;
  sentAt: number;
}

export interface Channel {
  send(message: OutboundMessage): Promise<SendReceipt>;
}

export interface StepTiming {
  step: StepName;
  startedAt: number;
  durationMs: number;
}

export interface LeadRecord {
  id: string;
  receivedAt: number;
  status: LeadStatus;
  lead?: Lead;
  errors?: string[];
  duplicateOf?: string;
  score?: ScoreResult;
  assignment?: Assignment;
  response?: OutboundMessage & SendReceipt & { attempts: number };
  timings: StepTiming[];
  /** Receipt of the webhook to confirmed send of the first response. */
  timeToFirstResponseMs?: number;
  withinSla?: boolean;
}

export interface Clock {
  /** Milliseconds since the Unix epoch. May be fractional. */
  now(): number;
}
