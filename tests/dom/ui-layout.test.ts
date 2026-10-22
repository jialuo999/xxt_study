import { afterEach, describe, expect, it, vi } from "vitest";
import { h, render, type ComponentChild } from "preact";
import { App } from "../../src/ui/App";
import { HomePage } from "../../src/ui/pages/Home";
import { BankPage } from "../../src/ui/pages/Bank";
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

  it("从题库进入远程题库设置时先展开合并后的答题板块", () => {
    const state = makeState();
    const { controller, saveSettings } = makeController(state);
    const onNavigate = vi.fn();
    const container = mount(h(BankPage, { controller, state, onNavigate }));

    const settingsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "远程题库",
    );
    expect(settingsButton).toBeDefined();
    settingsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(saveSettings).toHaveBeenCalledWith({ ui: { sectionStates: { solving: true } } });
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("拖动悬浮球松手时同步提交位置并清除 transform", () => {
    const state = makeState();
    state.settings.ui.collapsed = true;
    state.settings.ui.x = 100;
    state.settings.ui.y = 100;
    const { controller, saveSettings } = makeController(state);
    const container = mount(h(App, { controller }));
    const bubble = container.querySelector<HTMLElement>(".sh-bubble");
    expect(bubble).not.toBeNull();

    bubble?.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
    );
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 150, clientY: 140 }));
    expect(bubble?.style.transform).toContain("translate3d");
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 150, clientY: 140 }));

    const moved = container.querySelector<HTMLElement>(".sh-bubble");
    expect(moved?.style.left).toBe("150px");
    expect(moved?.style.top).toBe("140px");
    expect(moved?.style.transform).toBe("");
    expect(saveSettings).toHaveBeenCalledWith({ ui: { x: 150, y: 140 } });
  });

  it("拖动面板松手时同样同步位置并清除 transform", () => {
    const state = makeState();
    state.settings.ui.collapsed = false;
    state.settings.ui.x = 100;
    state.settings.ui.y = 100;
    state.settings.ui.width = 408;
    state.settings.ui.height = 620;
    const { controller, saveSettings } = makeController(state);
    const container = mount(h(App, { controller }));
    const header = container.querySelector<HTMLElement>(".sh-panel__header");
    expect(header).not.toBeNull();

    header?.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 110, clientY: 110 }),
    );
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 160, clientY: 150 }));
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 160, clientY: 150 }));

    const moved = container.querySelector<HTMLElement>(".sh-panel");
    expect(moved?.style.left).toBe("150px");
    expect(moved?.style.top).toBe("140px");
    expect(moved?.style.transform).toBe("");
    expect(saveSettings).toHaveBeenCalledWith({ ui: { x: 150, y: 140 } });
  });
});

describe("设置页折叠板块", () => {
  it("渲染 7 个可折叠板块，默认只展开答题与 AI 接口", () => {
    const state = makeState();
    const { controller } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    const sections = container.querySelectorAll("[data-section]");
    expect(sections).toHaveLength(7);

    const expanded = (id: string) =>
      container
        .querySelector(`[data-section="${id}"] .sh-collapse-toggle`)
        ?.getAttribute("aria-expanded");
    expect(expanded("solving")).toBe("true");
    expect(expanded("ai")).toBe("true");
    expect(expanded("autoTurn")).toBe("false");
    expect(expanded("logs")).toBe("false");
  });

  it("题库与缓存合并进答题板块", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.ui.sectionStates = { autoTurn: true };
    const state = makeState({ settings });
    const { controller } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    const answerSection = container.querySelector('[data-section="solving"]');
    expect(answerSection).not.toBeNull();
    expect(answerSection?.textContent).toContain("题库与缓存");
    expect(answerSection?.textContent).toContain("模糊匹配阈值");
    expect(answerSection?.textContent).toContain("缓存保留天数");

    const autoTurnSection = container.querySelector('[data-section="autoTurn"]');
    expect(autoTurnSection).not.toBeNull();
    expect(autoTurnSection?.textContent).toContain("媒体播放");
  });

  it("旧 bank/media 折叠状态不会破坏 7 板块渲染", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.ui.sectionStates = { bank: true, media: true };
    const state = makeState({ settings });
    const { controller } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    expect(container.querySelectorAll("[data-section]")).toHaveLength(7);
    const expanded = (id: string) =>
      container
        .querySelector(`[data-section="${id}"] .sh-collapse-toggle`)
        ?.getAttribute("aria-expanded");
    expect(expanded("solving")).toBe("true");
    expect(expanded("autoTurn")).toBe("false");
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

  it("全部展开会写入全部 7 个板块状态", () => {
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
      "advanced",
      "appearance",
      "data",
      "logs",
    ]);
    expect(Object.values(patch.ui.sectionStates).every(Boolean)).toBe(true);
  });

  it("自动翻页板块合并媒体播放且不再包含延迟与步数输入", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.ui.sectionStates = { autoTurn: true };
    const state = makeState({ settings });
    const { controller } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    const text = container.textContent ?? "";
    expect(text).toContain("启用自动翻页");
    expect(text).toContain("媒体播放");
    expect(text).toContain("默认静音");
    expect(text).toContain("自动翻页时暂停后恢复");
    for (const removed of ["开始前延迟", "无音视频时等待", "最小延迟", "最大延迟", "最大步数"]) {
      expect(text).not.toContain(removed);
    }
  });

  it("媒体播放不再提供默认倍速，提示去主页调整", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.ui.sectionStates = { autoTurn: true };
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
