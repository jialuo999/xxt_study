/**
 * 学习通视频等待工具：只观察播放器真实状态，不伪造进度、不调用平台日志接口。
 *
 * 选择器思路参考 https://github.com/CodFrm/cxmooc-tools （MIT License），
 * 本项目为独立实现，未复制其源码。
 *
 * 用法（供 auto-turn 使用）：
 *   const result = await waitForVideoEnd(doc, 30 * 60 * 1000);
 *   if (result.ok) nextPage(ctx);
 */
import { queryFirst } from "../../utils/dom";
import { VIDEO_SELECTORS } from "./selectors";

export interface VideoWaitResult {
  ok: boolean;
  reason: string;
  duration?: number;
  currentTime?: number;
}

const POLL_INTERVAL_MS = 1000;
/** 距离结尾小于该秒数即视为播放完成（部分播放器不触发 ended） */
const END_TOLERANCE_SECONDS = 1;

/** 查找视频元素 */
export function findVideo(doc: Document): HTMLVideoElement | null {
  try {
    return queryFirst<HTMLVideoElement>(doc, [...VIDEO_SELECTORS]);
  } catch {
    return null;
  }
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function isVideoFinished(video: HTMLVideoElement): boolean {
  try {
    if (video.ended) return true;
    const duration = readNumber(video.duration);
    const currentTime = readNumber(video.currentTime);
    if (Number.isNaN(duration) || Number.isNaN(currentTime)) return false;
    return duration > 0 && duration - currentTime <= END_TOLERANCE_SECONDS;
  } catch {
    return false;
  }
}

function snapshot(video: HTMLVideoElement): Pick<VideoWaitResult, "duration" | "currentTime"> {
  const duration = readNumber(video.duration);
  const currentTime = readNumber(video.currentTime);
  return {
    duration: Number.isNaN(duration) ? undefined : duration,
    currentTime: Number.isNaN(currentTime) ? undefined : currentTime,
  };
}

/**
 * 等待视频播放结束。
 *
 * - 监听 ended / timeupdate 事件，并用低频轮询兜底；
 * - timeoutMs <= 0 表示不设超时（由上层控制取消）；
 * - 不修改播放状态、不 seek、不伪造观看进度。
 */
export function waitForVideoEnd(doc: Document, timeoutMs = 0): Promise<VideoWaitResult> {
  return new Promise<VideoWaitResult>((resolve) => {
    const video = findVideo(doc);
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    function snapshotOf(): Pick<VideoWaitResult, "duration" | "currentTime"> {
      return video ? snapshot(video) : {};
    }

    function finish(result: VideoWaitResult): void {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (pollTimer) clearInterval(pollTimer);
      if (video) {
        try {
          video.removeEventListener("ended", onEnded);
          video.removeEventListener("timeupdate", onTimeUpdate);
        } catch {
          /* ignore */
        }
      }
      resolve(result);
    }

    function onEnded(): void {
      finish({ ok: true, reason: "视频已结束（ended）", ...snapshotOf() });
    }

    function onTimeUpdate(): void {
      if (video && isVideoFinished(video)) {
        finish({ ok: true, reason: "视频已播放到结尾（timeupdate）", ...snapshotOf() });
      }
    }

    if (!video) {
      finish({ ok: false, reason: "未找到视频元素（#video_html5_api / video）" });
      return;
    }

    try {
      if (isVideoFinished(video)) {
        finish({ ok: true, reason: "视频已播放完成", ...snapshotOf() });
        return;
      }
      video.addEventListener("ended", onEnded);
      video.addEventListener("timeupdate", onTimeUpdate);
      pollTimer = setInterval(() => {
        if (video && isVideoFinished(video)) {
          finish({ ok: true, reason: "视频已播放完成（轮询）", ...snapshotOf() });
        }
      }, POLL_INTERVAL_MS);
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          finish({ ok: false, reason: `等待视频结束超时（${timeoutMs}ms）`, ...snapshotOf() });
        }, timeoutMs);
      }
    } catch {
      finish({ ok: false, reason: "监听视频事件失败" });
    }
  });
}
