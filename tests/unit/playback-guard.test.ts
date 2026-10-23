import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  startPlaybackGuard,
  type PlaybackGuard,
  type PlaybackGuardOptions,
  type PlaybackNoticeLevel,
} from "../../src/app/playback-guard";

interface MockVideoOptions {
  /** 自定义 play 行为（默认：直接成功并把 paused 置为 false） */
  play?: () => Promise<void>;
  paused?: boolean;
  ended?: boolean;
  initialTime?: number;
}

interface MockVideo {
  video: HTMLVideoElement;
  playMock: Mock<() => Promise<void>>;
  setPaused(value: boolean): void;
  setEnded(value: boolean): void;
  setTime(value: number): void;
}

/** jsdom 不实现真正的播放，这里用手动可控属性模拟 video */
function mockVideo(options: MockVideoOptions = {}): MockVideo {
  const video = document.createElement("video");
  let paused = options.paused ?? true;
  let ended = options.ended ?? false;
  let currentTime = options.initialTime ?? 0;
  Object.defineProperty(video, "paused", { get: () => paused, configurable: true });
  Object.defineProperty(video, "ended", { get: () => ended, configurable: true });
  Object.defineProperty(video, "currentTime", {
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value;
    },
    configurable: true,
  });
  const playMock: Mock<() => Promise<void>> = vi.fn(async () => {
    if (options.play) {
      await options.play();
      return;
    }
    paused = false;
  });
  video.play = playMock;
  document.body.appendChild(video);
  return {
    video,
    playMock,
    setPaused: (value) => {
      paused = value;
    },
    setEnded: (value) => {
      ended = value;
    },
    setTime: (value) => {
      currentTime = value;
    },
  };
}

/** 模拟平台/失焦造成的暂停：paused 置位后派发 pause 事件 */
function dispatchPause(media: MockVideo): void {
  media.setPaused(true);
  media.video.dispatchEvent(new Event("pause"));
}

let guards: PlaybackGuard[] = [];

function startGuard(options: PlaybackGuardOptions = {}): PlaybackGuard {
  const guard = startPlaybackGuard({ doc: document, ...options });
  guards.push(guard);
  return guard;
}

describe("playback-guard", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    guards = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const guard of guards) guard.stop();
    guards = [];
    vi.useRealTimers();
  });

  it("平台暂停后 150ms 自动恢复播放", async () => {
    const media = mockVideo({ paused: false });
    const guard = startGuard();

    dispatchPause(media);
    await vi.advanceTimersByTimeAsync(149);
    expect(media.playMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(media.playMock).toHaveBeenCalledTimes(1);
    expect(guard.getStats().resumes).toBe(1);
  });

  it("播放器区域内用户按压后的暂停不被抢，人工暂停 30s 后才恢复", async () => {
    const player = document.createElement("div");
    player.className = "video-player";
    document.body.appendChild(player);
    const media = mockVideo({ paused: false });
    player.appendChild(media.video);
    const controls = document.createElement("div");
    player.appendChild(controls);

    const guard = startGuard();
    controls.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    dispatchPause(media);

    await vi.advanceTimersByTimeAsync(6_000);
    expect(media.playMock).not.toHaveBeenCalled();
    expect(guard.getStats().resumes).toBe(0);

    // 人工暂停窗口 30s，到期后由轮询兜底恢复
    await vi.advanceTimersByTimeAsync(26_000);
    expect(media.playMock).toHaveBeenCalled();
  });

  it("媒体上的 keydown 也算人工手势，暂停后不抢", async () => {
    const media = mockVideo({ paused: false });
    media.video.tabIndex = 0;
    media.video.focus();
    const guard = startGuard();

    media.video.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
    dispatchPause(media);

    await vi.advanceTimersByTimeAsync(6_000);
    expect(media.playMock).not.toHaveBeenCalled();
    expect(guard.getStats().resumes).toBe(0);
  });

  it("页面无关区域的点击不会被当成人工暂停", async () => {
    const player = document.createElement("div");
    player.className = "video-player";
    document.body.appendChild(player);
    const media = mockVideo({ paused: false });
    player.appendChild(media.video);
    const guard = startGuard();

    const unrelated = document.createElement("p");
    document.body.appendChild(unrelated);
    unrelated.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    dispatchPause(media);

    await vi.advanceTimersByTimeAsync(150);
    expect(media.playMock).toHaveBeenCalledTimes(1);
    expect(guard.getStats().resumes).toBe(1);
  });

  it("play 事件清除人工暂停标记，之后再次平台暂停照常恢复", async () => {
    const media = mockVideo({ paused: false });
    const guard = startGuard();

    media.video.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    dispatchPause(media);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(media.playMock).not.toHaveBeenCalled();

    // 用户/平台重新开始播放
    media.setPaused(false);
    media.video.dispatchEvent(new Event("play"));
    dispatchPause(media);
    await vi.advanceTimersByTimeAsync(150);
    expect(media.playMock).toHaveBeenCalledTimes(1);
    expect(guard.getStats().resumes).toBe(1);
  });

  it("suspend() 期间不恢复，resume() 解除后由轮询恢复且不立即 play", async () => {
    const media = mockVideo({ paused: false });
    const guard = startGuard();

    guard.suspend();
    dispatchPause(media);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(media.playMock).not.toHaveBeenCalled();

    guard.resume();
    expect(media.playMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_400);
    expect(media.playMock).toHaveBeenCalledTimes(1);
    expect(guard.getStats().resumes).toBe(1);
  });

  it("连续失败 3 次后退避 30s 且只提示一次", async () => {
    const media = mockVideo({
      paused: false,
      play: async () => {
        throw new Error("NotAllowedError");
      },
    });
    const notices: Array<{ message: string; level: PlaybackNoticeLevel }> = [];
    const guard = startGuard({
      onNotice: (message, level) => notices.push({ message, level }),
    });

    dispatchPause(media);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(guard.getStats().failures).toBe(3);
    expect(notices.filter((item) => item.level === "warn")).toHaveLength(1);

    // 进入退避：退避期内不再无限刷 play()
    const callsInBackoff = media.playMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(media.playMock.mock.calls.length).toBe(callsInBackoff);

    // 退避结束后可以再次尝试，但提示仍然只有一次
    await vi.advanceTimersByTimeAsync(12_000);
    expect(media.playMock.mock.calls.length).toBeGreaterThan(callsInBackoff);
    expect(notices.filter((item) => item.level === "warn")).toHaveLength(1);
  });

  it("ended 媒体不恢复", async () => {
    const media = mockVideo({ paused: false });
    const guard = startGuard();

    media.setEnded(true);
    dispatchPause(media);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(media.playMock).not.toHaveBeenCalled();
    expect(guard.getStats().resumes).toBe(0);
  });

  it("恢复后 2s 进度不增长记为 stalled 并 warn", async () => {
    const media = mockVideo();
    const notices: Array<{ message: string; level: PlaybackNoticeLevel }> = [];
    const guard = startGuard({
      onNotice: (message, level) => notices.push({ message, level }),
    });

    dispatchPause(media);
    await vi.advanceTimersByTimeAsync(2_200);

    expect(media.playMock).toHaveBeenCalledTimes(1);
    expect(guard.getStats().stalls).toBe(1);
    expect(notices.some((item) => item.level === "warn" && item.message.includes("进度"))).toBe(
      true,
    );
  });

  it("恢复后进度大幅跳变记为 seek 并提示，不修改 currentTime", async () => {
    const media = mockVideo();
    const notices: Array<{ message: string; level: PlaybackNoticeLevel }> = [];
    const guard = startGuard({
      onNotice: (message, level) => notices.push({ message, level }),
    });

    dispatchPause(media);
    await vi.advanceTimersByTimeAsync(150);
    media.setTime(25); // 播放器跳变（不是守卫做的）
    await vi.advanceTimersByTimeAsync(2_000);

    expect(guard.getStats().seeks).toBe(1);
    expect(guard.getStats().stalls).toBe(0);
    expect(media.video.currentTime).toBe(25);
    expect(notices.some((item) => item.level === "warn" && item.message.includes("跳变"))).toBe(
      true,
    );
  });

  it("跟随 isEnabled：关闭时不恢复，重新开启后轮询兜底", async () => {
    let enabled = true;
    const media = mockVideo({ paused: false });
    const guard = startGuard({ isEnabled: () => enabled });

    enabled = false;
    dispatchPause(media);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(media.playMock).not.toHaveBeenCalled();

    enabled = true;
    await vi.advanceTimersByTimeAsync(1_400);
    expect(media.playMock).toHaveBeenCalledTimes(1);
    expect(guard.getStats().resumes).toBe(1);
  });

  it("visibilitychange 回到可见时补扫一次（兜底丢失的 pause 事件）", async () => {
    const media = mockVideo({ paused: false });
    const guard = startGuard();

    media.setPaused(true); // 没有 pause 事件：模拟平台静默暂停
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(150);

    expect(media.playMock).toHaveBeenCalledTimes(1);
    expect(guard.getStats().resumes).toBe(1);
  });

  it("stop() 清理监听与定时器，可重复调用", async () => {
    const media = mockVideo();
    const guard = startGuard();
    expect(guard.isRunning).toBe(true);

    dispatchPause(media);
    guard.stop();
    guard.stop();
    expect(guard.isRunning).toBe(false);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(media.playMock).not.toHaveBeenCalled();

    dispatchPause(media);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(media.playMock).not.toHaveBeenCalled();
  });

  it("默认不进入 iframe 处理媒体（由该 frame 自己的实例负责）", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const childDoc = iframe.contentDocument;
    expect(childDoc).not.toBeNull();

    let childPaused = true;
    const childVideo = childDoc!.createElement("video");
    Object.defineProperty(childVideo, "paused", { get: () => childPaused, configurable: true });
    Object.defineProperty(childVideo, "ended", { get: () => false, configurable: true });
    const childPlay = vi.fn(async () => {
      childPaused = false;
    });
    childVideo.play = childPlay;
    childDoc!.body.appendChild(childVideo);

    const guard = startGuard();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(childPlay).not.toHaveBeenCalled();
    expect(guard.getStats().resumes).toBe(0);
  });
});
