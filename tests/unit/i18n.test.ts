import { afterEach, describe, expect, it } from "vitest";
import {
  applyLanguage,
  getLocale,
  resolveLocale,
  setLocale,
  t,
} from "../../src/core/i18n";

afterEach(() => {
  setLocale("zh-CN");
});

describe("i18n 语言解析", () => {
  it("auto 跟随浏览器：中文浏览器用中文，其他用英文", () => {
    expect(resolveLocale("auto", "zh-CN")).toBe("zh-CN");
    expect(resolveLocale("auto", "zh-TW")).toBe("zh-CN");
    expect(resolveLocale("auto", "en-US")).toBe("en");
    expect(resolveLocale("auto", "fr-FR")).toBe("en");
    expect(resolveLocale(undefined, "en-US")).toBe("en");
  });

  it("显式选择优先于浏览器语言", () => {
    expect(resolveLocale("zh-CN", "en-US")).toBe("zh-CN");
    expect(resolveLocale("en", "zh-CN")).toBe("en");
  });

  it("applyLanguage 更新当前 locale", () => {
    expect(applyLanguage("en")).toBe("en");
    expect(getLocale()).toBe("en");
    expect(applyLanguage("auto")).toBe("en");
  });
});

describe("i18n 文案", () => {
  it("切换语言后 t() 返回对应文案", () => {
    applyLanguage("zh-CN");
    expect(t("tab.home")).toBe("主页");
    expect(t("settings.language")).toBe("语言");

    applyLanguage("en");
    expect(t("tab.home")).toBe("Home");
    expect(t("settings.language")).toBe("Language");
  });

  it("支持 {name} 占位符", () => {
    applyLanguage("zh-CN");
    expect(t("home.steps", { count: 3 })).toBe("已翻 3 页");
    applyLanguage("en");
    expect(t("home.steps", { count: 3 })).toBe("3 pages turned");
    expect(t("run.status.collected", { count: 5 })).toBe("Collected 5 questions");
  });

  it("缺少变量时保留占位符而不是输出 undefined", () => {
    applyLanguage("en");
    expect(t("home.steps", {})).toBe("{count} pages turned");
  });
});
