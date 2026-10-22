import type { SolveSource, SolveStatus } from "@/core/types";
import type { Tone } from "./components";

export const SOURCE_LABEL: Record<SolveSource, string> = {
  "bank-exact": "题库·精确",
  "bank-fuzzy": "题库·模糊",
  remote: "远程题库",
  ai: "AI",
  manual: "人工",
};

export const SOURCE_TONE: Record<SolveSource, Tone> = {
  "bank-exact": "success",
  "bank-fuzzy": "success",
  remote: "info",
  ai: "accent",
  manual: "muted",
};

export const STATUS_LABEL: Record<SolveStatus, string> = {
  solved: "已答",
  pending: "待确认",
  failed: "失败",
};

export const STATUS_TONE: Record<SolveStatus, Tone> = {
  solved: "success",
  pending: "warn",
  failed: "danger",
};

export const MODE_LABEL = {
  hint: "仅提示",
  review: "复核后提交",
  auto: "全自动",
} as const;

export const MODE_DESC = {
  hint: "只展示答案，不操作页面",
  review: "自动填入，人工复核后提交",
  auto: "自动填入并按设置提交，低置信暂停",
} as const;
