import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type LeaderboardRow, type SeasonView } from "./api";
import { translator, type MessageKey } from "./i18n";

const t = translator("vi");
const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const SEASON_ERRORS = new Set(["season_running", "season_length", "season_name"]);

export function SeasonPanel({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  const [active, setActive] = useState<SeasonView | null>(null);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [name, setName] = useState("");
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.seasons(workspaceId).then((r) => setActive(r.active), () => setError(t("state.error")));
    api.leaderboard(workspaceId).then((r) => setBoard(r.entries), () => undefined);
  }, [workspaceId]);

  useEffect(load, [load]);

  async function start(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.startSeason(workspaceId, name, days);
      setName("");
      load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      setError(code && SEASON_ERRORS.has(code) ? t(`season.error.${code}` as MessageKey) : t("state.error"));
    }
  }

  async function end() {
    if (!window.confirm(t("season.endConfirm"))) return;
    await api.endSeason(workspaceId).catch(() => setError(t("state.error")));
    load();
  }

  async function erase(channelId: string) {
    if (!window.confirm(t("board.eraseConfirm"))) return;
    await api.eraseViewer(workspaceId, channelId).catch(() => setError(t("state.error")));
    load();
  }

  return (
    <div className="card">
      <h2>{t("season.title")}</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {active ? (
        <p>
          <strong>{active.name}</strong> <span className="badge badge-live">{t("season.active")}</span> · {t("season.endsAt")}{" "}
          {dateFormat.format(new Date(active.endsAt))}
        </p>
      ) : (
        <p>{t("season.none")}</p>
      )}
      <p className="muted">{t("season.rules")}</p>
      {isOwner &&
        (active ? (
          <p className="actions">
            <button type="button" className="button danger" onClick={end}>
              {t("season.end")}
            </button>
          </p>
        ) : (
          <form className="poll-form" onSubmit={start}>
            <label>
              {t("season.name")}
              <input value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              {t("season.days")}
              <input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} />
            </label>
            <button type="submit" className="button primary">
              {t("season.start")}
            </button>
          </form>
        ))}

      <h3>{t("board.title")}</h3>
      {board.length === 0 ? (
        <p className="muted">{t("board.empty")}</p>
      ) : (
        <table className="board">
          <thead>
            <tr>
              <th>{t("board.rank")}</th>
              <th>{t("board.points")}</th>
              <th>{t("board.joins")}</th>
              <th>{t("board.votes")}</th>
              {isOwner && <th>{t("board.channel")}</th>}
              {isOwner && <th />}
            </tr>
          </thead>
          <tbody>
            {board.map((row) => (
              <tr key={row.rank}>
                <td>#{row.rank}</td>
                <td>{row.points}</td>
                <td>{row.joins}</td>
                <td>{row.votes}</td>
                {isOwner && <td className="mono">{row.channelId}</td>}
                {isOwner && (
                  <td>
                    {row.channelId && (
                      <button type="button" className="button danger small" onClick={() => erase(row.channelId!)}>
                        {t("board.erase")}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
