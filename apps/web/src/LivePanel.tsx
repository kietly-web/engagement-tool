import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { PollPresetView, SessionMode, SessionResponse, StopReason } from "@et/worker/api-types";
import { api, ApiError, signInUrl, type SeasonView } from "./api";
import { translator, type MessageKey } from "./i18n";

const t = translator("vi");
// Each refresh costs a Worker request and a Durable Object call; the free plan allows 100,000 of each a day.
const REFRESH_MS = 5_000;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MAX_PRESETS = 12;

export type TallyState = "idle" | "live" | "demo";

function errorText(prefix: "live.error" | "poll.error", e: unknown): string {
  const code = e instanceof ApiError ? e.code : null;
  const key = `${prefix}.${code}` as MessageKey;
  return code && key in KNOWN ? t(key) : t("state.error");
}
const KNOWN: Record<string, true> = Object.fromEntries(
  [
    "live.error.not_connected",
    "live.error.not_live",
    "live.error.reconnect_required",
    "live.error.quota_exhausted",
    "live.error.youtube_unavailable",
    "live.error.already_live",
    "live.error.disabled",
    "live.error.demo_limit",
    "poll.error.invalid_poll",
    "poll.error.poll_open",
    "poll.error.not_live",
  ].map((k) => [k, true]),
);

interface Draft {
  question: string;
  options: string[];
  allowChange: boolean;
}

const EMPTY: Draft = { question: "", options: ["", ""], allowChange: false };

function toPreset(draft: Draft): PollPresetView | null {
  const question = draft.question.trim();
  const options = [...new Set(draft.options.map((o) => o.trim()).filter(Boolean))];
  return question && options.length >= MIN_OPTIONS ? { question, options, voteChange: draft.allowChange ? "latest" : "first" } : null;
}

// A default the creator never has to type: "Mùa 11/2026", the longest season the rules allow.
const SEASON_DAYS = 29;
const monthName = () => {
  const parts = new Intl.DateTimeFormat("vi-VN", { month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const [month, year] = [part("month"), part("year")];
  return t("home.seasonDefaultName").replace("{month}", `${month}/${year}`);
};

export function LivePanel({
  workspaceId,
  youtubeConnected,
  isOwner,
  onTally,
  onStopped,
  onSeasonStarted,
}: {
  workspaceId: string;
  youtubeConnected: boolean;
  isOwner: boolean;
  onTally: (state: TallyState) => void;
  onStopped: (reason: StopReason) => void;
  onSeasonStarted: () => void;
}) {
  const [data, setData] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [season, setSeason] = useState<SeasonView | null | undefined>(undefined);
  const [commands, setCommands] = useState<number | null>(null);

  const refresh = useCallback(() => {
    api.session(workspaceId).then(setData, () => undefined);
  }, [workspaceId]);

  useEffect(refresh, [refresh]);
  useEffect(() => {
    api.seasons(workspaceId).then((r) => setSeason(r.active), () => setSeason(null));
    api.alertsConfig(workspaceId).then((r) => setCommands(r.alerts.commands.length), () => undefined);
  }, [workspaceId]);
  // While idle there is no timer, so the checklist catches up when the creator comes back from OBS instead.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);
  useEffect(() => {
    if (data?.session.status !== "live") return;
    const tick = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [data?.session.status, refresh]);

  const session = data?.session;
  const live = session?.status === "live";
  useEffect(() => onTally(!live ? "idle" : session?.mode === "youtube" ? "live" : "demo"), [live, session?.mode, onTally]);
  const [wasLive, setWasLive] = useState(false);
  useEffect(() => {
    if (live) setWasLive(true);
    else if (wasLive) {
      setWasLive(false);
      if (session?.stopReason && session.stopReason !== "manual" && session.stopReason !== "demo_finished") onStopped(session.stopReason);
    }
  }, [live, wasLive, session?.stopReason, onStopped]);

  async function run(action: () => Promise<SessionResponse>, prefix: "live.error" | "poll.error"): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      setData(await action());
      return true;
    } catch (e) {
      setError(errorText(prefix, e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const start = (mode: SessionMode) => run(() => api.startSession(workspaceId, mode), "live.error");
  const poll = session?.poll;
  const obsConnected = (session?.overlayConnections ?? 0) > 0;

  async function openSeason() {
    setBusy(true);
    setError(null);
    try {
      setSeason(await api.startSeason(workspaceId, monthName(), SEASON_DAYS));
      onSeasonStarted();
    } catch {
      setError(t("state.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="card desk" aria-labelledby="desk-title">
        <h2 id="desk-title" className="visually-hidden">
          {t("live.desk")}
        </h2>
        <div className="launch">
          <div className="launch-power">
            {live ? (
              <button type="button" className="power is-live" disabled={busy} onClick={() => run(() => api.stopSession(workspaceId), "live.error")}>
                <span className="power-label">{t("home.stop")}</span>
                <span className="power-sub">{t(session?.mode === "youtube" ? "tally.live" : "tally.demo")}</span>
              </button>
            ) : (
              <button type="button" className="power" disabled={busy || !youtubeConnected} onClick={() => start("youtube")}>
                <span className="power-label">{t("home.start")}</span>
                <span className="power-sub">{t("home.startSub")}</span>
              </button>
            )}
            {!live && (
              <button type="button" className="button" disabled={busy || data?.quota.demoStartsLeft === 0} onClick={() => start("demo")}>
                {t("live.startDemo")}
              </button>
            )}
            <ul className="stats">
              {session && session.status !== "idle" && (
                <li>
                  <strong>{session.messagesSeen}</strong>
                  {t("live.messages")}
                </li>
              )}
              {data && live && session?.mode === "youtube" && (
                <li>
                  <strong>
                    {data.quota.workspaceUsed}/{data.quota.workspaceLimit}
                  </strong>
                  {t("live.quota")}
                </li>
              )}
              {data && !live && (
                <li>
                  <strong>{data.quota.demoStartsLeft}</strong>
                  {t("live.demoLeft")}
                </li>
              )}
            </ul>
          </div>

          <div className="launch-ready">
            <h3>{t("home.ready")}</h3>
            <ul className="ready-list">
              <ReadyRow done={youtubeConnected} label={t("home.youtube")} status={youtubeConnected ? t("home.youtubeOk") : t("home.youtubeMissing")}>
                {!youtubeConnected && isOwner && (
                  <a className="button small primary" href={signInUrl("creator")}>
                    {t("me.connect")}
                  </a>
                )}
              </ReadyRow>
              <ReadyRow done={obsConnected} label={t("home.obs")} status={obsConnected ? t("home.youtubeOk") : t("home.obsMissing")}>
                {!obsConnected && (
                  <a className="button small" href="#overlay">
                    {t("home.obsAction")}
                  </a>
                )}
              </ReadyRow>
              <ReadyRow
                done={!!season}
                label={t("season.title")}
                status={season ? `${season.name} · ${t("home.seasonUntil")} ${dayFormat.format(new Date(season.endsAt))}` : t("home.seasonMissing")}
              >
                {season === null && isOwner && (
                  <button type="button" className="button small" disabled={busy} onClick={openSeason}>
                    {t("home.seasonAction")}
                  </button>
                )}
              </ReadyRow>
              <ReadyRow done={(commands ?? 0) > 0} label={t("home.alerts")} status={commands ? t("home.alertsCount").replace("{n}", String(commands)) : t("home.alertsMissing")}>
                {commands === 0 && (
                  <a className="button small" href="#alerts">
                    {t("home.alertsAction")}
                  </a>
                )}
              </ReadyRow>
            </ul>
          </div>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!live && session?.stopReason && <p className="muted">{t(`live.stopReason.${session.stopReason}`)}</p>}
        {data?.quota.projectHeadroomLow && <p className="notice">{t("live.quotaLow")}</p>}

        {poll && (
          <div className="section">
            <h3>
              {poll.question} {poll.status === "closed" && <span className="badge">{t("poll.closed")}</span>}
            </h3>
            <PollResults poll={poll} />
            {live && poll.status === "open" && (
              <p className="actions">
                <button type="button" className="button" disabled={busy} onClick={() => run(() => api.closePoll(workspaceId), "poll.error")}>
                  {t("poll.close")}
                </button>
              </p>
            )}
          </div>
        )}
      </section>

      <PollComposer
        workspaceId={workspaceId}
        isOwner={isOwner}
        live={live}
        canOpen={live && poll?.status !== "open"}
        busy={busy}
        onOpen={(preset) => run(() => api.openPoll(workspaceId, preset), "poll.error")}
      />
    </div>
  );
}

const dayFormat = new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "numeric", timeZone: "Asia/Ho_Chi_Minh" });

function ReadyRow({ done, label, status, children }: { done: boolean; label: string; status: string; children?: ReactNode }) {
  return (
    <li className={done ? "ready done" : "ready"}>
      <span className="ready-dot" aria-hidden="true" />
      <span className="ready-text">
        <strong>{label}</strong>
        <span className="muted">{status}</span>
      </span>
      {children}
    </li>
  );
}

function PollComposer({
  workspaceId,
  isOwner,
  live,
  canOpen,
  busy,
  onOpen,
}: {
  workspaceId: string;
  isOwner: boolean;
  live: boolean;
  canOpen: boolean;
  busy: boolean;
  onOpen: (poll: PollPresetView) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [presets, setPresets] = useState<PollPresetView[]>([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    api.pollPresets(workspaceId).then((r) => setPresets(r.polls ?? []), () => undefined);
  }, [workspaceId]);

  const valid = toPreset(draft);

  async function savePresets(next: PollPresetView[], message: string | null) {
    try {
      setPresets((await api.savePollPresets(workspaceId, next)).polls);
      setNote(message);
    } catch (e) {
      setNote(e instanceof ApiError && e.code === "config_too_large" ? t("poll.presetsTooBig") : t("state.error"));
    }
  }

  function remove(i: number) {
    if (window.confirm(t("poll.deleteConfirm"))) void savePresets(presets.filter((_, j) => j !== i), null);
  }

  async function open(e: FormEvent) {
    e.preventDefault();
    if (valid && (await onOpen(valid))) setDraft(EMPTY);
  }

  function saveDraft() {
    if (!valid) return setNote(t("poll.presetInvalid"));
    if (presets.length >= MAX_PRESETS) return setNote(t("poll.presetsFull"));
    void savePresets([...presets, valid], t("poll.presetSaved"));
  }

  const setOption = (i: number, value: string) => setDraft((d) => ({ ...d, options: d.options.map((o, j) => (j === i ? value : o)) }));

  return (
    <section className="card" aria-labelledby="composer-title">
      <h2 id="composer-title">{t("poll.composer")}</h2>
      <p className="muted">{t("live.help")}</p>
      <form className="poll-form" onSubmit={open}>
        <label>
          {t("poll.question")}
          <input value={draft.question} maxLength={120} onChange={(e) => setDraft({ ...draft, question: e.target.value })} />
        </label>
        {draft.options.map((value, i) => (
          <div key={i} className="option-row">
            <span aria-hidden="true">{i + 1}</span>
            <input value={value} maxLength={40} aria-label={`${t("poll.option")} ${i + 1}`} onChange={(e) => setOption(i, e.target.value)} />
            {draft.options.length > MIN_OPTIONS ? (
              <button
                type="button"
                className="button small"
                aria-label={t("poll.removeOption")}
                onClick={() => setDraft({ ...draft, options: draft.options.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {draft.options.length < MAX_OPTIONS && (
          <p className="actions">
            <button type="button" className="button small" onClick={() => setDraft({ ...draft, options: [...draft.options, ""] })}>
              + {t("poll.addOption")}
            </button>
          </p>
        )}
        <label className="inline">
          <input type="checkbox" checked={draft.allowChange} onChange={(e) => setDraft({ ...draft, allowChange: e.target.checked })} /> {t("poll.allowChange")}
        </label>
        {!canOpen && <p className="muted">{t(live ? "poll.error.poll_open" : "poll.needLive")}</p>}
        <p className="actions">
          <button type="submit" className="button primary" disabled={busy || !canOpen || !valid}>
            {t("poll.open")}
          </button>
          {isOwner && (
            <button type="button" className="button" onClick={saveDraft}>
              {t("poll.savePreset")}
            </button>
          )}
        </p>
        {note && (
          <p className="notice" role="status">
            {note}
          </p>
        )}
      </form>

      <div className="section">
        <h3>{t("poll.presets")}</h3>
        <p className="muted">{t("poll.presetsHelp")}</p>
        {presets.length === 0 ? (
          <p className="muted">{t("poll.presetsEmpty")}</p>
        ) : (
          <ul className="item-list">
            {presets.map((p, i) => (
              <li key={`${i}-${p.question}`} className="item">
                <div>
                  <strong>{p.question}</strong>
                  <span className="muted">{p.options.join(" / ")}</span>
                </div>
                <p className="actions">
                  <button type="button" className="button primary small" disabled={busy || !canOpen} onClick={() => void onOpen(p)}>
                    {t("poll.useNow")}
                  </button>
                  <button
                    type="button"
                    className="button small"
                    onClick={() => setDraft({ question: p.question, options: [...p.options], allowChange: p.voteChange === "latest" })}
                  >
                    {t("poll.loadPreset")}
                  </button>
                  {isOwner && (
                    <button type="button" className="button danger small" onClick={() => remove(i)}>
                      {t("poll.deletePreset")}
                    </button>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PollResults({ poll }: { poll: NonNullable<SessionResponse["session"]["poll"]> }) {
  const max = Math.max(1, ...poll.counts);
  return (
    <>
      <ol className="poll-bars">
        {poll.options.map((option, i) => (
          <li key={i}>
            <span className="poll-label">
              {i + 1}. {option}
            </span>
            <span className="poll-bar" style={{ width: `${(100 * (poll.counts[i] ?? 0)) / max}%` }} />
            <span className="poll-count">{poll.counts[i] ?? 0}</span>
          </li>
        ))}
      </ol>
      <p className="muted">
        {t("poll.total")}: {poll.total}
      </p>
    </>
  );
}
