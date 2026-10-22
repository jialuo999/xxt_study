/**
 * 学习通（Chaoxing）平台适配器入口。
 *
 * 选择器思路参考 https://github.com/CodFrm/cxmooc-tools （MIT License），
 * 本项目为独立实现，未复制其源码；所有 DOM 访问都判空并包在 try/catch 中，
 * 识别失败时返回 unknown / supported:false，而不是抛异常。
 */
import type { PageInfo, PageKind, Question } from "../../core/types";
import type { PageContext, PlatformAdapter, SubmitOptions } from "../types";
import { queryFirst } from "../../utils/dom";
import { collectQuestionEntries, collectQuestions } from "./question";
import { fillAnswer } from "./fill";
import { submitAnswers } from "./submit";
import { nextPage } from "./next";
import { observePage } from "./observe";
import { waitForVideoEnd } from "./video";
import {
  CARDS_MARKERS,
  CHAIXING_HOST_SUFFIX,
  CHAPTER_IFRAME_SELECTORS,
  CHAPTER_MARKERS,
  QUIZ_TITLE_PATTERN,
  QUIZ_URL_PATTERN,
  QUESTION_CONTAINER_SELECTOR,
  QUESTION_CONTAINER_SELECTORS,
  ROUTE_RULES,
  VIDEO_SELECTORS,
} from "./selectors";

const KIND_SUPPORTED: Record<PageKind, boolean> = {
  chapter: true,
  cards: true,
  video: true,
  homework: true,
  exam: true,
  quiz: true,
  unknown: false,
};

function safeTitle(doc: Document): string {
  try {
    return doc.title ?? "";
  } catch {
    return "";
  }
}

function safeCurrentHref(doc: Document): string {
  try {
    return doc.location?.href ?? doc.URL ?? "";
  } catch {
    return "";
  }
}

function resolveUrl(doc: Document, url?: URL): URL | null {
  if (url) return url;
  try {
    const href = safeCurrentHref(doc);
    return href ? new URL(href) : null;
  } catch {
    return null;
  }
}

function hasQuestionContainers(doc: Document): boolean {
  try {
    return Boolean(
      queryFirst(doc, [QUESTION_CONTAINER_SELECTOR]) ||
        queryFirst(doc, [...QUESTION_CONTAINER_SELECTORS]),
    );
  } catch {
    return false;
  }
}

function isSubFrame(doc: Document): boolean {
  try {
    const win = doc.defaultView;
    return Boolean(win && win.top && win.top !== win);
  } catch {
    // 跨域访问 window.top 会抛错，说明当前是子 frame
    return true;
  }
}

function pageInfo(doc: Document, kind: PageKind, url: URL | null, reason: string): PageInfo {
  const isSub = isSubFrame(doc);
  const info: PageInfo = {
    kind,
    url: url?.href ?? safeCurrentHref(doc),
    title: safeTitle(doc),
    supported: KIND_SUPPORTED[kind],
    reason,
  };
  if (isSub) info.frameId = "sub";
  return info;
}

function pathOf(url: URL | null): string {
  if (!url) return "";
  try {
    return `${url.pathname}${url.search}`;
  } catch {
    return "";
  }
}

/** 按 URL 路由与 DOM 标记判定学习通页面类型 */
export function detectPage(doc: Document, url?: URL): PageInfo {
  try {
    const resolved = resolveUrl(doc, url);
    const path = pathOf(resolved);
    const title = safeTitle(doc);
    const hasQuestions = hasQuestionContainers(doc);

    for (const rule of ROUTE_RULES) {
      // 作业路由与章节测验路由重叠，留到标题判断之后再判定
      if (rule.kind === "homework") continue;
      if (rule.pattern.test(path)) return pageInfo(doc, rule.kind, resolved, rule.reason);
    }

    // 章节测验在 URL 上常复用作业路由，必须用标题/路径特征先判断
    if (QUIZ_URL_PATTERN.test(path) || QUIZ_TITLE_PATTERN.test(title)) {
      return pageInfo(doc, "quiz", resolved, "标题/路径命中章节测验特征");
    }

    const homeworkRule = ROUTE_RULES.find((rule) => rule.kind === "homework");
    if (homeworkRule && homeworkRule.pattern.test(path)) {
      return pageInfo(doc, "homework", resolved, homeworkRule.reason);
    }

    if (hasQuestions && /考试/.test(title)) {
      return pageInfo(doc, "exam", resolved, "DOM 检测到题目且标题含“考试”");
    }

    // DOM 兜底：视频 / 卡片 / 章节
    if (!hasQuestions) {
      if (queryFirst(doc, [...VIDEO_SELECTORS])) {
        return pageInfo(doc, "video", resolved, "DOM 检测到 video 播放器");
      }
      if (queryFirst(doc, [...CARDS_MARKERS])) {
        return pageInfo(doc, "cards", resolved, "DOM 检测到知识卡片标记");
      }
      if (
        queryFirst(doc, [...CHAPTER_MARKERS]) ||
        queryFirst(doc, [...CHAPTER_IFRAME_SELECTORS])
      ) {
        return pageInfo(doc, "chapter", resolved, "DOM 检测到章节导航/iframe");
      }
    }

    if (hasQuestions) {
      return pageInfo(doc, "homework", resolved, "DOM 检测到题目容器，按作业/测验处理");
    }

    return pageInfo(doc, "unknown", resolved, "未匹配学习通页面特征（URL/DOM 均未命中）");
  } catch {
    try {
      return {
        kind: "unknown",
        url: safeCurrentHref(doc),
        title: "",
        supported: false,
        reason: "页面识别异常",
      };
    } catch {
      return { kind: "unknown", url: "", title: "", supported: false, reason: "页面识别异常" };
    }
  }
}

function matches(url: URL): boolean {
  try {
    const host = url.hostname.toLowerCase();
    return host === CHAIXING_HOST_SUFFIX || host.endsWith(`.${CHAIXING_HOST_SUFFIX}`);
  } catch {
    return false;
  }
}

export const chaoxingAdapter: PlatformAdapter = {
  id: "chaoxing",
  label: "学习通",
  matches,
  detectPage,
  collectQuestions(ctx: PageContext): Question[] {
    return collectQuestions(ctx.doc, ctx.frameId);
  },
  fillAnswer,
  submit: (ctx: PageContext, options?: SubmitOptions) => submitAnswers(ctx, options),
  nextPage: (ctx: PageContext) => nextPage(ctx),
  observe: (ctx: PageContext, callback: () => void) => observePage(ctx, callback),
};

export { collectQuestionEntries, waitForVideoEnd };
export type { PageContext, PlatformAdapter };
