const MAX_TEXT_LENGTH = 80;

// Bidi overrides/isolates and C0/C1 controls let chat text reorder or hide what's on screen.
const UNSAFE_CHARS = /[\p{Cc}‎‏‪-‮⁦-⁩]/gu;

export function safeText(input: string, maxLength = MAX_TEXT_LENGTH): string {
  const cleaned = input.normalize("NFC").replace(UNSAFE_CHARS, "").trim();
  const chars = Array.from(cleaned);
  return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join("")}…` : cleaned;
}

export function setText(el: HTMLElement, input: string): void {
  el.textContent = safeText(input);
}
