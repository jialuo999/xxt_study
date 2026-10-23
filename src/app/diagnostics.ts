/**
 * 结构化脱敏诊断包（设计文档 3.4 / P12）。
 *
 * 目标：把“页面识别结果 + 选择器命中矩阵 + 状态快照 + 脱敏设置/日志”打包成
 * 一份 JSON，用户点击“复制诊断包”即可贴给开发者排查真实页面差异，替代纯文本
 * 日志和凭猜测改选择器。
 *
 * 脱敏是硬要求（用户主动点击才生成，但仍可能被转发）：
 * - `settings.ai.apiKey` → `"已设置"` / `"未设置"`；
 * - `settings.bank.remote.headers` 的所有值 → `"<redacted>"`（保留 header 名）；
 * - `settings.bank.remote.url` → 只保留 origin + pathname（去掉 query/hash）；
 * - 报告 `url` / frame URL / `media.nextTaskUrl` → 只保留 pathname + 白名单参数；
 * - 日志只保留最近 {@link DIAGNOSTICS_MAX_LOGS} 条，导出前对 message/data 再过
 *   一遍 `redact()`（logger 入库时已脱敏，这里是二次兜底）；
 * - 题目只给统计与样本：最多 {@link DIAGNOSTICS_MAX_SAMPLES} 条、题干截断
 *   {@link DIAGNOSTICS_MAX_STEM} 字、不含答案文本。
 *
 * 本模块是纯函数集合（只读 DOM doc，不监听、不写存储），便于单测。
 */
import type { MediaState, PageInfo, Question, QuestionType } from "@/core/types";
import type { Settings } from "@/core/settings";
import { redact } from "@/core/logger";
import type { LogEntry } from "@/core/logger";
import type { AutoTurnView, FrameSummary } from "@/ui/contract";
import {
  BLANK_SELECTORS,
  CARDS_MARKERS,
  CHAPTER_IFRAME_SELECTORS,
  CHAPTER_MARKERS,
  NEXT_SELECTORS,
  OPTION_INPUT_SELECTORS,
  OPTION_SELECTORS,
  QUESTION_CONTAINER_SELECTOR,
  STEM_SELECTORS,
  SUBMIT_BUTTON_SELECTORS,
  TEXT_INPUT_SELECTORS,
  TITLE_SELECTORS,
  TYPE_LABEL_SELECTORS,
  VIDEO_SELECTORS,
} from "@/platform/chaoxing/selectors";

/**
 * 构建版本号由 vite `define` 注入（`vite.config.ts` 从 package.json 读取，
 * 单一来源）。这里只做类型声明：模块作用域声明不会与 `src/env.d.ts` 的全局
 * 声明冲突；运行时用 `typeof` 守卫，未注入时回退 `"dev"`，单测也可显式传参。
 */
declare const __APP_VERSION__: string;

/** 诊断包内日志条数上限 */
export const DIAGNOSTICS_MAX_LOGS = 100;

/** 诊断包内题目样本条数上限 */
export const DIAGNOSTICS_MAX_SAMPLES = 10;

/** 诊断包内题干截断长度（含省略号） */
export const DIAGNOSTICS_MAX_STEM = 40;

/** URL 中允许保留的查询参数（小写 → 报告中的规范写法） */
const URL_PARAM_WHITELIST: Readonly<Record<string, string>> = {
  courseid: "courseId",
  clazzid: "clazzid",
  chapterid: "chapterId",
  knowledgeid: "knowledgeId",
  jobid: "jobid",
  objectid: "objectId",
};

/** 选择器命中矩阵中的一行 */
export interface SelectorHit {
  /** 选择器所属分组（多个候选时带 `#序号`） */
  name: string;
  selector: string;
  /** 命中的元素数量；选择器非法/DOM 不可用时为 0 */
  hits: number;
}

/** 页面识别摘要 */
export interface DiagnosticsPage {
  kind: PageInfo["kind"];
  supported: boolean;
  reason: string;
}

/** 题目样本（不含答案） */
export interface QuestionSample {
  type: QuestionType;
  stem: string;
  options: number;
}

/** 题目统计 */
export interface DiagnosticsQuestions {
  total: number;
  byType: Partial<Record<QuestionType, number>>;
  withImage: number;
  samples: QuestionSample[];
}

/** 多标签锁状态；`holder` 表示本页当前是否持有锁 */
export interface DiagnosticsTabLock {
  holder: boolean;
  heartbeatAt: number | null;
}

/** 构建输入：由 Host 从当前状态快照拼装 */
export interface DiagnosticsInput {
  page: PageInfo;
  frames: FrameSummary[];
  questions: Question[];
  settings: Settings;
  logs: readonly LogEntry[];
  media: MediaState | null;
  autoTurn: AutoTurnView;
  verification: { detected: boolean; message: string };
  tabLock?: DiagnosticsTabLock;
}

/** 输出报告（字段见设计文档 3.4；`verification` 为补充字段） */
export interface DiagnosticsReport {
  scriptVersion: string;
  generatedAt: string;
  userAgent: string;
  /** 只保留 pathname + 白名单参数 */
  url: string;
  page: DiagnosticsPage;
  frames: FrameSummary[];
  questions: DiagnosticsQuestions;
  selectors: SelectorHit[];
  media: MediaState | null;
  autoTurn: AutoTurnView;
  tabLock: DiagnosticsTabLock;
  verification: { detected: boolean; message: string };
  /** 脱敏后的设置快照（apiKey/headers/URL query 已处理） */
  settings: unknown;
  /** 最近 100 条日志，message/data 再次 redact */
  logs: LogEntry[];
}

interface SelectorGroup {
  name: string;
  selectors: readonly string[];
}

/** 复用 `platform/chaoxing/selectors.ts` 常量，避免诊断与采集逻辑漂移 */
const SELECTOR_GROUPS: readonly SelectorGroup[] = [
  { name: "题目容器", selectors: [QUESTION_CONTAINER_SELECTOR] },
  { name: "题干", selectors: STEM_SELECTORS },
  { name: "题型标签", selectors: TYPE_LABEL_SELECTORS },
  { name: "标题行", selectors: TITLE_SELECTORS },
  { name: "选项", selectors: OPTION_SELECTORS },
  { name: "选项输入", selectors: OPTION_INPUT_SELECTORS },
  { name: "填空输入", selectors: BLANK_SELECTORS },
  { name: "简答输入", selectors: TEXT_INPUT_SELECTORS },
  { name: "提交按钮", selectors: SUBMIT_BUTTON_SELECTORS },
  { name: "下一节", selectors: NEXT_SELECTORS },
  { name: "视频元素", selectors: VIDEO_SELECTORS },
  { name: "章节 iframe", selectors: CHAPTER_IFRAME_SELECTORS },
  { name: "知识卡片", selectors: CARDS_MARKERS },
  { name: "章节标记", selectors: CHAPTER_MARKERS },
];

function baseUrl(): string {
  try {
    if (typeof location !== "undefined" && location.href) return location.href;
  } catch {
    /* ignore */
  }
  return "https://chaoxing.com/";
}

/**
 * 把任意 URL 收敛为“pathname + 白名单参数”。
 *
 * 例：`https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1&clazzid=2&token=secret#x`
 * → `/mycourse/studentstudy?courseId=1&clazzid=2`。
 * URL 非法时退化为去掉 query/hash 的原始前缀（截断 200 字），不抛异常。
 */
export function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw, baseUrl());
    const params = new URLSearchParams();
    for (const [name, value] of url.searchParams) {
      const canonical = URL_PARAM_WHITELIST[name.toLowerCase()];
      if (canonical) params.append(canonical, value);
    }
    const search = params.toString();
    const path = url.pathname || "/";
    return search ? `${path}?${search}` : path;
  } catch {
    const cleaned = raw
      .split("#")[0]
      .split("?")[0]
      .trim();
    return cleaned.slice(0, 200);
  }
}

/** 只保留 origin + pathname（用于远程题库地址，去掉可能含 token 的 query/hash） */
function sanitizeEndpoint(raw: string): string {
  if (!raw) return "";
  try {
    const url = new URL(raw, baseUrl());
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw
      .split("#")[0]
      .split("?")[0]
      .trim()
      .slice(0, 200);
  }
}

/** 构造脱敏后的设置快照：JSON 深拷贝，避免修改调用方对象 */
export function redactSettings(settings: Settings): unknown {
  let copy: Record<string, unknown>;
  try {
    copy = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;
  } catch {
    return { error: "settings 序列化失败" };
  }
  if (!copy || typeof copy !== "object") return copy;

  const ai = asRecord(copy.ai);
  if (ai) ai.apiKey = typeof ai.apiKey === "string" && ai.apiKey.trim() ? "已设置" : "未设置";

  const remote = asRecord(asRecord(copy.bank)?.remote);
  if (remote) {
    const headers = asRecord(remote.headers);
    if (headers) {
      const masked: Record<string, string> = {};
      for (const name of Object.keys(headers)) masked[name] = "<redacted>";
      remote.headers = masked;
    }
    if (typeof remote.url === "string") remote.url = sanitizeEndpoint(remote.url);
  }

  return copy;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function truncateStem(stem: string): string {
  const normalized = stem.replace(/\s+/g, " ").trim();
  if (normalized.length <= DIAGNOSTICS_MAX_STEM) return normalized;
  return `${normalized.slice(0, DIAGNOSTICS_MAX_STEM - 1)}…`;
}

function summarizeQuestions(questions: readonly Question[]): DiagnosticsQuestions {
  const byType: Partial<Record<QuestionType, number>> = {};
  let withImage = 0;
  const samples: QuestionSample[] = [];
  for (const question of questions) {
    byType[question.type] = (byType[question.type] ?? 0) + 1;
    if (question.hasImage) withImage += 1;
    if (samples.length < DIAGNOSTICS_MAX_SAMPLES) {
      samples.push({
        type: question.type,
        stem: truncateStem(question.stem),
        options: question.options.length,
      });
    }
  }
  return { total: questions.length, byType, withImage, samples };
}

function countSelector(doc: Document, selector: string): number {
  try {
    return doc.querySelectorAll(selector).length;
  } catch {
    // 非法选择器 / doc 不可用时记 0，诊断本身不能因此失败
    return 0;
  }
}

/** 选择器命中矩阵：每个候选选择器单独 try/catch 计数，失败记 0 */
export function collectSelectorHits(doc: Document): SelectorHit[] {
  const rows: SelectorHit[] = [];
  for (const group of SELECTOR_GROUPS) {
    group.selectors.forEach((selector, index) => {
      rows.push({
        name: group.selectors.length > 1 ? `${group.name}#${index + 1}` : group.name,
        selector,
        hits: countSelector(doc, selector),
      });
    });
  }
  return rows;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (value instanceof Error) return redact(value.message);
  try {
    return JSON.parse(redact(JSON.stringify(value))) as unknown;
  } catch {
    return redact(String(value));
  }
}

function redactLogEntry(entry: LogEntry): LogEntry {
  const copy: LogEntry = {
    id: entry.id,
    ts: entry.ts,
    level: entry.level,
    scope: redact(entry.scope),
    message: redact(entry.message),
  };
  if (entry.data !== undefined) copy.data = redactValue(entry.data);
  return copy;
}

/** 日志只保留最近 N 条，并在导出前再脱敏一次 */
export function redactLogs(entries: readonly LogEntry[]): LogEntry[] {
  return entries.slice(-DIAGNOSTICS_MAX_LOGS).map(redactLogEntry);
}

function sanitizeFrames(frames: readonly FrameSummary[]): FrameSummary[] {
  return frames.map((frame) => ({
    frameId: frame.frameId,
    url: sanitizeUrl(frame.url),
    title: frame.title,
    pageKind: frame.pageKind,
    questionCount: frame.questionCount,
    isTop: frame.isTop,
  }));
}

function sanitizeMedia(media: MediaState | null): MediaState | null {
  if (!media) return null;
  const copy: MediaState = { ...media };
  if (typeof copy.nextTaskUrl === "string") copy.nextTaskUrl = sanitizeUrl(copy.nextTaskUrl);
  return copy;
}

function currentUserAgent(): string {
  try {
    return typeof navigator !== "undefined" ? navigator.userAgent : "";
  } catch {
    return "";
  }
}

/**
 * 构建诊断报告。
 *
 * @param input 状态快照（Host 负责从 UiState/媒体状态/锁状态拼装）
 * @param doc 用于选择器命中矩阵的文档，默认当前 document
 * @param version 脚本版本；默认取 vite 注入的 `__APP_VERSION__`，未注入时为 `"dev"`。
 *   单测显式传入，避免依赖全局注入。
 */
export function buildDiagnostics(
  input: DiagnosticsInput,
  doc: Document = document,
  version: string = typeof __APP_VERSION__ === "undefined" ? "dev" : __APP_VERSION__,
): DiagnosticsReport {
  return {
    scriptVersion: version,
    generatedAt: new Date().toISOString(),
    userAgent: currentUserAgent(),
    url: sanitizeUrl(input.page.url),
    page: {
      kind: input.page.kind,
      supported: input.page.supported,
      reason: input.page.reason ?? "",
    },
    frames: sanitizeFrames(input.frames),
    questions: summarizeQuestions(input.questions),
    selectors: collectSelectorHits(doc),
    media: sanitizeMedia(input.media),
    autoTurn: {
      running: input.autoTurn.running,
      steps: input.autoTurn.steps,
      maxSteps: input.autoTurn.maxSteps,
      message: input.autoTurn.message,
      nextAt: input.autoTurn.nextAt,
    },
    tabLock: {
      holder: Boolean(input.tabLock?.holder),
      heartbeatAt:
        typeof input.tabLock?.heartbeatAt === "number" && Number.isFinite(input.tabLock.heartbeatAt)
          ? input.tabLock.heartbeatAt
          : null,
    },
    verification: {
      detected: Boolean(input.verification.detected),
      message: String(input.verification.message ?? ""),
    },
    settings: redactSettings(input.settings),
    logs: redactLogs(input.logs),
  };
}

/** 序列化为可复制的 JSON 文本（2 空格缩进） */
export function formatDiagnostics(report: DiagnosticsReport): string {
  return JSON.stringify(report, null, 2);
}
