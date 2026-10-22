import type {
  AnswerValue,
  FillResult,
  NextResult,
  PageInfo,
  Question,
  SubmitResult,
} from "@/core/types";

export interface PageContext {
  doc: Document;
  win: Window;
  url: URL;
  page: PageInfo;
  frameId: string;
}

export interface FillOptions {
  delayMs?: [number, number];
  dryRun?: boolean;
}

export interface SubmitOptions {
  autoConfirm?: boolean;
}

export interface PlatformAdapter {
  id: string;
  label: string;
  matches(url: URL): boolean;
  detectPage(doc: Document, url?: URL): PageInfo;
  collectQuestions(ctx: PageContext): Question[];
  fillAnswer(
    ctx: PageContext,
    question: Question,
    answer: AnswerValue,
    options?: FillOptions,
  ): Promise<FillResult>;
  submit?(ctx: PageContext, options?: SubmitOptions): Promise<SubmitResult>;
  nextPage?(ctx: PageContext): Promise<NextResult>;
  observe?(ctx: PageContext, callback: () => void): () => void;
}
