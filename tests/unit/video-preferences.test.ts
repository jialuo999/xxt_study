import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyMediaPreferences, startMediaPreferences } from "../../src/app/media-preferences";

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
      autoPlay: true,
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
      autoPlay: true,
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
      autoPlay: true,
      resumeOnPause: true,
    });
    expect(video.playbackRate).toBe(4);
    applyMediaPreferences(document, {
      defaultMuted: false,
      playbackRate: 0.01,
      autoPlay: true,
      resumeOnPause: true,
    });
    expect(video.playbackRate).toBe(0.25);
  });

  it("媒体暂停后按设置尝试恢复播放", async () => {
    vi.useFakeTimers();
    const stop = startMediaPreferences();
    const video = document.createElement("video");
    let paused = true;
    Object.defineProperty(video, "paused", { get: () => paused, configurable: true });
    Object.defineProperty(video, "ended", { get: () => false, configurable: true });
    video.play = vi.fn(async () => {
      paused = false;
    });
    document.body.appendChild(video);
    video.dispatchEvent(new Event("pause"));
    await vi.advanceTimersByTimeAsync(300);
    expect(video.play).toHaveBeenCalled();
    stop();
    vi.useRealTimers();
  });
});
