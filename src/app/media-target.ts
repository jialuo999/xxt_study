/**
 * 播放目标选择：在顶层 frame 中根据任务点/章节信息，决定当前应该播放哪个子 frame。
 *
 * 从 host.ts 拆出的纯函数集合：不直接访问 DOM，只消费已上报的 frame 与媒体状态，
 * 便于用单测覆盖“同页多任务点 / 章节切换 / 旧 frame 残留”等边界。
 */

import type { MediaState, TaskPointKind } from "@/core/types";
import { isReadingTaskKind } from "./task-points";

/** 学习通同页多任务点时的播放目标 */
export interface MediaPlaybackTarget {
  /** 匹配到的子 frame；null 表示任务点 iframe 尚未连接、阅读任务或全部完成 */
  frameId: string | null;
  taskUrl: string;
  taskIndex: number;
  taskTotal: number;
  state: MediaState | null;
  allTasksFinished: boolean;
  /** tasks：按任务点 DOM 顺序；frames：任务点信息不足时按子 frame 连接顺序兜底 */
  source?: "tasks" | "frames";
  /** 当前任务点类型（媒体/阅读/文档/PPT…） */
  kind?: TaskPointKind;
  /** 当前任务点 jobid，用于让内容 frame 找到对应附件 iframe */
  taskId?: string;
  /** 当前任务点名称 */
  taskName?: string;
  /** 上报任务点快照的内容 frame；阅读/文档任务由它转发滚动指令 */
  ownerFrameId?: string;
}

export interface ChildFrameLike {
  frameId: string;
  url: string;
  lastSeen: number;
  /** iframe data/jobid；同 URL 的多个视频 frame 靠它区分 */
  jobid?: string;
  mid?: string;
}

export interface ChildMediaEntry {
  state: MediaState;
  at: number;
}

const TASK_URL_KEYS = [
  "jobid",
  "jobId",
  "_jobid",
  "knowledgeId",
  "knowledgeid",
  "chapterId",
  "chapterid",
  "objectId",
  "objectid",
  "clazzid",
  "clazzId",
  "courseId",
  "courseid",
] as const;

const CHAPTER_ID_KEYS = ["knowledgeId", "knowledgeid", "chapterId", "chapterid"] as const;

/** 去掉 _dc 等缓存参数，只保留能区分任务点的 URL 特征 */
export function taskUrlKey(raw: string): string {
  try {
    const url = new URL(raw);
    const search = TASK_URL_KEYS.filter((key) => url.searchParams.has(key))
      .map((key) => `${key}=${url.searchParams.get(key)}`)
      .join("&");
    return `${url.origin}${url.pathname}${search ? `?${search}` : ""}`;
  } catch {
    return raw;
  }
}

/** 任务点 iframe 与子 frame URL 的最终兜底：jobid / objectid */
export function taskKeyParam(url: URL): string {
  try {
    return (
      url.searchParams.get("jobid") ??
      url.searchParams.get("jobId") ??
      url.searchParams.get("_jobid") ??
      url.searchParams.get("objectid") ??
      url.searchParams.get("objectId") ??
      ""
    );
  } catch {
    return "";
  }
}

/** 从 URL 中读取章节 id（学习通不同页面用 knowledgeId / chapterId 两种写法） */
export function chapterIdFromUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of CHAPTER_ID_KEYS) {
      const value = url.searchParams.get(key);
      if (value) return value;
    }
    return "";
  } catch {
    return "";
  }
}

export const MEDIA_STATE_FRESH_MS = 3500;

function isStateForChapter(
  state: MediaState,
  childUrl: string,
  chapterId: string,
): boolean {
  if (!chapterId) return true;
  // 子 frame 上报时的章节快照优先，其次看当前 URL；两者都没有时不排除（兼容旧消息）。
  if (state.chapterId) return state.chapterId === chapterId;
  const fromUrl = chapterIdFromUrl(childUrl);
  return !fromUrl || fromUrl === chapterId;
}

/**
 * 任务点 URL 与子 frame 的匹配：jobid（iframe data）优先，再完整 URL key，
 * 最后 jobid/objectid 兜底。
 *
 * 学习通视频 iframe 的 URL 通常都是 `/ananas/modules/video/index.html`，同一页
 * 多个任务点完全同 URL；此时只能靠 iframe 的 data/jobid 区分，否则会挑到
 * “最近连接”的 frame，可能正好是已完成任务点。
 */
export function findChildForTask<T extends ChildFrameLike>(
  children: T[],
  taskUrl: string,
  taskId?: string,
): T | null {
  const sorted = [...children].sort((a, b) => b.lastSeen - a.lastSeen);
  if (taskId) {
    const byJobId = sorted.find((child) => child.jobid === taskId);
    if (byJobId) return byJobId;
  }
  const targetKey = taskUrlKey(taskUrl);
  for (const child of sorted) {
    if (taskUrlKey(child.url) === targetKey) return child;
  }
  try {
    const target = new URL(taskUrl);
    const targetJob = taskKeyParam(target);
    if (targetJob) {
      for (const child of sorted) {
        try {
          if (taskKeyParam(new URL(child.url)) === targetJob) return child;
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

interface SelectTargetArgs {
  children: ChildFrameLike[];
  childMedia: Map<string, ChildMediaEntry>;
  chapterId?: string;
  now?: number;
}

/** 任务点信息不足时，按子 frame 顺序逐个激活，避免所有视频一起播放 */
function fallbackMediaTarget(
  args: SelectTargetArgs,
  finishedTaskUrls: ReadonlySet<string> = new Set(),
  knownTaskUrls: ReadonlySet<string> = new Set(),
  knownTaskIds: ReadonlySet<string> = new Set(),
): MediaPlaybackTarget | null {
  const now = args.now ?? Date.now();
  const frames = args.children
    .map((child) => ({ child, entry: args.childMedia.get(child.frameId) }))
    .filter(
      (
        item,
      ): item is { child: ChildFrameLike; entry: ChildMediaEntry } => {
        if (!item.entry) return false;
        if (now - item.entry.at >= MEDIA_STATE_FRESH_MS) return false;
        if (!item.entry.state.hasMedia) return false;
        const key = taskUrlKey(item.child.url);
        if (finishedTaskUrls.has(key)) return false;
        // jobid 比 URL 可靠：多个视频 iframe 的 URL 完全相同。
        if (knownTaskIds.size > 0) {
          if (item.child.jobid) {
            if (!knownTaskIds.has(item.child.jobid)) return false;
          } else if (knownTaskUrls.size > 0 && !knownTaskUrls.has(key)) {
            return false;
          }
        }
        // 有任务点快照时只允许快照里出现过的 iframe，避免上一章节残留的
        // video frame（没有 chapterId，无法靠章节过滤）被误选并重播。
        if (knownTaskIds.size === 0 && knownTaskUrls.size > 0 && !knownTaskUrls.has(key)) {
          return false;
        }
        return isStateForChapter(item.entry.state, item.child.url, args.chapterId ?? "");
      },
    )
    .map(({ child, entry }) => ({ child, state: entry.state }));
  if (frames.length === 0) return null;

  const pending = frames.filter(
    ({ state }) => !state.allEnded && !state.currentTaskFinished,
  );
  if (pending.length === 0) {
    return {
      frameId: null,
      taskUrl: "",
      taskIndex: -1,
      taskTotal: frames.length,
      state: null,
      allTasksFinished: true,
      source: "frames",
    };
  }
  const first = pending[0];
  return {
    frameId: first.child.frameId,
    taskUrl: first.child.url,
    taskIndex: frames.indexOf(first),
    taskTotal: frames.length,
    state: first.state,
    allTasksFinished: false,
    source: "frames",
    kind: "media",
  };
}

/**
 * 选择当前播放目标。
 *
 * - 优先使用带任务点字段的最近上报；
 * - 任务点 URL 匹配到子 frame 时返回该 frame；
 * - 任务点 iframe 尚未连接 → 返回 frameId:null 的“任务点”状态；
 * - 否则回退到“按子 frame 顺序逐个播放”；
 * - 旧章节/旧 frame 的状态在章节过滤阶段被排除，避免跳过新章节视频。
 */
export function selectMediaPlaybackTarget(args: SelectTargetArgs): MediaPlaybackTarget | null {
  const now = args.now ?? Date.now();
  const chapterId = args.chapterId ?? "";
  const byId = new Map(args.children.map((child) => [child.frameId, child] as const));

  const entries = [...args.childMedia.entries()].filter(([frameId, entry]) => {
    if (now - entry.at >= MEDIA_STATE_FRESH_MS) return false;
    const child = byId.get(frameId);
    if (!child) return false;
    return isStateForChapter(entry.state, child.url, chapterId);
  });

  const taskEntry = entries
    .filter(
      ([, entry]) =>
        entry.state.taskTotal !== undefined ||
        entry.state.nextTaskUrl !== undefined ||
        entry.state.allTasksFinished !== undefined,
    )
    .sort((a, b) => b[1].at - a[1].at)[0];

  if (taskEntry) {
    const [ownerFrameId, entry] = taskEntry;
    const state = entry.state;
    const tasks = state.tasks ?? [];
    const finishedTaskUrls = new Set(
      tasks.filter((task) => task.finished && task.url).map((task) => taskUrlKey(task.url!)),
    );
    const knownTaskUrls = new Set(
      tasks.filter((task) => task.url).map((task) => taskUrlKey(task.url!)),
    );
    const knownTaskIds = new Set(
      tasks.filter((task) => task.jobid).map((task) => task.jobid!),
    );
    const nextTask =
      state.nextTaskIndex !== undefined
        ? tasks.find((task) => task.index === state.nextTaskIndex)
        : undefined;
    const kind = state.nextTaskKind ?? nextTask?.kind;
    const taskId = state.nextTaskId ?? nextTask?.jobid;
    const taskName = state.nextTaskName ?? nextTask?.name;
    const taskTotal = state.taskTotal ?? tasks.length;

    if (state.allTasksFinished) {
      return {
        frameId: null,
        taskUrl: "",
        taskIndex: -1,
        taskTotal,
        state: null,
        allTasksFinished: true,
        source: "tasks",
        ownerFrameId,
      };
    }

    const taskUrl = state.nextTaskUrl ?? "";
    if (taskUrl) {
      const child = findChildForTask(args.children, taskUrl, taskId);
      if (child) {
        return {
          frameId: child.frameId,
          taskUrl,
          taskIndex: state.nextTaskIndex ?? 0,
          taskTotal,
          state: args.childMedia.get(child.frameId)?.state ?? null,
          allTasksFinished: false,
          source: "tasks",
          kind: kind ?? "media",
          taskId,
          taskName,
          ownerFrameId,
        };
      }
      if (isReadingTaskKind(kind)) {
        // 阅读/文档 iframe 不一定会以子 frame 身份握手；保留任务目标，
        // 让内容 frame 自己找到附件 iframe 并转发滚动指令。
        return {
          frameId: null,
          taskUrl,
          taskIndex: state.nextTaskIndex ?? 0,
          taskTotal,
          state: null,
          allTasksFinished: false,
          source: "tasks",
          kind,
          taskId,
          taskName,
          ownerFrameId,
        };
      }
      // 只有当任务点本身没有 jobid（旧版页面）时才允许按 frame 兜底；
      // 已知 jobid 时不能挑“任意未完成 frame”，否则会跳过前面的视频先播后面的。
      if (!taskId) {
        const fallback = fallbackMediaTarget(args, finishedTaskUrls, knownTaskUrls, knownTaskIds);
        if (fallback) return fallback;
      }
      // 目标视频 frame 还没连接/握手：保留任务目标，让自动翻页等待而不是
      // 直接回退到“无媒体等 3 秒”而跳过新章节的视频。
      return {
        frameId: null,
        taskUrl,
        taskIndex: state.nextTaskIndex ?? 0,
        taskTotal,
        state: null,
        allTasksFinished: false,
        source: "tasks",
        kind: kind ?? "media",
        taskId,
        taskName,
        ownerFrameId,
      };
    } else if (isReadingTaskKind(kind) || (taskId && !knownTaskUrls.size)) {
      // 没有 iframe URL 的阅读任务（正文在内容 frame 内）/只有 jobid 的附件。
      return {
        frameId: null,
        taskUrl: "",
        taskIndex: state.nextTaskIndex ?? 0,
        taskTotal,
        state: null,
        allTasksFinished: false,
        source: "tasks",
        kind,
        taskId,
        taskName,
        ownerFrameId,
      };
    }

    return fallbackMediaTarget(args, finishedTaskUrls, knownTaskUrls, knownTaskIds);
  }

  return fallbackMediaTarget(args);
}

/**
 * 汇总子 frame 的媒体状态，供自动翻页判断视频/音频是否结束。
 *
 * 只有与当前章节匹配的 frame 才参与 allEnded/anyPaused 汇总；
 * 只有整章任务点都完成时 allTasksFinished 才为 true。
 */
export function summarizeChildMediaState(args: SelectTargetArgs): MediaState | null {
  const now = args.now ?? Date.now();
  const chapterId = args.chapterId ?? "";
  const byId = new Map(args.children.map((child) => [child.frameId, child] as const));

  const entries = [...args.childMedia.entries()].filter(([frameId, entry]) => {
    if (now - entry.at >= MEDIA_STATE_FRESH_MS) return false;
    const child = byId.get(frameId);
    if (!child) return false;
    return isStateForChapter(entry.state, child.url, chapterId);
  });

  const media = entries
    .map(([frameId, entry]) => ({ frameId, ...entry }))
    .filter((item) => item.state.hasMedia);
  const allTasksFinished = entries.some(
    ([frameId, entry]) =>
      entry.state.allTasksFinished === true &&
      (!chapterId || isStateForChapter(entry.state, byId.get(frameId)!.url, chapterId)),
  );
  const finished = allTasksFinished;

  if (media.length === 0 && !finished) return null;
  return {
    hasMedia: media.length > 0,
    allEnded: media.length > 0 && media.every((item) => item.state.allEnded),
    anyPaused: media.some((item) => item.state.anyPaused),
    currentTaskFinished: finished,
    allTasksFinished,
  };
}
