import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { PollPresetView, SessionMode, SessionResponse } from "@et/worker/api-types";
import { api, ApiError } from "./api";
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

export function LivePanel({
  workspaceId,
  youtubeConnected,
  isOwner,
  onTally,
}: {
  workspaceId: string;
  youtubeConnected: boolean;
  isOwner: boolean;
  onTally: (state: TallyState) => void;
}) {
  const [data, setData] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.session(workspaceId).then(setData, () => undefined);
  }, [workspaceId]);

  useEffect(refresh, [refresh]);
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

  return (
    <div className="stack">
      <section className="card desk" aria-labelledby="desk-title">
        <h2 id="desk-title">{t("live.desk")}</h2>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!live && session?.stopReason && <p className="muted">{t(`live.stopReason.${session.stopReason}`)}</p>}
        {!live && <p className="muted">{t("live.deskIdle")}</p>}

        <p className="actions">
          {live ? (
            <button type="button" className="button danger big" disabled={busy} onClick={() => run(() => api.stopSession(workspaceId), "live.error")}>
              {t("live.stop")}
            </button>
          ) : (
            <>
              <button type="button" className="button primary big" disabled={busy || !youtubeConnected} onClick={() => start("youtube")}>
                {t("live.startYoutube")}
              </button>
              <button type="button" className="button big" disabled={busy || data?.quota.demoStartsLeft === 0} onClick={() => start("demo")}>
                {t("live.startDemo")}
              </button>
            </>
          )}
        </p>

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
