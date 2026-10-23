import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Question } from "../../src/core/types";
import { DEFAULT_SETTINGS } from "../../src/core/settings";
import { replaceSettings, updateSettings } from "../../src/core/settings-store";

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
});
