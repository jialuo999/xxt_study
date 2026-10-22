import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForMedia } from "../../src/app/autoturn";

function mockVideo(options: { initialTime?: number; playSucceeds: boolean }) {
  const video = document.createElement("video");
  let paused = true;
  let currentTime = options.initialTime ?? 0;
  Object.defineProperty(video, "duration", { get: () => 10, configurable: true });
  Object.defineProperty(video, "paused", { get: () => paused, configurable: true });
  Object.defineProperty(video, "ended", { get: () => false, configurable: true });
  Object.defineProperty(video, "currentTime", {
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value;
    },
    configurable: true,
  });
  video.play = vi.fn(async () => {
    if (!options.playSucceeds) throw new Error("NotAllowedError");
    paused = false;
    currentTime = 10;
  });
  document.body.appendChild(video);
  return video;
}

const preferences = {
  defaultMuted: true,
  playbackRate: 1,
  resumeOnPause: true,
};

describe("waitForMedia", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("暂停时自动恢复播放，并在结束后返回 done", async () => {
    const video = mockVideo({ playSucceeds: true });
    const promise = waitForMedia(document, 10000, () => true, preferences);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(promise).resolves.toBe("done");
    expect(video.play).toHaveBeenCalled();
  });

  it("自动播放被拒绝且持续暂停时返回 blocked", async () => {
    mockVideo({ playSucceeds: false });
    const promise = waitForMedia(document, 10000, () => true, preferences);
    await vi.advanceTimersByTimeAsync(6500);
    await expect(promise).resolves.toBe("blocked");
  });

  it("没有媒体时返回 none", async () => {
    await expect(waitForMedia(document, 1000, () => true, preferences)).resolves.toBe("none");
  });

  it("关闭暂停恢复后不自动播放，也不把暂停判定为 blocked", async () => {
    const video = mockVideo({ playSucceeds: true });
    const noResume = { ...preferences, resumeOnPause: false };
    let settled = false;
    const promise = waitForMedia(document, 10000, () => true, noResume).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(7000);
    expect(settled).toBe(false);
    expect(video.play).not.toHaveBeenCalled();

    finishMedia(video);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(promise).resolves.toBe("done");
  });

  it("播放结束后播放器立即循环，也能识别为完成", async () => {
    const video = document.createElement("video");
    let paused = false;
    let currentTime = 9.5;
    let ended = false;
    Object.defineProperty(video, "duration", { get: () => 10, configurable: true });
    Object.defineProperty(video, "paused", { get: () => paused, configurable: true });
    Object.defineProperty(video, "ended", { get: () => ended, configurable: true });
    Object.defineProperty(video, "currentTime", {
      get: () => currentTime,
      configurable: true,
    });
    document.body.appendChild(video);

    const promise = waitForMedia(document, 10000, () => true, {
      ...preferences,
      resumeOnPause: false,
    });
    // 播放到结尾，随后播放器立刻循环回 0（轮询时已经看不到结尾状态）
    currentTime = 10;
    ended = true;
    video.dispatchEvent(new Event("ended"));
    currentTime = 0;
    ended = false;
    paused = false;

    await vi.advanceTimersByTimeAsync(3000);
    await expect(promise).resolves.toBe("done");
  });
});

function finishMedia(video: HTMLVideoElement): void {
  Object.defineProperty(video, "ended", { get: () => true, configurable: true });
  Object.defineProperty(video, "paused", { get: () => false, configurable: true });
  Object.defineProperty(video, "currentTime", { get: () => 10, configurable: true });
}
