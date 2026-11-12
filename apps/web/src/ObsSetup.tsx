import { useCallback, useEffect, useState, type DragEvent, type MouseEvent } from "react";
import type { ObsLinkResponse } from "@et/worker/api-types";
import { api, signInUrl } from "./api";
import { translator } from "./i18n";

const t = translator("vi");
// Checks whether OBS has opened the link only after a drag or copy, and stops once it has or after 10 minutes,
// so an ordinary dashboard visit doesn't keep the database awake.
const CHECK_MS = 10_000;
const CHECK_FOR_MS = 10 * 60_000;

export function ObsSetup({ workspaceId, youtubeConnected }: { workspaceId: string; youtubeConnected: boolean }) {
  const [link, setLink] = useState<ObsLinkResponse | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [clickedInstead, setClickedInstead] = useState(false);
  const [obsConnected, setObsConnected] = useState(false);
  const [checkingSince, setCheckingSince] = useState<number | null>(null);

  useEffect(() => {
    api.obsLink(workspaceId).then(setLink, () => setError(true));
  }, [workspaceId]);

  const check = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    api.session(workspaceId).then((r) => setObsConnected((r.session.overlayConnections ?? 0) > 0), () => undefined);
  }, [workspaceId]);

  useEffect(check, [check]);

  useEffect(() => {
    if (obsConnected || checkingSince === null) return;
    const timer = window.setInterval(() => {
      if (Date.now() - checkingSince > CHECK_FOR_MS) window.clearInterval(timer);
      else check();
    }, CHECK_MS);
    return () => window.clearInterval(timer);
  }, [obsConnected, check, checkingSince]);

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link.url).then(() => setCopied(true), () => setCopied(false));
    setCheckingSince(Date.now());
  }

  async function rotate() {
    if (!window.confirm(t("setup.rotateConfirm"))) return;
    try {
      setLink(await api.rotateObsLink(workspaceId));
      setCopied(false);
      setObsConnected(false);
      setCheckingSince(null);
    } catch {
      setError(true);
    }
  }

  // A click would open the overlay as a page; only a drag onto OBS (or the copied link) adds it.
  function onClick(e: MouseEvent) {
    e.preventDefault();
    setClickedInstead(true);
  }

  function onDragStart(e: DragEvent) {
    if (!link) return;
    e.dataTransfer.setData("text/uri-list", link.dragUrl);
    e.dataTransfer.setData("text/plain", link.dragUrl);
    setCheckingSince(Date.now());
  }

  return (
    <div className="card setup">
      <h2>{t("setup.title")}</h2>
      {error && <p className="error">{t("state.error")}</p>}
      <ol className="steps">
        <li className={youtubeConnected ? "done" : ""}>
          <strong>{t("setup.step1")}</strong>{" "}
          {youtubeConnected ? (
            <span className="ok">✓ {t("setup.done")}</span>
          ) : (
            <a className="button primary" href={signInUrl("creator")}>
              {t("me.connect")}
            </a>
          )}
        </li>
        <li className={obsConnected ? "done" : ""}>
          <strong>{t("setup.step2")}</strong>{" "}
          {obsConnected ? <span className="ok">✓ {t("setup.obsConnected")}</span> : <span className="muted">{t("setup.obsWaiting")}</span>}
          {link && (
            <>
              <p className="actions">
                <a className="button primary drag" href={link.dragUrl} draggable onDragStart={onDragStart} onClick={onClick}>
                  ⠿ {t("setup.drag")}
                </a>
                <button type="button" className="button" onClick={copy}>
                  {copied ? t("overlay.copied") : t("setup.copy")}
                </button>
              </p>
              {clickedInstead && <p className="notice">{t("setup.dragNotClick")}</p>}
              <p className="muted">{t("setup.dragHelp")}</p>
              <details>
                <summary>{t("setup.copyHelpTitle")}</summary>
                <p className="muted">{t("setup.copyHelp")}</p>
              </details>
            </>
          )}
        </li>
        <li>
          <strong>{t("setup.step3")}</strong> <span className="muted">{t("setup.step3Help")}</span>
        </li>
      </ol>
      {link && (
        <p className="muted">
          {t("setup.secret")}{" "}
          <button type="button" className="button" onClick={rotate}>
            {t("setup.rotate")}
          </button>
        </p>
      )}
    </div>
  );
}
