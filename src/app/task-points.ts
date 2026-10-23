import type { MediaState, TaskPointInfo } from "@/core/types";

export interface TaskPointState {
  currentTaskFinished: boolean;
  allTasksFinished: boolean;
  nextTaskUrl?: string;
  nextTaskIndex?: number;
  taskTotal?: number;
  tasks?: TaskPointInfo[];
}

interface IconEntry {
  icon: HTMLElement;
  item: HTMLElement;
  finished: boolean;
  url?: string;
}

/**
 * 读取学习通内容 frame 中的任务点列表。
 *
 * - 兼容 `.ans-job-finished` 在 icon 自身、父级或任务项内部三种结构；
 * - 按 DOM 顺序（从上到下）返回全部任务点快照；Host 用它跳过已完成任务；
 * - 第一个未完成且带 iframe 的任务点作为 nextTaskUrl；
 * - 只读取 DOM，不点击、不播放，异常时返回空状态。
 */
export function collectTaskPointState(doc: Document): TaskPointState {
  const result: TaskPointState = { currentTaskFinished: false, allTasksFinished: false };
  try {
    const icons = Array.from(doc.querySelectorAll<HTMLElement>(".ans-job-icon"));
    if (icons.length === 0) return result;

    const entries: IconEntry[] = icons.map((icon, index) => {
      const item = resolveTaskItem(icon);
      return {
        icon,
        item,
        finished: isFinishedTask(icon, item),
        url: resolveTaskUrl(doc, item),
        index,
      } as IconEntry & { index: number };
    });
    if (entries.length === 0) return result;

    result.taskTotal = entries.length;
    result.allTasksFinished = entries.every((entry) => entry.finished);
    result.tasks = entries.map((entry, index) => ({
      index,
      finished: entry.finished,
      ...(entry.url ? { url: entry.url } : {}),
    }));

    for (const entry of entries) {
      if (!entry.finished) continue;
      const iframe = entry.item.querySelector("iframe");
      if (iframe && isVisible(iframe)) {
        result.currentTaskFinished = true;
        break;
      }
    }

    const next = entries.find((entry) => !entry.finished && entry.url);
    if (next) {
      result.nextTaskUrl = next.url;
      result.nextTaskIndex = result.tasks.findIndex((task) => task.url === next.url);
    }
  } catch {
    /* ignore */
  }
  return result;
}

/** 从 icon 向上找到真正的任务点容器（含 iframe 或 ans-job 类名的最近节点） */
function resolveTaskItem(icon: HTMLElement): HTMLElement {
  const doc = icon.ownerDocument;
  let node: HTMLElement | null = icon.parentElement;
  const fallback = node ?? icon;
  for (let depth = 0; node && depth < 4; depth += 1) {
    if (node === doc.body || node === doc.documentElement) break;
    // 不要上溯到包含多个任务点的列表容器，否则任务点的 iframe 会串到别的任务上
    if (node.querySelectorAll(".ans-job-icon").length > 1) break;
    const className = typeof node.className === "string" ? node.className : "";
    if (node.querySelector("iframe") || /ans-job/i.test(className)) return node;
    node = node.parentElement;
  }
  return fallback;
}

/** 已完成标记可能出现在 icon 自身、任务容器或其内部 */
function isFinishedTask(icon: HTMLElement, item: HTMLElement): boolean {
  try {
    if (icon.classList.contains("ans-job-finished")) return true;
    let node: HTMLElement | null = item;
    for (let depth = 0; node && depth < 3; depth += 1) {
      if (node.classList.contains("ans-job-finished")) return true;
      node = node.parentElement;
    }
    // 只有任务容器内只有一个任务点时才看内部，避免把整个任务列表容器误判
    if (item.querySelectorAll(".ans-job-icon").length <= 1) {
      return Boolean(item.querySelector(".ans-job-finished"));
    }
  } catch {
    /* ignore */
  }
  return false;
}

function resolveTaskUrl(doc: Document, item: HTMLElement): string | undefined {
  try {
    const iframe = item.querySelector<HTMLIFrameElement>("iframe");
    const rawUrl = iframe?.src?.trim() || iframe?.getAttribute("data-src")?.trim() || "";
    if (!rawUrl) return undefined;
    return new URL(rawUrl, doc.baseURI || location.href).href;
  } catch {
    return undefined;
  }
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
