/** 题型 */
export type QuestionType = "single" | "multiple" | "judge" | "fill" | "short" | "unknown";

/** 页面类型 */
export type PageKind =
  | "chapter"
  | "cards"
  | "video"
  | "homework"
  | "exam"
  | "quiz"
  | "unknown";

/** 选项 */
export interface Option {
  /** 选项字母（A/B/C...），没有字母时使用序号 */
  key: string;
  text: string;
}

/** 从页面采集到的题目 */
export interface Question {
  id: string;
  type: QuestionType;
  stem: string;
  options: Option[];
  /** 填空题的空数 */
  blankCount?: number;
  /** 题干或选项含图片，纯文本 AI 无法可靠作答 */
  hasImage: boolean;
  /** 所在 frame 的标识 */
  frameId: string;
  /** 在当前 frame 内的顺序 */
  index: number;
}

/** 统一答案表示 */
export type AnswerValue =
  | { kind: "choice"; keys: string[]; texts?: string[] }
  | { kind: "judge"; value: boolean }
  | { kind: "fill"; values: string[] }
  | { kind: "text"; text: string };

/** 答案来源 */
export type SolveSource = "bank-exact" | "bank-fuzzy" | "remote" | "ai" | "manual";

/** 解题状态 */
export type SolveStatus = "solved" | "pending" | "failed";

export interface SolveResult {
  questionId: string;
  answer: AnswerValue | null;
  confidence: number;
  source: SolveSource;
  status: SolveStatus;
  explanation?: string;
  latencyMs: number;
  costTokens?: number;
}

/** 任务点类型（来自学习通 attachments.property.module / DOM 兜底） */
export type TaskPointKind = "media" | "read" | "doc" | "ppt" | "quiz" | "link" | "unknown";

/** 学习通任务点快照（用于跨 frame 跳过已完成任务） */
export interface TaskPointInfo {
  /** 从 0 开始的 DOM 顺序 */
  index: number;
  finished: boolean;
  /** 任务点 iframe 的绝对 URL；阅读类任务可能没有 */
  url?: string;
  /** 任务点 id（学习通 jobid / _jobid） */
  jobid?: string;
  /** 任务点类型；用于区分视频、阅读、文档、PPT 等 */
  kind?: TaskPointKind;
  /** 任务点名称（来自 attachments.property.name） */
  name?: string;
}

/** 媒体播放状态（跨 frame 汇总用） */
export interface MediaState {
  hasMedia: boolean;
  allEnded: boolean;
  anyPaused: boolean;
  /** 上报时所在 frame 的章节 id 快照（用于过滤上一章节的残留状态） */
  chapterId?: string;
  /** 当前任务点是否已完成（学习通 .ans-job-finished） */
  currentTaskFinished?: boolean;
  /** 当前页所有任务点是否都已完成 */
  allTasksFinished?: boolean;
  /** 按 DOM 顺序看到的第一个未完成任务点的 iframe URL（内容 frame 上报） */
  nextTaskUrl?: string;
  /** 第一个未完成任务点的序号（从 0 开始） */
  nextTaskIndex?: number;
  /** 第一个未完成任务点的 jobid（阅读/文档任务可能没有 iframe） */
  nextTaskId?: string;
  /** 第一个未完成任务点的类型 */
  nextTaskKind?: TaskPointKind;
  /** 第一个未完成任务点的名称 */
  nextTaskName?: string;
  /** 当前页任务点总数 */
  taskTotal?: number;
  /** 全部任务点快照；没有 nextTaskUrl 时也能判断哪些 iframe 已完成 */
  tasks?: TaskPointInfo[];
}

/** 页面信息 */
export interface PageInfo {
  kind: PageKind;
  url: string;
  title: string;
  /** 仅子 frame 有值 */
  frameId?: string;
  /** 是否受支持的页面 */
  supported: boolean;
  /** 页面特征说明，便于排查 */
  reason?: string;
}

/** 填答结果 */
export interface FillResult {
  questionId: string;
  ok: boolean;
  expected?: string;
  actual?: string;
  message?: string;
}

/** 提交结果 */
export interface SubmitResult {
  ok: boolean;
  message: string;
  score?: string;
  url?: string;
}

/** 翻页结果 */
export interface NextResult {
  ok: boolean;
  action: string;
  message: string;
  url?: string;
}

/** 本地题库条目 */
export interface BankEntry {
  id: string;
  hash: string;
  type: QuestionType;
  stem: string;
  options?: string[];
  answer: AnswerValue;
  source: string;
  updatedAt: number;
}

/** 远程题库返回 */
export interface RemoteAnswer {
  answer: AnswerValue | null;
  confidence: number;
  raw?: unknown;
}

/** AI 单题原始返回 */
export interface AiAnswerItem {
  id: string;
  answer: string[] | string | boolean | null;
  confidence?: number;
  explanation?: string;
}
