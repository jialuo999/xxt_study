import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyMediaPreferences, startMediaPreferences } from "../../src/app/media-preferences";
import { DEFAULT_SETTINGS } from "../../src/core/settings";
import { replaceSettings, updateSettings } from "../../src/core/settings-store";

describe("media-preferences", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
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

  it("平台重置倍速后定时重新应用设置", async () => {
    vi.useFakeTimers();
    replaceSettings(structuredClone(DEFAULT_SETTINGS));
    updateSettings({ video: { playbackRate: 1.5 } });
    const stop = startMediaPreferences();
    const video = document.createElement("video");
    document.body.appendChild(video);
    await vi.advanceTimersByTimeAsync(300);
    expect(video.playbackRate).toBe(1.5);
    video.playbackRate = 1; // 模拟平台播放器重置
    await vi.advanceTimersByTimeAsync(2500);
    expect(video.playbackRate).toBe(1.5);
    stop();
    replaceSettings(structuredClone(DEFAULT_SETTINGS));
    vi.useRealTimers();
  });
});
