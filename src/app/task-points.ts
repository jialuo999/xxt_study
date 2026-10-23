import type { MediaState } from "@/core/types";

export interface TaskPointState {
  currentTaskFinished: boolean;
  allTasksFinished: boolean;
  nextTaskUrl?: string;
  nextTaskIndex?: number;
  taskTotal?: number;
}

/**
 * 读取学习通内容 frame 中的任务点列表。
 *
 * - `.ans-job-icon` 的父级带 `.ans-job-finished` 表示该任务点已完成；
 * - 按 DOM 顺序（从上到下）返回第一个未完成、且带 iframe 的任务点，
 *   供 Host 逐个激活对应子 frame，避免多个视频同时播放；
 * - 只读取 DOM，不点击、不播放，异常时返回空状态。
 */
export function collectTaskPointState(doc: Document): TaskPointState {
  const result: TaskPointState = { currentTaskFinished: false, allTasksFinished: false };
  try {
    const icons = Array.from(doc.querySelectorAll<HTMLElement>(".ans-job-icon"));
    if (icons.length === 0) return result;
    const items = icons
      .map((icon) => icon.parentElement)
      .filter((item): item is HTMLElement => Boolean(item));
    if (items.length === 0) return result;

    result.taskTotal = items.length;
    result.allTasksFinished = items.every((item) => item.classList.contains("ans-job-finished"));

    for (const item of items) {
      const iframe = item.querySelector("iframe");
      if (!iframe) continue;
      if (!isVisible(iframe)) continue;
      if (item.classList.contains("ans-job-finished")) {
        result.currentTaskFinished = true;
        break;
      }
    }

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item.classList.contains("ans-job-finished")) continue;
      const iframe = item.querySelector<HTMLIFrameElement>("iframe");
      const rawUrl =
        iframe?.src?.trim() || iframe?.getAttribute("data-src")?.trim() || "";
      if (!rawUrl) continue;
      let url = rawUrl;
      try {
        url = new URL(rawUrl, doc.baseURI || location.href).href;
      } catch {
        /* 保持原值 */
      }
      result.nextTaskUrl = url;
      result.nextTaskIndex = index;
      break;
    }
  } catch {
    /* ignore */
  }
  return result;
}

function isVisible(element: HTMLElement): boolean {
  try {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const win = element.ownerDocument.defaultView;
    const style = win?.getComputedStyle(element);
    return !(style && (style.display === "none" || style.visibility === "hidden"));
  } catch {
    return false;
  }
}
