import { afterEach, describe, expect, it, vi } from "vitest";
import { h, render, type ComponentChild } from "preact";
import { App } from "../../src/ui/App";
import { HomePage } from "../../src/ui/pages/Home";
import { SolvePage } from "../../src/ui/pages/Solve";
import { BankPage } from "../../src/ui/pages/Bank";
import { SettingsPage } from "../../src/ui/pages/Settings";
import { DEFAULT_SETTINGS, type Settings } from "../../src/core/settings";
import { setLocale } from "../../src/core/i18n";
import type { UiController, UiState } from "../../src/ui/contract";

/** 界面测试固定中文，语言切换本身单独测；默认 "auto" 在 jsdom 下会解析成英文。 */
function makeSettings(): Settings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.ui.language = "zh-CN";
  return settings;
}

function makeState(patch: Partial<UiState> = {}): UiState {
  return {
    ready: true,
    page: {
      kind: "homework",
      url: "https://example.com/work",
      title: "测试作业",
      supported: true,
    },
    verification: { detected: false, message: "" },
    frames: [],
    questions: [],
    results: {},
    status: "idle",
    statusText: "待命",
    progress: null,
    filledQuestionIds: [],
    autoTurn: { running: false, steps: 0, maxSteps: 200, message: "", nextAt: null },
    bank: { total: 0, lastUpdated: null, storage: "indexeddb", indexedDbAvailable: true },
    settings: makeSettings(),
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

function sectionIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-section]")).map(
    (section) => section.dataset.section ?? "",
  );
}

function expanded(container: HTMLElement, id: string): string | null | undefined {
  return container
    .querySelector(`[data-section="${id}"] .sh-collapse-toggle`)
    ?.getAttribute("aria-expanded");
}

function findButton(container: HTMLElement, text: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>("button")).find(
    (button) => button.textContent?.trim() === text,
  );
}

afterEach(() => {
  setLocale("zh-CN");
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

  it("检测到平台人机验证时显示顶部提示条", () => {
    const state = makeState({
      verification: {
        detected: true,
        message: "平台返回【9010】操作异常，需要手动输入图片验证码",
      },
    });
    state.settings.ui.collapsed = false;
    const { controller } = makeController(state);
    const container = mount(h(App, { controller }));

    const banner = container.querySelector(".sh-verify");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("需要手动完成人机验证");
    expect(banner?.textContent).toContain("9010");
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

  it("主页自动翻页设置内嵌且默认收起，翻页设置按钮原地展开", () => {
    const state = makeState();
    const { controller, saveSettings } = makeController(state);
    const onNavigate = vi.fn();
    const container = mount(h(HomePage, { controller, state, onNavigate }));

    expect(sectionIds(container)).toContain("home.autoTurn");
    expect(expanded(container, "home.autoTurn")).toBe("false");

    const settingsButton = findButton(container, "翻页设置");
    expect(settingsButton).toBeDefined();
    settingsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(saveSettings).toHaveBeenCalledWith({ ui: { sectionStates: { "home.autoTurn": true } } });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("考试保护入口跳到答题页并展开答题设置", () => {
    const state = makeState({
      page: { kind: "exam", url: "https://example.com/exam", title: "考试", supported: true },
    });
    const { controller, saveSettings } = makeController(state);
    const onNavigate = vi.fn();
    const container = mount(h(HomePage, { controller, state, onNavigate }));

    expect(container.textContent).toContain("考试页面已保护");
    const entry = findButton(container, "去答题页设置");
    expect(entry).toBeDefined();
    entry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(saveSettings).toHaveBeenCalledWith({ ui: { sectionStates: { "solve.solving": true } } });
    expect(onNavigate).toHaveBeenCalledWith("solve");
  });

  it("缺 Key 提示跳到答题页并展开 AI 接口", () => {
    const settings = makeSettings();
    settings.ai.enabled = true;
    settings.ai.apiKey = "";
    const state = makeState({ settings });
    const { controller, saveSettings } = makeController(state);
    const onNavigate = vi.fn();
    const container = mount(h(HomePage, { controller, state, onNavigate }));

    expect(container.textContent).toContain("还差一个 API Key");
    const entry = findButton(container, "配置");
    expect(entry).toBeDefined();
    entry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(saveSettings).toHaveBeenCalledWith({ ui: { sectionStates: { "solve.ai": true } } });
    expect(onNavigate).toHaveBeenCalledWith("solve");
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

describe("答题页就近设置", () => {
  it("答题设置与 AI 接口默认收起，点击标题写入对应 key", () => {
    const state = makeState();
    const { controller, saveSettings } = makeController(state);
    const container = mount(h(SolvePage, { controller, state, onNavigate: () => undefined }));

    expect(sectionIds(container)).toEqual(["solve.solving", "solve.ai"]);
    expect(expanded(container, "solve.solving")).toBe("false");
    expect(expanded(container, "solve.ai")).toBe("false");
    expect(container.textContent).toContain("答题设置");
    expect(container.textContent).toContain("AI 接口");

    container
      .querySelector<HTMLElement>('[data-section="solve.solving"] .sh-collapse-toggle')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(saveSettings).toHaveBeenCalledWith({ ui: { sectionStates: { "solve.solving": true } } });
  });

  it("展开后显示答题模式、置信度与 AI 表单", () => {
    const settings = makeSettings();
    settings.ui.sectionStates = { "solve.solving": true, "solve.ai": true };
    const state = makeState({ settings });
    const { controller } = makeController(state);
    const container = mount(h(SolvePage, { controller, state, onNavigate: () => undefined }));

    const text = container.textContent ?? "";
    expect(text).toContain("最低置信度");
    expect(text).toContain("Base URL");
    expect(text).toContain("测试连接");
    expect(text).toContain("允许在考试页面自动作答");
  });

  it("答题页不再出现题库阈值与翻页设置，避免设置重复", () => {
    const settings = makeSettings();
    settings.ui.sectionStates = { "solve.solving": true, "solve.ai": true };
    const state = makeState({ settings });
    const { controller } = makeController(state);
    const container = mount(h(SolvePage, { controller, state, onNavigate: () => undefined }));

    const text = container.textContent ?? "";
    expect(text).not.toContain("模糊匹配阈值");
    expect(text).not.toContain("启用自动翻页");
  });
});

describe("题库页就近设置", () => {
  it("题库设置默认收起，包含阈值/缓存/远程入口", () => {
    const state = makeState();
    const { controller, saveSettings } = makeController(state);
    const container = mount(h(BankPage, { controller, state, onNavigate: () => undefined }));

    expect(sectionIds(container)).toEqual(["bank.settings"]);
    expect(expanded(container, "bank.settings")).toBe("false");
    expect(container.textContent).toContain("题库设置");

    container
      .querySelector<HTMLElement>('[data-section="bank.settings"] .sh-collapse-toggle')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(saveSettings).toHaveBeenCalledWith({ ui: { sectionStates: { "bank.settings": true } } });
  });

  it("展开后可直接配置模糊阈值、缓存天数与远程题库", () => {
    const settings = makeSettings();
    settings.ui.sectionStates = { "bank.settings": true };
    const state = makeState({ settings });
    const { controller } = makeController(state);
    const container = mount(h(BankPage, { controller, state, onNavigate: () => undefined }));

    const text = container.textContent ?? "";
    expect(text).toContain("模糊匹配阈值");
    expect(text).toContain("缓存保留天数");
    expect(text).toContain("启用远程题库");
    expect(text).not.toContain("可在设置中配置远程搜题接口");
  });
});

describe("设置页只保留全局项", () => {
  it("渲染 5 个全局板块（含关于），默认只展开外观", () => {
    const state = makeState();
    const { controller } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    expect(sectionIds(container)).toEqual([
      "settings.appearance",
      "settings.advanced",
      "settings.data",
      "settings.logs",
      "settings.about",
    ]);
    expect(expanded(container, "settings.appearance")).toBe("true");
    expect(expanded(container, "settings.advanced")).toBe("false");
    expect(expanded(container, "settings.data")).toBe("false");
    expect(expanded(container, "settings.logs")).toBe("false");
    expect(expanded(container, "settings.about")).toBe("false");
  });

  it("答题/AI/自动翻页/题库设置不再出现在设置页", () => {
    const state = makeState();
    const { controller } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    const text = container.textContent ?? "";
    expect(text).not.toContain("最低置信度");
    expect(text).not.toContain("启用自动翻页");
    expect(text).not.toContain("模糊匹配阈值");
    expect(text).not.toContain("Base URL");
    expect(text).toContain("外观与快捷键");
    expect(text).toContain("运行日志");
  });

  it("旧 sectionStates key 不会打开新板块", () => {
    const settings = makeSettings();
    settings.ui.sectionStates = { solving: true, ai: true, autoTurn: true, bank: true, media: true };
    const state = makeState({ settings });
    const { controller } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    expect(sectionIds(container)).toHaveLength(5);
    expect(expanded(container, "settings.appearance")).toBe("true");
    expect(expanded(container, "settings.advanced")).toBe("false");
  });

  it("点击板块标题写入对应的新 key", () => {
    const state = makeState();
    const { controller, saveSettings } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    container
      .querySelector<HTMLElement>('[data-section="settings.logs"] .sh-collapse-toggle')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(saveSettings).toHaveBeenCalledWith({
      ui: { sectionStates: { "settings.logs": true } },
    });
  });

  it("全部展开只写入设置页的 5 个板块", () => {
    const state = makeState();
    const { controller, saveSettings } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    findButton(container, "全部展开")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const patch = saveSettings.mock.calls.at(-1)?.[0] as {
      ui: { sectionStates: Record<string, boolean> };
    };
    expect(Object.keys(patch.ui.sectionStates)).toEqual([
      "settings.appearance",
      "settings.advanced",
      "settings.data",
      "settings.logs",
      "settings.about",
    ]);
    expect(Object.values(patch.ui.sectionStates).every(Boolean)).toBe(true);
  });

  it("日志内嵌在设置中：展开后显示筛选、导出与清空确认", async () => {
    const settings = makeSettings();
    settings.ui.sectionStates = { "settings.logs": true };
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

    const clear = findButton(container, "清空");
    expect(clear).toBeDefined();
    clear?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent).toContain("清空运行日志？");
  });
});

describe("语言选项与关于", () => {
  it("语言设为英文时 Tab 与面板文案显示英文", () => {
    const state = makeState();
    state.settings.ui.language = "en";
    state.settings.ui.collapsed = false;
    const { controller } = makeController(state);
    const container = mount(h(App, { controller }));

    const tabs = Array.from(container.querySelectorAll(".sh-tab")).map((tab) => tab.textContent);
    expect(tabs).toEqual(["Home", "Solve", "Bank", "Settings"]);
    expect(container.querySelector(".sh-root")?.getAttribute("lang")).toBe("en");
    expect(container.textContent).toContain("Home");
  });

  it("设置页可以切换语言并写入 ui.language", () => {
    const state = makeState();
    const { controller, saveSettings } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    const english = findButton(container, "English");
    expect(english).toBeDefined();
    english?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(saveSettings).toHaveBeenCalledWith({ ui: { language: "en" } });
  });

  it("关于板块展示开发者与项目地址", () => {
    const settings = makeSettings();
    settings.ui.sectionStates = { "settings.about": true };
    const state = makeState({ settings });
    const { controller } = makeController(state);
    const container = mount(h(SettingsPage, { controller, state, onNavigate: () => undefined }));

    const text = container.textContent ?? "";
    expect(text).toContain("关于");
    expect(text).toContain("jialuo");
    expect(text).toContain("MIT");
    expect(text).toContain("github.com/jialuo999/xxt_study");

    const link = container.querySelector<HTMLAnchorElement>("a.sh-link");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://github.com/jialuo999/xxt_study");
    expect(link?.getAttribute("target")).toBe("_blank");
  });
});
