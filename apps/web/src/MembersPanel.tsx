import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { WorkspaceResponse } from "@et/worker/api-types";
import { api, ApiError } from "./api";
import { translator, type MessageKey } from "./i18n";

const t = translator("vi");
const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const KNOWN_ACTIONS = new Set([
  "invite_created",
  "invite_revoked",
  "invite_accepted",
  "member_removed",
  "member_left",
  "overlay_rotated",
  "youtube_disconnected",
  "viewer_erased",
  "season_started",
  "season_ended",
]);

export function MembersPanel({ workspace, selfId, onLeft }: { workspace: WorkspaceResponse; selfId: string; onLeft: () => void }) {
  const isOwner = workspace.workspace.role === "owner";
  const wsId = workspace.workspace.id;
  const [members, setMembers] = useState(workspace.members);
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; email: string; expiresAt: string }[]>([]);
  const [events, setEvents] = useState<{ action: string; actorName: string | null; createdAt: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!isOwner) return;
    api.invites(wsId).then((r) => setPending(r.invites), () => undefined);
    api.audit(wsId).then((r) => setEvents(r.events), () => undefined);
  }, [isOwner, wsId]);
  useEffect(load, [load]);
  useEffect(() => setMembers(workspace.members), [workspace.members]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setLink((await api.invite(wsId, email)).url);
      setEmail("");
      load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      setError(code === "invalid_email" || code === "too_many_invites" ? t(`members.error.${code}` as MessageKey) : t("state.error"));
    }
  }

  async function remove(memberId: string) {
    const leaving = memberId === selfId;
    if (!window.confirm(t(leaving ? "members.leaveConfirm" : "members.removeConfirm"))) return;
    try {
      await api.removeMember(wsId, memberId);
      if (leaving) return onLeft();
      setMembers((list) => list.filter((m) => m.memberId !== memberId));
      load();
    } catch {
      setError(t("state.error"));
    }
  }

  async function revoke(inviteId: string) {
    await api.revokeInvite(wsId, inviteId).catch(() => setError(t("state.error")));
    load();
  }

  return (
    <div className="card">
      <h2>{t("members.title")}</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul>
        {members.map((m) => (
          <li key={m.memberId}>
            {m.displayName} · {t(`ws.role.${m.role}`)}
            {m.email && <span className="muted"> · {m.email}</span>}{" "}
            {m.role === "moderator" && (isOwner || m.memberId === selfId) && (
              <button type="button" className="button danger small" onClick={() => remove(m.memberId)}>
                {m.memberId === selfId ? t("members.leave") : t("members.remove")}
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <>
          <form className="poll-form" onSubmit={invite}>
            <label>
              {t("members.inviteEmail")}
              <input type="email" value={email} maxLength={320} required onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button type="submit" className="button primary">
              {t("members.invite")}
            </button>
          </form>
          {link && (
            <div className="notice" role="status">
              <p>{t("members.inviteNote")}</p>
              <input className="link-box" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={t("members.invite")} />
            </div>
          )}
          {pending.length > 0 && (
            <>
              <h3>{t("members.pending")}</h3>
              <ul>
                {pending.map((p) => (
                  <li key={p.id}>
                    {p.email} · {t("members.expires")} {dateFormat.format(new Date(p.expiresAt))}{" "}
                    <button type="button" className="button small" onClick={() => revoke(p.id)}>
                      {t("members.revoke")}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>{t("audit.title")}</h3>
          {events.length === 0 ? (
            <p className="muted">{t("audit.empty")}</p>
          ) : (
            <ul className="audit">
              {events.slice(0, 30).map((e, i) => (
                <li key={i}>
                  <span className="muted">{dateFormat.format(new Date(e.createdAt))}</span> ·{" "}
                  {KNOWN_ACTIONS.has(e.action) ? t(`audit.action.${e.action}` as MessageKey) : e.action} · {e.actorName ?? t("audit.unknownActor")}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
