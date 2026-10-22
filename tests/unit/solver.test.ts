import { describe, expect, it, vi } from "vitest";
import type { BankEntry, Question, SolveResult } from "../../src/core/types";
import { questionHash } from "../../src/utils/text";
import {
  describeSource,
  fuzzyConfidence,
  SOURCE_LABELS,
  solveQuestions,
  toBankEntry,
  type SolverDeps,
} from "../../src/solver";
import type { BankMatch } from "../../src/bank";
import {
  makeChoiceQuestion,
  makeJudgeQuestion,
  makeQuestion,
  makeSettings,
  makeShortQuestion,
} from "./fixtures";

function bankEntry(
  id: string,
  type: BankEntry["type"],
  stem: string,
  answer: BankEntry["answer"],
  options?: string[],
): BankEntry {
  const hash = questionHash(type, stem, options ?? []);
  return { id: `bank-${hash}`, hash, type, stem, options, answer, source: "unit", updatedAt: 1 };
}

function baseSettings() {
  return makeSettings((settings) => {
    settings.solving.minConfidence = 0.6;
    settings.bank.remote.enabled = true;
    settings.ai.enabled = true;
    settings.solving.includeTypes.short = false;
  });
}

function buildQuestions(): Question[] {
  return [
    makeChoiceQuestion("q1", "缓存中的题目", ["甲", "乙"]),
    makeChoiceQuestion("q2", "题库精确题目", ["甲", "乙"]),
    makeChoiceQuestion("q3", "题库相似题目", ["甲", "乙", "丙"], "multiple"),
    makeJudgeQuestion("q4", "远程题库题目"),
    makeChoiceQuestion("q5", "AI 题目", ["甲", "乙"]),
    makeChoiceQuestion("q6", "AI 低置信度题目", ["甲", "乙"]),
    makeChoiceQuestion("q7", "AI 未返回题目", ["甲", "乙"]),
    makeShortQuestion("q8", "简答题（默认关闭）"),
    makeQuestion({ id: "q9", stem: "带图片的题目", hasImage: true, options: [] }),
  ];
}

function buildDeps(): SolverDeps {
  const cachedResult: SolveResult = {
    questionId: "q1",
    answer: { kind: "choice", keys: ["A"], texts: ["甲"] },
    confidence: 0.9,
    source: "ai",
    status: "solved",
    explanation: "缓存",
    latencyMs: 1,
  };
  return {
    getCachedSolve: vi.fn(async (question: Question) =>
      question.id === "q1" ? cachedResult : null,
    ),
    searchBank: vi.fn(async (question: Question): Promise<BankMatch | null> => {
      if (question.id === "q2") {
        return {
          entry: bankEntry(
            "e2",
            "single",
            "题库精确题目",
            { kind: "choice", keys: ["B"], texts: ["乙"] },
            ["A. 甲", "B. 乙"],
          ),
          score: 0.99,
          mode: "exact",
        };
      }
      if (question.id === "q3") {
        return {
          entry: bankEntry(
            "e3",
            "multiple",
            "题库相似题目",
            { kind: "choice", keys: ["A", "B"], texts: ["甲", "乙"] },
            ["A. 甲", "B. 乙", "C. 丙"],
          ),
          score: 0.95,
          mode: "fuzzy",
        };
      }
      return null;
    }),
    queryRemote: vi.fn(async (question: Question) =>
      question.id === "q4"
        ? { answer: { kind: "judge" as const, value: true }, confidence: 0.8 }
        : null,
    ),
    solveWithAi: vi.fn(async (questions: Question[]) => {
      const map = new Map<string, SolveResult>();
      for (const question of questions) {
        if (question.id === "q5") {
          map.set("q5", {
            questionId: "q5",
            answer: { kind: "choice", keys: ["A"], texts: ["甲"] },
            confidence: 0.8,
            source: "ai",
            status: "solved",
            latencyMs: 20,
            costTokens: 12,
          });
        }
        if (question.id === "q6") {
          map.set("q6", {
            questionId: "q6",
            answer: { kind: "choice", keys: ["B"], texts: ["乙"] },
            confidence: 0.3,
            source: "ai",
            status: "solved",
            latencyMs: 20,
            costTokens: 12,
          });
        }
      }
      return map;
    }),
    putCache: vi.fn(async () => undefined),
  };
}

describe("solveQuestions 流水线", () => {
  it("按 缓存 → 题库精确 → 题库模糊 → 远程 → AI → pending 的优先级解题", async () => {
    const questions = buildQuestions();
    const deps = buildDeps();
    const progress: Array<{ done: number; total: number; id: string }> = [];
    const results = await solveQuestions(questions, {
      settings: baseSettings(),
      deps,
      onProgress: (done, total, result) => {
        progress.push({ done, total, id: result.questionId });
      },
    });

    expect(results).toHaveLength(questions.length);
    expect(results.map((result) => result.questionId)).toEqual(
      questions.map((question) => question.id),
    );

    const byId = new Map(results.map((result) => [result.questionId, result]));
    expect(byId.get("q1")).toMatchObject({
      source: "ai",
      status: "solved",
      confidence: 0.9,
    });
    expect(byId.get("q2")).toMatchObject({
      source: "bank-exact",
      status: "solved",
      confidence: 0.99,
      answer: { kind: "choice", keys: ["B"] },
    });
    expect(byId.get("q3")).toMatchObject({
      source: "bank-fuzzy",
      status: "solved",
      confidence: fuzzyConfidence(0.95, 0.86),
      answer: { kind: "choice", keys: ["A", "B"] },
    });
    expect(byId.get("q4")).toMatchObject({
      source: "remote",
      status: "solved",
      confidence: 0.8,
      answer: { kind: "judge", value: true },
    });
    expect(byId.get("q5")).toMatchObject({
      source: "ai",
      status: "solved",
      confidence: 0.8,
      latencyMs: 20,
      costTokens: 12,
    });
    expect(byId.get("q6")).toMatchObject({
      source: "ai",
      status: "pending",
      confidence: 0.3,
      answer: { kind: "choice", keys: ["B"] },
    });
    expect(byId.get("q7")).toMatchObject({
      source: "manual",
      status: "pending",
      answer: null,
    });
    expect(byId.get("q8")).toMatchObject({ source: "manual", status: "pending" });
    expect(byId.get("q9")).toMatchObject({ source: "manual", status: "pending" });

    // 进度回调覆盖全部题目且 done 递增
    expect(progress).toHaveLength(questions.length);
    expect(progress.at(-1)?.done).toBe(questions.length);
    expect(progress.at(-1)?.total).toBe(questions.length);

    // 被关闭的题型与图片题不进入检索/AI
    const searchIds = (deps.searchBank as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as Question).id,
    );
    expect(searchIds).not.toContain("q8");
    expect(searchIds).not.toContain("q9");
    expect(searchIds).not.toContain("q1");

    // 远程题库在 AI 之前对所有剩余题目都会被尝试（q4 命中，q5-q7 未命中后进入 AI）
    const remoteIds = (deps.queryRemote as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as Question).id,
    );
    expect(remoteIds).toEqual(["q4", "q5", "q6", "q7"]);

    const aiIds = (deps.solveWithAi as ReturnType<typeof vi.fn>).mock.calls.flatMap((call) =>
      (call[0] as Question[]).map((question) => question.id),
    );
    expect(aiIds).toEqual(["q5", "q6", "q7"]);

    // 仅 AI / 远程的 solved 结果写缓存：q1（缓存来源 AI）、q4、q5
    const cachedIds = (deps.putCache as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as Question).id,
    );
    expect(cachedIds.sort()).toEqual(["q1", "q4", "q5"]);
  });

  it("模糊命中多选条目但当前题为单选时收敛为单键", async () => {
    const question = makeChoiceQuestion("x1", "跨题型题目", ["甲", "乙"]);
    const deps = buildDeps();
    deps.searchBank = vi.fn(async (): Promise<BankMatch | null> => ({
      entry: bankEntry(
        "ex",
        "multiple",
        "跨题型题目",
        { kind: "choice", keys: ["A", "B"], texts: ["甲", "乙"] },
        ["A. 甲", "B. 乙"],
      ),
      score: 0.95,
      mode: "fuzzy",
    }));

    const results = await solveQuestions([question], { settings: baseSettings(), deps });
    expect(results[0].status).toBe("solved");
    expect(results[0].answer).toEqual({
      kind: "choice",
      keys: ["A"],
      texts: ["甲"],
    });
  });

  it("AI 与远程都关闭时全部转人工 pending", async () => {
    const questions = [makeChoiceQuestion("a1", "普通题目", ["甲", "乙"])];
    const deps = buildDeps();
    const settings = baseSettings();
    settings.ai.enabled = false;
    settings.bank.remote.enabled = false;

    const results = await solveQuestions(questions, { settings, deps });
    expect(results[0]).toMatchObject({
      status: "pending",
      source: "manual",
      answer: null,
    });
    expect(deps.solveWithAi).not.toHaveBeenCalled();
    expect(deps.queryRemote).not.toHaveBeenCalled();
  });

  it("低于 minConfidence 的缓存结果也标记 pending", async () => {
    const question = makeChoiceQuestion("c1", "缓存低置信度", ["甲", "乙"]);
    const deps = buildDeps();
    deps.getCachedSolve = vi.fn(async () => ({
      questionId: "c1",
      answer: { kind: "choice" as const, keys: ["A"], texts: ["甲"] },
      confidence: 0.4,
      source: "ai" as const,
      status: "solved" as const,
      latencyMs: 1,
    }));

    const results = await solveQuestions([question], { settings: baseSettings(), deps });
    expect(results[0].status).toBe("pending");
    expect(results[0].answer).toMatchObject({ kind: "choice", keys: ["A"] });
  });

  it("依赖抛错时不中断整条流水线", async () => {
    const questions = [
      makeChoiceQuestion("e1", "题库检索抛错", ["甲", "乙"]),
      makeChoiceQuestion("e2", "AI 抛错", ["甲", "乙"]),
    ];
    const deps = buildDeps();
    deps.searchBank = vi.fn(async () => {
      throw new Error("bank boom");
    });
    deps.solveWithAi = vi.fn(async () => {
      throw new Error("ai boom");
    });

    const results = await solveQuestions(questions, { settings: baseSettings(), deps });
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("pending");
    expect(results[1].status).toBe("pending");
  });
});

describe("fuzzyConfidence", () => {
  it("阈值处为 0.75，满分处为 0.95", () => {
    expect(fuzzyConfidence(0.86, 0.86)).toBe(0.75);
    expect(fuzzyConfidence(1, 0.86)).toBe(0.95);
    expect(fuzzyConfidence(0.93, 0.86)).toBeGreaterThan(0.75);
    expect(fuzzyConfidence(0.93, 0.86)).toBeLessThan(0.95);
  });
});

describe("toBankEntry", () => {
  it("无答案返回 null", () => {
    const question = makeChoiceQuestion("q1", "题目", ["甲", "乙"]);
    const result: SolveResult = {
      questionId: "q1",
      answer: null,
      confidence: 0,
      source: "manual",
      status: "pending",
      latencyMs: 0,
    };
    expect(toBankEntry(question, result)).toBeNull();
  });

  it("选择题保存选项文本并生成稳定 hash/id", () => {
    const question = makeChoiceQuestion("q1", "题目一", ["甲", "乙"]);
    const result: SolveResult = {
      questionId: "q1",
      answer: { kind: "choice", keys: ["A"], texts: ["甲"] },
      confidence: 0.9,
      source: "ai",
      status: "solved",
      latencyMs: 5,
    };
    const entry = toBankEntry(question, result);
    expect(entry).not.toBeNull();
    expect(entry?.type).toBe("single");
    expect(entry?.options).toEqual(["A. 甲", "B. 乙"]);
    expect(entry?.source).toBe("ai");
    expect(entry?.hash).toBe(
      questionHash("single", "题目一", question.options.map((option) => option.text)),
    );
    expect(entry?.id).toBe(`bank-${entry?.hash}`);

    const overridden = toBankEntry(question, result, "manual");
    expect(overridden?.source).toBe("manual");
  });

  it("判断题不保存选项", () => {
    const question = makeJudgeQuestion("q2", "判断题目");
    const entry = toBankEntry(question, {
      questionId: "q2",
      answer: { kind: "judge", value: true },
      confidence: 0.9,
      source: "ai",
      status: "solved",
      latencyMs: 1,
    });
    expect(entry?.options).toBeUndefined();
    expect(entry?.answer).toEqual({ kind: "judge", value: true });
  });
});

describe("describeSource", () => {
  it("返回中文标签", () => {
    expect(describeSource("bank-exact")).toContain("题库");
    expect(describeSource("ai")).toBe("AI");
    expect(describeSource("remote")).toContain("远程");
    expect(SOURCE_LABELS.manual).toContain("人工");
  });
});
