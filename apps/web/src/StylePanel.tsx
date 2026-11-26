import { useCallback, useEffect, useRef, useState } from "react";
import type { OverlayTheme, SceneEditorMessage, SceneEditorWidget } from "@et/worker/api-types";
import { api } from "./api";
import { translator, type MessageKey } from "./i18n";
import { CANVAS, clampX, clampY, DEFAULT_CORNER, readEditorMessage, SCENE_WIDGETS } from "./scene-editor";

const t = translator("vi");
const PRESETS = ["night", "day", "neon", "pastel"] as const;
const ACCENTS = ["pink", "orange", "yellow", "green", "teal", "blue", "purple", "red"] as const;
const POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "center", "custom"] as const;
const EDITOR_SRC = "/overlay/?preview=scene&edit=1";

type Themes = Record<SceneEditorWidget, OverlayTheme>;

export function StylePanel({ workspaceId }: { workspaceId: string }) {
  const [widget, setWidget] = useState<SceneEditorWidget>("poll");
  const [themes, setThemes] = useState<Themes | null>(null);
  const [dirty, setDirty] = useState<ReadonlySet<SceneEditorWidget>>(new Set());
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(0.4);
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setThemes(null);
    setDirty(new Set());
    Promise.all(SCENE_WIDGETS.map((w) => api.widgetConfig(workspaceId, w))).then(
      (configs) => setThemes(Object.fromEntries(SCENE_WIDGETS.map((w, i) => [w, configs[i]!.theme])) as Themes),
      () => setError(true),
    );
  }, [workspaceId]);

  const loaded = themes !== null;
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => entry && setScale(entry.contentRect.width / CANVAS.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, [loaded]);

  const post = useCallback((message: SceneEditorMessage) => frame.current?.contentWindow?.postMessage(message, location.origin), []);

  const change = useCallback((w: SceneEditorWidget, patch: Partial<OverlayTheme>) => {
    setSaved(false);
    setDirty((prev) => new Set(prev).add(w));
    setThemes((prev) => (prev ? { ...prev, [w]: { ...prev[w], ...patch } } : prev));
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      const message = readEditorMessage(event.data);
      if (message?.type === "et-layout-ready") setReady(true);
      else if (message?.type === "et-layout-select") setWidget(message.widget);
      else if (message?.type === "et-layout-move") change(message.widget, { position: "custom", x: message.x, y: message.y });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [change]);

  useEffect(() => {
    if (!ready || !themes) return;
    for (const w of SCENE_WIDGETS) post({ type: "et-layout-theme", widget: w, theme: themes[w] });
  }, [ready, themes, post]);

  useEffect(() => {
    if (ready) post({ type: "et-layout-select", widget });
  }, [ready, widget, post]);

  async function save() {
    if (!themes) return;
    const widgets = [...dirty];
    const results = await Promise.allSettled(widgets.map((w) => api.saveWidgetConfig(workspaceId, w, { theme: themes[w] })));
    const done = new Map<SceneEditorWidget, OverlayTheme>();
    results.forEach((r, i) => r.status === "fulfilled" && done.set(widgets[i]!, r.value.theme));
    setThemes((prev) => (prev ? { ...prev, ...Object.fromEntries(done) } : prev));
    setDirty((prev) => new Set([...prev].filter((w) => !done.has(w))));
    setSaved(done.size === widgets.length);
    setError(done.size !== widgets.length);
  }

  function resetLayout() {
    for (const w of SCENE_WIDGETS) change(w, { position: DEFAULT_CORNER[w] });
  }

  const theme = themes?.[widget];
  const update = <K extends keyof OverlayTheme>(key: K, value: OverlayTheme[K]) => change(widget, { [key]: value });

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
      {themes && theme && (
        <>
          <p className="muted">{t("style.layoutHint")}</p>
          <div className="scene-editor" ref={box}>
            <iframe ref={frame} title={t("style.preview")} src={EDITOR_SRC} style={{ transform: `scale(${scale})` }} />
          </div>
          <div className="widget-picker" role="group" aria-label={t("style.widget")}>
            {SCENE_WIDGETS.map((w) => (
              <button key={w} type="button" className="button small" aria-pressed={widget === w} onClick={() => setWidget(w)}>
                {t(`overlay.widget.${w}`)}
                {dirty.has(w) && " •"}
              </button>
            ))}
          </div>
          <div className="poll-form style-controls">
            {select("preset", PRESETS)}
            {select("accent", ACCENTS)}
            {select("position", POSITIONS)}
            {theme.position === "custom" && (
              <div className="xy">
                <label>
                  {t("style.x")}
                  <input type="number" min={0} max={CANVAS.width - 320} step={10} value={theme.x} onChange={(e) => update("x", clampX(Number(e.target.value)))} />
                </label>
                <label>
                  {t("style.y")}
                  <input type="number" min={0} max={CANVAS.height - 80} step={10} value={theme.y} onChange={(e) => update("y", clampY(Number(e.target.value)))} />
                </label>
              </div>
            )}
            <label>
              {t("style.width")}: {theme.width}
              <input type="range" min={320} max={1200} step={10} value={theme.width} onChange={(e) => update("width", Number(e.target.value))} />
            </label>
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
          </div>
          <div className="save-bar">
            {saved && <p className="notice">{t("style.saved")}</p>}
            <p className="actions">
              <button type="button" className="button primary" onClick={save} disabled={dirty.size === 0}>
                {t("style.save")}
              </button>
              <button type="button" className="button" onClick={resetLayout}>
                {t("style.resetLayout")}
              </button>
              {dirty.size > 0 && <span className="muted">{t("style.unsaved")}</span>}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
