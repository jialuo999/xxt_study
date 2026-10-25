import { getLocale, t, type MessageKey } from "@/core/i18n";

export type TabId = "home" | "solve" | "bank" | "settings";

const TAB_KEY: Record<TabId, MessageKey> = {
  home: "tab.home",
  solve: "tab.solve",
  bank: "tab.bank",
  settings: "tab.settings",
};

export const TABS: Array<{ id: TabId }> = [
  { id: "home" },
  { id: "solve" },
  { id: "bank" },
  { id: "settings" },
];

export function tabLabel(id: TabId): string {
  return t(TAB_KEY[id]);
}

export function downloadText(filename: string, text: string, mime = "application/json"): void {
  try {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* ignore */
  }
}

export function formatDateTime(ts: number | null): string {
  if (!ts) return t("common.never");
  return new Date(ts).toLocaleString(getLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
