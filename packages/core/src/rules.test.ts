import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands";
import { PointsTally } from "./points";
import { DEFAULT_RULES, normaliseWord, parseRules } from "./rules";

const A = "UCSYNTHxAAAAAAAAAAAAAAAA";

describe("parseRules", () => {
  it("defaults to the standard points and no extra words", () => {
    for (const input of [undefined, null, "x", {}]) expect(parseRules(input)).toEqual(DEFAULT_RULES);
    expect(DEFAULT_RULES.points).toEqual({ join: 10, vote: 5 });
  });

  it("clamps points to whole numbers inside the limits", () => {
    expect(parseRules({ points: { join: 25.4, vote: 3 } }).points).toEqual({ join: 25, vote: 3 });
    expect(parseRules({ points: { join: 9999, vote: -4 } }).points).toEqual({ join: 100, vote: 0 });
    expect(parseRules({ points: { join: "50", vote: Number.NaN } }).points).toEqual({ join: 10, vote: 5 });
  });

  it("folds words, drops spaces, built-ins, duplicates across commands and anything beyond five", () => {
    const rules = parseRules({ voteWords: ["!B", "Chọn Đi", "vote", "bc", "b", "x1", "x2", "x3", "x4"], joinWords: ["điểm danh", "b", "diemdanh", "<img>"] });
    expect(rules.voteWords).toEqual(["b", "x1", "x2", "x3", "x4"]);
    expect(rules.joinWords).toEqual(["diemdanh"]);
  });

  it("never accepts a word that a built-in already claims or half-claims", () => {
    for (const w of ["vote", "v", "binhchon", "bình chọn", "join", "tg", "thamgia", "v1", "vote2", "doan", "1abc", "a b", ""]) expect(normaliseWord(w), w).toBeNull();
    expect(normaliseWord("chọn")).toBeNull();
    expect(normaliseWord("Đỡ")).toBe("do");
  });
});

describe("parseCommand with the creator's words", () => {
  const words = { voteWords: ["b", "chondi"], joinWords: ["diemdanh", "hi"] };

  it("adds votes and joins with the same argument rules as built-ins", () => {
    expect(parseCommand("!b 2", words)).toEqual({ kind: "vote", option: 2 });
    expect(parseCommand("!B2", words)).toEqual({ kind: "vote", option: 2 });
    expect(parseCommand("!chọn đi 3", words)).toBeNull();
    expect(parseCommand("!chondi 3 cố lên", words)).toEqual({ kind: "vote", option: 3 });
    expect(parseCommand("!điểm danh", words)).toBeNull();
    expect(parseCommand("!diemdanh nha", words)).toEqual({ kind: "join" });
    expect(parseCommand("!Hi", words)).toEqual({ kind: "join" });
  });

  it("ignores near misses and leaves built-ins first", () => {
    for (const text of ["!bonus 2", "!b", "!b 0", "!b 2.5", "!b 123", "!hiya", "b 2", "!diemdanhx"]) expect(parseCommand(text, words), text).toBeNull();
    expect(parseCommand("!vote 4", words)).toEqual({ kind: "vote", option: 4 });
    expect(parseCommand("!b 2")).toBeNull();
  });
});

describe("PointsTally with creator points", () => {
  it("credits the configured amounts, including zero", () => {
    const t = new PointsTally();
    t.join(A, 25);
    t.countedVote(A, 0);
    t.countedVote(A, 7);
    expect(t.snapshot().pending).toEqual([[A, { points: 32, joins: 1, votes: 2 }]]);
  });
});
