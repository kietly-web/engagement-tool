import { useCallback, useEffect, useState } from "react";
import type { MeResponse, SignInOutcome, WorkspaceResponse } from "@et/worker/api-types";
import { api, ApiError, signInUrl } from "./api";
import { LivePanel } from "./LivePanel";
import { OverlayLinks } from "./OverlayLinks";
import { SeasonPanel } from "./SeasonPanel";
import { translator, type MessageKey } from "./i18n";

const t = translator("vi");
const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const OUTCOMES: SignInOutcome[] = ["denied", "state", "google", "youtube_denied", "no_refresh_token", "no_channel", "youtube_error", "channel_in_use"];

type View = { kind: "loading" } | { kind: "signedOut" } | { kind: "notConfigured" } | { kind: "error" } | { kind: "signedIn"; me: MeResponse };

function readOutcome(): SignInOutcome | null {
  const value = new URLSearchParams(window.location.search).get("signin");
  return OUTCOMES.find((o) => o === value) ?? null;
}

export function App() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [outcome] = useState(readOutcome);

  const load = useCallback(() => {
    api
      .me()
      .then((me) => setView({ kind: "signedIn", me }))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) setView({ kind: "signedOut" });
        else if (e instanceof ApiError && e.status === 503) setView({ kind: "notConfigured" });
        else setView({ kind: "error" });
      });
  }, []);

  useEffect(() => {
    if (outcome) window.history.replaceState(null, "", "/");
    load();
  }, [load, outcome]);

  return (
    <main className="page">
      <h1>{t("app.title")}</h1>
      {outcome && (
        <p className="notice" role="status">
          {t(`signin.outcome.${outcome}` as MessageKey)}
        </p>
      )}
      {view.kind === "loading" && <p>{t("state.loading")}</p>}
      {view.kind === "notConfigured" && <p>{t("state.notConfigured")}</p>}
      {view.kind === "error" && <p className="error">{t("state.error")}</p>}
      {view.kind === "signedOut" && <SignedOut />}
      {view.kind === "signedIn" && <SignedIn me={view.me} onChange={load} />}
    </main>
  );
}

function SignedOut() {
  return (
    <section>
      <p>{t("app.tagline")}</p>
      <p className="actions">
        <a className="button primary" href={signInUrl("creator")}>
          {t("signin.creator")}
        </a>
        <a className="button" href={signInUrl("moderator")}>
          {t("signin.moderator")}
        </a>
      </p>
      <p className="muted">{t("signin.readonlyNote")}</p>
    </section>
  );
}

function SignedIn({ me, onChange }: { me: MeResponse; onChange: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const first = me.workspaces[0];

  async function logout() {
    await api.logout().catch(() => undefined);
    onChange();
  }

  async function deleteAccount() {
    if (!window.confirm(t("account.deleteConfirm"))) return;
    try {
      await api.deleteAccount();
      onChange();
    } catch {
      setMessage(t("account.deleteFailed"));
    }
  }

  return (
    <section>
      <p>
        {t("me.hello")}, <strong>{me.member.displayName}</strong> ({me.member.email})
      </p>
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
      {first ? (
        <Workspace id={first.id} onError={setMessage} />
      ) : (
        <>
          <p>{t("me.noWorkspace")}</p>
          <p className="actions">
            <a className="button primary" href={signInUrl("creator")}>
              {t("me.connect")}
            </a>
          </p>
        </>
      )}
      <p className="actions">
        <a className="button" href="/api/account/export">
          {t("account.export")}
        </a>
        <button type="button" className="button" onClick={logout}>
          {t("account.logout")}
        </button>
        <button type="button" className="button danger" onClick={deleteAccount}>
          {t("account.delete")}
        </button>
      </p>
    </section>
  );
}

function Workspace({ id, onError }: { id: string; onError: (message: string) => void }) {
  const [data, setData] = useState<WorkspaceResponse | null>(null);

  const load = useCallback(() => {
    api.workspace(id).then(setData, () => onError(t("state.error")));
  }, [id, onError]);

  useEffect(load, [load]);

  async function disconnect() {
    if (!window.confirm(t("ws.disconnectConfirm"))) return;
    try {
      await api.disconnect(id);
      load();
    } catch {
      onError(t("ws.disconnectFailed"));
    }
  }

  if (!data) return <p>{t("state.loading")}</p>;
  const isOwner = data.workspace.role === "owner";

  return (
    <>
    <LivePanel workspaceId={id} youtubeConnected={data.youtube !== null} />
    <SeasonPanel workspaceId={id} isOwner={isOwner} />
    <OverlayLinks workspaceId={id} isOwner={isOwner} />
    <div className="card">
      <h2>
        {data.workspace.name} <span className="badge">{t(`ws.role.${data.workspace.role}`)}</span>
      </h2>
      {data.youtube ? (
        <dl>
          <dt>{t("ws.channel")}</dt>
          <dd>{data.youtube.channelTitle}</dd>
          <dt>{t("ws.connectedAt")}</dt>
          <dd>{dateFormat.format(new Date(data.youtube.connectedAt))}</dd>
        </dl>
      ) : (
        <p>{t("ws.notConnected")}</p>
      )}
      <h3>{t("ws.members")}</h3>
      <ul>
        {data.members.map((m) => (
          <li key={m.memberId}>
            {m.displayName} · {t(`ws.role.${m.role}`)}
            {m.email && <span className="muted"> · {m.email}</span>}
          </li>
        ))}
      </ul>
      {isOwner && (
        <p className="actions">
          {data.youtube ? (
            <button type="button" className="button danger" onClick={disconnect}>
              {t("ws.disconnect")}
            </button>
          ) : (
            <a className="button primary" href={signInUrl("creator")}>
              {t("me.connect")}
            </a>
          )}
        </p>
      )}
    </div>
    </>
  );
}
