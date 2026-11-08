const vi = { "poll.total": (n: number) => `${n} lượt bình chọn` };
const en: typeof vi = { "poll.total": (n: number) => `${n} votes` };

export const messages = { vi, en } as const;
export const t = messages.vi;
