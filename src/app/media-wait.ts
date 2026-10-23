/**
 * 媒体等待：只观察播放器真实状态，不伪造进度、不 seek。
 *
 * 从 autoturn.ts 拆出，便于独立测试与复用；自动翻页仍通过
 * `AutoTurnRunner` 调用这些函数。
 */

import { getSettings } from "@/core/settings-store";
import type { VideoSettings } from "@/core/settings";
import { sleep } from "@/utils/async";
import { collectMedia, focusMedia, pickPrimaryMedia } from "./media-preferences";

export type MediaWaitResult = "done" | "none" | "blocked" | "timeout" | "stalled";

export function findMedia(doc: Document): HTMLMediaElement[] {
  return collectMedia(doc);
}

/** 媒体所在任务点是否已完成（学习通 .ans-job-finished） */
function isTaskPointFinished(media: HTMLMediaElement): boolean {
  try {
    return Boolean(media.closest(".ans-job-finished"));
  } catch {
    return false;
  }
}

/** 等待页面中的视频/音频播放结束；暂停时按设置尝试恢复播放 */
export async function waitForMedia(
  doc: Document,
  timeoutMs: number,
  isAlive: () => boolean,
  preferences: VideoSettings = getSettings().video,
  onPausedNotice?: (message: string) => void,
): Promise<MediaWaitResult> {
  let allMedia = findMedia(doc);
  if (allMedia.length === 0 && doc.querySelector("iframe")) {
    // 章节页 iframe 可能尚未加载完，给播放器一点出现时间
    for (let attempt = 0; attempt < 10; attempt++) {
      if (!isAlive()) return "none";
      await sleep(500);
      allMedia = findMedia(doc);
      if (allMedia.length > 0) break;
    }
  }
  if (allMedia.length === 0) return "none";

  const started = Date.now();
  let lastPausedNotice = 0;
  const pausedSince = new Map<HTMLMediaElement, number>();
  const lastAttempt = new Map<HTMLMediaElement, number>();
  const finished = new WeakMap<HTMLMediaElement, { src: string; duration: number }>();

  const mediaSource = (element: HTMLMediaElement): string => {
    try {
      return element.currentSrc || element.src || "";
    } catch {
      return "";
    }
  };

  const mediaDuration = (element: HTMLMediaElement): number => {
    try {
      return element.duration;
    } catch {
      return Number.NaN;
    }
  };

  const markFinished = (element: HTMLMediaElement): void => {
    const src = mediaSource(element);
    const duration = mediaDuration(element);
    let nearEnd = false;
    try {
      nearEnd = duration > 0 && duration - element.currentTime <= 1;
    } catch {
      /* ignore */
    }
    let ended = false;
    try {
      ended = element.ended;
    } catch {
      /* ignore */
    }
    if (ended || nearEnd) finished.set(element, { src, duration });
  };

  const isFinished = (element: HTMLMediaElement): boolean => {
    const src = mediaSource(element);
    const duration = mediaDuration(element);
    const previous = finished.get(element);
    if (previous && (previous.src !== src || Math.abs(previous.duration - duration) > 1)) {
      // 切换到了新的视频/分段，重新等待
      finished.delete(element);
    }
    markFinished(element);
    return finished.has(element);
  };

  const onFinishEvent = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLMediaElement) markFinished(target);
  };
  document.addEventListener("ended", onFinishEvent, true);
  document.addEventListener("timeupdate", onFinishEvent, true);

  const cleanup = () => {
    document.removeEventListener("ended", onFinishEvent, true);
    document.removeEventListener("timeupdate", onFinishEvent, true);
  };

  const tryResume = async (element: HTMLMediaElement, now: number) => {
    let paused = false;
    try {
      paused = element.paused;
    } catch {
      return;
    }
    if (!paused || isFinished(element)) {
      pausedSince.delete(element);
      return;
    }
    const last = lastAttempt.get(element) ?? 0;
    if (now - last < 2000) return;
    lastAttempt.set(element, now);
    focusMedia(element);
    try {
      // play() 可能因浏览器自动播放策略被拒绝；保持静音可显著提高成功率
      if (preferences.defaultMuted) element.muted = true;
      await element.play();
    } catch {
      // 部分播放器需要鼠标聚焦/点击视频区域后才允许播放
      try {
        element.click();
      } catch {
        /* ignore */
      }
      try {
        await element.play();
      } catch {
        /* 由下面的 blocked 判定处理 */
      }
    }
  };

  while (Date.now() - started < timeoutMs) {
    if (!isAlive()) {
      cleanup();
      return "none";
    }
    // 多视频/音频页面：只跟踪“未完成任务点”的媒体，并按 DOM 顺序逐个等待，
    // 避免主播放器启发式在多个媒体之间来回切换导致进度跳动。
    const connected = findMedia(doc).filter((element) => element.isConnected);
    const unfinished = connected.filter(
      (element) => !isTaskPointFinished(element) && !isFinished(element),
    );
    if (unfinished.length === 0) {
      cleanup();
      return connected.length > 0 ? "done" : "none";
    }
    const primary = pickPrimaryMedia(unfinished);
    if (!primary) {
      cleanup();
      return "none";
    }

    const now = Date.now();
    if (preferences.resumeOnPause) {
      await tryResume(primary, now);

      let paused = false;
      try {
        paused = primary.paused;
      } catch {
        paused = false;
      }
      if (!paused) {
        pausedSince.delete(primary);
      } else {
        if (!pausedSince.has(primary)) pausedSince.set(primary, now);
        const pausedFor = now - (pausedSince.get(primary) ?? now);
        if (pausedFor > 5000) {
          cleanup();
          return "blocked";
        }
      }
    } else {
      // 关闭“暂停后恢复”时也要给用户明确反馈，不能静默空转到超时。
      let paused = false;
      try {
        paused = primary.paused;
      } catch {
        paused = false;
      }
      if (paused) {
        if (!pausedSince.has(primary)) pausedSince.set(primary, now);
        const pausedFor = now - (pausedSince.get(primary) ?? now);
        if (pausedFor > 8000 && now - lastPausedNotice > 15000) {
          lastPausedNotice = now;
          onPausedNotice?.("视频已暂停，请手动点击播放；播放结束后会自动翻页");
        }
      } else {
        pausedSince.delete(primary);
      }
    }

    await sleep(1000);
  }
  cleanup();
  return "timeout";
}
