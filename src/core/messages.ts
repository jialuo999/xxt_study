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
    })
  | (BaseMessage & { t: "WELCOME"; token: string })
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
  | (BaseMessage & { t: "NEXT"; token: string })
  | (BaseMessage & { t: "COLLECT"; token: string })
  | (BaseMessage & { t: "PING"; token: string })
  | (BaseMessage & { t: "PONG"; token: string });

export function createMessage<T extends Omit<FrameMessage, "sh" | "v">>(message: T): FrameMessage {
  return { ...message, sh: MSG_MARK, v: MSG_VERSION } as unknown as FrameMessage;
}

export function isFrameMessage(data: unknown): data is FrameMessage {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return record.sh === MSG_MARK && record.v === MSG_VERSION && typeof record.t === "string";
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
