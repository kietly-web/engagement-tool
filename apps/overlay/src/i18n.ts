const vi = {
  "poll.total": (n: number) => `${n} lượt bình chọn`,
  "leaderboard.title": "Bảng xếp hạng",
  "leaderboard.anonymous": "Khán giả",
  "leaderboard.points": (n: number) => `${n} điểm`,
};
const en: typeof vi = {
  "poll.total": (n: number) => `${n} votes`,
  "leaderboard.title": "Leaderboard",
  "leaderboard.anonymous": "Viewer",
  "leaderboard.points": (n: number) => `${n} pts`,
};

export const messages = { vi, en } as const;
export const t = messages.vi;
