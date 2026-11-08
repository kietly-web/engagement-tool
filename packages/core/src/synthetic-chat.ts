import type { ChatMessage } from "./chat";
import type { Command } from "./commands";

export interface SyntheticMessage extends ChatMessage {
  intent: Command | null;
}

export interface SyntheticChatOptions {
  seed: number;
  count: number;
  viewers?: number;
  options?: number;
  start?: string;
  intervalMs?: number;
  adversarial?: boolean;
}

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const VOTE_FORMS = [
  (n: number) => `!vote ${n}`,
  (n: number) => `!vote${n}`,
  (n: number) => `!VOTE ${n}`,
  (n: number) => `!v ${n}`,
  (n: number) => `!bình chọn ${n}`,
  (n: number) => `!binh chon ${n}`,
  (n: number) => `!binhchon ${n}`,
  (n: number) => `!chọn ${n}`,
  (n: number) => `!vote ${n} cố lên!!!`,
  (n: number) => `！ｖｏｔｅ\u3000${String.fromCharCode(0xff10 + n)}`,
];

const JOIN_FORMS = ["!join", "!JOIN", "!tham gia", "!thamgia", "!Tham Gia nha", "!tg"];

const CHATTER = [
  "Chào mọi người!",
  "hay quá anh ơi",
  "game này khó ghê",
  "đội xanh mạnh nhất",
  "lần đầu xem stream luôn",
  "vote đi mọi người",
  "hi from Hà Nội",
  "8 giờ tối mai có stream không ạ?",
  "❤\uFE0F❤\uFE0F❤\uFE0F",
  "kkk",
];

const ADVERSARIAL: [text: (n: number) => string, intent: (n: number) => Command | null][] = [
  [() => "<script>alert(1)</script>", () => null],
  [() => '<img src=x onerror="alert(1)">!vote 1', () => null],
  [(n) => `\u202E!vote ${n}`, (n) => ({ kind: "vote", option: n })],
  [(n) => `!vo\u200Bte ${n}`, (n) => ({ kind: "vote", option: n })],
  [(n) => `!v\u0337o\u0338t\u0335e ${n}`, (n) => ({ kind: "vote", option: n })],
  [(n) => `!vоte ${n}`, () => null],
  [(n) => `!vote ${"١٢٣"[n % 3]}`, () => null],
  [(n) => `!vote ${n}` + "\u0301".repeat(500), (n) => ({ kind: "vote", option: n })],
  [() => "a".repeat(5_000), () => null],
  [() => "!vote 99999", () => null],
  [() => "https://example.com !vote 1", () => null],
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

// Prefixed so synthetic viewers are recognisable in any output and never mistaken for real channels.
export function syntheticChannelId(index: number): string {
  let suffix = "";
  let n = index;
  for (let i = 0; i < 16; i++) {
    suffix = ID_ALPHABET[n % ID_ALPHABET.length] + suffix;
    n = Math.floor(n / ID_ALPHABET.length);
  }
  return `UCSYNTHx${suffix}`;
}

export function syntheticChat(opts: SyntheticChatOptions): SyntheticMessage[] {
  const rand = mulberry32(opts.seed);
  const viewers = opts.viewers ?? 50;
  const options = opts.options ?? 3;
  const startMs = new Date(opts.start ?? "2026-11-08T13:00:00Z").getTime();
  const intervalMs = opts.intervalMs ?? 400;
  const messages: SyntheticMessage[] = [];

  for (let i = 0; i < opts.count; i++) {
    const viewer = Math.floor(rand() * viewers);
    const option = 1 + Math.floor(rand() * options);
    const roll = rand();
    let text: string;
    let intent: Command | null;

    if (opts.adversarial && roll < 0.2) {
      const [makeText, makeIntent] = pick(rand, ADVERSARIAL);
      text = makeText(option);
      intent = makeIntent(option);
    } else if (roll < 0.55) {
      text = pick(rand, VOTE_FORMS)(option);
      intent = { kind: "vote", option };
    } else if (roll < 0.7) {
      text = pick(rand, JOIN_FORMS);
      intent = { kind: "join" };
    } else {
      text = pick(rand, CHATTER);
      intent = null;
    }

    messages.push({
      channelId: syntheticChannelId(viewer),
      displayName: `Khán giả ${String(viewer + 1).padStart(3, "0")}`,
      text,
      publishedAt: new Date(startMs + i * intervalMs).toISOString(),
      intent,
    });
  }
  return messages;
}
