/**
 * 学习通提交：定位提交按钮 → 可选的 confirm 兜底 → 15 秒内检测结果。
 *
 * 选择器思路参考 https://github.com/CodFrm/cxmooc-tools （MIT License），
 * 本项目为独立实现，未复制其源码。
 *
 * 安全约束：
 * - 同一 document 只允许提交一次，绝不自动重复点击；
 * - autoConfirm 只在点击瞬间临时返回 true，finally 中恢复原 confirm；
 * - 点击后 15 秒内未检测到结果时返回 ok:false 并提示人工确认。
 */
import type { SubmitResult } from "../../core/types";
import type { PageContext, SubmitOptions } from "../types";
import { unsafeWindowRef } from "../../core/gm";
import { sleep } from "../../utils/async";
import { clickElement, queryAll, queryFirst, textOf } from "../../utils/dom";
import {
  RESULT_TEXT_KEYWORDS,
  SUBMIT_BUTTON_SELECTORS,
  SUBMIT_TEXT_KEYWORDS,
} from "./selectors";

const SUBMIT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 250;
const MAX_BUTTON_TEXT_LENGTH = 20;

/** 已经提交过的 document；避免 watch/自动流程在一次页面上重复交卷 */
const submittedDocuments = new WeakSet<Document>();

/** 页面跳转（SPA 换题）后允许重新提交：由调用方在需要时重置 */
export function resetSubmitGuard(doc?: Document): void {
  try {
    const target = doc ?? (typeof document === "undefined" ? null : document);
    if (target) submittedDocuments.delete(target);
  } catch {
    /* ignore */
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function currentUrl(ctx: PageContext): string {
  try {
    return ctx.win.location?.href ?? ctx.doc.URL ?? "";
  } catch {
    try {
      return ctx.doc.URL ?? "";
    } catch {
      return "";
    }
  }
}

/** URL 比较忽略 hash：页面里的 #anchor 跳转不代表提交成功 */
function comparableUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url;
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

/** 提交按钮候选：先按选择器，再按文本兜底 */
export function findSubmitButton(doc: Document): HTMLElement | null {
  for (const selector of SUBMIT_BUTTON_SELECTORS) {
    const element = queryFirst<HTMLElement>(doc, [selector]);
    if (element && isActionable(element)) return element;
  }

  const candidates = queryAll<HTMLElement>(doc, [
    "a",
    "button",
    "input[type='button']",
    "input[type='submit']",
    "[onclick]",
  ]);
  for (const element of candidates) {
    const text = `${textOf(element)}${element.getAttribute("value") ?? ""}`.replace(/\s+/g, "");
    if (!text || text.length > MAX_BUTTON_TEXT_LENGTH) continue;
    if (!SUBMIT_TEXT_KEYWORDS.some((keyword) => text === keyword || text.includes(keyword))) continue;
    if (!isActionable(element)) continue;
    return element;
  }
  return null;
}

interface ConfirmPatch {
  clicked: boolean;
}

function clickSubmitButton(ctx: PageContext, button: HTMLElement, autoConfirm: boolean): ConfirmPatch {
  const windows: Window[] = [];
  const saved: Array<{ win: Window; confirm: Window["confirm"] }> = [];

  try {
    windows.push(unsafeWindowRef());
  } catch {
    /* ignore */
  }
  try {
    if (!windows.includes(ctx.win)) windows.push(ctx.win);
  } catch {
    /* ignore */
  }

  try {
    if (autoConfirm) {
      for (const win of windows) {
        try {
          saved.push({ win, confirm: win.confirm });
          win.confirm = (() => true) as Window["confirm"];
        } catch {
          /* 某些环境 confirm 只读，忽略 */
        }
      }
    }
    return { clicked: clickElement(button) };
  } finally {
    for (const item of saved) {
      try {
        item.win.confirm = item.confirm;
      } catch {
        /* ignore */
      }
    }
  }
}

function findNewResultKeyword(beforeText: string, currentText: string): string | null {
  for (const keyword of RESULT_TEXT_KEYWORDS) {
    if (currentText.includes(keyword) && !beforeText.includes(keyword)) return keyword;
  }
  return null;
}

function extractScore(text: string): string | undefined {
  if (!text) return undefined;
  const labeled = /(?:得分|成绩|分数)\s*[:：]?\s*(\d+(?:\.\d+)?)/.exec(text);
  if (labeled) return labeled[1];
  const plain = /(\d+(?:\.\d+)?)\s*分/.exec(text);
  return plain ? plain[1] : undefined;
}

async function waitForOutcome(
  ctx: PageContext,
  beforeUrl: string,
  beforeText: string,
): Promise<SubmitResult> {
  const startedAt = Date.now();
  const comparableBefore = comparableUrl(beforeUrl);
  while (Date.now() - startedAt < SUBMIT_TIMEOUT_MS) {
    const url = currentUrl(ctx);
    if (url && comparableBefore && comparableUrl(url) !== comparableBefore) {
      const text = textOf(ctx.doc.body);
      return { ok: true, message: "提交后页面已跳转", score: extractScore(text), url };
    }
    const currentText = textOf(ctx.doc.body);
    const keyword = findNewResultKeyword(beforeText, currentText);
    if (keyword) {
      return {
        ok: true,
        message: `检测到提交结果：${keyword}`,
        score: extractScore(currentText),
        url,
      };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return {
    ok: false,
    message: "15 秒内未检测到提交结果，提交状态未知，请人工确认",
    url: currentUrl(ctx),
  };
}

export async function submitAnswers(
  ctx: PageContext,
  options?: SubmitOptions,
): Promise<SubmitResult> {
  try {
    if (submittedDocuments.has(ctx.doc)) {
      return {
        ok: false,
        message: "本次页面已提交过，跳过重复提交",
        url: currentUrl(ctx),
      };
    }

    const button = findSubmitButton(ctx.doc);
    if (!button) {
      return {
        ok: false,
        message: "未找到提交按钮，请手动提交",
        url: currentUrl(ctx),
      };
    }

    const beforeUrl = currentUrl(ctx);
    const beforeText = textOf(ctx.doc.body);

    // 先占位再点击：即使结果未知也不再自动重复提交
    submittedDocuments.add(ctx.doc);
    const { clicked } = clickSubmitButton(ctx, button, options?.autoConfirm === true);
    if (!clicked) {
      submittedDocuments.delete(ctx.doc);
      return { ok: false, message: "点击提交按钮失败，请手动提交", url: currentUrl(ctx) };
    }

    return await waitForOutcome(ctx, beforeUrl, beforeText);
  } catch (error) {
    return {
      ok: false,
      message: `提交异常：${errorText(error)}`,
      url: currentUrl(ctx),
    };
  }
}
