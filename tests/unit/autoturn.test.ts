import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoTurnRunner, type AutoTurnHost } from "../../src/app/autoturn";
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
    resumeChildMedia: () => undefined,
    getTaskSignature: options.signature,
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
    runner.start();
    await vi.advanceTimersByTimeAsync(3000);
    runner.stop("测试结束");

    expect(host.nextPage).toHaveBeenCalledTimes(1);
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
});
