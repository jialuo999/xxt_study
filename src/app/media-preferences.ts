import {
  getSettings,
  refreshSettings,
  startExternalSettingsSync,
  subscribeSettings,
} from "@/core/settings-store";
import type { VideoSettings } from "@/core/settings";
import { clamp } from "@/utils/async";

const MIN_RATE = 0.25;
const MAX_RATE = 4;

function collectShadowMedia(root: ParentNode, out: HTMLMediaElement[], depth = 0): void {
  if (depth > 3) return;
  try {
    const all = root.querySelectorAll<HTMLElement>("*");
    const limit = Math.min(all.length, 800);
    for (let index = 0; index < limit; index++) {
      const shadow = all[index]?.shadowRoot;
      if (!shadow) continue;
      out.push(...Array.from(shadow.querySelectorAll<HTMLMediaElement>("video, audio")));
      collectShadowMedia(shadow, out, depth + 1);
    }
  } catch {
    /* ignore */
  }
}

function collectDocumentMedia(doc: Document = document): HTMLMediaElement[] {
  const media: HTMLMediaElement[] = [];
  try {
    media.push(...Array.from(doc.querySelectorAll<HTMLMediaElement>("video, audio")));
    if (media.length === 0) {
      // 新版播放器可能把 video 放进 Shadow DOM
      collectShadowMedia(doc, media);
    }
  } catch {
    /* ignore */
  }
  return media;
}

function collectMedia(doc: Document = document, depth = 0): HTMLMediaElement[] {
  const media = collectDocumentMedia(doc);
  if (depth >= 3) return media;
  for (const iframe of Array.from(doc.querySelectorAll("iframe"))) {
    try {
      const childDoc = iframe.contentDocument;
      if (childDoc) media.push(...collectMedia(childDoc, depth + 1));
    } catch {
      // 跨域 iframe：由该 iframe 内的脚本自行应用
    }
  }
  return media;
}

/** 多视频/音频页面里选出“当前主播放器”：优先正在播放，其次可见面积最大 */
export function pickPrimaryMedia(media: HTMLMediaElement[]): HTMLMediaElement | null {
  let best: HTMLMediaElement | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const element of media) {
    let score = 0;
    try {
      const rect = element.getBoundingClientRect();
      score += Math.max(0, rect.width) * Math.max(0, rect.height);
    } catch {
      /* ignore */
    }
    try {
      if (!element.paused && !element.ended) score += 1e9;
    } catch {
      /* ignore */
    }
    try {
      if (element.currentTime > 0) score += 1e6;
    } catch {
      /* ignore */
    }
    if (score > bestScore) {
      best = element;
      bestScore = score;
    }
  }
  return best;
}

function applyRate(media: HTMLMediaElement, rateValue: number): void {
  const rate = clamp(Number(rateValue) || 1, MIN_RATE, MAX_RATE);
  try {
    if (Math.abs(media.playbackRate - rate) > 0.001) media.playbackRate = rate;
  } catch {
    /* 某些播放器会锁定倍速 */
  }
  try {
    media.defaultPlaybackRate = rate;
  } catch {
    /* older browsers */
  }
}

/**
 * 让播放器获得焦点并模拟一次鼠标移入。
 * 部分平台播放器只有在视频区域获得焦点/鼠标悬停时才响应播放、倍速等操作。
 */
export function focusMedia(media: HTMLMediaElement): void {
  try {
    if (media.tabIndex < 0) media.tabIndex = 0;
    media.focus({ preventScroll: true });
  } catch {
    try {
      media.focus();
    } catch {
      /* ignore */
    }
  }
  try {
    const win = media.ownerDocument.defaultView;
    if (!win) return;
    media.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
    media.dispatchEvent(new win.MouseEvent("mouseenter", { bubbles: false }));
    media.dispatchEvent(
      new win.MouseEvent("mousemove", { bubbles: true, clientX: 1, clientY: 1 }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * 一次性强制应用静音与倍速（仅测试或显式调用；生产请用 startMediaPreferences）。
 * 注意：defaultMuted=false 时会强制取消静音，且 1x 也会写入倍速。
 */
export function applyMediaPreferences(
  doc: Document = document,
  settings: VideoSettings = getSettings().video,
): number {
  const media = collectDocumentMedia(doc);
  for (const element of media) {
    try {
      if (element.muted !== settings.defaultMuted) element.muted = settings.defaultMuted;
      element.defaultMuted = settings.defaultMuted;
    } catch {
      /* 某些播放器会锁定静音属性 */
    }
    applyRate(element, settings.playbackRate);
  }
  return media.length;
}

/**
 * 监听媒体创建并应用静音/倍速。
 *
 * 设计原则：尽量不打扰用户。
 * - 默认静音只在新媒体第一次出现时应用一次；用户手动静音/取消静音后不再覆盖。
 * - 设置 1x 时完全不写 playbackRate，避免覆盖播放器内手动调整的速度。
 * - 普通设置变更（主题、折叠板块等）不触发媒体重置；只有视频设置真正变化才应用。
 * - 非 1x 时，平台重置倍速后由 timeupdate / 定时器补回。
 */
export function startMediaPreferences(): () => void {
  const initialized = new WeakSet<HTMLMediaElement>();
  let mutedByUser = new WeakSet<HTMLMediaElement>();
  const lastAppliedMuted = new WeakMap<HTMLMediaElement, boolean>();
  let lastVideo = { ...getSettings().video };
  let timer: ReturnType<typeof setTimeout> | null = null;

  const muteOnce = (media: HTMLMediaElement, defaultMuted: boolean): void => {
    if (!defaultMuted || mutedByUser.has(media) || media.muted) return;
    try {
      media.muted = true;
      media.defaultMuted = true;
    } catch {
      return;
    }
    lastAppliedMuted.set(media, true);
  };

  const applyConfiguredRate = (media: HTMLMediaElement, rateValue: number): void => {
    // 1x 表示保持播放器原速，不主动写入
    if (Math.abs(rateValue - 1) < 0.001) return;
    applyRate(media, rateValue);
  };

  const applyToMedia = (media: HTMLMediaElement, settings: VideoSettings): void => {
    muteOnce(media, settings.defaultMuted);
    applyConfiguredRate(media, settings.playbackRate);
    initialized.add(media);
  };

  const applyAll = (): void => {
    const settings = getSettings().video;
    for (const media of collectDocumentMedia()) applyToMedia(media, settings);
  };

  const applyNew = (): void => {
    const settings = getSettings().video;
    for (const media of collectDocumentMedia()) {
      if (!initialized.has(media)) applyToMedia(media, settings);
    }
  };

  const schedule = (apply: () => void) => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      apply();
    }, 250);
  };

  applyAll();

  const observer = new MutationObserver(() => schedule(applyNew));
  try {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch {
    /* ignore */
  }

  /** 用户手动静音/取消静音后，后续不再覆盖 */
  const onVolumeChange = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLMediaElement)) return;
    const applied = lastAppliedMuted.get(target);
    if (applied !== undefined && target.muted !== applied) mutedByUser.add(target);
  };
  document.addEventListener("volumechange", onVolumeChange, true);

  const onMediaReady = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLMediaElement)) return;
    // 子 frame 可能刚收到顶层的倍速变更，先同步一次设置
    refreshSettings();
    if (!initialized.has(target)) {
      applyToMedia(target, getSettings().video);
      return;
    }
    // 非 1x 时平台可能在播放开始后重置倍速，补一次；1x 不干预
    applyConfiguredRate(target, getSettings().video.playbackRate);
  };
  let lastRateCheck = 0;
  const onTimeUpdate = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLMediaElement)) return;
    const rate = getSettings().video.playbackRate;
    if (Math.abs(rate - 1) < 0.001) return;
    const now = Date.now();
    if (now - lastRateCheck < 1000) return;
    lastRateCheck = now;
    applyRate(target, rate);
  };
  const lastRateFix = new WeakMap<HTMLMediaElement, number>();
  const onRateChange = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLMediaElement)) return;
    const rate = getSettings().video.playbackRate;
    if (Math.abs(rate - 1) < 0.001) return;
    if (Math.abs(target.playbackRate - rate) < 0.001) return;
    const now = Date.now();
    if (now - (lastRateFix.get(target) ?? 0) < 200) return;
    lastRateFix.set(target, now);
    // 播放器可能在 ratechange 里把倍速重置，立即补回
    applyRate(target, rate);
  };
  document.addEventListener("loadedmetadata", onMediaReady, true);
  document.addEventListener("canplay", onMediaReady, true);
  document.addEventListener("play", onMediaReady, true);
  document.addEventListener("timeupdate", onTimeUpdate, true);
  document.addEventListener("ratechange", onRateChange, true);

  // 定时同步跨 frame 设置；非 1x 时补回被播放器重置的倍速
  const syncTimer = setInterval(() => {
    refreshSettings();
    const rate = getSettings().video.playbackRate;
    if (Math.abs(rate - 1) < 0.001) return;
    for (const media of collectDocumentMedia()) applyRate(media, rate);
  }, 1500);

  // GM 存储支持时立即收到其他 frame 的设置变更；轮询作为不支持时的兜底
  const stopExternalSync = startExternalSettingsSync();

  const unsubscribe = subscribeSettings(() => {
    const next = { ...getSettings().video };
    const rateChanged = Math.abs(next.playbackRate - lastVideo.playbackRate) > 0.001;
    const muteChanged = next.defaultMuted !== lastVideo.defaultMuted;
    lastVideo = next;

    // 用户显式改设置时才重置静音；关闭默认静音不强行为用户取消静音
    if (muteChanged) {
      mutedByUser = new WeakSet<HTMLMediaElement>();
      if (next.defaultMuted) {
        for (const media of collectDocumentMedia()) muteOnce(media, true);
      }
    }
    if (rateChanged) {
      for (const media of collectDocumentMedia()) applyRate(media, next.playbackRate);
    }
  });

  return () => {
    if (timer) clearTimeout(timer);
    clearInterval(syncTimer);
    observer.disconnect();
    document.removeEventListener("loadedmetadata", onMediaReady, true);
    document.removeEventListener("canplay", onMediaReady, true);
    document.removeEventListener("play", onMediaReady, true);
    document.removeEventListener("timeupdate", onTimeUpdate, true);
    document.removeEventListener("ratechange", onRateChange, true);
    document.removeEventListener("volumechange", onVolumeChange, true);
    stopExternalSync();
    unsubscribe();
  };
}

export { collectMedia };

