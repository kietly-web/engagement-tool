import { commandKey } from "./text";

export type Command = { kind: "vote"; option: number } | { kind: "join" };

export const COMMAND_ALIASES = {
  vote: ["!vote", "!v", "!binhchon", "!bình chọn", "!chon", "!chọn", "!bc"],
  join: ["!join", "!thamgia", "!tham gia", "!tg"],
} as const;

const VOTE = /^!(?:vote|v|binh ?chon|chon|bc) ?(\d{1,2})(?= |$)/;
const JOIN = /^!(?:join|tham ?gia|tg)(?= |$)/;

// Extra words come from the creator's rules, already folded to [a-z0-9]; built-ins always win.
export interface CommandWords {
  voteWords?: readonly string[];
  joinWords?: readonly string[];
}

const VOTE_ARG = / ?(\d{1,2})(?= |$)/y;

export function parseCommand(text: string, extra?: CommandWords): Command | null {
  const key = commandKey(text);
  if (!key.startsWith("!")) return null;

  const vote = VOTE.exec(key);
  if (vote) {
    const option = Number(vote[1]);
    return option >= 1 ? { kind: "vote", option } : null;
  }
  if (JOIN.test(key)) return { kind: "join" };

  for (const word of extra?.voteWords ?? []) {
    if (!key.startsWith(`!${word}`)) continue;
    VOTE_ARG.lastIndex = word.length + 1;
    const arg = VOTE_ARG.exec(key);
    const option = arg ? Number(arg[1]) : 0;
    if (option >= 1) return { kind: "vote", option };
  }
  for (const word of extra?.joinWords ?? []) {
    if (key === `!${word}` || key.startsWith(`!${word} `)) return { kind: "join" };
  }
  return null;
}
