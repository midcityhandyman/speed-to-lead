import type { Config } from "./config";
import { inServiceArea } from "./score";
import type { Assignment, Lead, Owner, Tier } from "./types";

type RouteConfig = Pick<Config, "owners" | "nurtureQueue" | "serviceAreaPrefixes">;

/**
 * Picks an owner with ordered rules:
 *   1. A postal code outside the service area goes to the nurture queue.
 *   2. Owners who list the service and take the tier, least loaded first.
 *   3. Generalists ("*") who take the tier, least loaded first.
 *   4. The least loaded owner overall.
 * Load is the number of leads assigned by this router since it started.
 */
export class Router {
  private readonly load = new Map<string, number>();

  constructor(private readonly config: RouteConfig) {}

  assign(lead: Lead, tier: Tier): Assignment {
    const { owners, nurtureQueue } = this.config;
    if (lead.postalCode && !inServiceArea(lead, this.config)) {
      return this.take(nurtureQueue, `postal code ${lead.postalCode} is outside the service area`);
    }
    const takesTier = owners.filter((o) => o.tiers.includes(tier));
    const specialists = takesTier.filter((o) => o.services.includes(lead.service));
    if (specialists.length > 0) {
      return this.take(this.leastLoaded(specialists), `handles ${lead.service} and takes ${tier} leads`);
    }
    const generalists = takesTier.filter((o) => o.services.includes("*"));
    if (generalists.length > 0) {
      return this.take(this.leastLoaded(generalists), `generalist who takes ${tier} leads`);
    }
    if (owners.length === 0) return this.take(nurtureQueue, "no owners configured");
    return this.take(this.leastLoaded(owners), "fallback: least loaded owner");
  }

  private leastLoaded(candidates: Owner[]): Owner {
    // Stable: ties go to the owner listed first.
    return candidates.reduce((best, o) => (this.count(o) < this.count(best) ? o : best));
  }

  private count(owner: Owner): number {
    return this.load.get(owner.id) ?? 0;
  }

  private take(owner: Owner, reason: string): Assignment {
    this.load.set(owner.id, this.count(owner) + 1);
    return { ownerId: owner.id, ownerName: owner.name, reason };
  }
}
