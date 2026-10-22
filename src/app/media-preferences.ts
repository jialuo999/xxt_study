import { getSettings, subscribeSettings } from "@/core/settings-store";
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

function collectMedia(doc: Document = document, depth = 0): HTMLMediaElement[] {
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

function applyToMedia(media: HTMLMediaElement, settings: VideoSettings): void {
  try {
    if (media.muted !== settings.defaultMuted) media.muted = settings.defaultMuted;
    try {
      media.defaultMuted = settings.defaultMuted;
    } catch {
      /* older browsers */
    }
    applyRate(media, settings.playbackRate);
  } catch {
    /* 某些播放器会锁定这些属性 */
  }
}

/** 应用视频/音频静音与倍速（导出供测试与子 frame 复用） */
export function applyMediaPreferences(
  doc: Document = document,
  settings: VideoSettings = getSettings().video,
): number {
  const media = collectMedia(doc);
  for (const element of media) applyToMedia(element, settings);
  return media.length;
}

/**
 * 监听媒体创建与播放事件，应用静音/倍速。
 *
 * 平台播放器经常在 loadedmetadata、切段或播放开始时把 playbackRate 重置为 1，
 * 因此当用户选择非 1x 时，每 2 秒重新断言一次倍速（参考公开脚本的常见做法）。
 * 暂停恢复不在这里做：只有自动翻页等待媒体结束、或宿主显式请求时才恢复。
 */
export function startMediaPreferences(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const initialized = new WeakSet<HTMLMediaElement>();

  const applyAll = () => {
    for (const media of collectMedia()) {
      applyToMedia(media, getSettings().video);
      initialized.add(media);
    }
  };

  const applyNew = () => {
    for (const media of collectMedia()) {
      if (initialized.has(media)) continue;
      applyToMedia(media, getSettings().video);
      initialized.add(media);
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

  const onMediaReady = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLMediaElement) {
      applyToMedia(target, getSettings().video);
      initialized.add(target);
    }
  };
  document.addEventListener("loadedmetadata", onMediaReady, true);
  document.addEventListener("canplay", onMediaReady, true);
  document.addEventListener("play", onMediaReady, true);

  // 学习通等播放器可能在播放中重置倍速，定时重新应用（不改静音，避免覆盖用户操作）
  const rateTimer = setInterval(() => {
    const rate = getSettings().video.playbackRate;
    if (Math.abs(rate - 1) < 0.001) return;
    for (const media of collectMedia()) applyRate(media, rate);
  }, 2000);

  const unsubscribe = subscribeSettings(() => applyAll());

  return () => {
    if (timer) clearTimeout(timer);
    clearInterval(rateTimer);
    observer.disconnect();
    document.removeEventListener("loadedmetadata", onMediaReady, true);
    document.removeEventListener("canplay", onMediaReady, true);
    document.removeEventListener("play", onMediaReady, true);
    unsubscribe();
  };
}

export { collectMedia };
