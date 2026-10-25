import type { AiPresetId, SolveMode, ThemeMode } from "@/core/settings";
import { t, type Language, type MessageKey } from "@/core/i18n";
import type { PageKind, QuestionType, SolveSource, SolveStatus } from "@/core/types";
import type { Tone } from "./components";

const SOURCE_KEY: Record<SolveSource, MessageKey> = {
  "bank-exact": "label.source.bank-exact",
  "bank-fuzzy": "label.source.bank-fuzzy",
  remote: "label.source.remote",
  ai: "label.source.ai",
  manual: "label.source.manual",
};

const STATUS_KEY: Record<SolveStatus, MessageKey> = {
  solved: "label.status.solved",
  pending: "label.status.pending",
  failed: "label.status.failed",
};

const MODE_KEY: Record<SolveMode, MessageKey> = {
  hint: "label.mode.hint",
  review: "label.mode.review",
  auto: "label.mode.auto",
};

const PAGE_KIND_KEY: Record<PageKind, MessageKey> = {
  chapter: "label.page.chapter",
  cards: "label.page.cards",
  video: "label.page.video",
  homework: "label.page.homework",
  exam: "label.page.exam",
  quiz: "label.page.quiz",
  unknown: "label.page.unknown",
};

const QUESTION_TYPE_KEY: Record<QuestionType, MessageKey> = {
  single: "label.qtype.single",
  multiple: "label.qtype.multiple",
  judge: "label.qtype.judge",
  fill: "label.qtype.fill",
  short: "label.qtype.short",
  unknown: "label.qtype.unknown",
};

const THEME_KEY: Record<ThemeMode, MessageKey> = {
  auto: "theme.auto",
  light: "theme.light",
  dark: "theme.dark",
};

const AI_PRESET_KEY: Record<AiPresetId, MessageKey> = {
  deepseek: "label.aiPreset.deepseek",
  openai: "label.aiPreset.openai",
  siliconflow: "label.aiPreset.siliconflow",
  custom: "label.aiPreset.custom",
};

const LANGUAGE_KEY: Record<Language, MessageKey> = {
  auto: "language.auto",
  "zh-CN": "language.zhCN",
  en: "language.en",
};

export function sourceLabel(source: SolveSource): string {
  return t(SOURCE_KEY[source]);
}

export function statusLabel(status: SolveStatus): string {
  return t(STATUS_KEY[status]);
}

export function modeLabel(mode: SolveMode): string {
  return t(MODE_KEY[mode]);
}

export function pageKindLabel(kind: PageKind): string {
  return t(PAGE_KIND_KEY[kind]);
}

export function questionTypeLabel(type: QuestionType): string {
  return t(QUESTION_TYPE_KEY[type]);
}

export function themeLabel(theme: ThemeMode): string {
  return t(THEME_KEY[theme]);
}

export function aiPresetLabel(id: AiPresetId): string {
  return t(AI_PRESET_KEY[id]);
}

export function languageLabel(language: Language): string {
  return t(LANGUAGE_KEY[language]);
}

export const SOURCE_TONE: Record<SolveSource, Tone> = {
  "bank-exact": "success",
  "bank-fuzzy": "success",
  remote: "info",
  ai: "accent",
  manual: "muted",
};

export const STATUS_TONE: Record<SolveStatus, Tone> = {
  solved: "success",
  pending: "warn",
  failed: "danger",
};
