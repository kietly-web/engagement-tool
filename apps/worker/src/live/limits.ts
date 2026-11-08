import type { QuotaLimits } from "@et/youtube";

// Headroom under YouTube's default 10,000 units/day for sign-ins and broadcast lookups.
const DEFAULT_PROJECT_DAILY = 9_000;
const DEFAULT_WORKSPACE_DAILY = 3_000;

export function quotaLimits(env: { QUOTA_PROJECT_DAILY?: string; QUOTA_WORKSPACE_DAILY?: string }): QuotaLimits {
  const read = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return {
    projectDaily: read(env.QUOTA_PROJECT_DAILY, DEFAULT_PROJECT_DAILY),
    workspaceDaily: read(env.QUOTA_WORKSPACE_DAILY, DEFAULT_WORKSPACE_DAILY),
  };
}
