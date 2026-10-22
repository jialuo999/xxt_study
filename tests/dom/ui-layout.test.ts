import { afterEach, describe, expect, it, vi } from "vitest";
import { h, render, type ComponentChild } from "preact";
import { App } from "../../src/ui/App";
import { HomePage } from "../../src/ui/pages/Home";
import { SettingsPage } from "../../src/ui/pages/Settings";
import { DEFAULT_SETTINGS } from "../../src/core/settings";
import type { UiController, UiState } from "../../src/ui/contract";

function makeState(patch: Partial<UiState> = {}): UiState {
  return {
    ready: true,
    page: {
      kind: "homework",
      url: "https://example.com/work",
      title: "测试作业",
      supported: true,
    },
    frames: [],
    questions: [],
    results: {},
    status: "idle",
    statusText: "待命",
    progress: null,
    autoTurn: { running: false, steps: 0, maxSteps: 200, message: "", nextAt: null },
    bank: { total: 0, lastUpdated: null },
    settings: structuredClone(DEFAULT_SETTINGS),
    logs: [],
    lastSubmit: null,
    toast: null,
    noticeAccepted: true,
    ...patch,
  };
}

function makeController(state: UiState) {
  const saveSettings = vi.fn();
  const controller = {
    state,
    subscribe: () => () => undefined,
    saveSettings,
  } as unknown as UiController;
  return { controller, saveSettings };
}

const containers: HTMLElement[] = [];

function mount(vnode: ComponentChild): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  render(vnode, container);
  return container;
}

afterEach(() => {
  for (const container of containers.splice(0)) render(null, container);
});

describe("导航与主页布局", () => {
  it("只保留主页/答题/题库/设置 4 个 Tab，且主页没有最近日志卡", () => {
    const state = makeState();
    state.settings.ui.collapsed = false;
    const { controller } = makeController(state);
    const container = mount(h(App, { controller }));

    const tabs = Array.from(container.querySelectorAll(".sh-tab")).map((tab) => tab.textContent);
    expect(tabs).toEqual(["主页", "答题", "题库", "设置"]);
    expect(container.textContent).not.toContain("最近日志");
  });

  it("主页自动翻页卡显示已翻页数和倍速选择，默认 1x", () => {
    const state = makeState();
    const { controller } = makeController(state);
    const container = mount(h(HomePage, { controller, state, onNavigate: () => undefined }));

    expect(container.textContent).toContain("已翻 0 页");
    const rate = container.querySelector<HTMLSelectElement>(".sh-select--compact");
    expect(rate).not.toBeNull();
    expect(rate?.value).toBe("1");
  });

  it("从主页进入翻页设置时先展开对应板块再跳转", () => {
    const state = makeState();
    const { controller, saveSettings } = makeController(state);
    const onNavigate = vi.fn();
    const container = mount(h(HomePage, { controller, state, onNavigate }));

    const settingsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "翻页设置",
    );
    expect(settingsButton).toBeDefined();
    settingsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(saveSettings).toHaveBeenCalledWith({ ui: { sectionStates: { autoTurn: true } } });
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });
});

describe("设置页折叠板块", () => {
  it("渲染 9 个可折叠板块，默认只展开答题模式与 AI 接口", () => {
    const state = makeState();
    const { controller } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    const sections = container.querySelectorAll("[data-section]");
    expect(sections).toHaveLength(9);

    const expanded = (id: string) =>
      container
        .querySelector(`[data-section="${id}"] .sh-collapse-toggle`)
        ?.getAttribute("aria-expanded");
    expect(expanded("solving")).toBe("true");
    expect(expanded("ai")).toBe("true");
    expect(expanded("autoTurn")).toBe("false");
    expect(expanded("logs")).toBe("false");
  });

  it("点击板块标题写入对应的展开状态", () => {
    const state = makeState();
    const { controller, saveSettings } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    const toggle = container.querySelector<HTMLElement>(
      '[data-section="logs"] .sh-collapse-toggle',
    );
    expect(toggle).not.toBeNull();
    toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(saveSettings).toHaveBeenCalledWith({ ui: { sectionStates: { logs: true } } });
  });

  it("全部展开会写入全部 9 个板块状态", () => {
    const state = makeState();
    const { controller, saveSettings } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    const expandAll = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "全部展开",
    );
    expect(expandAll).toBeDefined();
    expandAll?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const patch = saveSettings.mock.calls.at(-1)?.[0] as {
      ui: { sectionStates: Record<string, boolean> };
    };
    expect(Object.keys(patch.ui.sectionStates)).toEqual([
      "solving",
      "ai",
      "autoTurn",
      "media",
      "bank",
      "advanced",
      "appearance",
      "data",
      "logs",
    ]);
    expect(Object.values(patch.ui.sectionStates).every(Boolean)).toBe(true);
  });

  it("自动翻页板块不再包含延迟与步数输入", () => {
    const state = makeState({
      settings: {
        ...structuredClone(DEFAULT_SETTINGS),
        ui: { ...structuredClone(DEFAULT_SETTINGS).ui, sectionStates: { autoTurn: true } },
      },
    });
    const { controller } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    const text = container.textContent ?? "";
    expect(text).toContain("启用自动翻页");
    for (const removed of ["开始前延迟", "无音视频时等待", "最小延迟", "最大延迟", "最大步数"]) {
      expect(text).not.toContain(removed);
    }
  });

  it("媒体播放板块不再提供默认倍速，提示去主页调整", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.ui.sectionStates = { media: true };
    const state = makeState({ settings });
    const { controller } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    const text = container.textContent ?? "";
    expect(text).not.toContain("默认倍速");
    expect(text).toContain("主页");
  });

  it("日志内嵌在设置中：展开后显示筛选、导出与清空确认", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.ui.sectionStates = { logs: true };
    const state = makeState({
      settings,
      logs: [
        { id: 1, ts: Date.now(), level: "info", scope: "scan", message: "扫描完成" },
        { id: 2, ts: Date.now(), level: "error", scope: "ai", message: "请求失败" },
      ],
    });
    const { controller } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    expect(container.textContent).toContain("扫描完成");
    expect(container.textContent).toContain("导出");
    expect(container.textContent).toContain("全部");

    const clear = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "清空",
    );
    expect(clear).toBeDefined();
    clear?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent).toContain("清空运行日志？");
  });
});
