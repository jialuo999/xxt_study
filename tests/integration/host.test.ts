import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Question } from "../../src/core/types";
import { DEFAULT_SETTINGS } from "../../src/core/settings";
import { replaceSettings, updateSettings } from "../../src/core/settings-store";
import { lockKeyFromUrl, readLock } from "../../src/app/tab-lock";

const fixture = vi.hoisted(() => {
  const question: Question = {
    id: "q1",
    type: "single",
    stem: "1 + 1 = ?",
    options: [
      { key: "A", text: "1" },
      { key: "B", text: "2" },
    ],
    hasImage: false,
    frameId: "top",
    index: 0,
  };
  const calls = { fill: 0, submit: 0, submitOptions: [] as Array<{ autoConfirm?: boolean }> };
  const adapter = {
    id: "fake",
    label: "Fake",
    matches: () => true,
    detectPage: () => ({
      kind: "homework" as const,
      url: location.href,
      title: document.title,
      supported: true,
    }),
    collectQuestions: () => [question],
    fillAnswer: async () => {
      calls.fill += 1;
      return { questionId: "q1", ok: true, expected: "B", actual: "B" };
    },
    submit: async (_ctx: unknown, options?: { autoConfirm?: boolean }) => {
      calls.submit += 1;
      calls.submitOptions.push(options ?? {});
      return { ok: true, message: "提交成功" };
    },
    nextPage: async () => ({ ok: false, action: "none", message: "没有下一页" }),
  };
  return { question, calls, adapter };
});

vi.mock("@/platform/registry", () => ({
  getAdapter: () => fixture.adapter,
}));

vi.mock("@/bank", () => ({
  initBank: async () => undefined,
  getBankStats: async () => ({ total: 1, newestUpdatedAt: Date.now() }),
  importBankText: async () => ({
    added: 1,
    updated: 0,
    skipped: 0,
    duplicates: 0,
    failed: 0,
    total: 1,
    totalEntries: 1,
  }),
  clearBank: async () => undefined,
  exportBank: async () => "[]",
  searchBankByText: async () => [],
}));

vi.mock("@/solver", () => ({
  solveQuestions: async (questions: Question[]) =>
    questions.map((question) => ({
      questionId: question.id,
      answer: { kind: "choice", keys: ["B"], texts: ["2"] },
      confidence: 0.95,
      source: "bank-exact",
      status: "solved",
      latencyMs: 1,
    })),
}));

vi.mock("@/ai", () => ({
  testAiConnection: async () => ({
    ok: true,
    message: "连接成功",
    latencyMs: 1,
    model: "fake",
  }),
}));

describe("HostController 集成", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div class="TiMu"><div>1 + 1 = ?</div></div>`;
    localStorage.clear();
    sessionStorage.clear();
    replaceSettings(structuredClone(DEFAULT_SETTINGS));
    (fixture.adapter as { detectPage: () => unknown }).detectPage = () => ({
      kind: "homework" as const,
      url: location.href,
      title: document.title,
      supported: true,
    });
    fixture.calls.fill = 0;
    fixture.calls.submit = 0;
    fixture.calls.submitOptions = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("初始化 → 采集 → 解题 → 填入 → 提交", async () => {
    const { HostController } = await import("../../src/app/host");
    const controller = new HostController();
    await controller.init();

    expect(controller.state.ready).toBe(true);
    expect(controller.state.page.kind).toBe("homework");
    expect(controller.state.questions).toHaveLength(1);
    expect(controller.state.bank.total).toBe(1);

    await controller.solve();
    expect(controller.state.results.q1?.status).toBe("solved");
    expect(controller.state.results.q1?.source).toBe("bank-exact");

    const filled = await controller.fillAll();
    expect(filled).toBe(true);
    expect(fixture.calls.fill).toBe(1);

    await controller.submit();
    expect(fixture.calls.submit).toBe(1);
    // 复核模式即便覆盖率 100%，也不应自动点掉平台原生确认框
    expect(fixture.calls.submitOptions.at(-1)?.autoConfirm).toBe(false);
    expect(controller.state.lastSubmit?.ok).toBe(true);

    controller.dispose();
  });

  it("考试页默认阻止解题、填入与提交", async () => {
    (fixture.adapter as { detectPage: () => unknown }).detectPage = () => ({
      kind: "exam" as const,
      url: location.href,
      title: document.title,
      supported: true,
    });
    const { HostController } = await import("../../src/app/host");
    const controller = new HostController();
    await controller.init();

    await controller.solve();
    await controller.fillAll();
    expect(fixture.calls.fill).toBe(0);
    expect(controller.state.results.q1).toBeUndefined();

    controller.dispose();
  });

  it("仅提示模式不填入也不提交", async () => {
    updateSettings({ solving: { mode: "hint" } });
    const { HostController } = await import("../../src/app/host");
    const controller = new HostController();
    await controller.init();

    await controller.solve();
    expect(controller.state.results.q1?.status).toBe("solved");

    expect(await controller.fillAll()).toBe(false);
    await controller.submit();

    expect(fixture.calls.fill).toBe(0);
    expect(fixture.calls.submit).toBe(0);
    controller.dispose();
  });

  it("没有先填入时首次提交需二次确认，手动填写也能提交", async () => {
    const { HostController } = await import("../../src/app/host");
    const controller = new HostController();
    await controller.init();

    await controller.solve();
    await controller.submit();
    expect(fixture.calls.submit).toBe(0);

    // 第二次点击视为用户显式确认（覆盖“用户手动填写”场景）
    await controller.submit();
    expect(fixture.calls.submit).toBe(1);
    expect(fixture.calls.submitOptions.at(-1)?.autoConfirm).toBe(true);
    controller.dispose();
  });

  it("脚本填入后复核模式仍由用户确认平台弹窗", async () => {
    const { HostController } = await import("../../src/app/host");
    const controller = new HostController();
    await controller.init();

    await controller.solve();
    expect(await controller.fillAll()).toBe(true);
    await controller.submit();
    expect(fixture.calls.submit).toBe(1);
    expect(fixture.calls.submitOptions.at(-1)?.autoConfirm).toBe(false);
    controller.dispose();
  });

  it("扫描后清空已填入状态", async () => {
    const { HostController } = await import("../../src/app/host");
    const controller = new HostController();
    await controller.init();
    await controller.solve();
    await controller.fillAll();
    expect(controller.state.filledQuestionIds.length).toBe(1);

    await controller.refresh();
    expect(controller.state.filledQuestionIds).toEqual([]);
    controller.dispose();
  });

  it("恢复会话失败时释放多标签锁，不阻塞其他标签页", async () => {
    updateSettings({ autoTurn: { enabled: true, resumeOnReload: true } });
    (fixture.adapter as { detectPage: () => unknown }).detectPage = () => ({
      kind: "chapter" as const,
      url: location.href,
      title: document.title,
      supported: true,
    });
    sessionStorage.setItem(
      "study-helper.autoturn.v1",
      JSON.stringify({
        running: true,
        steps: 1,
        visited: [],
        lastUrl: "https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=old",
        savedAt: Date.now(),
      }),
    );

    const { HostController } = await import("../../src/app/host");
    const controller = new HostController();
    await controller.init();

    expect(readLock(lockKeyFromUrl(location.href))).toBeNull();
    controller.dispose();
  });

  it("当前视频未播完时固定当前目标，避免任务快照抖动导致来回切换", async () => {
    const { HostController } = await import("../../src/app/host");
    const controller = new HostController();
    const fakeChild = (frameId: string, url: string) =>
      ({
        frameId,
        source: { closed: false, postMessage: () => undefined } as unknown as Window,
        token: frameId,
        nonce: "",
        url,
        title: "",
        pageKind: "video",
        questions: [],
        lastSeen: Date.now(),
      }) as never;

    const host = controller as unknown as {
      children: Map<string, unknown>;
      childMedia: Map<string, unknown>;
      activeMediaFrameId: string;
      getMediaPlaybackTarget: () => { frameId: string | null } | null;
    };
    host.children.set("a", fakeChild("a", "https://x/video?jobid=1"));
    host.children.set("b", fakeChild("b", "https://x/video?jobid=2"));
    host.children.set("c", fakeChild("c", "https://x/content"));
    const mediaState = { hasMedia: true, allEnded: false, anyPaused: false };
    host.childMedia.set("a", { state: mediaState, at: Date.now() });
    host.childMedia.set("b", { state: mediaState, at: Date.now() });
    host.childMedia.set("c", {
      state: {
        hasMedia: false,
        allEnded: false,
        anyPaused: false,
        taskTotal: 2,
        nextTaskUrl: "https://x/video?jobid=2",
        tasks: [
          { index: 0, finished: false, url: "https://x/video?jobid=1" },
          { index: 1, finished: false, url: "https://x/video?jobid=2" },
        ],
      },
      at: Date.now(),
    });
    host.activeMediaFrameId = "a";

    expect(host.getMediaPlaybackTarget()?.frameId).toBe("a");
    controller.dispose();
  });
  it("切换播放目标时暂停旧目标、恢复新目标，不启动播放守卫", async () => {
    const { HostController } = await import("../../src/app/host");
    const controller = new HostController();
    const sentA: string[] = [];
    const sentB: string[] = [];
    const fake = (sent: string[]) =>
      ({
        closed: false,
        postMessage: (message: { t?: string }) => sent.push(message.t ?? ""),
      }) as unknown as Window;

    (controller as unknown as { children: Map<string, unknown> }).children.set("a", {
      frameId: "a",
      source: fake(sentA),
      token: "ta",
      nonce: "",
      url: "https://x/video?jobid=1",
      title: "",
      pageKind: "video",
      questions: [],
      lastSeen: Date.now(),
    });
    (controller as unknown as { children: Map<string, unknown> }).children.set("b", {
      frameId: "b",
      source: fake(sentB),
      token: "tb",
      nonce: "",
      url: "https://x/video?jobid=2",
      title: "",
      pageKind: "video",
      questions: [],
      lastSeen: Date.now(),
    });
    (controller as unknown as { autoTurn: { running: boolean } }).autoTurn.running = true;
    (controller as unknown as { activeMediaFrameId: string }).activeMediaFrameId = "a";
    (controller as unknown as { activateMediaFrame: (id: string) => void }).activateMediaFrame("b");

    expect(sentA).toEqual(["PAUSE_MEDIA"]);
    expect(sentB).toEqual(["RESUME_MEDIA"]);
    controller.dispose();
  });
});
