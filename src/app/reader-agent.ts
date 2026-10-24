/**
 * 阅读/文档任务自动化（每个 frame 独立运行）。
 *
 * 学习通的文档任务通常嵌入两层 iframe：
 *   cards 内容 frame -> 文档模块 index(2).html -> pan-yz 文档页 file.html
 * 文档页与内容 frame 不同源，无法直接访问其 DOM；但可以逐层 `postMessage`。
 * 本模块只做两件事：
 *   1. Host 的 READER_TASK 传到哪一层，哪一层就继续转发给子 iframe；
 *   2. 真正承载文档/PPT 的 frame 收到后，真实滚动到文末/翻到最后一页。
 *
 * 完成状态不在这里伪造：滚动完成后由平台自己的脚本写回 `.ans-job-finished`
 * / 任务点状态，Host 只观察平台状态。
 *
 * 注意：这里不点击验证码、不调用平台“完成任务”接口、不伪造视频进度。
 */
import { getSettings } from "@/core/settings-store";
import { logger } from "@/core/logger";
import { isFrameMessage, isTrustedOrigin, sendToWindow, type FrameMessage } from "@/core/messages";
import { sleep } from "@/utils/async";

export type ReaderMode = "window" | "element" | "swiper";

export interface ReaderTarget {
  mode: ReaderMode;
  element?: HTMLElement;
}

const READER_LOG_SCOPE = "reader";
const READER_MAX_MS = 10 * 60 * 1000;
const STEP_INTERVAL_MS = 420;
const BOTTOM_CONFIRM = 2;

function isReaderTaskMessage(message: FrameMessage): boolean {
  return message.t === "READER_TASK" || message.t === "READER_STOP";
}

/**
 * 当前 frame 是否是需要自己滚动的“阅读器”页面。
 *
 * 文档模块外层（含 #panView / #wpsView）不自己滚动，而是继续转发给子 iframe；
 * 返回 null 表示“这不是最终阅读器，应该 relay”。
 */
export function resolveReaderTarget(doc: Document): ReaderTarget | null {
  try {
    if (doc.querySelector("#panView, #wpsView")) return null;

    // 学习通云盘文档预览页（file.html）：整个 window 滚动，底部自动 postMessage
    if (doc.querySelector("#fileInfoNameInput, .fileBox")) {
      return { mode: "window" };
    }

    // PPT 预览：切换 slide
    if (doc.querySelector(".swiper-container .swiper-slide")) {
      return { mode: "swiper" };
    }

    // 旧版文档/书籍阅读页：优先滚动正文，而不是整页 chrome
    if (doc.querySelector("#ReadWeb, #img.imglook, #reader, .readerPager")) {
      const scrollable = findLargestScrollable(doc);
      if (scrollable) return { mode: "element", element: scrollable };
      return { mode: "window" };
    }

    const scrollable = findLargestScrollable(doc);
    if (scrollable) return { mode: "element", element: scrollable };
    const win = doc.defaultView;
    if (win && doc.documentElement.scrollHeight - (win.innerHeight || 0) > 200) {
      return { mode: "window" };
    }
    return null;
  } catch {
    return null;
  }
}

function isScrollable(element: Element): boolean {
  try {
    const el = element as HTMLElement;
    if (el.scrollHeight - el.clientHeight < 200) return false;
    const win = el.ownerDocument.defaultView;
    const style = win?.getComputedStyle(el);
    if (!style) return false;
    const overflowY = style.overflowY;
    return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
  } catch {
    return false;
  }
}

function findLargestScrollable(doc: Document): HTMLElement | null {
  try {
    const scrolling = (doc.scrollingElement ?? doc.documentElement) as HTMLElement;
    if (isScrollable(scrolling)) return scrolling;
    const candidates = [
      ...Array.from(
        doc.querySelectorAll<HTMLElement>(
          "main, article, #main, #content, #docContainer, .fileBox, [class*='reader'], [class*='content'], [class*='doc']",
        ),
      ),
    ];
    let best: HTMLElement | null = null;
    let bestScore = 0;
    for (const element of candidates) {
      if (!isScrollable(element)) continue;
      const score = element.scrollHeight - element.clientHeight;
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }
    return best;
  } catch {
    return null;
  }
}

/** 找出任务点对应的文档 iframe；有 jobid 时优先精确匹配 data 属性 */
export function findReaderIframes(doc: Document, jobid?: string): HTMLIFrameElement[] {
  try {
    const iframes = Array.from(doc.querySelectorAll<HTMLIFrameElement>("iframe"));
    if (!jobid) return iframes;
    const matched = iframes.filter((iframe) => {
      try {
        const raw = iframe.getAttribute("data");
        if (!raw) return false;
        const data = JSON.parse(raw) as Record<string, unknown>;
        return String(data.jobid ?? "") === jobid || String(data._jobid ?? "") === jobid;
      } catch {
        return false;
      }
    });
    return matched;
  } catch {
    return [];
  }
}

function relayReaderMessage(doc: Document, message: FrameMessage, jobid?: string): void {
  const iframes = findReaderIframes(doc, jobid);
  // 文档模块外层 iframe 本身没有 jobid（#panView），需要继续向下转发。
  const targets = iframes.length > 0 ? iframes : doc.querySelector("#panView, #wpsView") ? Array.from(doc.querySelectorAll<HTMLIFrameElement>("iframe")) : [];
  for (const iframe of targets) {
    const win = iframe.contentWindow;
    if (!win) continue;
    try {
      sendToWindow(win, message);
    } catch {
      /* ignore */
    }
  }
}

/** 把窗口/元素滚到底；只滚动，不点击、不调用平台完成任务方法 */
async function scrollToBottom(
  target: ReaderTarget,
  isAlive: () => boolean,
  doc: Document,
): Promise<void> {
  if (target.mode === "swiper") {
    await swipeThroughPpt(doc, isAlive);
    return;
  }
  const win = doc.defaultView;
  if (!win) return;
  const element = target.mode === "window" ? null : target.element;
  const viewport = element ? element.clientHeight : win.innerHeight || 800;
  const step = Math.max(240, Math.floor(viewport * 0.75));
  let bottomHits = 0;
  const started = Date.now();
  while (Date.now() - started < READER_MAX_MS) {
    if (!isAlive()) return;
    const scrollTop = element ? element.scrollTop : win.scrollY || doc.documentElement.scrollTop || 0;
    const scrollHeight = element ? element.scrollHeight : doc.documentElement.scrollHeight;
    const clientHeight = element ? element.clientHeight : win.innerHeight || 800;
    if (scrollTop + clientHeight >= scrollHeight - 40) {
      bottomHits += 1;
      if (bottomHits >= BOTTOM_CONFIRM) return;
    } else {
      bottomHits = 0;
      const next = Math.min(scrollTop + step, Math.max(0, scrollHeight - clientHeight));
      try {
        if (element) {
          element.scrollTop = next;
        } else {
          win.scrollTo({ top: next, behavior: "smooth" });
        }
      } catch {
        /* ignore */
      }
    }
    await sleep(STEP_INTERVAL_MS);
  }
}

/** PPT/幻灯片：优先调用页面自带 swiperNext，其次点击下一张按钮 */
async function swipeThroughPpt(doc: Document, isAlive: () => boolean): Promise<void> {
  const win = doc.defaultView as (Window & { swiperNext?: () => void }) | null;
  let idle = 0;
  let lastIndex = -1;
  const started = Date.now();
  while (Date.now() - started < READER_MAX_MS) {
    if (!isAlive()) return;
    const next = doc.querySelector<HTMLElement>(
      ".swiper-button-next:not(.swiper-button-disabled), .swiper-button-next",
    );
    if (next?.classList.contains("swiper-button-disabled") || !next) {
      idle += 1;
      if (idle >= 3) return;
      await sleep(700);
      continue;
    }
    const active = doc.querySelector(".swiper-slide-active");
    const index = active ? Array.from(active.parentElement?.children ?? []).indexOf(active) : -1;
    if (index === lastIndex) {
      idle += 1;
      if (idle >= 6) return;
    } else {
      idle = 0;
      lastIndex = index;
    }
    try {
      win?.swiperNext?.();
    } catch {
      /* ignore */
    }
    try {
      next.click();
    } catch {
      /* ignore */
    }
    await sleep(900);
  }
}

interface ReaderRun {
  token: number;
  taskKey: string;
}

/**
 * 在任意 frame 启动阅读任务中继/执行器；返回卸载函数。
 * 每个 frame 都注册监听，只有收到 READER_TASK 才动作。
 */
export function startReaderAgent(): () => void {
  let disposed = false;
  let run: ReaderRun | null = null;
  let runSeq = 0;

  const isAlive = (token: number): boolean => !disposed && run?.token === token;

  const stopLocal = (): void => {
    runSeq += 1;
    run = null;
  };

  const onMessage = (event: MessageEvent): void => {
    if (disposed) return;
    if (!isTrustedOrigin(event.origin)) return;
    // 只接受父级/顶层 frame 下发的阅读指令，避免同源第三方脚本随意驱动滚动。
    const source = event.source as Window | null;
    if (source && source !== window.parent && source !== window.top) return;
    const message = event.data;
    if (!isFrameMessage(message)) return;
    if (!isReaderTaskMessage(message)) return;

    if (message.t === "READER_STOP") {
      stopLocal();
      // 子 iframe 的 document 在跨域时不可读；用当前 frame 自己的文档继续转发。
      relayReaderMessage(document, message);
      return;
    }

    if (!getSettings().autoTurn.readingAuto) return;
    const jobid = "jobid" in message ? message.jobid : undefined;
    const doc = document;
    const targets = findReaderIframes(doc, jobid);
    const wrapper = Boolean(doc.querySelector("#panView, #wpsView"));

    // 有明确任务 iframe（cards frame）或文档模块外层（#panView）时，先向下转发。
    if ((jobid && targets.length > 0) || wrapper) {
      relayReaderMessage(doc, message, jobid);
      return;
    }

    // 当前 frame 就是文档/阅读页：直接真实滚动。
    const target = resolveReaderTarget(doc);
    if (!target) {
      // 没有本地阅读器时，才把指令继续转发给子 frame。
      if (targets.length > 0) relayReaderMessage(doc, message, jobid);
      return;
    }
    const taskKey = jobid || ("url" in message ? message.url : "") || "reading-task";
    if (run?.taskKey === taskKey) return;
    const token = ++runSeq;
    run = { token, taskKey };
    logger.info(READER_LOG_SCOPE, "开始滚动阅读页", {
      mode: target.mode,
      taskKey,
      url: location.href,
    });
    void scrollToBottom(target, () => isAlive(token), doc)
      .then(() => {
        if (!isAlive(token)) return;
        logger.info(READER_LOG_SCOPE, "阅读页已滚动到底，等待平台任务点状态", {
          mode: target.mode,
          taskKey,
        });
        run = null;
      })
      .catch((error: unknown) => {
        logger.debug(READER_LOG_SCOPE, "阅读滚动失败", error);
        if (isAlive(token)) run = null;
      });
  };

  window.addEventListener("message", onMessage);

  return () => {
    disposed = true;
    stopLocal();
    window.removeEventListener("message", onMessage);
  };
}
