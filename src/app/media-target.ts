/**
 * 播放目标选择：在顶层 frame 中根据任务点/章节信息，决定当前应该播放哪个子 frame。
 *
 * 从 host.ts 拆出的纯函数集合：不直接访问 DOM，只消费已上报的 frame 与媒体状态，
 * 便于用单测覆盖“同页多任务点 / 章节切换 / 旧 frame 残留”等边界。
 */

import type { MediaState } from "@/core/types";

/** 学习通同页多任务点时的播放目标 */
export interface MediaPlaybackTarget {
  /** 匹配到的子 frame；null 表示任务点 iframe 尚未连接或全部完成 */
  frameId: string | null;
  taskUrl: string;
  taskIndex: number;
  taskTotal: number;
  state: MediaState | null;
  allTasksFinished: boolean;
  /** tasks：按任务点 DOM 顺序；frames：任务点信息不足时按子 frame 连接顺序兜底 */
  source?: "tasks" | "frames";
}

export interface ChildFrameLike {
  frameId: string;
  url: string;
  lastSeen: number;
}

export interface ChildMediaEntry {
  state: MediaState;
  at: number;
}

const TASK_URL_KEYS = [
  "jobid",
  "jobId",
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

/** 任务点 URL 与子 frame 的匹配：先完整 key，再 jobid/objectid 兜底 */
export function findChildForTask<T extends ChildFrameLike>(
  children: T[],
  taskUrl: string,
): T | null {
  const sorted = [...children].sort((a, b) => b.lastSeen - a.lastSeen);
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
function fallbackMediaTarget(args: SelectTargetArgs): MediaPlaybackTarget | null {
  const now = args.now ?? Date.now();
  const byId = new Map(args.children.map((child) => [child.frameId, child] as const));
  const frames = [...args.childMedia.entries()]
    .filter(([frameId, entry]) => {
      if (now - entry.at >= MEDIA_STATE_FRESH_MS) return false;
      const child = byId.get(frameId);
      if (!child) return false;
      if (!entry.state.hasMedia) return false;
      return isStateForChapter(entry.state, child.url, args.chapterId ?? "");
    })
    .map(([frameId, entry]) => ({ child: byId.get(frameId)!, state: entry.state }));
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
    const state = taskEntry[1].state;
    if (state.allTasksFinished) {
      return {
        frameId: null,
        taskUrl: "",
        taskIndex: -1,
        taskTotal: state.taskTotal ?? 0,
        state: null,
        allTasksFinished: true,
        source: "tasks",
      };
    }
    const taskUrl = state.nextTaskUrl;
    if (taskUrl) {
      const child = findChildForTask(args.children, taskUrl);
      if (child) {
        return {
          frameId: child.frameId,
          taskUrl,
          taskIndex: state.nextTaskIndex ?? 0,
          taskTotal: state.taskTotal ?? 0,
          state: args.childMedia.get(child.frameId)?.state ?? null,
          allTasksFinished: false,
          source: "tasks",
        };
      }
    }
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
