import { useEffect, useState } from "react";
import type { HealthResponse } from "@et/worker/api-types";
import { translator } from "./i18n";

const t = translator("vi");

type Health = "checking" | "ok" | "down";

export function App() {
  const [health, setHealth] = useState<Health>("checking");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/healthz", { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<HealthResponse>) : Promise.reject(new Error(String(res.status)))))
      .then((body) => setHealth(body.ok ? "ok" : "down"))
      .catch(() => {
        if (!controller.signal.aborted) setHealth("down");
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="page">
      <h1>{t("app.title")}</h1>
      <p>{t("app.tagline")}</p>
      <p className={`health health-${health}`} role="status">
        {t(`health.${health}`)}
      </p>
    </main>
  );
}
