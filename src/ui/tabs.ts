export type TabId = "overview" | "solve" | "bank" | "settings" | "logs";

export const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "概览" },
  { id: "solve", label: "答题" },
  { id: "bank", label: "题库" },
  { id: "settings", label: "设置" },
  { id: "logs", label: "日志" },
];

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
  if (!ts) return "从未";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
