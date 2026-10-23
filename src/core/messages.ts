import type { AnswerValue, FillResult, MediaState, PageKind, Question, SubmitResult } from "./types";

export const MSG_MARK = "study-helper";
export const MSG_VERSION = 1;

interface BaseMessage {
  sh: typeof MSG_MARK;
  v: typeof MSG_VERSION;
}

export type FrameMessage =
  | (BaseMessage & {
      t: "HELLO";
      frameId: string;
      url: string;
      title: string;
      pageKind: PageKind;
      /** 一次性随机数，由 Host 在 WELCOME 回显，避免任意父页面冒充 Host */
      nonce: string;
    })
  | (BaseMessage & { t: "WELCOME"; token: string; nonce: string })
  | (BaseMessage & {
      t: "STATE";
      token: string;
      frameId: string;
      url: string;
      pageKind: PageKind;
    })
  | (BaseMessage & {
      t: "QUESTIONS";
      token: string;
      frameId: string;
      pageKind: PageKind;
      questions: Question[];
    })
  | (BaseMessage & {
      t: "FILL";
      token: string;
      answers: Array<{ questionId: string; answer: AnswerValue }>;
      delayMs?: [number, number];
    })
  | (BaseMessage & { t: "FILLED"; token: string; frameId: string; results: FillResult[] })
  | (BaseMessage & { t: "SUBMIT"; token: string; autoConfirm?: boolean })
  | (BaseMessage & { t: "SUBMIT_RESULT"; token: string; frameId: string; result: SubmitResult })
  | (BaseMessage & { t: "MEDIA_STATE"; token: string; frameId: string; state: MediaState })
  | (BaseMessage & { t: "RESUME_MEDIA"; token: string })
  | (BaseMessage & { t: "PAUSE_MEDIA"; token: string })
  | (BaseMessage & { t: "GUARD_START"; token: string })
  | (BaseMessage & { t: "GUARD_STOP"; token: string })
  | (BaseMessage & {
      t: "GUARD_NOTICE";
      token: string;
      frameId: string;
      level: "info" | "warn";
      message: string;
    })
  | (BaseMessage & { t: "NEXT"; token: string })
  | (BaseMessage & { t: "COLLECT"; token: string })
  | (BaseMessage & { t: "PING"; token: string })
  | (BaseMessage & { t: "PONG"; token: string });

/**
 * 分布式 Omit：直接 `Omit<联合类型, K>` 会退化成公共字段（只剩 t），
 * 导致 createMessage 缺少字段也能编译通过。
 */
type DistributedOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type FramePayload = DistributedOmit<FrameMessage, "sh" | "v">;

export function createMessage<T extends FramePayload>(message: T): FrameMessage {
  return { ...message, sh: MSG_MARK, v: MSG_VERSION } as unknown as FrameMessage;
}

export function isFrameMessage(data: unknown): data is FrameMessage {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return record.sh === MSG_MARK && record.v === MSG_VERSION && typeof record.t === "string";
}

const MAX_ITEMS = 500;
/**
 * 跨 frame 文本上限。不能卡在 4000：题干/选项偶尔会超过 4000 字符，
 * 整条 QUESTIONS 被拒绝会让题目静默消失；这里放宽到 20k，仍保留基本防滥用上限。
 */
const MAX_TEXT_LENGTH = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_TEXT_LENGTH;
}

/**
 * 按消息类型做基础载荷校验。
 *
 * 只校验跨 frame 边界必须可信的字段与长度，避免任意页面伪造 HELLO/题目/媒体状态，
 * 也避免把超大 payload 传进渲染路径。校验失败返回 null，调用方直接忽略。
 */
export function validateFrameMessage(data: unknown): FrameMessage | null {
  if (!isFrameMessage(data)) return null;
  const message = data as unknown as Record<string, unknown>;
  const t = message.t;

  switch (t) {
    case "HELLO":
      if (
        !isString(message.frameId) ||
        !isString(message.url) ||
        !isString(message.title) ||
        !isString(message.nonce) ||
        !isString(message.pageKind)
      ) {
        return null;
      }
      return data;
    case "WELCOME":
      return isString(message.token) && isString(message.nonce) ? data : null;
    case "STATE":
      return ["token", "frameId", "url", "pageKind"].every((key) => isString(message[key]))
        ? data
        : null;
    case "QUESTIONS":
      if (
        !isString(message.token) ||
        !isString(message.frameId) ||
        !isString(message.pageKind) ||
        !Array.isArray(message.questions) ||
        message.questions.length > MAX_ITEMS
      ) {
        return null;
      }
      return message.questions.every(
        (question) =>
          isRecord(question) &&
          isString(question.id) &&
          isString(question.type) &&
          isString(question.stem) &&
          Array.isArray(question.options),
      )
        ? data
        : null;
    case "FILL":
      if (!isString(message.token) || !Array.isArray(message.answers)) return null;
      if (message.answers.length > MAX_ITEMS) return null;
      return message.answers.every(
        (answer) => isRecord(answer) && isString(answer.questionId) && "answer" in answer,
      )
        ? data
        : null;
    case "FILLED":
      return isString(message.token) &&
        isString(message.frameId) &&
        Array.isArray(message.results)
        ? data
        : null;
    case "SUBMIT":
      return isString(message.token) ? data : null;
    case "SUBMIT_RESULT":
      return isString(message.token) &&
        isString(message.frameId) &&
        isRecord(message.result)
        ? data
        : null;
    case "MEDIA_STATE": {
      const state = message.state;
      if (!isString(message.token) || !isString(message.frameId) || !isRecord(state)) {
        return null;
      }
      return typeof state.hasMedia === "boolean" &&
        typeof state.allEnded === "boolean" &&
        typeof state.anyPaused === "boolean"
        ? data
        : null;
    }
    case "GUARD_NOTICE":
      return isString(message.token) &&
        isString(message.frameId) &&
        isString(message.message) &&
        (message.level === "info" || message.level === "warn")
        ? data
        : null;
    case "RESUME_MEDIA":
    case "PAUSE_MEDIA":
    case "GUARD_START":
    case "GUARD_STOP":
    case "NEXT":
    case "COLLECT":
    case "PING":
    case "PONG":
      return isString(message.token) ? data : null;
    default:
      return null;
  }
}

export function createToken(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sendToParent(message: FrameMessage): void {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, "*");
  }
}

export function sendToWindow(target: Window, message: FrameMessage): void {
  try {
    target.postMessage(message, "*");
  } catch {
    /* ignore */
  }
}

export function isTrustedOrigin(origin: string, allowOrigins: readonly string[] = []): boolean {
  if (origin === "null") return false;
  try {
    const host = new URL(origin).hostname;
    if (allowOrigins.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      return true;
    }
    return host.endsWith(".chaoxing.com") || host.endsWith(".edu.cn");
  } catch {
    return false;
  }
}
