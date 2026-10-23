import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/core/settings";
import { replaceSettings } from "../../src/core/settings-store";
import {
  clearBank,
  clearCache,
  detectBankFormat,
  exportBank,
  getBankStats,
  getCachedSolve,
  importBankText,
  initBank,
  putCache,
  resetBankForTests,
  searchBank,
  searchBankByText,
} from "../../src/bank";
import { parseBankText } from "../../src/bank/parser";
import type { SolveResult } from "../../src/core/types";
import { makeChoiceQuestion, makeSettings } from "./fixtures";

beforeEach(() => {
  replaceSettings(makeSettings());
  resetBankForTests();
});

afterEach(async () => {
  await clearBank();
});

const JSON_SAMPLE = JSON.stringify([
  {
    type: "single",
    question: "以下哪个选项是马克思主义哲学的核心？",
    options: ["A. 辩证法", "B. 形而上学", "C. 不可知论", "D. 宿命论"],
    answer: "A",
    source: "单元测试",
  },
  {
    type: "multiple",
    question: "下列哪些属于唯物主义的基本形态？",
    options: ["A. 古代朴素唯物主义", "B. 近代形而上学唯物主义", "C. 辩证唯物主义", "D. 客观唯心主义"],
    answer: "ABC",
    source: "单元测试",
  },
  {
    type: "judge",
    question: "实践是检验真理的唯一标准。",
    answer: "对",
    source: "单元测试",
  },
  {
    type: "fill",
    question: "商品的价值量由生产商品的____决定，并受____影响。",
    options: [],
    answer: "社会必要劳动时间|供求关系",
    source: "单元测试",
  },
]);

describe("parseBankText", () => {
  it("解析 JSON 数组并统一答案类型", () => {
    const parsed = parseBankText(JSON_SAMPLE, "json");
    expect(parsed.total).toBe(4);
    expect(parsed.skipped).toBe(0);
    expect(parsed.rows[0]).toMatchObject({
      type: "single",
      answer: { kind: "choice", keys: ["A"] },
    });
    expect(parsed.rows[1].answer).toMatchObject({ kind: "choice", keys: ["A", "B", "C"] });
    expect(parsed.rows[2].answer).toEqual({ kind: "judge", value: true });
    expect(parsed.rows[3].answer).toEqual({
      kind: "fill",
      values: ["社会必要劳动时间", "供求关系"],
    });
  });

  it("JSON 支持 {questions:[...]}、中文表头与 AnswerValue 对象", () => {
    const parsed = parseBankText(
      JSON.stringify({
        questions: [
          {
            题型: "单选题",
            题目: "中国的首都是哪里？",
            选项: "A. 北京||B. 上海",
            答案: { kind: "choice", keys: ["A"] },
            来源: "中文",
          },
          {
            题型: "判断题",
            题干: "太阳从西边升起。",
            答案: false,
          },
        ],
      }),
      "json",
    );
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].type).toBe("single");
    expect(parsed.rows[0].options).toEqual(["A. 北京", "B. 上海"]);
    expect(parsed.rows[1].answer).toEqual({ kind: "judge", value: false });
  });

  it("CSV 支持 BOM、引号、字段内换行与中文表头", () => {
    const csv = [
      "\uFEFF题型,题目,选项,答案,来源",
      '单选,"以下哪个正确？","A. 甲\nB. 乙\nC. 丙",A,单元测试',
      '判断,"地球是圆的",,对,导入',
    ].join("\n");
    const parsed = parseBankText(csv, "csv");
    expect(parsed.total).toBe(2);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      type: "single",
      stem: "以下哪个正确？",
      answer: { kind: "choice", keys: ["A"] },
    });
    expect(parsed.rows[0].options).toEqual(["A. 甲", "B. 乙", "C. 丙"]);
    expect(parsed.rows[1].answer).toEqual({ kind: "judge", value: true });
  });

  it("CSV 带引号逗号与转义双引号", () => {
    const csv = [
      "question,options,answer",
      '"下列哪项是“正确”的, 请选择",A. 甲||B. 乙,A',
    ].join("\n");
    const parsed = parseBankText(csv, "csv");
    expect(parsed.rows[0].stem).toBe('下列哪项是“正确”的, 请选择');
  });

  it("CSV 支持 A/B/C/D 分列选项", () => {
    const csv = ["题目,答案,A,B,C,D", "以下哪个正确,A,甲,乙,丙,丁"].join("\n");
    const parsed = parseBankText(csv, "csv");
    expect(parsed.rows[0].options).toEqual(["A. 甲", "B. 乙", "C. 丙", "D. 丁"]);
    expect(parsed.rows[0].answer).toMatchObject({ kind: "choice", keys: ["A"] });
  });

  it("CSV 无表头时按题干/答案/选项顺序解析", () => {
    const parsed = parseBankText("以下哪个正确,A,甲||乙||丙", "csv");
    expect(parsed.rows[0]).toMatchObject({
      stem: "以下哪个正确",
      answer: { kind: "choice", keys: ["A"] },
    });
    expect(parsed.rows[0].options).toHaveLength(3);
  });

  it("TSV 使用制表符分隔", () => {
    const parsed = parseBankText("题目\t答案\n以下哪个正确\tB", "tsv");
    expect(parsed.rows[0].answer).toMatchObject({ kind: "choice", keys: ["B"] });
  });

  it("TXT 支持 == 与制表符两种分隔，并统计跳过行", () => {
    const parsed = parseBankText("题目一==A\n题目二\t对\n无法解析的一行", "txt");
    expect(parsed.total).toBe(3);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.skipped).toBe(1);
    expect(parsed.rows[0].type).toBe("single");
    expect(parsed.rows[1].type).toBe("judge");
  });

  it("无法解析答案的行被跳过并记录错误", () => {
    const parsed = parseBankText(
      JSON.stringify([
        { type: "single", question: "正常题目", options: ["A. 甲", "B. 乙"], answer: "A" },
        { type: "single", question: "坏题目", options: ["A. 甲", "B. 乙"], answer: "丙丁" },
        { question: "", answer: "A" },
      ]),
      "json",
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.skipped).toBe(2);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });
});

describe("detectBankFormat", () => {
  it("按扩展名推断格式，.jsonl 不再被当作 json", () => {
    expect(detectBankFormat("bank.json")).toBe("json");
    expect(detectBankFormat("BANK.JSON")).toBe("json");
    expect(detectBankFormat("bank.jsonl")).toBe("txt");
    expect(detectBankFormat("bank.csv")).toBe("csv");
    expect(detectBankFormat("bank.tsv")).toBe("tsv");
    expect(detectBankFormat("bank.tab")).toBe("tsv");
    expect(detectBankFormat("bank.txt")).toBe("txt");
    expect(detectBankFormat("noext")).toBe("txt");
  });
});

describe("题库导入与统计", () => {
  it("initBank 在无 IndexedDB 环境下退化为内存存储", async () => {
    await expect(initBank()).resolves.toBeUndefined();
    const stats = await getBankStats();
    expect(stats.storage).toBe("memory");
    expect(stats.total).toBe(0);
  });

  it("导入 JSON 后统计正确", async () => {
    const result = await importBankText(JSON_SAMPLE, "json", "sample.json");
    expect(result.ok).toBe(true);
    expect(result.added).toBe(4);
    expect(result.failed).toBe(0);
    expect(result.totalEntries).toBe(4);
    expect(result.filename).toBe("sample.json");

    const stats = await getBankStats();
    expect(stats.total).toBe(4);
    expect(stats.byType.single).toBe(1);
    expect(stats.byType.multiple).toBe(1);
    expect(stats.byType.judge).toBe(1);
    expect(stats.byType.fill).toBe(1);
    expect(stats.lastImportAt).toBeTypeOf("number");
    expect(stats.oldestUpdatedAt).toBeTypeOf("number");
  });

  it("重复导入按 hash 去重", async () => {
    await importBankText(JSON_SAMPLE, "json");
    const second = await importBankText(JSON_SAMPLE, "json");
    expect(second.added).toBe(0);
    expect(second.duplicates).toBe(4);
    expect(second.totalEntries).toBe(4);
  });

  it("相同题目答案变化时更新条目", async () => {
    const first = JSON.stringify([
      {
        type: "single",
        question: "同一道题",
        options: ["A. 甲", "B. 乙"],
        answer: "A",
      },
    ]);
    const second = JSON.stringify([
      {
        type: "single",
        question: "同一道题",
        options: ["A. 甲", "B. 乙"],
        answer: "B",
      },
    ]);
    await importBankText(first, "json");
    const result = await importBankText(second, "json");
    expect(result.added).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.duplicates).toBe(0);

    const match = await searchBank(
      makeChoiceQuestion("q1", "同一道题", ["甲", "乙"]),
    );
    expect(match?.entry.answer).toMatchObject({ kind: "choice", keys: ["B"] });
  });

  it("超过 maxEntries 时裁剪最旧条目", async () => {
    replaceSettings(makeSettings((settings) => (settings.bank.maxEntries = 2)));
    const rows = [1, 2, 3].map((index) => ({
      type: "single",
      question: `题目${index}`,
      options: ["A. 甲", "B. 乙"],
      answer: "A",
    }));
    const result = await importBankText(JSON.stringify(rows), "json");
    expect(result.pruned).toBeGreaterThan(0);
    const stats = await getBankStats();
    expect(stats.total).toBe(2);
  });

  it("导出 JSON 后可再次导入", async () => {
    await importBankText(JSON_SAMPLE, "json");
    const exported = await exportBank("json");
    const parsed = JSON.parse(exported) as unknown[];
    expect(parsed).toHaveLength(4);

    await clearBank();
    const reimport = await importBankText(exported, "json");
    expect(reimport.added).toBe(4);
    expect(reimport.failed).toBe(0);
  });

  it("导出 CSV 包含表头与答案文本", async () => {
    await importBankText(JSON_SAMPLE, "json");
    const csv = await exportBank("csv");
    expect(csv.split("\n")[0]).toBe("type,question,options,answer,source");
    expect(csv).toContain("辩证法");
  });

  it("clearBank 清空题库与缓存", async () => {
    await importBankText(JSON_SAMPLE, "json");
    await clearBank();
    const stats = await getBankStats();
    expect(stats.total).toBe(0);
    expect(stats.cacheCount).toBe(0);
  });
});

describe("searchBank", () => {
  it("精确命中返回 0.99 / exact", async () => {
    await importBankText(JSON_SAMPLE, "json");
    const question = makeChoiceQuestion("q1", "以下哪个选项是马克思主义哲学的核心？", [
      "辩证法",
      "形而上学",
      "不可知论",
      "宿命论",
    ]);
    const match = await searchBank(question);
    expect(match).not.toBeNull();
    expect(match?.mode).toBe("exact");
    expect(match?.score).toBe(0.99);
    expect(match?.entry.answer).toMatchObject({ kind: "choice", keys: ["A"] });
  });

  it("相似题干命中模糊结果并带选项加权", async () => {
    await importBankText(
      JSON.stringify([
        {
          type: "single",
          question: "在哲学基本问题中，思维和存在的关系问题是最根本的问题。",
          options: ["A. 甲选项", "B. 乙选项", "C. 丙选项", "D. 丁选项"],
          answer: "A",
        },
      ]),
      "json",
    );
    const question = makeChoiceQuestion(
      "q2",
      "在哲学基本问题中，思维和存在的关系问题是最基础的问题。",
      ["甲选项", "乙选项", "丙选项", "丁选项"],
    );
    const match = await searchBank(question);
    expect(match).not.toBeNull();
    expect(match?.mode).toBe("fuzzy");
    expect(match?.score).toBeGreaterThan(0.86);
  });

  it("低于阈值返回 null", async () => {
    await importBankText(JSON_SAMPLE, "json");
    replaceSettings(makeSettings((settings) => (settings.bank.fuzzyThreshold = 0.999)));
    const question = makeChoiceQuestion("q3", "完全无关的另一道题", ["甲", "乙"]);
    expect(await searchBank(question)).toBeNull();
  });

  it("题型不兼容时不匹配", async () => {
    await importBankText(JSON_SAMPLE, "json");
    const question = makeChoiceQuestion("q4", "实践是检验真理的唯一标准。", ["正确", "错误"], "judge");
    const match = await searchBank(question);
    // judge 题与题库中的判断题题干高度相似，允许模糊命中；但不允许匹配到选择题答案
    if (match) expect(match.entry.type).toBe("judge");
  });

  it("searchBankByText 按得分排序并限制数量", async () => {
    await importBankText(JSON_SAMPLE, "json");
    const hits = await searchBankByText("马克思主义哲学的核心", 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(hits[0].entry.stem).toContain("马克思主义哲学");
    expect(hits[0].score).toBeGreaterThan(0);
  });
});

describe("解题缓存", () => {
  const question = makeChoiceQuestion("q-cache", "缓存题目", ["甲", "乙"]);
  const result: SolveResult = {
    questionId: question.id,
    answer: { kind: "choice", keys: ["A"], texts: ["甲"] },
    confidence: 0.9,
    source: "ai",
    status: "solved",
    explanation: "测试",
    latencyMs: 12,
    costTokens: 8,
  };

  it("写入后可读取（questionId 使用当前题目）", async () => {
    await putCache(question, result);
    const cached = await getCachedSolve(question);
    expect(cached).not.toBeNull();
    expect(cached?.questionId).toBe(question.id);
    expect(cached?.answer).toEqual(result.answer);
    expect(cached?.source).toBe("ai");
    expect(cached?.costTokens).toBe(8);
  });

  it("TTL 为 0 时不缓存", async () => {
    replaceSettings(makeSettings((settings) => (settings.bank.cacheTtlDays = 0)));
    await putCache(question, result);
    expect(await getCachedSolve(question)).toBeNull();
  });

  it("clearCache 清空缓存", async () => {
    await putCache(question, result);
    await clearCache();
    expect(await getCachedSolve(question)).toBeNull();
  });
});
