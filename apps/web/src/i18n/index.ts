import { en } from "./en";
import { vi, type MessageKey } from "./vi";

export type Locale = "vi" | "en";

const catalogs: Record<Locale, Record<MessageKey, string>> = { vi, en };

export function translator(locale: Locale) {
  const catalog = catalogs[locale];
  return (key: MessageKey): string => catalog[key];
}

export type { MessageKey };
