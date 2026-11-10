import { commandKey } from "./text";

export type Command = { kind: "vote"; option: number } | { kind: "join" } | { kind: "guess"; value: number };

export const COMMAND_ALIASES = {
  vote: ["!vote", "!v", "!binhchon", "!bình chọn", "!chon", "!chọn", "!bc"],
  join: ["!join", "!thamgia", "!tham gia", "!tg"],
  guess: ["!guess", "!doan", "!đoán"],
} as const;

const VOTE = /^!(?:vote|v|binh ?chon|chon|bc) ?(\d{1,2})(?= |$)/;
const JOIN = /^!(?:join|tham ?gia|tg)(?= |$)/;
const GUESS = /^!(?:guess|doan) ?(\d{1,7})(?= |$)/;

export function parseCommand(text: string): Command | null {
  const key = commandKey(text);
  if (!key.startsWith("!")) return null;

  const vote = VOTE.exec(key);
  if (vote) {
    const option = Number(vote[1]);
    return option >= 1 ? { kind: "vote", option } : null;
  }

  const guess = GUESS.exec(key);
  if (guess) return { kind: "guess", value: Number(guess[1]) };

  return JOIN.test(key) ? { kind: "join" } : null;
}
