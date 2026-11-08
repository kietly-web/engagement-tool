// YouTube caps chat messages at 200 characters; commands sit at the start, so scanning more only costs CPU.
export const MAX_SCAN_LENGTH = 256;

const COMBINING_MARKS = /\p{M}/gu;
const FORMAT_CHARS = /\p{Cf}/gu;
const WHITESPACE_RUN = /\s+/gu;

export function toNfc(text: string): string {
  return text.normalize("NFC");
}

export function foldVietnamese(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

// Matching key only: never shown or stored, since folding loses meaning ("chọn" and "chôn" collide).
export function commandKey(text: string): string {
  const compat = text.slice(0, MAX_SCAN_LENGTH).normalize("NFKC").slice(0, MAX_SCAN_LENGTH).replace(FORMAT_CHARS, "");
  return foldVietnamese(compat).toLowerCase().replace(WHITESPACE_RUN, " ").trim().slice(0, MAX_SCAN_LENGTH);
}
