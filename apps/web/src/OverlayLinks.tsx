import { useEffect, useState } from "react";
import type { OverlayLinkView, OverlayWidget } from "@et/worker/api-types";
import { api } from "./api";
import { translator } from "./i18n";

const t = translator("vi");
const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });

export function OverlayLinks({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  const [links, setLinks] = useState<OverlayLinkView[]>([]);
  const [fresh, setFresh] = useState<{ widget: OverlayWidget; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.overlays(workspaceId).then((r) => setLinks(r.overlays), () => setError(true));
  }, [workspaceId]);

  async function rotate(link: OverlayLinkView) {
    if (link.rotatedAt && !window.confirm(t("overlay.rotateConfirm"))) return;
    try {
      const result = await api.rotateOverlay(workspaceId, link.widget);
      setFresh(result);
      setCopied(false);
      setLinks((await api.overlays(workspaceId)).overlays);
    } catch {
      setError(true);
    }
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url).then(() => setCopied(true), () => setCopied(false));
  }

  return (
    <details className="card">
      <summary>{t("overlay.advanced")}</summary>
      {error && <p className="error">{t("state.error")}</p>}
      {fresh && (
        <div className="notice" role="status">
          <p>{t("overlay.copyNow")}</p>
          <p className="actions">
            <input className="link-box" readOnly value={fresh.url} onFocus={(e) => e.currentTarget.select()} aria-label={t(`overlay.widget.${fresh.widget}`)} />
            <button type="button" className="button" onClick={() => copy(fresh.url)}>
              {copied ? t("overlay.copied") : t("overlay.copy")}
            </button>
          </p>
        </div>
      )}
      <ul>
        {links.map((link) => (
          <li key={link.widget}>
            <strong>{t(`overlay.widget.${link.widget}`)}</strong>
            {" · "}
            {link.rotatedAt ? `${t("overlay.created")} ${dateFormat.format(new Date(link.rotatedAt))}` : t("overlay.none")}{" "}
            {isOwner && (
              <button type="button" className="button" onClick={() => rotate(link)}>
                {link.rotatedAt ? t("overlay.rotate") : t("overlay.create")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="muted">{isOwner ? t("overlay.howto") : t("overlay.ownerOnly")}</p>
    </details>
  );
}
