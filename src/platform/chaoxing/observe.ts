/**
 * 学习通页面变化观察：MutationObserver + 250ms 防抖。
 *
 * 选择器思路参考 https://github.com/CodFrm/cxmooc-tools （MIT License），
 * 本项目为独立实现，未复制其源码。
 */
import type { PageContext } from "../types";

/** 防抖间隔：题目/选项往往是批量插入 DOM，避免重复触发扫描 */
const DEBOUNCE_MS = 250;

/**
 * 监听 body 子节点变化（含子树），防抖后回调一次。
 * 返回 disconnect，可重复调用；文档没有 body 或环境不支持时返回空函数。
 */
export function observePage(ctx: PageContext, callback: () => void): () => void {
  const noop = (): void => undefined;
  try {
    const body = ctx.doc.body;
    const Observer = ctx.doc.defaultView?.MutationObserver ?? (typeof MutationObserver === "undefined" ? null : MutationObserver);
    if (!body || !Observer) return noop;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const observer = new Observer(() => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (disposed) return;
        try {
          callback();
        } catch {
          /* 页面回调异常不能影响 observer */
        }
      }, DEBOUNCE_MS);
    });

    observer.observe(body, { childList: true, subtree: true });

    return () => {
      if (disposed) return;
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        observer.disconnect();
      } catch {
        /* ignore */
      }
    };
  } catch {
    return noop;
  }
}
