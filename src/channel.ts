import type { Channel, Clock, OutboundMessage, SendReceipt } from "./types";

export const systemClock: Clock = {
  now: () => performance.timeOrigin + performance.now(),
};

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface MockChannelOptions {
  clock: Clock;
  /** Latency of one send attempt in milliseconds. */
  latencyMs?: () => number;
  /** How to wait. Tests and the demo pass a function that advances a virtual clock. */
  wait?: (ms: number) => Promise<void>;
  /** Fail this many sends before succeeding. Used to exercise the retry path. */
  failFirst?: number;
}

/** Stands in for an SMS or email provider. Nothing leaves the process. */
export class MockChannel implements Channel {
  readonly sent: Array<OutboundMessage & SendReceipt> = [];
  private failuresLeft: number;
  private counter = 0;

  constructor(private readonly options: MockChannelOptions) {
    this.failuresLeft = options.failFirst ?? 0;
  }

  async send(message: OutboundMessage): Promise<SendReceipt> {
    await (this.options.wait ?? sleep)(this.options.latencyMs?.() ?? 0);
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error("mock channel: simulated delivery failure");
    }
    this.counter += 1;
    const receipt = { messageId: `mock_${String(this.counter).padStart(4, "0")}`, sentAt: this.options.clock.now() };
    this.sent.push({ ...message, ...receipt });
    return receipt;
  }
}
