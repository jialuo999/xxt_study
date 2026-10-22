import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/core/settings";
import { getSettings, replaceSettings, updateSettings } from "../../src/core/settings-store";

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
});
