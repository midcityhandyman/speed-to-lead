import type { Config } from "./config";
import { Deduper } from "./dedupe";
import { Router } from "./route";
import { scoreLead } from "./score";
import type { Assignment, Channel, Clock, Lead, LeadRecord, OutboundMessage, StepName, Tier } from "./types";
import { validateLead } from "./validate";

export class LeadStore {
  private readonly records: LeadRecord[] = [];
  private counter = 0;

  nextId(): string {
    this.counter += 1;
    return `lead_${String(this.counter).padStart(4, "0")}`;
  }

  save(record: LeadRecord): LeadRecord {
    this.records.push(record);
    return record;
  }

  all(): readonly LeadRecord[] {
    return this.records;
  }
}

const PROMISE: Record<Tier, string> = {
  hot: "will call you within 15 minutes",
  warm: "will reach out within the hour",
  cold: "will follow up by the next business day",
};

export function firstResponse(leadId: string, lead: Lead, tier: Tier, assignment: Assignment): OutboundMessage {
  const firstName = lead.name.split(/\s+/)[0] ?? lead.name;
  const body =
    `Hi ${firstName}, thanks for your ${lead.service} request. We have it. ` +
    `${assignment.ownerName} ${PROMISE[tier]}. Reply here if anything changes.`;
  return lead.phone
    ? { leadId, via: "sms", to: lead.phone, body }
    : { leadId, via: "email", to: lead.email ?? "", body };
}

export interface PipelineDeps {
  config: Config;
  clock: Clock;
  channel: Channel;
  store: LeadStore;
}

/** validate -> dedupe -> score -> route -> respond, with a timing entry per step. */
export class Pipeline {
  private readonly deduper: Deduper;
  private readonly router: Router;

  constructor(private readonly deps: PipelineDeps) {
    this.deduper = new Deduper(deps.config.dedupeWindowMs);
    this.router = new Router(deps.config);
  }

  async handle(raw: unknown): Promise<LeadRecord> {
    const { config, clock, store } = this.deps;
    const record: LeadRecord = { id: store.nextId(), receivedAt: clock.now(), status: "rejected", timings: [] };

    const validation = await this.step(record, "validate", () => validateLead(raw));
    if (!validation.ok) {
      record.errors = validation.errors;
      return store.save(record);
    }
    const lead = (record.lead = validation.lead);

    record.duplicateOf = await this.step(record, "dedupe", () => this.deduper.check(lead, record.id, record.receivedAt));
    if (record.duplicateOf) {
      record.status = "duplicate";
      return store.save(record);
    }

    const score = (record.score = await this.step(record, "score", () => scoreLead(lead, config)));
    const assignment = (record.assignment = await this.step(record, "route", () => this.router.assign(lead, score.tier)));

    try {
      record.response = await this.step(record, "respond", () =>
        this.sendWithRetry(firstResponse(record.id, lead, score.tier, assignment)),
      );
      record.status = "responded";
      record.timeToFirstResponseMs = record.response.sentAt - record.receivedAt;
      record.withinSla = record.timeToFirstResponseMs <= config.slaMs;
    } catch (error) {
      record.status = "failed";
      record.errors = [error instanceof Error ? error.message : String(error)];
    }
    return store.save(record);
  }

  private async sendWithRetry(message: OutboundMessage) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.deps.config.maxSendAttempts; attempt += 1) {
      try {
        const receipt = await this.deps.channel.send(message);
        return { ...message, ...receipt, attempts: attempt };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private async step<T>(record: LeadRecord, step: StepName, run: () => T | Promise<T>): Promise<T> {
    const startedAt = this.deps.clock.now();
    try {
      return await run();
    } finally {
      record.timings.push({ step, startedAt, durationMs: this.deps.clock.now() - startedAt });
    }
  }
}
