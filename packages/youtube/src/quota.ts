const PACIFIC_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });

// YouTube's daily quota resets at midnight Pacific time.
export function quotaDay(now: Date): string {
  return PACIFIC_DAY.format(now);
}

export interface QuotaLimits {
  projectDaily: number;
  workspaceDaily: number;
}

export interface QuotaSnapshot {
  day: string;
  total: number;
  byWorkspace: Record<string, number>;
}

export type QuotaDecision = { ok: true } | { ok: false; reason: "project_limit" | "workspace_limit" | "invalid" };

export interface QuotaUsage {
  day: string;
  workspaceUsed: number;
  workspaceLimit: number;
  projectUsed: number;
  projectLimit: number;
}

export class QuotaBudget {
  private state: QuotaSnapshot;

  constructor(
    private readonly limits: QuotaLimits,
    snapshot?: QuotaSnapshot,
  ) {
    this.state = snapshot ?? { day: "", total: 0, byWorkspace: {} };
  }

  private roll(now: Date): void {
    const day = quotaDay(now);
    if (this.state.day !== day) this.state = { day, total: 0, byWorkspace: {} };
  }

  reserve(workspaceId: string, units: number, now: Date): QuotaDecision {
    if (!Number.isInteger(units) || units <= 0 || !workspaceId) return { ok: false, reason: "invalid" };
    this.roll(now);
    const used = this.state.byWorkspace[workspaceId] ?? 0;
    if (this.state.total + units > this.limits.projectDaily) return { ok: false, reason: "project_limit" };
    if (used + units > this.limits.workspaceDaily) return { ok: false, reason: "workspace_limit" };
    this.state.total += units;
    this.state.byWorkspace[workspaceId] = used + units;
    return { ok: true };
  }

  usage(workspaceId: string, now: Date): QuotaUsage {
    this.roll(now);
    return {
      day: this.state.day,
      workspaceUsed: this.state.byWorkspace[workspaceId] ?? 0,
      workspaceLimit: this.limits.workspaceDaily,
      projectUsed: this.state.total,
      projectLimit: this.limits.projectDaily,
    };
  }

  snapshot(): QuotaSnapshot {
    return { day: this.state.day, total: this.state.total, byWorkspace: { ...this.state.byWorkspace } };
  }
}
