import type { PollInput } from "@et/core";
import { QuotaBudget, type QuotaSnapshot } from "@et/youtube";
import { DurableObject } from "cloudflare:workers";
import { defaultDeps, type AppEnv } from "../env";
import { SessionEngine, type StartInput, type StopReason } from "./engine";
import { googleCredentials, quotaClient } from "./clients";
import { quotaLimits } from "./limits";
import { LiveSourceProvider } from "./sources";

const systemClock = { now: () => new Date() };

export class LiveSession extends DurableObject<AppEnv> {
  private readonly engine: SessionEngine;

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    const provider = new LiveSourceProvider({
      fetch: defaultDeps.fetch,
      clock: systemClock,
      quota: quotaClient(env),
      credentials: () => googleCredentials(env),
    });
    const storage = {
      get: <T>(key: string) => ctx.storage.get<T>(key),
      put: (key: string, value: unknown) => ctx.storage.put(key, value),
      delete: (key: string) => ctx.storage.delete(key),
      setAlarm: (time: number) => ctx.storage.setAlarm(time),
      deleteAlarm: () => ctx.storage.deleteAlarm(),
      deleteAll: () => ctx.storage.deleteAll(),
    };
    this.engine = new SessionEngine(storage, provider, systemClock, { disabled: () => String(env.SESSIONS_DISABLED) === "true" });
  }

  start(input: StartInput) {
    return this.engine.start(input);
  }
  stop(reason?: StopReason) {
    return this.engine.stop(reason);
  }
  status() {
    return this.engine.status();
  }
  createPoll(input: PollInput) {
    return this.engine.createPoll(input);
  }
  closePoll() {
    return this.engine.closePoll();
  }
  purge() {
    return this.engine.purge();
  }
  override async alarm() {
    await this.engine.tick();
  }
}

export class QuotaKeeper extends DurableObject<AppEnv> {
  private budget: QuotaBudget | null = null;

  private async load(): Promise<QuotaBudget> {
    this.budget ??= new QuotaBudget(quotaLimits(this.env), await this.ctx.storage.get<QuotaSnapshot>("quota"));
    return this.budget;
  }

  async reserve(workspaceId: string, units: number) {
    const budget = await this.load();
    const decision = budget.reserve(workspaceId, units, new Date());
    if (decision.ok) await this.ctx.storage.put("quota", budget.snapshot());
    return decision;
  }

  async reserveDemo(workspaceId: string) {
    const budget = await this.load();
    const ok = budget.reserveDemo(workspaceId, new Date());
    if (ok) await this.ctx.storage.put("quota", budget.snapshot());
    return ok;
  }

  async usage(workspaceId: string) {
    return (await this.load()).usage(workspaceId, new Date());
  }
}
