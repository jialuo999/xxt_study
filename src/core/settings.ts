import type { Language } from "./i18n";
import type { PageKind, QuestionType } from "./types";

export type ThemeMode = "auto" | "light" | "dark";
export type SolveMode = "hint" | "review" | "auto";

export interface AiSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  maxRetries: number;
  jsonMode: "auto" | "on" | "off";
  maxBatch: number;
}

export interface RemoteBankSettings {
  enabled: boolean;
  url: string;
  method: "POST";
  headers: Record<string, string>;
  bodyTemplate: string;
  answerPath: string;
  confidencePath: string;
}

export interface BankSettings {
  fuzzyThreshold: number;
  maxEntries: number;
  cacheTtlDays: number;
  remote: RemoteBankSettings;
}

export interface AutoTurnSettings {
  enabled: boolean;
  waitVideoEnd: boolean;
  minDelayMs: number;
  maxDelayMs: number;
  maxSteps: number;
  stopOnUnanswered: boolean;
  /** 开始翻页前等待（毫秒） */
  startDelayMs: number;
  /** 刷新/跳转后是否自动恢复 */
  resumeOnReload: boolean;
  /** 页面没有 video/audio 时，等待多久再翻页（毫秒） */
  contentWaitMs: number;
  /**
   * 自动完成阅读/文档/PPT 任务：只做真实滚动/翻页，完成状态以平台任务点为准。
   * 默认开启；关闭后阅读任务会停止并提示人工处理，不会 3 秒后直接跳过。
   */
  readingAuto: boolean;
}

export interface VideoSettings {
  /** 进入视频页时默认静音 */
  defaultMuted: boolean;
  /** 默认播放倍速；1 表示原始速度 */
  playbackRate: number;
  /** 仅自动翻页等待媒体结束时，暂停后尝试恢复播放 */
  resumeOnPause: boolean;
}

export interface SolvingSettings {
  mode: SolveMode;
  autoSubmit: boolean;
  allowExam: boolean;
  minConfidence: number;
  batchSize: number;
  fillDelayMs: [number, number];
  autoFillOnScan: boolean;
  includeTypes: Record<Exclude<QuestionType, "unknown">, boolean>;
}

export interface UiSettings {
  theme: ThemeMode;
  /** 面板界面语言；auto 跟随浏览器 */
  language: Language;
  hotkey: string;
  collapsed: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 设置页板块展开状态（板块 key → 是否展开） */
  sectionStates: Record<string, boolean>;
}

export interface AdvancedSettings {
  debug: boolean;
  logLevel: "info" | "debug";
  selectorProfile: "auto" | "chaoxing";
  /** 用户自定义的通用适配器配置 */
  genericConfig?: GenericAdapterConfig;
}

export interface GenericAdapterConfig {
  name: string;
  matches: string[];
  questionContainer: string;
  stem: string;
  options: string;
  optionText?: string;
  typeLabel?: string;
  nextButton?: string;
  submitButton?: string;
}

export interface Settings {
  version: 1;
  ui: UiSettings;
  autoTurn: AutoTurnSettings;
  video: VideoSettings;
  solving: SolvingSettings;
  ai: AiSettings;
  bank: BankSettings;
  advanced: AdvancedSettings;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};

export const SETTINGS_KEY = "study-helper.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  ui: {
    theme: "auto",
    language: "auto",
    hotkey: "Alt+Shift+S",
    collapsed: true,
    x: -1,
    y: 120,
    width: 408,
    height: 620,
    sectionStates: {},
  },
  autoTurn: {
    enabled: false,
    waitVideoEnd: true,
    minDelayMs: 2000,
    maxDelayMs: 5000,
    maxSteps: 200,
    stopOnUnanswered: true,
    startDelayMs: 1500,
    resumeOnReload: true,
    contentWaitMs: 3000,
    readingAuto: true,
  },
  video: {
    defaultMuted: true,
    playbackRate: 1,
    resumeOnPause: true,
  },
  solving: {
    mode: "review",
    autoSubmit: false,
    allowExam: false,
    minConfidence: 0.6,
    batchSize: 6,
    fillDelayMs: [120, 320],
    autoFillOnScan: false,
    includeTypes: {
      single: true,
      multiple: true,
      judge: true,
      fill: true,
      short: false,
    },
  },
  ai: {
    enabled: false,
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-chat",
    temperature: 0,
    timeoutMs: 60000,
    maxRetries: 2,
    jsonMode: "auto",
    maxBatch: 6,
  },
  bank: {
    fuzzyThreshold: 0.86,
    maxEntries: 50000,
    cacheTtlDays: 30,
    remote: {
      enabled: false,
      url: "",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      bodyTemplate:
        '{"question":"{{question}}","type":"{{type}}","options":{{options}}}',
      answerPath: "answer",
      confidencePath: "confidence",
    },
  },
  advanced: {
    debug: false,
    logLevel: "info",
    selectorProfile: "auto",
  },
};

export const PAGE_KIND_LABEL: Record<PageKind, string> = {
  chapter: "章节学习",
  cards: "知识卡片",
  video: "视频",
  homework: "作业",
  exam: "考试",
  quiz: "章节测验",
  unknown: "未识别页面",
};

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  single: "单选题",
  multiple: "多选题",
  judge: "判断题",
  fill: "填空题",
  short: "简答题",
  unknown: "未知题型",
};

export type AiPresetId = "deepseek" | "openai" | "siliconflow" | "custom";

export const AI_PRESETS: Array<{ id: AiPresetId; baseUrl: string; model: string }> = [
  { id: "deepseek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { id: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "siliconflow", baseUrl: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3" },
  { id: "custom", baseUrl: "", model: "" },
];

export const VIDEO_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;
