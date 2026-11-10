const vi = {
  "poll.total": (n: number) => `${n} lượt bình chọn`,
  "leaderboard.title": "Bảng xếp hạng",
  "leaderboard.anonymous": "Khán giả",
  "leaderboard.points": (n: number) => `${n} điểm`,
  "game.title": (min: number, max: number) => `Đoán số từ ${min} đến ${max}`,
  "game.howto": "Gõ !doan <số> vào chat",
  "game.higher": (n: number) => `${n}: cao hơn!`,
  "game.lower": (n: number) => `${n}: thấp hơn!`,
  "game.guesses": (n: number) => `${n} lượt đoán`,
  "game.won": (name: string, secret: number) => `${name} đoán đúng: ${secret}!`,
  "game.closed": (secret: number) => `Đáp án là ${secret}`,
  "game.someone": "Một khán giả",
};
const en: typeof vi = {
  "poll.total": (n: number) => `${n} votes`,
  "leaderboard.title": "Leaderboard",
  "leaderboard.anonymous": "Viewer",
  "leaderboard.points": (n: number) => `${n} pts`,
  "game.title": (min: number, max: number) => `Guess a number from ${min} to ${max}`,
  "game.howto": "Type !guess <number> in chat",
  "game.higher": (n: number) => `${n}: higher!`,
  "game.lower": (n: number) => `${n}: lower!`,
  "game.guesses": (n: number) => `${n} guesses`,
  "game.won": (name: string, secret: number) => `${name} got it: ${secret}!`,
  "game.closed": (secret: number) => `The answer was ${secret}`,
  "game.someone": "A viewer",
};

export const messages = { vi, en } as const;
export const t = messages.vi;
