import { useEffect, useState } from "react";
import type { AlertAnimation, AlertCommandView, AlertsConfigView, AlertSticker } from "@et/worker/api-types";
import { api } from "./api";
import { translator, type MessageKey } from "./i18n";

const t = translator("vi");
const STICKERS: AlertSticker[] = ["heart", "fire", "clap", "star", "laugh", "wave", "gift", "sparkles"];
const ANIMATIONS: AlertAnimation[] = ["pop", "slide", "bounce", "shake"];
const MAX_COMMANDS = 20;
// Catalog labels start with the sticker's emoji ("❤️ Tim"), which doubles as the preview.
const emoji = (sticker: AlertSticker) => t(`alerts.sticker.${sticker}` as MessageKey).split(" ")[0];

export function AlertsPanel({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  const [config, setConfig] = useState<AlertsConfigView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.alertsConfig(workspaceId).then((r) => setConfig(r.alerts), () => setNotice(t("state.error")));
  }, [workspaceId]);

  const edit = (next: AlertsConfigView) => {
    setConfig(next);
    setDirty(true);
    setNotice(null);
  };
  const updateCommand = (i: number, patch: Partial<AlertCommandView>) =>
    config && edit({ ...config, commands: config.commands.map((cmd, j) => (j === i ? { ...cmd, ...patch } : cmd)) });

  async function save() {
    if (!config) return;
    try {
      const saved = await api.saveAlertsConfig(workspaceId, config);
      setConfig(saved.alerts);
      setDirty(false);
      setNotice(saved.alerts.commands.length < config.commands.length ? t("alerts.reserved") : t("alerts.saved"));
    } catch {
      setNotice(t("state.error"));
    }
  }

  async function test() {
    await api.testAlert(workspaceId).then(
      () => setNotice(t("alerts.tested")),
      () => setNotice(t("state.error")),
    );
  }

  if (!config) return notice ? <p className="error">{notice}</p> : null;
  return (
    <>
      <section className="card" aria-labelledby="alerts-title">
        <h2 id="alerts-title">{t("alerts.title")}</h2>
        <p className="muted">{t("alerts.howto")}</p>
        {config.commands.length === 0 && <p className="muted">{t("alerts.empty")}</p>}
        <ul className="item-list">
          {config.commands.map((cmd, i) => (
            <li key={i} className="command">
              <span className="sticker" aria-hidden="true">
                {emoji(cmd.sticker)}
              </span>
              <label className="field">
                {t("alerts.trigger")}
                <span className="trigger">
                  <span aria-hidden="true">!</span>
                  <input value={cmd.trigger} maxLength={20} disabled={!isOwner} onChange={(e) => updateCommand(i, { trigger: e.target.value })} />
                </span>
              </label>
              <label className="field">
                {t("alerts.text")}
                <input value={cmd.text} maxLength={80} disabled={!isOwner} onChange={(e) => updateCommand(i, { text: e.target.value })} />
              </label>
              <label className="field">
                {t("alerts.sticker")}
                <select value={cmd.sticker} disabled={!isOwner} onChange={(e) => updateCommand(i, { sticker: e.target.value as AlertSticker })}>
                  {STICKERS.map((s) => (
                    <option key={s} value={s}>
                      {t(`alerts.sticker.${s}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t("alerts.animation")}
                <select value={cmd.animation} disabled={!isOwner} onChange={(e) => updateCommand(i, { animation: e.target.value as AlertAnimation })}>
                  {ANIMATIONS.map((a) => (
                    <option key={a} value={a}>
                      {t(`alerts.animation.${a}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </label>
              {isOwner ? (
                <button type="button" className="button danger small" onClick={() => edit({ ...config, commands: config.commands.filter((_, j) => j !== i) })}>
                  {t("alerts.remove")}
                </button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
        {isOwner && config.commands.length < MAX_COMMANDS && (
          <p className="actions">
            <button type="button" className="button" onClick={() => edit({ ...config, commands: [...config.commands, { trigger: "", text: "", sticker: "heart", animation: "pop" }] })}>
              + {t("alerts.add")}
            </button>
          </p>
        )}

        {isOwner && (
          <div className="section">
            <h3>{t("alerts.timing")}</h3>
            <div className="form-row">
              <label className="field">
                {t("alerts.viewerCooldown")}
                <input type="number" min={5} max={600} value={config.viewerCooldownSeconds} onChange={(e) => edit({ ...config, viewerCooldownSeconds: Number(e.target.value) })} />
              </label>
              <label className="field">
                {t("alerts.globalCooldown")}
                <input type="number" min={1} max={60} value={config.globalCooldownSeconds} onChange={(e) => edit({ ...config, globalCooldownSeconds: Number(e.target.value) })} />
              </label>
            </div>
            <p className="actions">
              <label className="inline">
                <input type="checkbox" checked={config.showHint} onChange={(e) => edit({ ...config, showHint: e.target.checked })} /> {t("alerts.showHint")}
              </label>
            </p>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="donations-title">
        <h2 id="donations-title">{t("alerts.donations")}</h2>
        <p className="muted">{t("alerts.donations.help")}</p>
        <div className="checks">
          {(["superChats", "memberships", "showAmount", "showComment"] as const).map((key) => (
            <label key={key} className="inline">
              <input
                type="checkbox"
                disabled={!isOwner}
                checked={config.donations[key]}
                onChange={(e) => edit({ ...config, donations: { ...config.donations, [key]: e.target.checked } })}
              />{" "}
              {t(`alerts.donations.${key}`)}
            </label>
          ))}
        </div>
      </section>

      <div className="save-bar">
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <p className="actions">
          {isOwner && (
            <button type="button" className="button primary" disabled={!dirty} onClick={save}>
              {t("alerts.save")}
            </button>
          )}
          <button type="button" className="button" onClick={test}>
            {t("alerts.test")}
          </button>
          {dirty && <span className="muted">{t("style.unsaved")}</span>}
        </p>
      </div>
    </>
  );
}
