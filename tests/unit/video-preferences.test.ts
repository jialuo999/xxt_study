import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyMediaPreferences,
  collectMedia,
  startMediaPreferences,
} from "../../src/app/media-preferences";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../../src/core/settings";
import { replaceSettings, updateSettings } from "../../src/core/settings-store";

let stopPreferences: (() => void) | null = null;

describe("media-preferences", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    replaceSettings(structuredClone(DEFAULT_SETTINGS));
  });

  afterEach(() => {
    stopPreferences?.();
    stopPreferences = null;
    vi.useRealTimers();
    replaceSettings(structuredClone(DEFAULT_SETTINGS));
  });

  it("应用默认静音与倍速到页面中的 video/audio", () => {
    const video = document.createElement("video");
    const audio = document.createElement("audio");
    document.body.append(video, audio);

    const count = applyMediaPreferences(document, {
      defaultMuted: true,
      playbackRate: 1.5,
      resumeOnPause: true,
    });

    expect(count).toBe(2);
    expect(video.muted).toBe(true);
    expect(video.playbackRate).toBe(1.5);
    expect(audio.muted).toBe(true);
    expect(audio.playbackRate).toBe(1.5);

    applyMediaPreferences(document, {
      defaultMuted: false,
      playbackRate: 1,
      resumeOnPause: true,
    });
    expect(video.muted).toBe(false);
    expect(video.playbackRate).toBe(1);
  });

  it("倍速越界时收敛到 0.25–4", () => {
    const video = document.createElement("video");
    document.body.appendChild(video);

    applyMediaPreferences(document, {
      defaultMuted: false,
      playbackRate: 99,
      resumeOnPause: true,
    });
    expect(video.playbackRate).toBe(4);
    applyMediaPreferences(document, {
      defaultMuted: false,
      playbackRate: 0.01,
      resumeOnPause: true,
    });
    expect(video.playbackRate).toBe(0.25);
  });

  it("能穿透 Shadow DOM 找到播放器里的 video", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    shadow.appendChild(video);
    document.body.appendChild(host);

    const count = applyMediaPreferences(document, {
      defaultMuted: true,
      playbackRate: 2,
      resumeOnPause: true,
    });
    expect(count).toBe(1);
    expect(video.playbackRate).toBe(2);
  });

  it("媒体偏好只处理当前文档，同源 iframe 交给子 frame 自己的实例", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const childDoc = iframe.contentDocument;
    expect(childDoc).not.toBeNull();
    const video = childDoc!.createElement("video");
    childDoc!.body.appendChild(video);

    const count = applyMediaPreferences(document, {
      defaultMuted: true,
      playbackRate: 2,
      resumeOnPause: true,
    });
    expect(count).toBe(0);
    expect(video.muted).toBe(false);
    expect(collectMedia(document)).toContain(video);
  });

  it("平台重置倍速后定时重新应用设置", async () => {
    vi.useFakeTimers();
    updateSettings({ video: { playbackRate: 1.5 } });
    stopPreferences = startMediaPreferences();
    const video = document.createElement("video");
    document.body.appendChild(video);
    await vi.advanceTimersByTimeAsync(300);
    expect(video.playbackRate).toBe(1.5);
    video.playbackRate = 1; // 模拟平台播放器重置
    await vi.advanceTimersByTimeAsync(2500);
    expect(video.playbackRate).toBe(1.5);
  });

  it("关闭默认静音后不覆盖用户手动静音状态", async () => {
    vi.useFakeTimers();
    updateSettings({ video: { defaultMuted: false } });
    stopPreferences = startMediaPreferences();
    const video = document.createElement("video");
    video.muted = true;
    document.body.appendChild(video);

    await vi.advanceTimersByTimeAsync(300);
    expect(video.muted).toBe(true);

    video.dispatchEvent(new Event("play"));
    video.dispatchEvent(new Event("canplay"));
    await vi.advanceTimersByTimeAsync(300);
    expect(video.muted).toBe(true);

    // 普通设置变更不应重置媒体状态
    updateSettings({ ui: { theme: "dark" } });
    await vi.advanceTimersByTimeAsync(10);
    expect(video.muted).toBe(true);
  });

  it("默认静音开启时用户取消静音后不再强制静音", async () => {
    vi.useFakeTimers();
    updateSettings({ video: { defaultMuted: true } });
    stopPreferences = startMediaPreferences();
    const video = document.createElement("video");
    document.body.appendChild(video);

    await vi.advanceTimersByTimeAsync(300);
    expect(video.muted).toBe(true);

    video.muted = false;
    video.dispatchEvent(new Event("volumechange"));
    video.dispatchEvent(new Event("play"));
    await vi.advanceTimersByTimeAsync(300);
    expect(video.muted).toBe(false);

    updateSettings({ ui: { theme: "light" } });
    await vi.advanceTimersByTimeAsync(10);
    expect(video.muted).toBe(false);
  });

  it("默认 1x 时不覆盖播放器内手动调整的倍速", async () => {
    vi.useFakeTimers();
    stopPreferences = startMediaPreferences();
    const video = document.createElement("video");
    document.body.appendChild(video);

    await vi.advanceTimersByTimeAsync(300);
    expect(video.playbackRate).toBe(1);

    video.playbackRate = 1.75;
    video.dispatchEvent(new Event("play"));
    video.dispatchEvent(new Event("timeupdate"));
    await vi.advanceTimersByTimeAsync(2500);
    expect(video.playbackRate).toBe(1.75);

    updateSettings({ ui: { theme: "dark" } });
    await vi.advanceTimersByTimeAsync(10);
    expect(video.playbackRate).toBe(1.75);
  });

  it("切换默认静音设置时按新设置应用", async () => {
    vi.useFakeTimers();
    updateSettings({ video: { defaultMuted: false } });
    stopPreferences = startMediaPreferences();
    const video = document.createElement("video");
    document.body.appendChild(video);

    await vi.advanceTimersByTimeAsync(300);
    expect(video.muted).toBe(false);

    updateSettings({ video: { defaultMuted: true } });
    await vi.advanceTimersByTimeAsync(10);
    expect(video.muted).toBe(true);
  });

  it("其他 frame 修改倍速后子 frame 轮询同步并生效", async () => {
    vi.useFakeTimers();
    stopPreferences = startMediaPreferences();
    const video = document.createElement("video");
    document.body.appendChild(video);
    await vi.advanceTimersByTimeAsync(300);
    expect(video.playbackRate).toBe(1);

    const external = structuredClone(DEFAULT_SETTINGS);
    external.video.playbackRate = 2;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(external));

    await vi.advanceTimersByTimeAsync(1600);
    expect(video.playbackRate).toBe(2);
  });

  it("播放器把倍速重置时通过 ratechange 立即补回", async () => {
    vi.useFakeTimers();
    updateSettings({ video: { playbackRate: 1.5 } });
    stopPreferences = startMediaPreferences();
    const video = document.createElement("video");
    document.body.appendChild(video);

    await vi.advanceTimersByTimeAsync(300);
    expect(video.playbackRate).toBe(1.5);

    video.playbackRate = 1;
    video.dispatchEvent(new Event("ratechange"));
    expect(video.playbackRate).toBe(1.5);
  });
});
