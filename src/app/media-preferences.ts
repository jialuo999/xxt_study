import { getSettings, subscribeSettings } from "@/core/settings-store";
import type { VideoSettings } from "@/core/settings";
import { clamp } from "@/utils/async";

const MIN_RATE = 0.25;
const MAX_RATE = 4;

function collectMedia(doc: Document = document, depth = 0): HTMLMediaElement[] {
  const media: HTMLMediaElement[] = [];
  try {
    media.push(...Array.from(doc.querySelectorAll<HTMLMediaElement>("video, audio")));
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

function applyToMedia(media: HTMLMediaElement, settings: VideoSettings): void {
  try {
    const rate = clamp(Number(settings.playbackRate) || 1, MIN_RATE, MAX_RATE);
    if (media.muted !== settings.defaultMuted) media.muted = settings.defaultMuted;
    try {
      media.defaultMuted = settings.defaultMuted;
    } catch {
      /* older browsers */
    }
    if (Math.abs(media.playbackRate - rate) > 0.001) media.playbackRate = rate;
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
 * 监听媒体创建与播放事件，持续应用用户的默认静音/倍速。
 * 在每个 frame 中独立启动；同一 frame 只调用一次。
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
      // 新 source / 播放器重建时重新应用默认值，但不持续覆盖用户手动调整
      applyToMedia(target, getSettings().video);
      initialized.add(target);
      if (getSettings().video.autoPlay) void tryPlay(target);
    }
  };

  const onPause = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLMediaElement)) return;
    if (!getSettings().video.resumeOnPause) return;
    if (target.ended) return;
    // 播放器/平台有时会在缓冲或切段时把视频暂停，稍等再尝试恢复
    setTimeout(() => {
      if (target.paused && !target.ended) void tryPlay(target);
    }, 200);
  };

  document.addEventListener("loadedmetadata", onMediaReady, true);
  document.addEventListener("play", onMediaReady, true);
  document.addEventListener("pause", onPause, true);

  const unsubscribe = subscribeSettings(() => applyAll());

  return () => {
    if (timer) clearTimeout(timer);
    observer.disconnect();
    document.removeEventListener("loadedmetadata", onMediaReady, true);
    document.removeEventListener("play", onMediaReady, true);
    document.removeEventListener("pause", onPause, true);
    unsubscribe();
  };
}

async function tryPlay(media: HTMLMediaElement): Promise<void> {
  try {
    if (getSettings().video.defaultMuted) media.muted = true;
    await media.play();
  } catch {
    /* 浏览器自动播放策略可能拒绝；由自动翻页层提示手动播放 */
  }
}

export { collectMedia };
