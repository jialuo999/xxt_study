import { describe, expect, it } from "vitest";
import { isWithinDailyWindow, parseClock } from "../../src/app/autoturn";

describe("自动翻页时间窗", () => {
  it("解析 HH:mm", () => {
    expect(parseClock("09:30")).toBe(570);
    expect(parseClock("23:05")).toBe(1385);
    expect(parseClock("")).toBeNull();
    expect(parseClock("25:00")).toBeNull();
    expect(parseClock("9:5")).toBeNull();
  });

  it("普通时间窗", () => {
    expect(isWithinDailyWindow(new Date(2026, 0, 1, 8, 0), "09:00", "18:00")).toBe(false);
    expect(isWithinDailyWindow(new Date(2026, 0, 1, 9, 0), "09:00", "18:00")).toBe(true);
    expect(isWithinDailyWindow(new Date(2026, 0, 1, 17, 59), "09:00", "18:00")).toBe(true);
    expect(isWithinDailyWindow(new Date(2026, 0, 1, 18, 0), "09:00", "18:00")).toBe(false);
  });

  it("跨午夜时间窗", () => {
    expect(isWithinDailyWindow(new Date(2026, 0, 1, 23, 30), "23:00", "06:00")).toBe(true);
    expect(isWithinDailyWindow(new Date(2026, 0, 2, 5, 30), "23:00", "06:00")).toBe(true);
    expect(isWithinDailyWindow(new Date(2026, 0, 2, 12, 0), "23:00", "06:00")).toBe(false);
  });

  it("留空表示全天 / 只填一端", () => {
    expect(isWithinDailyWindow(new Date(2026, 0, 1, 12, 0), "", "")).toBe(true);
    expect(isWithinDailyWindow(new Date(2026, 0, 1, 12, 0), "09:00", "")).toBe(true);
    expect(isWithinDailyWindow(new Date(2026, 0, 1, 8, 0), "09:00", "")).toBe(false);
    expect(isWithinDailyWindow(new Date(2026, 0, 1, 8, 0), "", "09:00")).toBe(true);
    expect(isWithinDailyWindow(new Date(2026, 0, 1, 10, 0), "", "09:00")).toBe(false);
  });
});
