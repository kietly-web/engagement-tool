const vi = {
  "poll.total": (n: number) => `${n} lượt bình chọn`,
  "leaderboard.title": "Bảng xếp hạng",
  "leaderboard.anonymous": "Khán giả",
  "leaderboard.points": (n: number) => `${n} điểm`,
  "preview.question": "Tối nay chơi game nào tiếp?",
  "preview.options": ["Minecraft", "Valorant", "Liên Quân Mobile"],
  "preview.season": "Mùa 1",
  "preview.names": ["Linh", "Bảo", "Khán giả 7", "Minh Anh"],
  "preview.alert": "Thả tim cho idol!",
  "alerts.hint": (triggers: string[]) => `Gõ ${triggers.map((t) => `!${t}`).join(" · ")} vào chat`,
};
const en: typeof vi = {
  "poll.total": (n: number) => `${n} votes`,
  "leaderboard.title": "Leaderboard",
  "leaderboard.anonymous": "Viewer",
  "leaderboard.points": (n: number) => `${n} pts`,
  "preview.question": "Which game should we play next?",
  "preview.options": ["Minecraft", "Valorant", "Arena of Valor"],
  "preview.season": "Season 1",
  "preview.names": ["Linh", "Bao", "Viewer 7", "Minh Anh"],
  "preview.alert": "Hearts for the streamer!",
  "alerts.hint": (triggers: string[]) => `Type ${triggers.map((t) => `!${t}`).join(" · ")} in chat`,
};

export const messages = { vi, en } as const;
export const t = messages.vi;
