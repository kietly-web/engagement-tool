import { describe, expect, it } from "vitest";
import { fixedClock } from "./clock";
import { Poll, PollError, POLL_LIMITS } from "./poll";

const A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const B = "UCbbbbbbbbbbbbbbbbbbbbbb";
const C = "UCcccccccccccccccccccc-_";

function openPoll(voteChange?: "first" | "latest") {
  const clock = fixedClock("2026-11-08T12:00:00Z");
  const poll = Poll.create({ question: "Chơi game nào tiếp?", options: ["Minecraft", "Valorant", "Liên Quân"], voteChange }, clock);
  poll.open();
  return { poll, clock };
}

describe("Poll.create", () => {
  it("normalises text to NFC and collapses whitespace", () => {
    const poll = Poll.create({ question: "  Vie\u0323\u0302t   Nam? ", options: ["Có", "Không"] }, fixedClock("2026-11-08T00:00:00Z"));
    expect(poll.question).toBe("Việt Nam?");
  });

  it.each([
    [{ options: ["Một"] }, "too_few_options"],
    [{ options: ["1", "2", "3", "4", "5", "6", "7"] }, "too_many_options"],
    [{ options: ["Có", "   "] }, "empty_text"],
    [{ options: ["Có", "x".repeat(POLL_LIMITS.maxOptionLength + 1)] }, "text_too_long"],
    [{ options: ["Đội Xanh", "đội xanh"] }, "duplicate_option"],
  ])("rejects %j with %s", (input, code) => {
    expect(() => Poll.create({ question: "Q?", ...input }, fixedClock("2026-11-08T00:00:00Z"))).toThrow(new PollError(code as never));
  });

  it("counts length in characters, not UTF-16 units", () => {
    const emoji = "😀".repeat(POLL_LIMITS.maxOptionLength);
    expect(() => Poll.create({ question: "Q?", options: [emoji, "b"] }, fixedClock("2026-11-08T00:00:00Z"))).not.toThrow();
  });
});

describe("Poll lifecycle", () => {
  it("returns voters once on close and keeps only the counts", () => {
    const { poll, clock } = openPoll();
    poll.vote(A, 1);
    poll.vote(B, 2);
    expect(poll.close().sort()).toEqual([A, B]);
    expect(poll.results()).toEqual({ counts: [1, 1, 0], total: 2 });
    const snapshot = poll.snapshot();
    expect(snapshot.votes).toEqual([]);
    expect(Poll.restore(snapshot, clock).results()).toEqual({ counts: [0, 0, 0], total: 0 });
  });

  it("opens and closes with times from the injected clock", () => {
    const { poll, clock } = openPoll();
    expect(poll.openedAt?.toISOString()).toBe("2026-11-08T12:00:00.000Z");
    clock.advance(60_000);
    poll.close();
    expect(poll.status).toBe("closed");
    expect(poll.closedAt?.toISOString()).toBe("2026-11-08T12:01:00.000Z");
  });

  it("rejects invalid transitions", () => {
    const { poll } = openPoll();
    expect(() => poll.open()).toThrow(PollError);
    poll.close();
    expect(() => poll.close()).toThrow(PollError);
    expect(() => poll.open()).toThrow(PollError);
  });

  it("ignores votes before opening and after closing", () => {
    const poll = Poll.create({ question: "Q?", options: ["a", "b"] }, fixedClock("2026-11-08T00:00:00Z"));
    expect(poll.vote(A, 1)).toBe("not_open");
    poll.open();
    poll.close();
    expect(poll.vote(A, 1)).toBe("not_open");
    expect(poll.results()).toEqual({ counts: [0, 0], total: 0 });
  });
});

describe("Poll.vote", () => {
  it("counts one vote per viewer; the first one wins by default", () => {
    const { poll } = openPoll();
    expect(poll.vote(A, 1)).toBe("counted");
    expect(poll.vote(A, 2)).toBe("duplicate");
    expect(poll.vote(B, 2)).toBe("counted");
    expect(poll.results()).toEqual({ counts: [1, 1, 0], total: 2 });
  });

  it("lets viewers change their vote when the poll allows it", () => {
    const { poll } = openPoll("latest");
    poll.vote(A, 1);
    expect(poll.vote(A, 3)).toBe("changed");
    expect(poll.vote(A, 3)).toBe("duplicate");
    expect(poll.results()).toEqual({ counts: [0, 0, 1], total: 1 });
  });

  it.each([0, 4, -1, 1.5, Number.NaN])("rejects option %s", (option) => {
    const { poll } = openPoll();
    expect(poll.vote(A, option)).toBe("invalid_option");
  });

  it.each(["", "UC123", "<script>", "ucaaaaaaaaaaaaaaaaaaaaaa", `${A}x`])("rejects viewer id %j", (id) => {
    const { poll } = openPoll();
    expect(poll.vote(id, 1)).toBe("invalid_viewer");
  });

  it("keeps counts consistent under many voters", () => {
    const { poll } = openPoll("latest");
    for (let i = 0; i < 5_000; i++) {
      const id = `UC${i.toString(36).padStart(22, "0")}`;
      poll.vote(id, (i % 3) + 1);
      poll.vote(id, ((i + 1) % 3) + 1);
    }
    const { counts, total } = poll.results();
    expect(total).toBe(5_000);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(5_000);
  });
});

describe("Poll snapshot and restore", () => {
  it("round-trips state", () => {
    const { poll, clock } = openPoll();
    poll.vote(A, 1);
    poll.vote(B, 3);
    const restored = Poll.restore(poll.snapshot(), clock);
    expect(restored.results()).toEqual(poll.results());
    expect(restored.status).toBe("open");
    expect(restored.vote(A, 2)).toBe("duplicate");
    expect(restored.vote(C, 2)).toBe("counted");
  });

  it("skips non-string viewer ids that would otherwise count twice", () => {
    const { poll, clock } = openPoll();
    const votes = [[[A], 1], [[A], 1], [A, 1]] as unknown as [string, number][];
    expect(Poll.restore({ ...poll.snapshot(), votes }, clock).results()).toEqual({ counts: [1, 0, 0], total: 1 });
  });

  it.each([
    ["unknown vote-change policy", { voteChange: "zzz" }],
    ["unknown status", { status: "paused" }],
    ["unparseable time", { openedAt: "garbage" }],
    ["open poll without an open time", { openedAt: null }],
    ["open poll with a close time", { closedAt: "2026-11-08T12:05:00.000Z" }],
    ["draft carrying votes", { status: "draft", openedAt: null }],
    ["closed poll still carrying votes", { status: "closed", closedAt: "2026-11-08T12:05:00.000Z" }],
    ["too many options", { options: ["1", "2", "3", "4", "5", "6", "7"] }],
    ["non-string option", { options: ["a", 2] }],
  ])("rejects a snapshot with %s", (_label, patch) => {
    const { poll, clock } = openPoll();
    poll.vote(A, 1);
    const snapshot = { ...poll.snapshot(), ...patch } as never;
    expect(() => Poll.restore(snapshot, clock)).toThrow(new PollError("corrupt_snapshot"));
  });

  it("restores polls whose text predates tighter limits", () => {
    const { poll, clock } = openPoll();
    const longer = { ...poll.snapshot(), question: "q".repeat(POLL_LIMITS.maxQuestionLength * 2) };
    expect(Poll.restore(longer, clock).question).toHaveLength(POLL_LIMITS.maxQuestionLength * 2);
  });

  it("drops corrupt or duplicated vote entries instead of miscounting", () => {
    const { poll, clock } = openPoll();
    const snap = { ...poll.snapshot(), votes: [[A, 1], [A, 2], [B, 9], ["bad", 1], [C, 2]] as [string, number][] };
    expect(Poll.restore(snap, clock).results()).toEqual({ counts: [1, 1, 0], total: 2 });
  });
});
