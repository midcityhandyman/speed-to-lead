import type { Lead } from "./types";

/**
 * Remembers contact keys (phone, email) and reports a lead as a duplicate when
 * any of its keys was first seen inside the window. The window is measured from
 * the original lead, so repeats do not extend it.
 */
export class Deduper {
  private readonly seen = new Map<string, { id: string; at: number }>();

  constructor(private readonly windowMs: number) {}

  static keys(lead: Lead): string[] {
    const keys: string[] = [];
    if (lead.phone) keys.push(`phone:${lead.phone}`);
    if (lead.email) keys.push(`email:${lead.email}`);
    return keys;
  }

  /** Returns the id of the original lead, or undefined after registering this one. */
  check(lead: Lead, id: string, now: number): string | undefined {
    const keys = Deduper.keys(lead);
    const live = (key: string) => {
      const hit = this.seen.get(key);
      return hit && now - hit.at <= this.windowMs ? hit : undefined;
    };
    const original = keys.map(live).find((hit) => hit !== undefined);
    if (original) {
      // A repeat that adds a new phone or email ties that contact to the original too.
      for (const key of keys) if (!live(key)) this.seen.set(key, original);
      return original.id;
    }
    for (const key of keys) this.seen.set(key, { id, at: now });
    return undefined;
  }

  /** Drops every key registered for a lead. Used when its first response never went out. */
  forget(id: string): void {
    for (const [key, hit] of this.seen) if (hit.id === id) this.seen.delete(key);
  }
}
