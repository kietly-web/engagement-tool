import { COMMAND_ALIASES, parseCommand } from "./commands";
import { POINTS } from "./points";
import { commandKey } from "./text";

// What a creator may change about how chat earns points. Server-side only: never sent to overlays.
export interface SessionRules {
  points: { join: number; vote: number };
  voteWords: string[];
  joinWords: string[];
}

export const RULE_LIMITS = {
  joinPoints: { min: 0, max: 100 },
  votePoints: { min: 0, max: 50 },
  wordsPerCommand: 5,
  wordLength: 20,
} as const;

export const DEFAULT_RULES: SessionRules = { points: { join: POINTS.join, vote: POINTS.countedVote }, voteWords: [], joinWords: [] };

const BUILT_IN = new Set(
  [...COMMAND_ALIASES.vote, ...COMMAND_ALIASES.join, "!guess", "!doan", "!points", "!diem"].map((a) => commandKey(a).slice(1).replace(/ /g, "")),
);

const int = (v: unknown, min: number, max: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d);

// Letters and digits only after folding, so a word can't shadow a built-in or carry anything but a plain key.
export function normaliseWord(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = commandKey(raw.startsWith("!") ? raw : `!${raw}`).slice(1);
  if (!/^[a-z][a-z0-9]{0,19}$/.test(key) || BUILT_IN.has(key)) return null;
  return parseCommand(`!${key}`) || parseCommand(`!${key} 1`) ? null : key;
}

function words(input: unknown, taken: Set<string>): string[] {
  const out: string[] = [];
  // Bounded walk: an owner-sent array is capped before any folding work.
  for (const raw of Array.isArray(input) ? input.slice(0, RULE_LIMITS.wordsPerCommand * 4) : []) {
    if (out.length >= RULE_LIMITS.wordsPerCommand) break;
    const word = normaliseWord(raw);
    if (word && !taken.has(word)) {
      taken.add(word);
      out.push(word);
    }
  }
  return out;
}

// Lenient like the widget config: bad values fall back, so a stored config never breaks a session.
export function parseRules(input: unknown): SessionRules {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const points = (typeof raw.points === "object" && raw.points !== null ? raw.points : {}) as Record<string, unknown>;
  const taken = new Set<string>();
  return {
    points: {
      join: int(points.join, RULE_LIMITS.joinPoints.min, RULE_LIMITS.joinPoints.max, DEFAULT_RULES.points.join),
      vote: int(points.vote, RULE_LIMITS.votePoints.min, RULE_LIMITS.votePoints.max, DEFAULT_RULES.points.vote),
    },
    voteWords: words(raw.voteWords, taken),
    joinWords: words(raw.joinWords, taken),
  };
}
