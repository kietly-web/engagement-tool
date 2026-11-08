import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { SessionMode, SessionResponse } from "@et/worker/api-types";
import { api, ApiError } from "./api";
import { translator, type MessageKey } from "./i18n";

const t = translator("vi");
const REFRESH_MS = 2_000;

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

export function LivePanel({ workspaceId, youtubeConnected }: { workspaceId: string; youtubeConnected: boolean }) {
  const [data, setData] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.session(workspaceId).then(setData, () => undefined);
  }, [workspaceId]);

  useEffect(refresh, [refresh]);
  useEffect(() => {
    if (data?.session.status !== "live") return;
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [data?.session.status, refresh]);

  async function run(action: () => Promise<SessionResponse>, prefix: "live.error" | "poll.error") {
    setBusy(true);
    setError(null);
    try {
      setData(await action());
    } catch (e) {
      setError(errorText(prefix, e));
    } finally {
      setBusy(false);
    }
  }

  const start = (mode: SessionMode) => run(() => api.startSession(workspaceId, mode), "live.error");
  const session = data?.session;
  const live = session?.status === "live";

  return (
    <div className="card">
      <h2>
        {t("live.title")}{" "}
        {session && session.status !== "idle" && (
          <span className={`badge ${live ? "badge-live" : ""}`}>
            {t(live ? "live.live" : "live.stopped")} · {t(`live.mode.${session.mode ?? "demo"}`)}
          </span>
        )}
      </h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!live && session?.stopReason && <p className="muted">{t(`live.stopReason.${session.stopReason}`)}</p>}
      {!session || session.status === "idle" ? <p>{t("live.idle")}</p> : null}

      <p className="actions">
        {live ? (
          <button type="button" className="button danger" disabled={busy} onClick={() => run(() => api.stopSession(workspaceId), "live.error")}>
            {t("live.stop")}
          </button>
        ) : (
          <>
            <button type="button" className="button primary" disabled={busy || !youtubeConnected} onClick={() => start("youtube")}>
              {t("live.startYoutube")}
            </button>
            <button type="button" className="button" disabled={busy} onClick={() => start("demo")}>
              {t("live.startDemo")}
            </button>
          </>
        )}
      </p>

      {session && session.status !== "idle" && (
        <p className="muted">
          {t("live.messages")}: {session.messagesSeen}
          {data && ` · ${t("live.quota")}: ${data.quota.workspaceUsed}/${data.quota.workspaceLimit}`}
        </p>
      )}
      {data && !live && (
        <p className="muted">
          {t("live.demoLeft")}: {data.quota.demoStartsLeft}
        </p>
      )}
      {data?.quota.projectHeadroomLow && <p className="notice">{t("live.quotaLow")}</p>}

      {live && (
        <PollSection
          data={data!}
          busy={busy}
          onOpen={(poll) => run(() => api.openPoll(workspaceId, poll), "poll.error")}
          onClose={() => run(() => api.closePoll(workspaceId), "poll.error")}
        />
      )}
      {!live && session?.poll && <PollResults poll={session.poll} />}
    </div>
  );
}

function PollSection({
  data,
  busy,
  onOpen,
  onClose,
}: {
  data: SessionResponse;
  busy: boolean;
  onOpen: (poll: { question: string; options: string[]; voteChange: "first" | "latest" }) => void;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [allowChange, setAllowChange] = useState(false);
  const poll = data.session.poll;

  function submit(e: FormEvent) {
    e.preventDefault();
    onOpen({ question, options: options.map((o) => o.trim()).filter(Boolean), voteChange: allowChange ? "latest" : "first" });
  }

  if (poll?.status === "open") {
    return (
      <section>
        <h3>{t("poll.title")}</h3>
        <PollResults poll={poll} />
        <p className="actions">
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            {t("poll.close")}
          </button>
        </p>
      </section>
    );
  }

  return (
    <section>
      <h3>{t("poll.title")}</h3>
      {poll && <PollResults poll={poll} />}
      <form className="poll-form" onSubmit={submit}>
        <label>
          {t("poll.question")}
          <input value={question} maxLength={120} required onChange={(e) => setQuestion(e.target.value)} />
        </label>
        {options.map((value, i) => (
          <label key={i}>
            {t("poll.option")} {i + 1}
            <input
              value={value}
              maxLength={40}
              onChange={(e) => setOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))}
            />
          </label>
        ))}
        <label className="inline">
          <input type="checkbox" checked={allowChange} onChange={(e) => setAllowChange(e.target.checked)} /> {t("poll.allowChange")}
        </label>
        <p className="muted">{t("live.help")}</p>
        <button type="submit" className="button primary" disabled={busy}>
          {t("poll.open")}
        </button>
      </form>
    </section>
  );
}

function PollResults({ poll }: { poll: NonNullable<SessionResponse["session"]["poll"]> }) {
  const max = Math.max(1, ...poll.counts);
  return (
    <div>
      <p>
        <strong>{poll.question}</strong> {poll.status === "closed" && <span className="badge">{t("poll.closed")}</span>}
      </p>
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
    </div>
  );
}
