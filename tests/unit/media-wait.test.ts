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
  autoPlay: true,
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
    await vi.advanceTimersByTimeAsync(1500);
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
});
