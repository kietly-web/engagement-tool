import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { MeResponse, SignInOutcome, WorkspaceResponse } from "@et/worker/api-types";
import { api, ApiError, signInUrl } from "./api";
import { AlertsPanel } from "./AlertsPanel";
import { LivePanel, type TallyState } from "./LivePanel";
import { MembersPanel } from "./MembersPanel";
import { ObsSetup } from "./ObsSetup";
import { OverlayLinks } from "./OverlayLinks";
import { SeasonPanel } from "./SeasonPanel";
import { StylePanel } from "./StylePanel";
import { Icon } from "./Icon";
import { translator, type MessageKey } from "./i18n";

const t = translator("vi");
const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const OUTCOMES: SignInOutcome[] = ["denied", "state", "google", "youtube_denied", "no_refresh_token", "no_channel", "youtube_error", "channel_in_use"];

type View = { kind: "loading" } | { kind: "signedOut" } | { kind: "notConfigured" } | { kind: "error" } | { kind: "signedIn"; me: MeResponse };

const INVITE_KEY = "et.pendingInvite";
const INVITE_OUTCOMES = new Set(["accepted", "already_member", "email_mismatch", "invalid"]);

// The invite token survives the Google sign-in round trip in sessionStorage, then leaves the URL straight away.
function captureInvite(): string | null {
  const match = /^\/invite\/([A-Za-z0-9_-]{43})$/.exec(window.location.pathname);
  try {
    if (match) {
      window.sessionStorage.setItem(INVITE_KEY, match[1]!);
      window.history.replaceState(null, "", "/");
    }
    return window.sessionStorage.getItem(INVITE_KEY);
  } catch {
    if (match) window.history.replaceState(null, "", "/");
    return match ? match[1]! : null;
  }
}

function clearInvite(): void {
  try {
    window.sessionStorage.removeItem(INVITE_KEY);
  } catch {
    // Storage may be blocked; nothing to clear.
  }
}

function readOutcome(): SignInOutcome | null {
  const value = new URLSearchParams(window.location.search).get("signin");
  return OUTCOMES.find((o) => o === value) ?? null;
}

export function App() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [outcome] = useState(readOutcome);
  const [inviteToken, setInviteToken] = useState(captureInvite);
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [invitePreview, setInvitePreview] = useState<string | null>(null);

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
    if (outcome) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    load();
  }, [load, outcome]);

  // Nothing is accepted until the person sees which channel invited them and chooses to join.
  useEffect(() => {
    if (view.kind !== "signedIn" || !inviteToken) return;
    api.previewInvite(inviteToken).then(
      (r) => setInvitePreview(r.workspaceName),
      () => {
        clearInvite();
        setInviteToken(null);
        setInviteResult("invalid");
      },
    );
  }, [view.kind, inviteToken]);

  function decideInvite(join: boolean) {
    const token = inviteToken;
    clearInvite();
    setInviteToken(null);
    setInvitePreview(null);
    if (!join || !token) return;
    api
      .acceptInvite(token)
      .then((r) => setInviteResult(r.outcome))
      .catch((e: unknown) => setInviteResult(e instanceof ApiError && e.code ? e.code : "invalid"))
      .finally(load);
  }

  const banners = (
    <>
      {outcome && (
        <p className="notice" role="status">
          {t(`signin.outcome.${outcome}` as MessageKey)}
        </p>
      )}
      {inviteResult && INVITE_OUTCOMES.has(inviteResult) && (
        <p className="notice" role="status">
          {t(`invite.${inviteResult}` as MessageKey)}
        </p>
      )}
      {inviteToken && view.kind === "signedOut" && <p className="notice">{t("invite.pending")}</p>}
      {invitePreview && (
        <div className="notice" role="dialog" aria-label={t("invite.prompt")}>
          <p>
            {t("invite.prompt")} <strong>{invitePreview}</strong>
          </p>
          <p className="actions">
            <button type="button" className="button primary" onClick={() => decideInvite(true)}>
              {t("invite.join")}
            </button>
            <button type="button" className="button" onClick={() => decideInvite(false)}>
              {t("invite.decline")}
            </button>
          </p>
        </div>
      )}
    </>
  );

  if (view.kind === "signedIn") return <SignedIn me={view.me} onChange={load} banners={banners} />;

  return (
    <main className="page">
      <div className="welcome">
        <h1>{t("app.title")}</h1>
        {banners}
        {view.kind === "loading" && <p>{t("state.loading")}</p>}
        {view.kind === "notConfigured" && <p>{t("state.notConfigured")}</p>}
        {view.kind === "error" && <p className="error">{t("state.error")}</p>}
        {view.kind === "signedOut" && <SignedOut />}
      </div>
    </main>
  );
}

function SignedOut() {
  return (
    <section>
      <p className="lead">{t("app.tagline")}</p>
      <p className="actions">
        <a className="button primary big" href={signInUrl("creator")}>
          {t("signin.creator")}
        </a>
        <a className="button big" href={signInUrl("moderator")}>
          {t("signin.moderator")}
        </a>
      </p>
      <p className="muted signin-note">{t("signin.readonlyNote")}</p>
    </section>
  );
}

type Tab = "live" | "season" | "overlay" | "alerts" | "channel" | "settings";
const TABS: readonly Tab[] = ["live", "season", "overlay", "alerts", "channel", "settings"];
const MAIN_TABS: readonly Tab[] = ["live", "season", "overlay", "alerts", "channel"];
const readTab = (): Tab => TABS.find((tab) => `#${tab}` === window.location.hash) ?? "live";

function SignedIn({ me, onChange, banners }: { me: MeResponse; onChange: () => void; banners: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [tally, setTally] = useState<TallyState>("idle");
  const [tab, setTab] = useState<Tab>(readTab);
  // The creator's own channel comes first, so joining someone else's can't take over their dashboard.
  const ordered = [...me.workspaces].sort((a, b) => (a.role === b.role ? 0 : a.role === "owner" ? -1 : 1));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const first = ordered.find((w) => w.id === selectedId) ?? ordered[0];

  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function choose(next: Tab) {
    setTab(next);
    window.history.replaceState(null, "", `#${next}`);
  }

  const navItem = (id: Tab) => (
    <a key={id} href={`#${id}`} className="nav-item" aria-current={tab === id ? "page" : undefined} onClick={(e) => (e.preventDefault(), choose(id))}>
      <Icon name={id} />
      <span>{t(`tab.${id}`)}</span>
    </a>
  );

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail-brand">
          <span className="rail-mark" aria-hidden="true" />
          <span>
            {t("app.short")}
            {first && <small>{first.name}</small>}
          </span>
        </div>
        {first && (
          <p className="tally" data-state={tally} role="status">
            <span className="tally-lamp" aria-hidden="true" />
            <span>{t(`tally.${tally}`)}</span>
          </p>
        )}
        {ordered.length > 1 && (
          <label className="rail-switch">
            <span>{t("ws.switch")}</span>
            <select value={first?.id} onChange={(e) => setSelectedId(e.target.value)}>
              {ordered.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({t(`ws.role.${w.role}`)})
                </option>
              ))}
            </select>
          </label>
        )}
        <nav className="rail-nav" aria-label={t("tab.label")}>
          {first && MAIN_TABS.map(navItem)}
        </nav>
        <nav className="rail-nav rail-foot" aria-label={t("tab.settings")}>
          {navItem("settings")}
        </nav>
      </aside>
      <main className="stage">
        <header className="stage-head">
          <h1>{t(`tab.${tab}`)}</h1>
          <p>{t(`page.${tab}`)}</p>
        </header>
        {banners}
        {message && (
          <p className="error" role="alert">
            {message}
          </p>
        )}
        <div hidden={tab !== "settings"}>
          <Settings me={me} onChange={onChange} onError={setMessage} />
        </div>
        {first ? (
          <Workspace key={first.id} id={first.id} selfId={me.member.id} tab={tab} onTally={setTally} onError={setMessage} onChange={onChange} />
        ) : (
          tab !== "settings" && (
            <div className="card">
              <p>{t("me.noWorkspace")}</p>
              <p className="actions">
                <a className="button primary" href={signInUrl("creator")}>
                  {t("me.connect")}
                </a>
              </p>
            </div>
          )
        )}
      </main>
    </div>
  );
}

function Settings({ me, onChange, onError }: { me: MeResponse; onChange: () => void; onError: (message: string) => void }) {
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
      onError(t("account.deleteFailed"));
    }
  }

  return (
    <div className="stack narrow">
      <section className="card">
        <h2>{t("settings.account")}</h2>
        <dl className="facts">
          <dt>{t("settings.name")}</dt>
          <dd>{me.member.displayName}</dd>
          <dt>{t("account.signedInAs")}</dt>
          <dd>{me.member.email}</dd>
        </dl>
        <p className="actions">
          <button type="button" className="button" onClick={logout}>
            {t("account.logout")}
          </button>
        </p>
      </section>
      <section className="card">
        <h2>{t("settings.data")}</h2>
        <p className="muted">{t("settings.dataHelp")}</p>
        <p className="actions">
          <a className="button" href="/api/account/export">
            {t("account.export")}
          </a>
        </p>
      </section>
      <section className="card card-danger">
        <h2>{t("settings.danger")}</h2>
        <p className="muted">{t("settings.dangerHelp")}</p>
        <p className="actions">
          <button type="button" className="button danger" onClick={deleteAccount}>
            {t("account.delete")}
          </button>
        </p>
      </section>
    </div>
  );
}

function Workspace({
  id,
  selfId,
  tab,
  onTally,
  onError,
  onChange,
}: {
  id: string;
  selfId: string;
  tab: Tab;
  onTally: (state: TallyState) => void;
  onError: (message: string) => void;
  onChange: () => void;
}) {
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

  if (!data) return tab === "settings" ? null : <p>{t("state.loading")}</p>;
  const isOwner = data.workspace.role === "owner";
  const youtubeConnected = data.youtube !== null;
  // Pages stay mounted when hidden, so a running session keeps its state and the tally stays right.
  const panel = (name: Tab) => ({ id: `panel-${name}`, hidden: tab !== name });

  return (
    <>
      <div {...panel("live")} className="stack">
        <LivePanel workspaceId={id} youtubeConnected={youtubeConnected} isOwner={isOwner} onTally={onTally} />
      </div>
      <div {...panel("season")} className="stack">
        <SeasonPanel workspaceId={id} isOwner={isOwner} />
      </div>
      <div {...panel("overlay")} className="stack">
        {isOwner && <ObsSetup workspaceId={id} youtubeConnected={youtubeConnected} />}
        {isOwner && <StylePanel workspaceId={id} />}
        <OverlayLinks workspaceId={id} isOwner={isOwner} />
      </div>
      <div {...panel("alerts")} className="stack">
        <AlertsPanel workspaceId={id} isOwner={isOwner} />
      </div>
      <div {...panel("channel")} className="grid-2">
        <section className="card">
          <h2>
            {t("channel.title")} <span className="badge">{t(`ws.role.${data.workspace.role}`)}</span>
          </h2>
          {data.youtube ? (
            <dl className="facts">
              <dt>{t("ws.channel")}</dt>
              <dd>{data.youtube.channelTitle}</dd>
              <dt>{t("ws.connectedAt")}</dt>
              <dd>{dateFormat.format(new Date(data.youtube.connectedAt))}</dd>
            </dl>
          ) : (
            <p>{t("ws.notConnected")}</p>
          )}
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
        </section>
        <MembersPanel workspace={data} selfId={selfId} onLeft={onChange} />
      </div>
    </>
  );
}
