import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AutoTurnRunner,
  isReadingTarget,
  type AutoTurnHost,
  type MediaPlaybackTarget,
} from "../../src/app/autoturn";
import { DEFAULT_SETTINGS } from "../../src/core/settings";
import { replaceSettings, updateSettings } from "../../src/core/settings-store";
import type { PageInfo } from "../../src/core/types";
import type { PlatformAdapter } from "../../src/platform/types";
import type { AutoTurnView } from "../../src/ui/contract";

interface FakeHost extends AutoTurnHost {
  nextPage: ReturnType<typeof vi.fn>;
  stopped: string[];
  states: AutoTurnView[];
}

function makeHost(options: {
  signature: () => string;
  onChangeSignature?: () => void;
}): FakeHost {
  const nextPage = vi.fn(async () => {
    options.onChangeSignature?.();
    return { ok: true, action: "test", message: "已点击测试翻页", url: "" };
  });
  const page: PageInfo = {
    kind: "chapter",
    url: "https://mooc1.chaoxing.com/mycourse/studentstudy",
    title: "测试章节",
    supported: true,
  };
  const stopped: string[] = [];
  const states: AutoTurnView[] = [];
  const host: FakeHost = {
    nextPage,
    stopped,
    states,
    getAdapter: () => ({ nextPage } as unknown as PlatformAdapter),
    getContext: () => ({
      doc: document,
      win: window,
      url: new URL(page.url),
      page,
      frameId: "top",
    }),
    getPage: () => page,
    hasUnansweredQuestions: () => false,
    getChildMediaState: () => null,
    getMediaPlaybackTarget: () => null,
    activateMediaFrame: () => undefined,
    resumeChildMedia: () => undefined,
    pauseMedia: () => undefined,
    getTaskSignature: options.signature,
    hasVerificationChallenge: () => false,
    onState: (state) => states.push(state),
    onStopped: (reason) => stopped.push(reason),
  };
  return host;
}

describe("AutoTurnRunner 翻页校验", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    replaceSettings(structuredClone(DEFAULT_SETTINGS));
    updateSettings({
      autoTurn: {
        enabled: true,
        startDelayMs: 0,
        minDelayMs: 1,
        maxDelayMs: 1,
        contentWaitMs: 0,
        waitVideoEnd: true,
        maxSteps: 5,
      },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    replaceSettings(structuredClone(DEFAULT_SETTINGS));
  });

  it("同页多任务点时按顺序激活，且只恢复当前任务点", async () => {
    const host = makeHost({ signature: () => "multi-task" });
    let target: MediaPlaybackTarget = {
      frameId: "frame-a",
      taskUrl: "https://mooc1.chaoxing.com/ananas/modules/video/index.html?jobid=1",
      taskIndex: 0,
      taskTotal: 2,
      state: { hasMedia: true, allEnded: false, anyPaused: false },
      allTasksFinished: false,
    };
    const activated: string[] = [];
    host.getMediaPlaybackTarget = () => target;
    host.activateMediaFrame = (frameId) => activated.push(frameId);

    const runner = new AutoTurnRunner(host);
    runner.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(activated[0]).toBe("frame-a");

    target = {
      ...target,
      frameId: "frame-b",
      taskIndex: 1,
      taskUrl: "https://mooc1.chaoxing.com/ananas/modules/video/index.html?jobid=2",
    };
    await vi.advanceTimersByTimeAsync(1000);
    expect(activated).toContain("frame-b");

    target = { ...target, frameId: null, state: null, allTasksFinished: true };
    await vi.advanceTimersByTimeAsync(1500);
    expect(host.nextPage).toHaveBeenCalled();

    runner.stop("测试结束");
  });

  it("restore 在会话页面与当前页面不一致时返回 false，供 Host 释放锁", () => {
    updateSettings({ autoTurn: { enabled: true, resumeOnReload: true } });
    sessionStorage.setItem(
      "study-helper.autoturn.v1",
      JSON.stringify({
        running: true,
        steps: 2,
        visited: [],
        lastUrl: "https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=old-chapter",
        savedAt: Date.now(),
      }),
    );
    const host = makeHost({ signature: () => "restore" });
    const runner = new AutoTurnRunner(host);

    expect(runner.restore()).toBe(false);
    expect(runner.isRunning).toBe(false);
    sessionStorage.removeItem("study-helper.autoturn.v1");
  });

  it("检测到人机验证时停止翻页且不点击下一页", async () => {
    const host = makeHost({ signature: () => "verification" });
    host.hasVerificationChallenge = () => true;
    const runner = new AutoTurnRunner(host);
    runner.start();
    await vi.advanceTimersByTimeAsync(3000);

    expect(host.nextPage).not.toHaveBeenCalled();
    expect(host.stopped.some((reason) => reason.includes("验证"))).toBe(true);
    expect(runner.isRunning).toBe(false);
  });

  it("点击后任务点签名变化才计为一步", async () => {
    updateSettings({ autoTurn: { maxSteps: 1 } });
    let signature = "signature-1";
    const host = makeHost({
      signature: () => signature,
      onChangeSignature: () => {
        signature = "signature-2";
      },
    });
    const runner = new AutoTurnRunner(host);
    const pauseSpy = vi.spyOn(host, "pauseMedia");
    runner.start();
    await vi.advanceTimersByTimeAsync(3000);
    runner.stop("测试结束");

    expect(host.nextPage).toHaveBeenCalledTimes(1);
    expect(pauseSpy).toHaveBeenCalled();
    expect(host.stopped.some((reason) => reason.includes("最大步数"))).toBe(true);
    const lastState = host.states.at(-1) as AutoTurnView;
    expect(lastState.steps).toBe(1);
  });

  it("点击后页面没有变化时停止，不再重复执行同一任务点", async () => {
    const host = makeHost({ signature: () => "signature-stable" });
    const runner = new AutoTurnRunner(host);
    runner.start();
    await vi.advanceTimersByTimeAsync(20000);

    expect(host.nextPage).toHaveBeenCalledTimes(3);
    expect(host.stopped.some((reason) => reason.includes("页面没有变化"))).toBe(true);
    expect(runner.isRunning).toBe(false);
  });

  it("当前任务点已完成时跳过视频等待直接翻页", async () => {
    updateSettings({ autoTurn: { maxSteps: 1 } });
    let signature = "finished-1";
    const host = makeHost({
      signature: () => signature,
      onChangeSignature: () => {
        signature = "finished-2";
      },
    });
    host.getChildMediaState = () => ({
      hasMedia: true,
      allEnded: false,
      anyPaused: true,
      currentTaskFinished: true,
    });
    const runner = new AutoTurnRunner(host);
    runner.start();
    await vi.advanceTimersByTimeAsync(3000);
    runner.stop("测试结束");

    expect(host.nextPage).toHaveBeenCalledTimes(1);
    const lastState = host.states.at(-1) as AutoTurnView;
    expect(lastState.steps).toBe(1);
  });

  it("翻页按钮晚加载时短暂重试，而不是立即停止", async () => {
    updateSettings({ autoTurn: { maxSteps: 1 } });
    let signature = "retry-1";
    let calls = 0;
    const host = makeHost({ signature: () => signature });
    host.nextPage.mockImplementation(async () => {
      calls += 1;
      if (calls < 3) {
        return { ok: false, action: "none", message: "未找到「下一节」按钮", url: "" };
      }
      signature = "retry-2";
      return { ok: true, action: "click:test", message: "已点击下一节", url: "" };
    });

    const runner = new AutoTurnRunner(host);
    runner.start();
    await vi.advanceTimersByTimeAsync(12000);
    runner.stop("测试结束");

    expect(calls).toBe(3);
    expect(host.states.some((state) => state.steps === 1)).toBe(true);
    expect(host.stopped.some((reason) => reason.includes("未找到"))).toBe(false);
  });

  it("连续三次找不到翻页按钮时才停止", async () => {
    const host = makeHost({ signature: () => "missing" });
    host.nextPage.mockResolvedValue({ ok: false, action: "none", message: "未找到「下一节」按钮", url: "" });
    const runner = new AutoTurnRunner(host);
    runner.start();
    await vi.advanceTimersByTimeAsync(12000);

    expect(host.nextPage).toHaveBeenCalledTimes(3);
    expect(host.stopped.some((reason) => reason.includes("未找到"))).toBe(true);
    expect(runner.isRunning).toBe(false);
  });

  it("阅读/文档任务通过内容 frame 转发滚动，任务完成后才翻页", async () => {
    updateSettings({ autoTurn: { maxSteps: 1 } });
    let signature = "reading-1";
    const host = makeHost({
      signature: () => signature,
      onChangeSignature: () => {
        signature = "reading-2";
      },
    });
    let target: MediaPlaybackTarget = {
      frameId: null,
      taskUrl: "https://mooc1.chaoxing.com/ananas/modules/pdf/index.html?jobid=doc-1",
      taskIndex: 0,
      taskTotal: 2,
      state: null,
      allTasksFinished: false,
      source: "tasks",
      kind: "doc",
      taskId: "doc-1",
      taskName: "阅读材料.pdf",
      ownerFrameId: "cards",
    };
    const started: string[] = [];
    host.getMediaPlaybackTarget = () => target;
    host.startReadingTask = (readingTarget) => {
      started.push(readingTarget.taskId ?? "");
    };

    const runner = new AutoTurnRunner(host);
    runner.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(isReadingTarget(target)).toBe(true);
    expect(started).toEqual(["doc-1"]);
    expect(host.nextPage).not.toHaveBeenCalled();

    target = {
      ...target,
      frameId: null,
      taskUrl: "",
      taskIndex: -1,
      state: null,
      allTasksFinished: true,
    };
    await vi.advanceTimersByTimeAsync(2500);
    expect(host.nextPage).toHaveBeenCalledTimes(1);
    runner.stop("测试结束");
  });

  it("阅读任务未完成时不会因为 10 秒无媒体而误判完成", async () => {
    const host = makeHost({ signature: () => "reading-unfinished" });
    host.getMediaPlaybackTarget = () => ({
      frameId: null,
      taskUrl: "https://mooc1.chaoxing.com/ananas/modules/pdf/index.html?jobid=doc-1",
      taskIndex: 0,
      taskTotal: 1,
      state: null,
      allTasksFinished: false,
      source: "tasks",
      kind: "doc",
      taskId: "doc-1",
      ownerFrameId: "cards",
    });
    host.startReadingTask = () => undefined;
    const runner = new AutoTurnRunner(host);
    runner.start();
    await vi.advanceTimersByTimeAsync(15000);

    expect(host.nextPage).not.toHaveBeenCalled();
    expect(runner.isRunning).toBe(true);
    runner.stop("测试结束");
  });

  it("当前任务点未完成时不会跳过视频等待", async () => {
    const host = makeHost({ signature: () => "unfinished" });
    host.getChildMediaState = () => ({
      hasMedia: true,
      allEnded: false,
      anyPaused: true,
      currentTaskFinished: false,
    });
    const runner = new AutoTurnRunner(host);
    runner.start();
    await vi.advanceTimersByTimeAsync(6000);

    expect(host.nextPage).not.toHaveBeenCalled();
    expect(runner.isRunning).toBe(true);
    runner.stop("测试结束");
  });
});
