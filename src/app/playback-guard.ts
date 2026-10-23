import { collectDocumentMedia, focusMedia } from "./media-preferences";

/**
 * 播放保活守卫：自动翻页期间，平台/静音/失焦导致的 `pause` 被自动恢复，
 * 但「用户主动暂停」与「脚本主动暂停」都不会被抢。
 *
 * 设计约束（见 docs/superpowers/specs/2026-10-24-oss-informed-hardening-design.md 3.1）：
 * - 只在接入方显式启动后工作，并跟随 `isEnabled`（默认跟随 video.resumeOnPause 由接入方注入）；
 * - 脚本自己暂停媒体前调用 `suspend()`，恢复目标时调用 `resume()`（不会立即播放）；
 * - pause 前 1.5s 内有播放器区域内的用户手势 → 视为人工暂停，尊重 30s 或直到 play；
 * - 同一媒体连续失败 3 次后退避 30s，只提示一次，不无限刷 `play()`；
 * - 恢复后 2s 检查进度连续性，只记录/提示停滞与跳变，不改 `currentTime`、不伪造进度；
 * - 不处理 `ended`，不进入 iframe / Shadow（默认只覆盖当前文档，Shadow 由 collectDocumentMedia 覆盖）。
 *
 * 本模块不做平台判断、不发消息、不写日志：提示通过 `onNotice` 交给 host 决定 toast/日志。
 */

export type PlaybackNoticeLevel = "info" | "warn";

export interface PlaybackGuardOptions {
  /** 目标文档，默认当前 document；iframe 内由该 frame 自己的实例处理 */
  doc?: Document;
  /** 是否启用；接入方通常传 () => getSettings().video.resumeOnPause */
  isEnabled?: () => boolean;
  /** 媒体收集器，默认 collectDocumentMedia(doc)（light DOM + open Shadow Root） */
  collectMedia?: () => HTMLMediaElement[];
  /** 时间源，默认 Date.now（测试可注入） */
  now?: () => number;
  /** 提示回调；host 可据此限频 toast + 日志 */
  onNotice?: (message: string, level: PlaybackNoticeLevel) => void;
}

export interface PlaybackGuardStats {
  /** 成功恢复次数 */
  resumes: number;
  /** 恢复失败次数（一次恢复尝试内 play 与 click 回退都失败记一次） */
  failures: number;
  /** 恢复后 2s 内进度不增长的次数 */
  stalls: number;
  /** 恢复后进度大幅跳变的次数 */
  seeks: number;
}

export interface PlaybackGuard {
  /** 守卫是否在运行（start 之后、stop 之前为 true，与 isEnabled 无关） */
  readonly isRunning: boolean;
  /** 停止并清理所有监听/定时器；可重复调用 */
  stop(): void;
  /** 脚本主动暂停媒体前调用：清空待恢复并停止自动恢复 */
  suspend(): void;
  /** 脚本主动恢复目标媒体后调用：解除 suspend，但不立即 play */
  resume(): void;
  getStats(): PlaybackGuardStats;
}

/** 低频轮询兜底：漏掉 pause 事件时也能发现停住的播放器 */
const POLL_INTERVAL_MS = 1_200;
/** 平台 pause 后稍等再恢复，给播放器自身状态一个稳定窗口 */
const RESUME_DELAY_MS = 150;
/** pause 事件前这么久内出现过播放器区域内的用户手势，视为人工暂停 */
const USER_GESTURE_WINDOW_MS = 1_500;
/** 人工暂停需要尊重的时长（期间不自动恢复，直到再次 play） */
const MANUAL_PAUSE_MS = 30_000;
/** 同一媒体连续失败达到该值后进入退避 */
const MAX_CONSECUTIVE_FAILURES = 3;
/** 连续失败后的退避时长 */
const FAILURE_BACKOFF_MS = 30_000;
/** 恢复后进度连续性检查窗口 */
const PROGRESS_CHECK_MS = 2_000;
/** 2s 内进度增长不超过该值视为停滞 */
const STALL_DELTA_S = 0.1;
/** 2s 内进度跳变超过该值视为 seek（只记录，不调整） */
const SEEK_DELTA_S = 10;

interface FailureState {
  consecutive: number;
  backoffUntil: number;
  /** 是否已就当前这一串失败提示过（避免刷屏） */
  notified: boolean;
}

/** 跨 realm 安全：只认标签名，避免 iframe 文档里的元素 instanceof 失败 */
function isMediaElement(node: EventTarget | null | undefined): node is HTMLMediaElement {
  if (!node || typeof node !== "object") return false;
  const tagName = (node as { tagName?: unknown }).tagName;
  return tagName === "VIDEO" || tagName === "AUDIO";
}

function isElementLike(node: EventTarget | null | undefined): node is Element {
  if (!node || typeof node !== "object") return false;
  return typeof (node as { tagName?: unknown }).tagName === "string";
}

export function startPlaybackGuard(options: PlaybackGuardOptions = {}): PlaybackGuard {
  const doc = options.doc ?? document;
  const now = options.now ?? (() => Date.now());
  const isEnabled = options.isEnabled ?? (() => true);
  const collectMedia = options.collectMedia ?? (() => collectDocumentMedia(doc));
  const notify = options.onNotice ?? (() => undefined);

  const stats: PlaybackGuardStats = { resumes: 0, failures: 0, stalls: 0, seeks: 0 };
  const failureStates = new Map<HTMLMediaElement, FailureState>();
  const pendingResumes = new Map<HTMLMediaElement, ReturnType<typeof setTimeout>>();
  const progressTimers = new Map<HTMLMediaElement, ReturnType<typeof setTimeout>>();
  /** 每媒体的人工暂停窗口（Map 而非常量：多播放器互不干扰） */
  const manualPauses = new Map<HTMLMediaElement, number>();
  const observedMedia = new WeakSet<HTMLMediaElement>();
  const abortController = typeof AbortController !== "undefined" ? new AbortController() : null;

  let stopped = false;
  let suspended = false;
  let lastGestureAt = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const enabled = (): boolean => {
    if (stopped) return false;
    try {
      return isEnabled();
    } catch {
      return false;
    }
  };

  const warn = (message: string): void => {
    try {
      notify(message, "warn");
    } catch {
      /* 提示失败不影响守卫本身 */
    }
  };

  const collect = (): HTMLMediaElement[] => {
    try {
      const media = collectMedia();
      return media.filter((item) => isMediaElement(item));
    } catch {
      return [];
    }
  };

  // 守卫启动前就已暂停且已有进度的媒体，通常是用户自己暂停的；
  // 先按人工暂停处理，避免“一开自动翻页就把用户暂停的视频抢走”。
  // 暂停在 0 秒的预加载媒体不在此列，仍由任务点顺序逻辑正常开始播放。
  for (const media of collect()) {
    try {
      if (media.paused && !media.ended && media.currentTime > 0) {
        manualPauses.set(media, now() + MANUAL_PAUSE_MS);
      }
    } catch {
      /* ignore */
    }
  }

  const manualPauseActive = (media: HTMLMediaElement): boolean => {
    const until = manualPauses.get(media);
    if (until === undefined) return false;
    if (until <= now()) {
      manualPauses.delete(media);
      return false;
    }
    return true;
  };

  const cancelPendingResume = (media: HTMLMediaElement): void => {
    const timer = pendingResumes.get(media);
    if (timer === undefined) return;
    clearTimeout(timer);
    pendingResumes.delete(media);
  };

  const cancelAllPendingResumes = (): void => {
    for (const timer of pendingResumes.values()) clearTimeout(timer);
    pendingResumes.clear();
  };

  const cancelProgressCheck = (media: HTMLMediaElement): void => {
    const timer = progressTimers.get(media);
    if (timer === undefined) return;
    clearTimeout(timer);
    progressTimers.delete(media);
  };

  const cancelAllProgressChecks = (): void => {
    for (const timer of progressTimers.values()) clearTimeout(timer);
    progressTimers.clear();
  };

  const shouldResume = (media: HTMLMediaElement): boolean => {
    if (!enabled() || suspended) return false;
    if (manualPauseActive(media)) return false;
    try {
      // 结束的不处理；正在播放的不需要恢复
      if (media.ended || !media.paused) return false;
    } catch {
      return false;
    }
    const state = failureStates.get(media);
    return !state || state.backoffUntil <= now();
  };

  const recordFailure = (media: HTMLMediaElement): void => {
    stats.failures++;
    const state = failureStates.get(media) ?? {
      consecutive: 0,
      backoffUntil: 0,
      notified: false,
    };
    state.consecutive++;
    if (state.consecutive >= MAX_CONSECUTIVE_FAILURES) {
      state.consecutive = 0;
      state.backoffUntil = now() + FAILURE_BACKOFF_MS;
      if (!state.notified) {
        state.notified = true;
        warn(
          `自动恢复播放连续失败 ${MAX_CONSECUTIVE_FAILURES} 次，暂停重试 ${FAILURE_BACKOFF_MS / 1000} 秒`,
        );
      }
    }
    failureStates.set(media, state);
  };

  const evaluateProgress = (media: HTMLMediaElement, baseTime: number): void => {
    if (stopped || suspended) return;
    try {
      // 已被再次暂停/结束：交给 pause/ended 处理，不做误判
      if (media.ended || media.paused) return;
    } catch {
      return;
    }
    let currentTime: number;
    try {
      currentTime = Number(media.currentTime);
    } catch {
      return;
    }
    if (!Number.isFinite(currentTime)) return;
    const delta = currentTime - baseTime;
    if (delta > SEEK_DELTA_S) {
      stats.seeks++;
      warn(`播放进度跳变约 ${Math.round(delta)} 秒（仅记录，不调整进度）`);
      return;
    }
    if (delta <= STALL_DELTA_S) {
      stats.stalls++;
      warn("恢复播放后 2 秒内进度未增长，可能被播放器拦截");
    }
  };

  const scheduleProgressCheck = (media: HTMLMediaElement): void => {
    cancelProgressCheck(media);
    let baseTime: number;
    try {
      baseTime = Number(media.currentTime);
    } catch {
      return;
    }
    if (!Number.isFinite(baseTime)) baseTime = 0;
    const timer = setTimeout(() => {
      progressTimers.delete(media);
      evaluateProgress(media, baseTime);
    }, PROGRESS_CHECK_MS);
    progressTimers.set(media, timer);
  };

  const onResumed = (media: HTMLMediaElement): void => {
    stats.resumes++;
    failureStates.delete(media);
    scheduleProgressCheck(media);
  };

  const attemptResume = async (media: HTMLMediaElement): Promise<void> => {
    if (!shouldResume(media)) return;
    try {
      await media.play();
      onResumed(media);
      return;
    } catch {
      /* 首次 play 被拒：走 focus + click 回退 */
    }
    // 期间状态已变化（可能已被用户/平台恢复，或进入人工暂停/结束），不再重试也不计失败
    if (!shouldResume(media)) return;
    try {
      focusMedia(media);
      media.click();
      await media.play();
      onResumed(media);
    } catch {
      recordFailure(media);
    }
  };

  const scheduleResume = (media: HTMLMediaElement): void => {
    if (stopped || pendingResumes.has(media)) return;
    const timer = setTimeout(() => {
      pendingResumes.delete(media);
      void attemptResume(media);
    }, RESUME_DELAY_MS);
    pendingResumes.set(media, timer);
  };

  /** 取走最近一次播放器区域内的用户手势（1.5s 窗口） */
  const takeRecentGesture = (): boolean => {
    if (lastGestureAt === 0) return false;
    const recent = now() - lastGestureAt <= USER_GESTURE_WINDOW_MS;
    lastGestureAt = 0;
    return recent;
  };

  const isInPlayerArea = (target: Element): boolean => {
    if (isMediaElement(target)) return true;
    try {
      if (target.closest("video, audio, [class*='player']")) return true;
    } catch {
      /* ignore */
    }
    const body = doc.body;
    const root = doc.documentElement;
    for (const media of collect()) {
      // 控件在 Shadow DOM 时事件 target 会被重定向到宿主，直接检查宿主
      try {
        const mediaRoot = media.getRootNode() as { host?: Element } | null;
        if (mediaRoot && "host" in mediaRoot && mediaRoot.host === target) return true;
      } catch {
        /* ignore */
      }
      let wrapper: Element | null = media.parentElement;
      for (let depth = 0; wrapper && depth < 4; depth++) {
        // 到 body/documentElement 就停：否则页面任意点击都会被误判成播放器手势
        if (wrapper === body || wrapper === root) break;
        try {
          if (wrapper.contains(target)) return true;
        } catch {
          break;
        }
        wrapper = wrapper.parentElement;
      }
    }
    return false;
  };

  const isPlayerGesture = (event: Event): boolean => {
    try {
      if (isMediaElement(doc.activeElement)) return true;
    } catch {
      /* ignore */
    }
    // 播放器控件可能位于 open/closed Shadow DOM，事件 target 会被重定向到宿主；
    // composedPath 能看到真实控件节点，避免把用户在控件上的暂停误判成平台暂停。
    try {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      for (const node of path) {
        if (isMediaElement(node)) return true;
        if (!isElementLike(node)) continue;
        if (node.tagName === "BODY" || node.tagName === "HTML") break;
        try {
          if (
            node.closest(
              "video, audio, [class*='player'], .vjs-control-bar, .prism-controls, .vjs-play-control",
            )
          ) {
            return true;
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    const target = event.target;
    if (!isElementLike(target)) return false;
    // 播放器 Shadow DOM 的事件 target 是宿主；宿主内部有 video/audio 即视为播放器区域
    try {
      if (target.shadowRoot?.querySelector("video, audio")) return true;
    } catch {
      /* ignore */
    }
    const tagName = target.tagName;
    if (tagName === "BODY" || tagName === "HTML") return false;
    return isInPlayerArea(target);
  };

  const onGesture = (event: Event): void => {
    if (stopped) return;
    // 系统媒体键可能以 Body 为 target；这类按键就是明确的播放/暂停意图
    if (event instanceof KeyboardEvent) {
      if (
        event.key === "MediaPlayPause" ||
        event.key === "MediaPlay" ||
        event.key === "MediaPause" ||
        event.key === "MediaStop"
      ) {
        lastGestureAt = now();
        return;
      }
    }
    const playerGesture = isPlayerGesture(event);
    if (!playerGesture) return;
    lastGestureAt = now();
  };

  const onPause = (event: Event): void => {
    const media = event.target;
    if (!isMediaElement(media)) return;
    if (!enabled() || suspended) return;
    if (manualPauseActive(media)) return;
    try {
      if (media.ended) return;
    } catch {
      return;
    }
    if (takeRecentGesture()) {
      manualPauses.set(media, now() + MANUAL_PAUSE_MS);
      return;
    }
    scheduleResume(media);
  };

  const onPlay = (event: Event): void => {
    const media = event.target;
    if (!isMediaElement(media)) return;
    cancelPendingResume(media);
    failureStates.delete(media);
    // 用户/平台重新播放即视为人工暂停结束
    manualPauses.delete(media);
  };

  const onEnded = (event: Event): void => {
    const media = event.target;
    if (!isMediaElement(media)) return;
    cancelPendingResume(media);
    cancelProgressCheck(media);
    failureStates.delete(media);
    manualPauses.delete(media);
  };

  /**
   * Shadow DOM 内的媒体事件不会以 composed 形式冒泡到 document，
   * 必须在媒体元素本身上补监听，否则“用户点控件暂停”永远只能靠轮询发现。
   */
  const observeMedia = (media: HTMLMediaElement): void => {
    if (observedMedia.has(media)) return;
    try {
      if (media.getRootNode() === doc) return;
    } catch {
      return;
    }
    observedMedia.add(media);
    const options: AddEventListenerOptions = abortController
      ? { capture: true, signal: abortController.signal }
      : { capture: true };
    try {
      media.addEventListener("pause", onPause, options);
      media.addEventListener("play", onPlay, options);
      media.addEventListener("ended", onEnded, options);
    } catch {
      /* ignore */
    }
  };

  const sweep = (): void => {
    if (!enabled() || suspended) return;
    for (const media of collect()) {
      observeMedia(media);
      if (pendingResumes.has(media)) continue;
      if (manualPauseActive(media)) continue;
      try {
        if (media.ended || !media.paused) continue;
      } catch {
        continue;
      }
      scheduleResume(media);
    }
  };

  const onVisibilityChange = (): void => {
    if (stopped) return;
    let hidden = false;
    try {
      hidden = doc.visibilityState === "hidden";
    } catch {
      hidden = false;
    }
    if (hidden) return;
    // 回到可见时补一次扫描：平台上常在失焦时静默 pause，事件可能丢失
    sweep();
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    cancelAllPendingResumes();
    cancelAllProgressChecks();
    failureStates.clear();
    manualPauses.clear();
    abortController?.abort();
    doc.removeEventListener("pause", onPause, true);
    doc.removeEventListener("play", onPlay, true);
    doc.removeEventListener("ended", onEnded, true);
    doc.removeEventListener("pointerdown", onGesture, true);
    doc.removeEventListener("keydown", onGesture, true);
    doc.removeEventListener("visibilitychange", onVisibilityChange);
  };

  const suspendGuard = (): void => {
    if (stopped) return;
    suspended = true;
    cancelAllPendingResumes();
    cancelAllProgressChecks();
  };

  const resumeGuard = (): void => {
    if (stopped) return;
    // 只解除暂停标记，不立刻 play：由 pause 事件/轮询按正常流程恢复
    suspended = false;
  };

  doc.addEventListener("pause", onPause, true);
  doc.addEventListener("play", onPlay, true);
  doc.addEventListener("ended", onEnded, true);
  doc.addEventListener("pointerdown", onGesture, true);
  doc.addEventListener("keydown", onGesture, true);
  doc.addEventListener("visibilitychange", onVisibilityChange);
  for (const media of collect()) observeMedia(media);
  pollTimer = setInterval(sweep, POLL_INTERVAL_MS);

  return {
    get isRunning(): boolean {
      return !stopped;
    },
    stop,
    suspend: suspendGuard,
    resume: resumeGuard,
    getStats: () => ({ ...stats }),
  };
}
