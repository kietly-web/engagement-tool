import { useEffect, useMemo, useState } from "react";
import type { OverlayTheme, OverlayWidget } from "@et/worker/api-types";
import { api } from "./api";
import { translator, type MessageKey } from "./i18n";

const t = translator("vi");
const PRESETS = ["night", "day", "neon", "pastel"] as const;
const ACCENTS = ["pink", "orange", "yellow", "green", "teal", "blue", "purple", "red"] as const;
const POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "center"] as const;
const WIDGETS: OverlayWidget[] = ["poll", "leaderboard", "alerts"];

function encode(theme: OverlayTheme): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ theme }));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function StylePanel({ workspaceId }: { workspaceId: string }) {
  const [widget, setWidget] = useState<OverlayWidget>("poll");
  const [theme, setTheme] = useState<OverlayTheme | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setTheme(null);
    setSaved(false);
    api.widgetConfig(workspaceId, widget).then((c) => setTheme(c.theme), () => setError(true));
  }, [workspaceId, widget]);

  const previewSrc = useMemo(() => (theme ? `/overlay/?preview=${widget}#${encode(theme)}` : null), [theme, widget]);
  const update = <K extends keyof OverlayTheme>(key: K, value: OverlayTheme[K]) => {
    setSaved(false);
    setTheme((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  async function save() {
    if (!theme) return;
    try {
      setTheme((await api.saveWidgetConfig(workspaceId, widget, { theme })).theme);
      setSaved(true);
    } catch {
      setError(true);
    }
  }

  const select = <K extends "preset" | "accent" | "position">(key: K, options: readonly OverlayTheme[K][]) => (
    <label>
      {t(`style.${key}`)}
      <select value={theme?.[key]} onChange={(e) => update(key, e.target.value as OverlayTheme[K])}>
        {options.map((o) => (
          <option key={o} value={o}>
            {t(`style.${key}.${o}` as MessageKey)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="card">
      <h2>{t("style.title")}</h2>
      {error && <p className="error">{t("state.error")}</p>}
      <label className="switcher">
        {t("style.widget")}{" "}
        <select value={widget} onChange={(e) => setWidget(e.target.value as OverlayWidget)}>
          {WIDGETS.map((w) => (
            <option key={w} value={w}>
              {t(`overlay.widget.${w}`)}
            </option>
          ))}
        </select>
      </label>
      {theme && (
        <div className="style-grid">
          <div className="poll-form">
            {select("preset", PRESETS)}
            {select("accent", ACCENTS)}
            {select("position", POSITIONS)}
            <label>
              {t("style.fontScale")}: {theme.fontScale}
              <input type="range" min={75} max={150} step={5} value={theme.fontScale} onChange={(e) => update("fontScale", Number(e.target.value))} />
            </label>
            <label>
              {t("style.opacity")}: {theme.opacity}
              <input type="range" min={0} max={100} step={5} value={theme.opacity} onChange={(e) => update("opacity", Number(e.target.value))} />
            </label>
            {(["showTitle", "showTotal", "showNames"] as const).map((key) => (
              <label key={key} className="inline">
                <input type="checkbox" checked={theme[key]} onChange={(e) => update(key, e.target.checked)} /> {t(`style.${key}`)}
              </label>
            ))}
            <button type="button" className="button primary" onClick={save}>
              {t("style.save")}
            </button>
            {saved && <p className="notice">{t("style.saved")}</p>}
          </div>
          <figure className="preview">
            <figcaption className="muted">{t("style.preview")}</figcaption>
            {previewSrc && <iframe title={t("style.preview")} src={previewSrc} />}
          </figure>
        </div>
      )}
    </div>
  );
}
