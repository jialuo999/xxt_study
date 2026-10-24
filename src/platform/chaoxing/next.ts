/**
 * 学习通下一节：章节 / 卡片 / 答题分页的“下一节”探测。
 *
 * 选择器思路参考 https://github.com/CodFrm/cxmooc-tools （MIT License），
 * 本项目为独立实现，未复制其源码。
 *
 * 约定：只点击一次，不循环、不延迟；是否继续翻页由上层（auto-turn）决定。
 */
import type { NextResult } from "../../core/types";
import type { PageContext } from "../types";
import { clickElement, queryAll, queryFirst, textOf } from "../../utils/dom";
import { NEXT_SELECTORS, NEXT_TEXT_KEYWORDS } from "./selectors";
import { findNextPendingChapter, readCourseCatalog } from "./catalog";

const MAX_NEXT_TEXT_LENGTH = 12;

/** 已经点击过但没有产生页面变化的元素，重试时跳过（10 秒后允许再次尝试） */
const attemptedNext = new WeakMap<HTMLElement, number>();
const ATTEMPT_TTL_MS = 10000;

function wasAttempted(element: HTMLElement): boolean {
  const at = attemptedNext.get(element);
  return at !== undefined && Date.now() - at < ATTEMPT_TTL_MS;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function currentUrl(ctx: PageContext): string {
  try {
    return ctx.win.location?.href ?? ctx.doc.URL ?? "";
  } catch {
    return "";
  }
}

function isActionable(element: HTMLElement): boolean {
  try {
    if (element.hasAttribute("disabled")) return false;
    if (element.getAttribute("aria-disabled") === "true") return false;
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    return true;
  } catch {
    return false;
  }
}

/** 只考虑自身文本就是“下一节”的叶子节点，避免点到把整页包起来的容器 */
function isLeafText(element: HTMLElement): boolean {
  for (const child of Array.from(element.children)) {
    if (textOf(child).replace(/\s+/g, "").length > 0) return false;
  }
  return true;
}

function clickAndReport(
  ctx: PageContext,
  element: HTMLElement,
  action: string,
  label: string,
): NextResult | null {
  if (wasAttempted(element)) return null;
  if (!clickElement(element)) return null;
  attemptedNext.set(element, Date.now());
  return {
    ok: true,
    action,
    message: `已点击「${label}」`,
    url: currentUrl(ctx),
  };
}

export async function nextPage(ctx: PageContext): Promise<NextResult> {
  try {
    // 优先走章节树：直接跳到当前章节之后第一个“未完成且有待完成任务点”的章节，
    // 跳过整章已完成/无待完成的章节；点击仍交给原生 getTeacherAjax。
    const nextChapter = findNextPendingChapter(ctx.doc);
    if (nextChapter) {
      const result = clickAndReport(
        ctx,
        nextChapter.target,
        `catalog:${nextChapter.chapterId}`,
        nextChapter.title,
      );
      if (result) return result;
    } else if (readCourseCatalog(ctx.doc).length > 0) {
      return {
        ok: false,
        action: "catalog-end",
        message: "章节目录中没有待完成的章节",
        url: currentUrl(ctx),
      };
    }

    for (const selector of NEXT_SELECTORS) {
      const element = queryFirst<HTMLElement>(ctx.doc, [selector]);
      if (!element || !isActionable(element) || wasAttempted(element)) continue;
      const label = textOf(element).replace(/\s+/g, "") || selector;
      const result = clickAndReport(ctx, element, `click:${selector}`, label);
      if (result) return result;
    }

    const candidates = queryAll<HTMLElement>(ctx.doc, ["a", "button", "span", "i", "div", "li"]);
    for (const element of candidates) {
      if (wasAttempted(element)) continue;
      // 先用 textContent 做低成本预筛，避免对页面里数千个导航节点逐个读取 innerText（触发布局）。
      const rawText = (element.textContent ?? "").replace(/\s+/g, "");
      if (!rawText || rawText.length > MAX_NEXT_TEXT_LENGTH) continue;
      if (!NEXT_TEXT_KEYWORDS.some((keyword) => rawText === keyword || rawText.includes(keyword))) {
        continue;
      }
      const text = textOf(element).replace(/\s+/g, "");
      if (!text || text.length > MAX_NEXT_TEXT_LENGTH) continue;
      if (!NEXT_TEXT_KEYWORDS.some((keyword) => text === keyword || text.includes(keyword))) continue;
      if (!isLeafText(element) || !isActionable(element)) continue;
      const result = clickAndReport(ctx, element, `text:${text}`, text);
      if (result) return result;
    }

    return {
      ok: false,
      action: "none",
      message: "未找到「下一节/下一章/下一页/下一题」按钮",
      url: currentUrl(ctx),
    };
  } catch (error) {
    return {
      ok: false,
      action: "none",
      message: `翻页异常：${errorText(error)}`,
      url: currentUrl(ctx),
    };
  }
}
