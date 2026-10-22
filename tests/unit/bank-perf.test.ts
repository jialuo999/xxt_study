import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/core/settings";
import { replaceSettings } from "../../src/core/settings-store";
import { clearBank, importBankText, resetBankForTests, searchBank } from "../../src/bank";
import { makeChoiceQuestion } from "./fixtures";

const ENTRY_COUNT = 10000;

function buildEntries(count: number): string {
  const rows: Array<Record<string, unknown>> = [];
  for (let index = 0; index < count; index++) {
    rows.push({
      type: "single",
      question: `第${index}题：关于知识点${index}的基本原理，下列说法中正确的是（　）`,
      options: [
        `A. 知识点${index}的原理说明甲`,
        `B. 知识点${index}的原理说明乙`,
        `C. 知识点${index}的原理说明丙`,
        `D. 知识点${index}的原理说明丁`,
      ],
      answer: "A",
      source: "perf",
    });
  }
  return JSON.stringify(rows);
}

function median(values: number[]): number {
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

describe("1 万条题库性能", () => {
  let importMs = 0;

  beforeAll(async () => {
    replaceSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS);
    resetBankForTests();
    const json = buildEntries(ENTRY_COUNT);
    const startedAt = performance.now();
    const result = await importBankText(json, "json", "perf.json");
    importMs = performance.now() - startedAt;
    expect(result.added).toBe(ENTRY_COUNT);
    // 预热内存索引（懒加载）
    await searchBank(makeChoiceQuestion("warmup", "预热题目", ["甲", "乙"]));
  }, 120000);

  afterAll(async () => {
    await clearBank();
  });

  it("导入 1 万条耗时在可接受范围", () => {
    // 仅作健康检查，避免 CI 抖动
    expect(importMs).toBeLessThan(30000);
    console.log(`[perf] import ${ENTRY_COUNT} entries: ${importMs.toFixed(1)}ms`);
  });

  it("精确匹配目标 < 10ms", async () => {
    const question = makeChoiceQuestion(
      "exact",
      "第5000题：关于知识点5000的基本原理，下列说法中正确的是（　）",
      [
        "知识点5000的原理说明甲",
        "知识点5000的原理说明乙",
        "知识点5000的原理说明丙",
        "知识点5000的原理说明丁",
      ],
    );
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const startedAt = performance.now();
      const match = await searchBank(question);
      samples.push(performance.now() - startedAt);
      expect(match?.mode).toBe("exact");
    }
    const value = median(samples);
    console.log(`[perf] exact search: ${value.toFixed(2)}ms (median of ${samples.length})`);
    expect(value).toBeLessThan(10);
  });

  it("模糊匹配目标 < 50ms", async () => {
    const question = makeChoiceQuestion(
      "fuzzy",
      "第5000题：关于知识点5000的基本原理，下列说法中哪一项是正确的（　）",
      [
        "知识点5000的原理说明甲",
        "知识点5000的原理说明乙",
        "知识点5000的原理说明丙",
        "知识点5000的原理说明丁",
      ],
    );
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const startedAt = performance.now();
      await searchBank(question);
      samples.push(performance.now() - startedAt);
    }
    const value = median(samples);
    console.log(`[perf] fuzzy search: ${value.toFixed(2)}ms (median of ${samples.length})`);
    expect(value).toBeLessThan(50);
  });
});
