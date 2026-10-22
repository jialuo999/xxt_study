import { describe, expect, it } from "vitest";
import { extractJson, parseAiResponse, repairJson } from "../../src/ai/parse";
import {
  makeChoiceQuestion,
  makeFillQuestion,
  makeJudgeQuestion,
  makeShortQuestion,
} from "./fixtures";

const questions = [
  makeChoiceQuestion("q1", "单选题目", ["甲", "乙", "丙", "丁"]),
  makeChoiceQuestion("q2", "多选题目", ["甲", "乙", "丙", "丁"], "multiple"),
  makeJudgeQuestion("q3", "判断题目"),
  makeFillQuestion("q4", "填空题目", 2),
  makeShortQuestion("q5", "简答题目"),
];

describe("extractJson", () => {
  it("提取纯 JSON", () => {
    expect(extractJson('{"answers":[]}')).toBe('{"answers":[]}');
  });

  it("提取 ```json 代码块", () => {
    const text = '这里是答案：\n```json\n{"answers":[{"id":"q1"}]}\n```\n请查收';
    expect(extractJson(text)).toBe('{"answers":[{"id":"q1"}]}');
  });

  it("忽略字符串内部的花括号", () => {
    const text = '{"answers":[{"id":"q1","explanation":"含有 } 和 ] 的文本"}]}';
    expect(extractJson(text)).toBe(text);
  });

  it("提取裸数组", () => {
    expect(extractJson('说明 [{"id":"q1","answer":["A"]}] 结束')).toBe(
      '[{"id":"q1","answer":["A"]}]',
    );
  });

  it("没有 JSON 时返回 null", () => {
    expect(extractJson("完全没有 JSON 的文本")).toBeNull();
    expect(extractJson("")).toBeNull();
  });
});

describe("repairJson", () => {
  it("修复尾逗号", () => {
    const repaired = repairJson('{"answers":[{"id":"q1","answer":["A"],},],}');
    expect(repaired).not.toBeNull();
    expect(JSON.parse(repaired as string)).toEqual({
      answers: [{ id: "q1", answer: ["A"] }],
    });
  });

  it("修复单引号", () => {
    const repaired = repairJson("{'answers':[{'id':'q1','answer':['A']}]}");
    expect(repaired).not.toBeNull();
    expect(JSON.parse(repaired as string)).toEqual({
      answers: [{ id: "q1", answer: ["A"] }],
    });
  });

  it("修复未加引号的 key", () => {
    const repaired = repairJson('{answers:[{id:"q1",answer:["A"]}]}');
    expect(repaired).not.toBeNull();
    expect(JSON.parse(repaired as string)).toEqual({
      answers: [{ id: "q1", answer: ["A"] }],
    });
  });

  it("修复智能引号", () => {
    const repaired = repairJson('{“answers”:[{“id”:“q1”,“answer”:[“A”]}]}');
    expect(repaired).not.toBeNull();
    expect(JSON.parse(repaired as string)).toEqual({
      answers: [{ id: "q1", answer: ["A"] }],
    });
  });

  it("无法修复时返回 null", () => {
    expect(repairJson("这不是 JSON")).toBeNull();
  });
});

describe("parseAiResponse", () => {
  it("解析标准返回并转换为 SolveResult", () => {
    const text = JSON.stringify({
      answers: [
        { id: "q1", answer: ["B"], confidence: 0.9, explanation: "因为 B 正确" },
        { id: "q2", answer: ["C", "A", "A"], confidence: 0.8 },
        { id: "q3", answer: true, confidence: "0.7" },
        { id: "q4", answer: ["空一", "空二", "空三"], confidence: 0.6 },
        { id: "q5", answer: "这是简答内容", confidence: 0.5 },
      ],
    });
    const results = parseAiResponse(text, questions);
    expect(results.size).toBe(5);

    expect(results.get("q1")).toMatchObject({
      questionId: "q1",
      source: "ai",
      status: "solved",
      confidence: 0.9,
      explanation: "因为 B 正确",
      answer: { kind: "choice", keys: ["B"], texts: ["乙"] },
    });
    expect(results.get("q2")?.answer).toEqual({
      kind: "choice",
      keys: ["A", "C"],
      texts: ["甲", "丙"],
    });
    expect(results.get("q3")?.answer).toEqual({ kind: "judge", value: true });
    expect(results.get("q4")?.answer).toEqual({ kind: "fill", values: ["空一", "空二"] });
    expect(results.get("q5")?.answer).toEqual({ kind: "text", text: "这是简答内容" });
  });

  it("容忍代码块与前后杂文本", () => {
    const text = [
      "好的，答案如下：",
      "```json",
      JSON.stringify({ answers: [{ id: "q1", answer: ["A"], confidence: 0.99 }] }),
      "```",
      "以上。",
    ].join("\n");
    const results = parseAiResponse(text, questions);
    expect(results.get("q1")?.answer).toMatchObject({ kind: "choice", keys: ["A"] });
  });

  it("拒绝不存在的 id 与越界选项", () => {
    const text = JSON.stringify({
      answers: [
        { id: "q1", answer: ["E"], confidence: 0.9 },
        { id: "q1", answer: ["A"], confidence: 0.9 },
        { id: "unknown-id", answer: ["A"], confidence: 0.9 },
        { id: "q2", answer: ["Z"], confidence: 0.9 },
      ],
    });
    const results = parseAiResponse(text, questions);
    expect(results.has("unknown-id")).toBe(false);
    expect(results.get("q1")?.answer).toMatchObject({ kind: "choice", keys: ["A"] });
    expect(results.has("q2")).toBe(false);
  });

  it("单选多字母时只保留第一个", () => {
    const text = JSON.stringify({
      answers: [{ id: "q1", answer: ["C", "A"], confidence: 0.9 }],
    });
    expect(parseAiResponse(text, questions).get("q1")?.answer).toMatchObject({
      kind: "choice",
      keys: ["C"],
    });
  });

  it("置信度越界时修正，缺失时默认 0.5", () => {
    const text = JSON.stringify({
      answers: [
        { id: "q1", answer: ["A"], confidence: 95 },
        { id: "q2", answer: ["A"] },
        { id: "q3", answer: "对", confidence: -1 },
      ],
    });
    const results = parseAiResponse(text, questions);
    expect(results.get("q1")?.confidence).toBeCloseTo(0.95, 10);
    expect(results.get("q2")?.confidence).toBe(0.5);
    expect(results.get("q3")?.confidence).toBe(0);
  });

  it("支持 answers 为按 id 索引的对象", () => {
    const text = JSON.stringify({
      answers: {
        q1: { answer: ["D"], confidence: 0.8 },
        q2: { answer: ["A", "B"], confidence: 0.7 },
      },
    });
    const results = parseAiResponse(text, questions);
    expect(results.get("q1")?.answer).toMatchObject({ kind: "choice", keys: ["D"] });
    expect(results.get("q2")?.answer).toMatchObject({ kind: "choice", keys: ["A", "B"] });
  });

  it("单题返回裸 answer 对象也能解析", () => {
    const text = JSON.stringify({ answer: ["A"], confidence: 0.9 });
    const results = parseAiResponse(text, [questions[0]]);
    expect(results.get("q1")?.answer).toMatchObject({ kind: "choice", keys: ["A"] });
  });

  it("判断题接受字符串", () => {
    const text = JSON.stringify({ answers: [{ id: "q3", answer: "错误", confidence: 0.6 }] });
    expect(parseAiResponse(text, questions).get("q3")?.answer).toEqual({
      kind: "judge",
      value: false,
    });
  });

  it("无法解析时返回空 Map", () => {
    expect(parseAiResponse("模型没有按要求输出", questions).size).toBe(0);
    expect(parseAiResponse("", questions).size).toBe(0);
    expect(parseAiResponse("{}", questions).size).toBe(0);
  });
});
