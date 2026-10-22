import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../../src/core/settings";
import {
  getSettings,
  refreshSettings,
  replaceSettings,
  startExternalSettingsSync,
  subscribeSettings,
  updateSettings,
} from "../../src/core/settings-store";

describe("settings-store", () => {
  it("空存储 / null 时回退到完整默认设置，不崩溃", () => {
    localStorage.clear();
    const settings = replaceSettings(null as unknown as typeof DEFAULT_SETTINGS);
    expect(settings.version).toBe(1);
    expect(settings.ui.collapsed).toBe(true);
    expect(settings.solving.mode).toBe("review");
    expect(settings.solving.allowExam).toBe(false);
    expect(settings.ai.baseUrl).toContain("deepseek");
    expect(getSettings().bank.fuzzyThreshold).toBe(0.86);
    expect(settings.video.defaultMuted).toBe(true);
    expect(settings.video.playbackRate).toBe(1);
  });

  it("部分更新深度合并，不影响其他设置", () => {
    replaceSettings(structuredClone(DEFAULT_SETTINGS));
    const next = updateSettings({
      ui: { theme: "dark" },
      solving: { minConfidence: 0.75 },
      ai: { enabled: true },
    });
    expect(next.ui.theme).toBe("dark");
    expect(next.ui.width).toBe(DEFAULT_SETTINGS.ui.width);
    expect(next.solving.minConfidence).toBe(0.75);
    expect(next.solving.mode).toBe("review");
    expect(next.ai.enabled).toBe(true);
    expect(next.bank.remote.enabled).toBe(false);
  });

  it("未知字段不会覆盖默认结构", () => {
    replaceSettings(structuredClone(DEFAULT_SETTINGS));
    const next = updateSettings({
      solving: { includeTypes: { single: false } },
    });
    expect(next.solving.includeTypes.single).toBe(false);
    expect(next.solving.includeTypes.multiple).toBe(true);
    expect(next.solving.includeTypes.fill).toBe(true);
  });

  it("设置页板块折叠状态按 key 合并保存", () => {
    replaceSettings(structuredClone(DEFAULT_SETTINGS));
    expect(getSettings().ui.sectionStates).toEqual({});
    updateSettings({ ui: { sectionStates: { ai: false, logs: true } } });
    const next = updateSettings({ ui: { sectionStates: { bank: true } } });
    expect(next.ui.sectionStates).toEqual({ ai: false, logs: true, bank: true });
    expect(next.ui.width).toBe(DEFAULT_SETTINGS.ui.width);
  });

  it("refreshSettings 能同步其他 frame 写入 GM 存储的设置", () => {
    replaceSettings(structuredClone(DEFAULT_SETTINGS));
    const external = structuredClone(DEFAULT_SETTINGS);
    external.video.playbackRate = 1.75;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(external));

    const refreshed = refreshSettings();
    expect(refreshed.video.playbackRate).toBe(1.75);
    expect(getSettings().video.playbackRate).toBe(1.75);
    // 无变化时返回同一缓存对象，不重复通知
    expect(refreshSettings()).toBe(refreshed);
  });

  it("refreshSettings 只在有变化时通知订阅者", () => {
    replaceSettings(structuredClone(DEFAULT_SETTINGS));
    const listener = vi.fn();
    const unsubscribe = subscribeSettings(listener);
    refreshSettings();
    expect(listener).not.toHaveBeenCalled();

    const external = structuredClone(DEFAULT_SETTINGS);
    external.video.playbackRate = 1.25;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(external));
    refreshSettings();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("本地写入失败时 refreshSettings 不用旧存储回滚", () => {
    replaceSettings(structuredClone(DEFAULT_SETTINGS));
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    try {
      const next = updateSettings({ video: { playbackRate: 1.5 } });
      expect(next.video.playbackRate).toBe(1.5);
      expect(refreshSettings().video.playbackRate).toBe(1.5);
    } finally {
      spy.mockRestore();
    }
  });

  it("有 GM_addValueChangeListener 时外部变更立即同步", () => {
    replaceSettings(structuredClone(DEFAULT_SETTINGS));
    const globals = globalThis as unknown as Record<string, unknown>;
    const callbacks: Array<(...args: unknown[]) => void> = [];
    const remove = vi.fn();
    globals.GM_addValueChangeListener = (
      _name: string,
      callback: (...args: unknown[]) => void,
    ) => {
      callbacks.push(callback);
      return 7;
    };
    globals.GM_removeValueChangeListener = remove;

    try {
      const stop = startExternalSettingsSync();
      const external = structuredClone(DEFAULT_SETTINGS);
      external.video.playbackRate = 1.75;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(external));
      callbacks[0]?.(SETTINGS_KEY, DEFAULT_SETTINGS, external, true);
      expect(getSettings().video.playbackRate).toBe(1.75);
      stop();
      expect(remove).toHaveBeenCalledWith(7);
    } finally {
      delete globals.GM_addValueChangeListener;
      delete globals.GM_removeValueChangeListener;
    }
  });
});
