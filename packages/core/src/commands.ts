import { commandKey } from "./text";

export type Command = { kind: "vote"; option: number } | { kind: "join" };

export const COMMAND_ALIASES = {
  vote: ["!vote", "!v", "!binhchon", "!bình chọn", "!chon", "!chọn", "!bc"],
  join: ["!join", "!thamgia", "!tham gia", "!tg"],
} as const;

const VOTE = /^!(?:vote|v|binh ?chon|chon|bc) ?(\d{1,2})(?= |$)/;
const JOIN = /^!(?:join|tham ?gia|tg)(?= |$)/;

export function parseCommand(text: string): Command | null {
  const key = commandKey(text);
  if (!key.startsWith("!")) return null;

  const vote = VOTE.exec(key);
  if (vote) {
    const option = Number(vote[1]);
    return option >= 1 ? { kind: "vote", option } : null;
  }

  return JOIN.test(key) ? { kind: "join" } : null;
}
