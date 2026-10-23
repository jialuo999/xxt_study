import type {
  BankEntry,
  PageInfo,
  Question,
  SolveResult,
  SubmitResult,
} from "@/core/types";
import type { DeepPartial, Settings } from "@/core/settings";
import type { LogEntry } from "@/core/logger";

export type HostStatus =
  | "idle"
  | "scanning"
  | "solving"
  | "filling"
  | "submitting"
  | "error";

export interface FrameSummary {
  frameId: string;
  url: string;
  title: string;
  pageKind: PageInfo["kind"];
  questionCount: number;
  isTop: boolean;
}

export interface AutoTurnView {
  running: boolean;
  steps: number;
  maxSteps: number;
  message: string;
  nextAt: number | null;
}

export interface BankStatsView {
  total: number;
  lastUpdated: number | null;
  /** 当前题库存储后端；memory 表示 IndexedDB 不可用，刷新会丢失 */
  storage: "indexeddb" | "memory";
  indexedDbAvailable: boolean;
}

export interface ImportResultView {
  added: number;
  skipped: number;
  failed: number;
  message: string;
}

export interface AiTestView {
  ok: boolean;
  message: string;
  latencyMs?: number;
  model?: string;
}

/** 平台人机验证（学习通【9010】）状态；只用于提示，不自动处理验证码 */
export interface VerificationView {
  detected: boolean;
  message: string;
}

export interface ToastView {
  id: number;
  kind: "info" | "success" | "warn" | "error";
  text: string;
}

export interface UiState {
  ready: boolean;
  page: PageInfo;
  verification: VerificationView;
  frames: FrameSummary[];
  questions: Question[];
  results: Record<string, SolveResult>;
  status: HostStatus;
  statusText: string;
  progress: { done: number; total: number } | null;
  /** 已成功填入页面的题目 id（提交前覆盖率校验用） */
  filledQuestionIds: string[];
  autoTurn: AutoTurnView;
  bank: BankStatsView;
  settings: Settings;
  logs: readonly LogEntry[];
  lastSubmit: SubmitResult | null;
  toast: ToastView | null;
  noticeAccepted: boolean;
}

export interface UiController {
  readonly state: UiState;
  subscribe(listener: (state: UiState) => void): () => void;
  init(): Promise<void>;
  refresh(): Promise<void>;
  solve(): Promise<void>;
  fillAll(questionIds?: string[]): Promise<boolean>;
  submit(): Promise<void>;
  /** 生成并复制脱敏诊断包；成功返回 true */
  copyDiagnostics(): Promise<boolean>;
  startAutoTurn(): void;
  stopAutoTurn(): void;
  importBankFile(file: File): Promise<ImportResultView>;
  clearBank(): Promise<void>;
  searchBank(query: string): Promise<BankEntry[]>;
  exportBank(): Promise<string>;
  testAi(): Promise<AiTestView>;
  saveSettings(patch: DeepPartial<Settings>): void;
  resetSettings(): void;
  clearLogs(): void;
  exportLogs(): string;
  acceptNotice(): void;
  setCollapsed(collapsed: boolean): void;
  togglePanel(): void;
}
