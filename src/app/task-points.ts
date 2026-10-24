import type { TaskPointInfo, TaskPointKind } from "@/core/types";

export interface TaskPointState {
  currentTaskFinished: boolean;
  allTasksFinished: boolean;
  nextTaskUrl?: string;
  nextTaskIndex?: number;
  nextTaskId?: string;
  nextTaskKind?: TaskPointKind;
  nextTaskName?: string;
  taskTotal?: number;
  tasks?: TaskPointInfo[];
}

interface DomEntry {
  container: HTMLElement | null;
  icon: HTMLElement | null;
  iframe: HTMLIFrameElement | null;
  url?: string;
  jobid?: string;
  mid?: string;
  kind: TaskPointKind;
  name?: string;
  isTask: boolean;
  finished: boolean;
}

const READING_KINDS = new Set<TaskPointKind>(["read", "doc", "ppt"]);

/** 学习通 attachments 里的任务点类型；没有 iframe 的阅读任务也能识别 */
export function isReadingTaskKind(kind: TaskPointKind | undefined): boolean {
  return kind !== undefined && READING_KINDS.has(kind);
}

/**
 * 读取学习通内容 frame 中的任务点列表。
 *
 * 数据来源优先级：
 * 1. `window.mArg.attachments` / `window.attachments`（学习通知识卡片页的权威任务点数据，
 *    能拿到 `job` / `isPassed` / `property.module`，阅读/文档任务不会因为没有
 *    `.ans-job-icon` 而被漏掉）；
 * 2. `.ans-attach-ct` 容器 + iframe `data` 属性（真实 DOM 里完成标记在容器上）；
 * 3. `.ans-job-icon` 图标兜底（旧版/简化页面）。
 *
 * 只读取 DOM，不点击、不播放、不滚动；异常时返回空状态。
 */
export function collectTaskPointState(doc: Document): TaskPointState {
  const result: TaskPointState = { currentTaskFinished: false, allTasksFinished: false };
  try {
    const attachments = readAttachments(doc);
    const entries = collectDomEntries(doc, attachments);
    if (entries.length === 0) return result;

    const tasks: TaskPointInfo[] = entries
      .filter((entry) => entry.isTask)
      .map((entry, index) => ({
        index,
        finished: entry.finished,
        ...(entry.url ? { url: entry.url } : {}),
        ...(entry.jobid ? { jobid: entry.jobid } : {}),
        ...(entry.kind !== "unknown" ? { kind: entry.kind } : {}),
        ...(entry.name ? { name: entry.name } : {}),
      }));

    if (tasks.length === 0) return result;

    result.taskTotal = tasks.length;
    result.tasks = tasks;
    result.allTasksFinished = tasks.every((task) => task.finished);
    // 兼容旧字段：只有整页任务都完成才认为“当前任务完成”，避免任意一个已完成
    // 任务点就让上层跳过等待（真实页面同页通常同时存在已完成/未完成任务）。
    result.currentTaskFinished = result.allTasksFinished;

    // 第一个未完成任务：优先带 iframe 的媒体任务；阅读/文档任务即使没有 iframe
    // 也必须保留，否则会跳过未完成的阅读任务。
    const next =
      tasks.find((task) => !task.finished && task.url) ??
      tasks.find((task) => !task.finished && isReadingTaskKind(task.kind));
    if (next) {
      result.nextTaskIndex = next.index;
      result.nextTaskId = next.jobid;
      result.nextTaskKind = next.kind;
      result.nextTaskName = next.name;
      if (next.url) result.nextTaskUrl = next.url;
    }
  } catch {
    /* ignore */
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function boolish(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function readAttachments(doc: Document): Record<string, unknown>[] {
  try {
    const win = doc.defaultView as
      | (Window & { mArg?: unknown; attachments?: unknown })
      | null;
    if (!win) return [];
    const candidates: unknown[] = [];
    const mArg = isRecord(win.mArg) ? win.mArg : null;
    if (mArg) candidates.push(mArg.attachments);
    candidates.push(win.attachments);
    for (const raw of candidates) {
      if (Array.isArray(raw)) return raw.filter(isRecord);
    }
  } catch {
    /* cross-frame / 旧页面没有 attachments */
  }
  return [];
}

function attachmentProperty(attachment: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(attachment.property) ? attachment.property : null;
}

function attachmentJobId(attachment: Record<string, unknown>): string {
  const property = attachmentProperty(attachment);
  return (
    text(attachment.jobid) ||
    text(property?._jobid) ||
    text(attachment._jobid) ||
    text(property?.jobid)
  );
}

function attachmentMid(attachment: Record<string, unknown>): string {
  const property = attachmentProperty(attachment);
  return text(attachment.mid) || text(property?.mid);
}

function attachmentName(attachment: Record<string, unknown>): string {
  const property = attachmentProperty(attachment);
  return text(property?.name) || text(attachment.name);
}

/** `job === true` 表示未完成任务点；`isPassed === true` 表示已完成任务点 */
function attachmentIsTask(attachment: Record<string, unknown>): boolean {
  return boolish(attachment.job) || boolish(attachment.isPassed);
}

function attachmentFinished(attachment: Record<string, unknown>): boolean {
  return boolish(attachment.isPassed);
}

function attachmentKind(attachment: Record<string, unknown>): TaskPointKind {
  const property = attachmentProperty(attachment);
  const module = (text(property?.module) || text(attachment.type)).toLowerCase();
  if (module.includes("video") || module.includes("audio") || module === "media") return "media";
  if (module.includes("doc") || module === "pdf" || module.includes("document")) return "doc";
  if (module.includes("book") || module.includes("read")) return "read";
  if (module.includes("flash") || module.includes("ppt") || module.includes("slide")) return "ppt";
  if (module.includes("work") || module.includes("quiz") || module.includes("test")) return "quiz";
  if (module.includes("link") || module.includes("hyperlink")) return "link";
  return "unknown";
}

function kindFromDom(icon: HTMLElement | null, url: string): TaskPointKind {
  const className = typeof icon?.className === "string" ? icon.className : "";
  if (/ans-job-(video|audio)|insertvideo|insertaudio/i.test(className)) return "media";
  if (/ans-job-(doc|read|book)|insertdoc|insertbook/i.test(className)) return "doc";
  if (/ans-job-(ppt|flash)|insertflash/i.test(className)) return "ppt";
  if (/ans-job-work|insertwork/i.test(className)) return "quiz";
  if (/\/ananas\/modules\/(video|audio)\//i.test(url)) return "media";
  if (/\/ananas\/modules\/pdf\//i.test(url) || /pan-yz\.chaoxing\.com/i.test(url)) return "doc";
  if (/\/readsvr\/book\/mooc|\/readsvr\//i.test(url)) return "read";
  return "unknown";
}

function parseIframeData(iframe: HTMLIFrameElement | null): Record<string, unknown> | null {
  if (!iframe) return null;
  try {
    const raw = iframe.getAttribute("data");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolveIframeUrl(doc: Document, iframe: HTMLIFrameElement | null): string | undefined {
  try {
    const rawUrl =
      iframe?.getAttribute("src")?.trim() || iframe?.getAttribute("data-src")?.trim() || "";
    if (!rawUrl) return undefined;
    return new URL(rawUrl, doc.baseURI || location.href).href;
  } catch {
    return undefined;
  }
}

function hasFinishedMarker(container: HTMLElement | null, icon: HTMLElement | null): boolean {
  try {
    if (icon?.classList.contains("ans-job-finished")) return true;
    if (!container) return false;
    if (container.classList.contains("ans-job-finished")) return true;
    // 真实页面把完成标记加在 iframe 的父容器上；只在当前容器内查找，避免把
    // 整个任务列表容器的完成状态误算到每个任务点。
    return container.querySelector(".ans-job-finished") != null;
  } catch {
    return false;
  }
}

function findAttachment(
  attachments: Record<string, unknown>[],
  jobid: string,
  mid: string,
): Record<string, unknown> | undefined {
  if (attachments.length === 0) return undefined;
  return attachments.find((attachment) => {
    const attachmentId = attachmentJobId(attachment);
    if (jobid && attachmentId && attachmentId === jobid) return true;
    const attachmentMidValue = attachmentMid(attachment);
    return Boolean(mid && attachmentMidValue && attachmentMidValue === mid);
  });
}

function collectDomEntries(
  doc: Document,
  attachments: Record<string, unknown>[],
): DomEntry[] {
  const entries: DomEntry[] = [];
  const containers = Array.from(doc.querySelectorAll<HTMLElement>(".ans-attach-ct"));

  for (const container of containers) {
    const icon = container.querySelector<HTMLElement>(".ans-job-icon");
    const iframe = container.querySelector<HTMLIFrameElement>("iframe");
    entries.push(buildEntry(doc, attachments, container, icon, iframe));
  }

  // 部分版本没有 `.ans-attach-ct`：退到 `.ans-job-icon` 祖先上的 iframe。
  if (entries.length === 0) {
    for (const icon of Array.from(doc.querySelectorAll<HTMLElement>(".ans-job-icon"))) {
      const container = resolveTaskItem(icon);
      entries.push(
        buildEntry(
          doc,
          attachments,
          container,
          icon,
          container.querySelector<HTMLIFrameElement>("iframe"),
        ),
      );
    }
  }

  // 仍没有 DOM 任务点，但页面里有 iframe + attachments：按 iframe data 匹配。
  if (entries.length === 0 && attachments.length > 0) {
    for (const iframe of Array.from(doc.querySelectorAll<HTMLIFrameElement>("iframe"))) {
      const data = parseIframeData(iframe);
      if (!data) continue;
      const jobid = text(data.jobid) || text(data._jobid);
      const mid = text(data.mid);
      if (!jobid && !mid) continue;
      entries.push(
        buildEntry(doc, attachments, null, null, iframe),
      );
    }
  }

  return entries;
}

function buildEntry(
  doc: Document,
  attachments: Record<string, unknown>[],
  container: HTMLElement | null,
  icon: HTMLElement | null,
  iframe: HTMLIFrameElement | null,
): DomEntry {
  const data = parseIframeData(iframe);
  const jobid = text(data?.jobid) || text(data?._jobid);
  const mid = text(data?.mid);
  const attachment = findAttachment(attachments, jobid, mid);
  const url = resolveIframeUrl(doc, iframe);
  const finished = hasFinishedMarker(container, icon) || (attachment ? attachmentFinished(attachment) : false);
  const kind = attachment ? attachmentKind(attachment) : kindFromDom(icon, url ?? "");
  // attachments 存在时以 job/isPassed 为准；旧页面没有 attachments 时用任务点图标兜底。
  const isTask = attachment ? attachmentIsTask(attachment) || Boolean(icon) : Boolean(icon);
  return {
    container,
    icon,
    iframe,
    url,
    jobid: jobid || (attachment ? attachmentJobId(attachment) : undefined),
    mid,
    kind,
    name: attachment ? attachmentName(attachment) : text(data?.name),
    isTask,
    finished,
  };
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
