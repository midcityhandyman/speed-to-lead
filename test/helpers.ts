import { MockChannel, type MockChannelOptions } from "../src/channel";
import { DEFAULTS, type Config } from "../src/config";
import { LeadStore, Pipeline } from "../src/pipeline";
import type { Clock, Lead } from "../src/types";

/** A clock that only moves when told to. */
export class VirtualClock implements Clock {
  constructor(private t = 1_700_000_000_000) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

export function lead(overrides: Partial<Lead> = {}): Lead {
  return { name: "Alex Sample", service: "general", message: "", source: "unknown", ...overrides };
}

export function harness(options: { config?: Partial<Config>; latencyMs?: number; failFirst?: number } = {}) {
  const config: Config = { ...DEFAULTS, ...options.config };
  const clock = new VirtualClock();
  const channelOptions: MockChannelOptions = {
    clock,
    latencyMs: () => options.latencyMs ?? 2000,
    wait: async (ms) => clock.advance(ms),
    failFirst: options.failFirst,
  };
  const channel = new MockChannel(channelOptions);
  const store = new LeadStore();
  const pipeline = new Pipeline({ config, clock, channel, store });
  return { config, clock, channel, store, pipeline };
}
