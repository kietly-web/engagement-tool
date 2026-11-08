export const vi = {
  "app.title": "Công cụ tương tác livestream",
  "app.tagline": "Bình chọn, mini-game và điểm thưởng từ chat YouTube, hiển thị trên OBS.",
  "health.checking": "Đang kiểm tra máy chủ…",
  "health.ok": "Máy chủ đang hoạt động",
  "health.down": "Không kết nối được máy chủ",
} as const;

export type MessageKey = keyof typeof vi;
