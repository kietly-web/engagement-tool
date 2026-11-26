import { useEffect, useState } from "react";
import type { SessionRulesView } from "@et/worker/api-types";
import { api } from "./api";
import { translator } from "./i18n";

const t = translator("vi");
const LIMITS = { join: 100, vote: 50, words: 5 } as const;

const toList = (text: string) =>
  text
    .split(/[,\s]+/)
    .map((w) => w.replace(/^!/, "").trim())
    .filter(Boolean)
    .slice(0, LIMITS.words);
const toText = (words: string[]) => words.map((w) => `!${w}`).join(", ");

export function RulesPanel({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  const [rules, setRules] = useState<SessionRulesView | null>(null);
  const [voteWords, setVoteWords] = useState("");
  const [joinWords, setJoinWords] = useState("");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState(false);

  function load(next: SessionRulesView) {
    setRules(next);
    setVoteWords(toText(next.voteWords));
    setJoinWords(toText(next.joinWords));
    setDirty(false);
  }

  useEffect(() => {
    api.rules(workspaceId).then((r) => load(r.rules), () => setError(true));
  }, [workspaceId]);

  if (!rules) return error ? <p className="error">{t("state.error")}</p> : null;

  const setPoints = (key: "join" | "vote", value: number) => {
    setRules({ ...rules, points: { ...rules.points, [key]: value } });
    setDirty(true);
    setNotice(null);
  };

  async function save() {
    if (!rules) return;
    const wanted = { ...rules, voteWords: toList(voteWords), joinWords: toList(joinWords) };
    try {
      const saved = (await api.saveRules(workspaceId, wanted)).rules;
      load(saved);
      const dropped = wanted.voteWords.length + wanted.joinWords.length - saved.voteWords.length - saved.joinWords.length;
      setNotice(dropped > 0 ? t("rules.savedDropped") : t("rules.saved"));
    } catch {
      setError(true);
    }
  }

  return (
    <section className="card" aria-labelledby="rules-title">
      <h2 id="rules-title">{t("rules.title")}</h2>
      <p className="muted">{t("rules.help")}</p>
      {error && <p className="error">{t("state.error")}</p>}
      <div className="poll-form form-row">
        <label>
          {t("rules.joinPoints")}
          <input type="number" min={0} max={LIMITS.join} step={1} value={rules.points.join} disabled={!isOwner} onChange={(e) => setPoints("join", Number(e.target.value))} />
        </label>
        <label>
          {t("rules.votePoints")}
          <input type="number" min={0} max={LIMITS.vote} step={1} value={rules.points.vote} disabled={!isOwner} onChange={(e) => setPoints("vote", Number(e.target.value))} />
        </label>
      </div>
      <div className="poll-form form-row">
        <label>
          {t("rules.voteWords")}
          <input
            value={voteWords}
            placeholder="!b, !go"
            disabled={!isOwner}
            onChange={(e) => (setVoteWords(e.target.value), setDirty(true), setNotice(null))}
          />
        </label>
        <label>
          {t("rules.joinWords")}
          <input
            value={joinWords}
            placeholder="!diemdanh, !hi"
            disabled={!isOwner}
            onChange={(e) => (setJoinWords(e.target.value), setDirty(true), setNotice(null))}
          />
        </label>
      </div>
      <p className="muted">{t("rules.wordsHelp")}</p>
      {isOwner ? (
        <p className="actions">
          <button type="button" className="button primary" disabled={!dirty} onClick={save}>
            {t("rules.save")}
          </button>
          {notice && <span className="muted">{notice}</span>}
        </p>
      ) : (
        <p className="muted">{t("rules.ownerOnly")}</p>
      )}
    </section>
  );
}
