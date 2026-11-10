import { describe, expect, it } from "vitest";
import { GameError, GAME_LIMITS, GuessGame } from "./game";
import { syntheticChannelId } from "./synthetic-chat";

const A = syntheticChannelId(1);
const B = syntheticChannelId(2);
const game = () => GuessGame.create(1, 100, () => 0.41);

describe("GuessGame", () => {
  it("picks the secret from the injected random source and hints until someone wins", () => {
    const g = game();
    expect(g.guess(A, 10)).toBe("higher");
    expect(g.guess(B, 90)).toBe("lower");
    expect(g.publicView()).toMatchObject({ status: "open", guesses: 2, lastGuess: { value: 90, hint: "lower" }, secret: null });
    expect(g.guess(B, 42)).toBe("correct");
    expect(g.winner()).toBe(B);
    expect(g.publicView()).toMatchObject({ status: "won", secret: 42 });
    expect(g.guess(A, 42)).toBe("not_open");
  });

  it("caps guesses per viewer so the range can't be swept", () => {
    const g = game();
    for (let i = 0; i < GAME_LIMITS.guessesPerViewer; i++) g.guess(A, 1 + i);
    expect(g.guess(A, 42)).toBe("limit");
    expect(g.guess(B, 42)).toBe("correct");
  });

  it("ignores out-of-range guesses and invalid viewers without using a try", () => {
    const g = game();
    expect(g.guess(A, 0)).toBe("out_of_range");
    expect(g.guess(A, 101)).toBe("out_of_range");
    expect(g.guess("<script>", 42)).toBe("invalid_viewer");
    expect(g.publicView().guesses).toBe(0);
  });

  it("validates ranges", () => {
    for (const [min, max] of [
      [0, 100],
      [1, 5],
      [1, 2_000_000],
      [1.5, 100],
    ]) {
      expect(() => GuessGame.create(min!, max!, Math.random)).toThrow(new GameError("invalid_range"));
    }
  });

  it("closing reveals the secret with no winner; snapshots round-trip and reject tampering", () => {
    const g = game();
    g.guess(A, 5);
    const restored = GuessGame.restore(g.snapshot());
    expect(restored.guess(A, 42)).toBe("correct");
    const h = game();
    h.close();
    expect(h.publicView()).toMatchObject({ status: "closed", secret: 42 });
    expect(() => GuessGame.restore({ ...g.snapshot(), secret: 500 })).toThrow(GameError);
    expect(() => GuessGame.restore({ ...g.snapshot(), status: "won", winner: null })).toThrow(GameError);
  });
});
