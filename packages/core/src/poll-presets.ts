import { POLL_LIMITS, type VoteChangePolicy } from "./poll";
import { toNfc } from "./text";

// Polls a creator prepares before going live. Creator-written text only; stored with the poll widget's settings
// but never part of what an overlay receives (parseWidgetConfig drops it).
export interface PollPreset {
  question: string;
  options: string[];
  voteChange: VoteChangePolicy;
}

export const MAX_POLL_PRESETS = 12;

function clean(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = toNfc(raw).replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/gu, " ").trim();
  return text && Array.from(text).length <= max ? text : null;
}

// Lenient like the widget config: a broken preset is dropped, the rest survive.
export function parsePollPresets(input: unknown): PollPreset[] {
  if (!Array.isArray(input)) return [];
  const presets: PollPreset[] = [];
  for (const raw of input.slice(0, MAX_POLL_PRESETS)) {
    if (typeof raw !== "object" || raw === null) continue;
    const p = raw as Record<string, unknown>;
    const question = clean(p.question, POLL_LIMITS.maxQuestionLength);
    const options = Array.isArray(p.options) ? p.options.map((o) => clean(o, POLL_LIMITS.maxOptionLength)).filter((o): o is string => o !== null) : [];
    const unique = [...new Set(options)].slice(0, POLL_LIMITS.maxOptions);
    if (!question || unique.length < POLL_LIMITS.minOptions) continue;
    presets.push({ question, options: unique, voteChange: p.voteChange === "latest" ? "latest" : "first" });
  }
  return presets;
}
