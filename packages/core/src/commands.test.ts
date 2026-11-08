import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands";

const vote = (option: number) => ({ kind: "vote", option });
const join = { kind: "join" };

describe("parseCommand: votes", () => {
  it.each([
    ["!vote 2", 2],
    ["!vote2", 2],
    ["!VOTE 3", 3],
    ["!v 1", 1],
    ["!v1", 1],
    ["!binhchon 4", 4],
    ["!bình chọn 4", 4],
    ["!binh chon 4", 4],
    ["!BÌNH CHỌN 5", 5],
    ["!chọn 6", 6],
    ["!chon 6", 6],
    ["!bc 2", 2],
    ["!vote 02", 2],
    ["!vote 12", 12],
    ["   !vote 2   ", 2],
    ["!vote 2 đội xanh cố lên", 2],
    ["！ｖｏｔｅ\u3000２", 2],
    ["!vote ２", 2],
  ])("%j → vote %i", (text, option) => {
    expect(parseCommand(text)).toEqual(vote(option));
  });

  it("accepts decomposed (NFD) Vietnamese", () => {
    expect(parseCommand("!bi\u0300nh cho\u0323n 3")).toEqual(vote(3));
  });

  it("ignores invisible characters and zalgo inside the command", () => {
    expect(parseCommand("!vo\u200Bte 2")).toEqual(vote(2));
    expect(parseCommand("\u202E!vote 2")).toEqual(vote(2));
    expect(parseCommand("!v\u0337o\u0338t\u0335e 2")).toEqual(vote(2));
  });
});

describe("parseCommand: joins", () => {
  it.each(["!join", "!JOIN", "!join đây", "!thamgia", "!tham gia", "!Tham Gia", "!tg"])("%j → join", (text) => {
    expect(parseCommand(text)).toEqual(join);
  });
});

describe("parseCommand: ignored input", () => {
  it.each([
    "",
    "vote 2",
    "hello !vote 2",
    "!vote",
    "!vote 0",
    "!vote 00",
    "!vote -1",
    "!vote 2.5",
    "!vote 2abc",
    "!vote 123",
    "!voter 2",
    "!vote ٢",
    "!vote hai",
    "!joined",
    "!joinx",
    "!chôn 2x",
    "<b>!vote 2</b>",
    "!vоte 2",
    "!",
    "!!vote 2",
  ])("%j → null", (text) => {
    expect(parseCommand(text)).toBeNull();
  });

  it("stays fast and safe on very long hostile input", () => {
    const hostile = "!vote " + "\u0301".repeat(50_000) + "2";
    const start = Date.now();
    for (let i = 0; i < 1_000; i++) parseCommand(hostile);
    expect(Date.now() - start).toBeLessThan(2_000);
  });
});
