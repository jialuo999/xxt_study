import { describe, expect, it } from "vitest";
import {
  formatAnswer,
  normalizeOption,
  normalizeText,
  optionSetSimilarity,
  parseAnswerLetters,
  parseJudge,
  questionHash,
  splitFillValues,
  textSimilarity,
} from "../../src/utils/text";
import {
  answerFromUnknown,
  formatAnswerText,
  parseAnswerText,
  resolveOptions,
} from "../../src/bank/answer";

describe("normalizeText / normalizeOption", () => {
  it("去掉题号与标点", () => {
    const raw = "第3题、以下、哪个 说法 正确？";
    expect(normalizeText(raw)).toBe("以下哪个说法正确");
  });

  it("去掉分值前缀", () => {
    expect(normalizeText("（5分）以下哪个正确")).toBe("以下哪个正确");
  });

  it("全角字符与大小写归一", () => {
    expect(normalizeText("ＡＢＣ　ＤＥＦ")).toBe(normalizeText("abc def"));
  });

  it("normalizeOption 去掉 A. / （B） / 选项C 前缀", () => {
    expect(normalizeOption("A. 社会主义")).toBe("社会主义");
    expect(normalizeOption("（B）市场经济")).toBe("市场经济");
    expect(normalizeOption("选项C、计划经济")).toBe("计划经济");
    expect(normalizeOption("D)  按劳分配")).toBe("按劳分配");
  });
});

describe("questionHash", () => {
  it("相同题目（忽略空白/标点/选项顺序）哈希一致", () => {
    const a = questionHash("single", "以下哪个正确？", ["A. 甲", "B. 乙"]);
    const b = questionHash("single", "以下 哪个 正确", ["B. 乙", "A. 甲"]);
    expect(a).toBe(b);
  });

  it("题型不同哈希不同", () => {
    const stem = "以下哪个正确";
    expect(questionHash("single", stem, ["甲", "乙"])).not.toBe(
      questionHash("multiple", stem, ["甲", "乙"]),
    );
  });

  it("题干不同哈希不同", () => {
    expect(questionHash("single", "题目一", ["甲", "乙"])).not.toBe(
      questionHash("single", "题目二", ["甲", "乙"]),
    );
  });
});

describe("textSimilarity / optionSetSimilarity", () => {
  it("完全相同为 1", () => {
    expect(textSimilarity("社会主义的本质", "社会主义的本质")).toBe(1);
  });

  it("轻微差异仍保持高相似度", () => {
    const score = textSimilarity(
      "社会主义的本质是解放生产力，发展生产力",
      "社会主义的本质是解放生产力，发展生产力。",
    );
    expect(score).toBeGreaterThan(0.95);
  });

  it("无关文本相似度低", () => {
    expect(textSimilarity("马克思主义哲学", "计算机网络协议")).toBeLessThan(0.3);
  });

  it("对称性", () => {
    const left = "剩余价值学说";
    const right = "剩余价值理论";
    expect(textSimilarity(left, right)).toBeCloseTo(textSimilarity(right, left), 10);
  });

  it("选项集合 Jaccard", () => {
    expect(optionSetSimilarity(["A. 甲", "B. 乙"], ["甲", "乙"])).toBe(1);
    expect(optionSetSimilarity(["A. 甲", "B. 乙"], ["甲", "丙"])).toBeCloseTo(1 / 3, 10);
    expect(optionSetSimilarity([], ["甲"])).toBe(0);
  });
});

describe("parseAnswerLetters / parseJudge / splitFillValues", () => {
  it("解析字母答案并去重排序", () => {
    expect(parseAnswerLetters("A,C")).toEqual(["A", "C"]);
    expect(parseAnswerLetters("AC")).toEqual(["A", "C"]);
    expect(parseAnswerLetters("a、c")).toEqual(["A", "C"]);
    expect(parseAnswerLetters("A. 甲")).toEqual([]);
    expect(parseAnswerLetters("")).toEqual([]);
  });

  it("解析判断题", () => {
    expect(parseJudge("对")).toBe(true);
    expect(parseJudge("正确")).toBe(true);
    expect(parseJudge("√")).toBe(true);
    expect(parseJudge("T")).toBe(true);
    expect(parseJudge("错")).toBe(false);
    expect(parseJudge("×")).toBe(false);
    expect(parseJudge("F")).toBe(false);
    expect(parseJudge("不知道")).toBeNull();
  });

  it("拆分填空题多空", () => {
    expect(splitFillValues("空1|空2|空3")).toEqual(["空1", "空2", "空3"]);
    expect(splitFillValues("空1；空2")).toEqual(["空1", "空2"]);
    expect(splitFillValues("空1\n空2")).toEqual(["空1", "空2"]);
    expect(splitFillValues("甲、乙", 2)).toEqual(["甲", "乙"]);
    expect(splitFillValues("甲、乙、丙", 2)).toEqual(["甲", "乙"]);
  });
});

describe("resolveOptions", () => {
  it("识别 A. 前缀并保留文本", () => {
    expect(resolveOptions(["A. 甲", "B. 乙"])).toEqual([
      { key: "A", text: "甲" },
      { key: "B", text: "乙" },
    ]);
  });

  it("缺少字母时自动补 A/B/C", () => {
    expect(resolveOptions(["甲", "乙", "丙"]).map((option) => option.key)).toEqual(["A", "B", "C"]);
  });

  it("数字序号也识别为 key", () => {
    expect(resolveOptions(["1. 甲", "2. 乙"]).map((option) => option.key)).toEqual(["1", "2"]);
  });
});

describe("parseAnswerText", () => {
  const options = ["A. 甲", "B. 乙", "C. 丙", "D. 丁"];

  it("单选字母", () => {
    expect(parseAnswerText("B", { type: "single", options })).toEqual({
      kind: "choice",
      keys: ["B"],
      texts: ["乙"],
    });
  });

  it("单选选项全文", () => {
    expect(parseAnswerText("丙", { type: "single", options })).toEqual({
      kind: "choice",
      keys: ["C"],
      texts: ["丙"],
    });
  });

  it("多选字母组合并去重排序", () => {
    expect(parseAnswerText("C,A,C", { type: "multiple", options })).toEqual({
      kind: "choice",
      keys: ["A", "C"],
      texts: ["甲", "丙"],
    });
  });

  it("单选多给字母时只取第一个", () => {
    const answer = parseAnswerText("AC", { type: "single", options });
    expect(answer).toMatchObject({ kind: "choice", keys: ["A"] });
  });

  it("判断题字母映射到选项文本", () => {
    expect(
      parseAnswerText("A", {
        type: "judge",
        options: ["A. 正确", "B. 错误"],
      }),
    ).toEqual({ kind: "judge", value: true });
    expect(
      parseAnswerText("错误", {
        type: "judge",
        options: ["A. 正确", "B. 错误"],
      }),
    ).toEqual({ kind: "judge", value: false });
  });

  it("填空题多空", () => {
    expect(parseAnswerText("生产力|生产关系", { type: "fill", blankCount: 2 })).toEqual({
      kind: "fill",
      values: ["生产力", "生产关系"],
    });
  });

  it("简答题文本", () => {
    expect(parseAnswerText("  这是简答内容  ", { type: "short" })).toEqual({
      kind: "text",
      text: "这是简答内容",
    });
  });

  it("未知题型可推断", () => {
    expect(parseAnswerText("A", { type: "unknown", options })).toMatchObject({
      kind: "choice",
      keys: ["A"],
    });
    expect(parseAnswerText("对", { type: "unknown" })).toEqual({ kind: "judge", value: true });
    expect(parseAnswerText("甲|乙", { type: "unknown" })).toEqual({
      kind: "fill",
      values: ["甲", "乙"],
    });
    expect(parseAnswerText("一段解释", { type: "unknown" })).toEqual({
      kind: "text",
      text: "一段解释",
    });
  });

  it("空答案返回 null", () => {
    expect(parseAnswerText("   ", { type: "single", options })).toBeNull();
  });
});

describe("answerFromUnknown", () => {
  const ctx = {
    type: "multiple" as const,
    options: ["A. 甲", "B. 乙", "C. 丙", "D. 丁"],
  };

  it("接受数组并去重", () => {
    expect(answerFromUnknown(["A", "C", "A"], ctx)).toEqual({
      kind: "choice",
      keys: ["A", "C"],
      texts: ["甲", "丙"],
    });
  });

  it("接受 AnswerValue 对象", () => {
    expect(answerFromUnknown({ kind: "judge", value: true }, { type: "judge" })).toEqual({
      kind: "judge",
      value: true,
    });
  });

  it("判断题接受布尔", () => {
    expect(answerFromUnknown(false, { type: "judge" })).toEqual({ kind: "judge", value: false });
  });

  it("填空题接受数组", () => {
    expect(answerFromUnknown(["甲", "乙"], { type: "fill", blankCount: 2 })).toEqual({
      kind: "fill",
      values: ["甲", "乙"],
    });
  });

  it("无效输入返回 null", () => {
    expect(answerFromUnknown(null, ctx)).toBeNull();
    expect(answerFromUnknown("", ctx)).toBeNull();
    expect(answerFromUnknown(["Z"], ctx)).toBeNull();
  });
});

describe("formatAnswer / formatAnswerText", () => {
  it("choice 输出字母与文本", () => {
    expect(
      formatAnswer({ kind: "choice", keys: ["A", "C"], texts: ["甲", "丙"] }),
    ).toContain("AC");
  });

  it("各题型文本", () => {
    expect(formatAnswerText({ kind: "choice", keys: ["A", "C"] })).toBe("A,C");
    expect(formatAnswerText({ kind: "judge", value: true })).toBe("对");
    expect(formatAnswerText({ kind: "fill", values: ["甲", "乙"] })).toBe("甲|乙");
    expect(formatAnswerText({ kind: "text", text: "简答" })).toBe("简答");
    expect(formatAnswerText(null)).toBe("");
  });
});
