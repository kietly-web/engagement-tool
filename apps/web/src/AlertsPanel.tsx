import { useEffect, useState } from "react";
import type { AlertAnimation, AlertCommandView, AlertsConfigView, AlertSticker } from "@et/worker/api-types";
import { api } from "./api";
import { translator, type MessageKey } from "./i18n";

const t = translator("vi");
const STICKERS: AlertSticker[] = ["heart", "fire", "clap", "star", "laugh", "wave", "gift", "sparkles"];
const ANIMATIONS: AlertAnimation[] = ["pop", "slide", "bounce", "shake"];
const MAX_COMMANDS = 20;

export function AlertsPanel({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  const [config, setConfig] = useState<AlertsConfigView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api.alertsConfig(workspaceId).then((r) => setConfig(r.alerts), () => setNotice(t("state.error")));
  }, [workspaceId]);

  const updateCommand = (i: number, patch: Partial<AlertCommandView>) =>
    setConfig((c) => (c ? { ...c, commands: c.commands.map((cmd, j) => (j === i ? { ...cmd, ...patch } : cmd)) } : c));

  async function save() {
    if (!config) return;
    try {
      const saved = await api.saveAlertsConfig(workspaceId, config);
      setConfig(saved.alerts);
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

  if (!config) return null;
  return (
    <div className="card">
      <h2>{t("alerts.title")}</h2>
      <p className="muted">{t("alerts.help")}</p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <table className="board">
        <thead>
          <tr>
            <th>{t("alerts.trigger")}</th>
            <th>{t("alerts.text")}</th>
            <th>{t("alerts.sticker")}</th>
            <th>{t("alerts.animation")}</th>
            {isOwner && <th />}
          </tr>
        </thead>
        <tbody>
          {config.commands.map((cmd, i) => (
            <tr key={i}>
              <td>
                !<input value={cmd.trigger} maxLength={20} disabled={!isOwner} aria-label={t("alerts.trigger")} onChange={(e) => updateCommand(i, { trigger: e.target.value })} />
              </td>
              <td>
                <input value={cmd.text} maxLength={80} disabled={!isOwner} aria-label={t("alerts.text")} onChange={(e) => updateCommand(i, { text: e.target.value })} />
              </td>
              <td>
                <select value={cmd.sticker} disabled={!isOwner} aria-label={t("alerts.sticker")} onChange={(e) => updateCommand(i, { sticker: e.target.value as AlertSticker })}>
                  {STICKERS.map((s) => (
                    <option key={s} value={s}>
                      {t(`alerts.sticker.${s}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select value={cmd.animation} disabled={!isOwner} aria-label={t("alerts.animation")} onChange={(e) => updateCommand(i, { animation: e.target.value as AlertAnimation })}>
                  {ANIMATIONS.map((a) => (
                    <option key={a} value={a}>
                      {t(`alerts.animation.${a}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </td>
              {isOwner && (
                <td>
                  <button type="button" className="button small" onClick={() => setConfig({ ...config, commands: config.commands.filter((_, j) => j !== i) })}>
                    {t("alerts.remove")}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {isOwner && (
        <div className="poll-form">
          {config.commands.length < MAX_COMMANDS && (
            <button
              type="button"
              className="button"
              onClick={() => setConfig({ ...config, commands: [...config.commands, { trigger: "", text: "", sticker: "heart", animation: "pop" }] })}
            >
              {t("alerts.add")}
            </button>
          )}
          <label>
            {t("alerts.viewerCooldown")}
            <input type="number" min={5} max={600} value={config.viewerCooldownSeconds} onChange={(e) => setConfig({ ...config, viewerCooldownSeconds: Number(e.target.value) })} />
          </label>
          <label>
            {t("alerts.globalCooldown")}
            <input type="number" min={1} max={60} value={config.globalCooldownSeconds} onChange={(e) => setConfig({ ...config, globalCooldownSeconds: Number(e.target.value) })} />
          </label>
          <label className="inline">
            <input type="checkbox" checked={config.showHint} onChange={(e) => setConfig({ ...config, showHint: e.target.checked })} /> {t("alerts.showHint")}
          </label>
          <button type="button" className="button primary" onClick={save}>
            {t("alerts.save")}
          </button>
        </div>
      )}
      <p className="actions">
        <button type="button" className="button" onClick={test}>
          {t("alerts.test")}
        </button>
      </p>
    </div>
  );
}
