import { describe, expect, it } from "vitest";
import { collectFrom } from "./helpers";
import dedupeHtml from "../fixtures/chaoxing/dedupe.html?raw";
import judgeHtml from "../fixtures/chaoxing/judge.html?raw";
import mixedHtml from "../fixtures/chaoxing/mixed.html?raw";
import textOptionsHtml from "../fixtures/chaoxing/text-options.html?raw";

describe("chaoxingAdapter.collectQuestions", () => {
  it("识别混合页面的全部题型", () => {
    const questions = collectFrom(mixedHtml);
    expect(questions).toHaveLength(6);
    expect(questions.map((question) => question.type)).toEqual([
      "single",
      "multiple",
      "judge",
      "fill",
      "short",
      "single",
    ]);
  });

  it("题干去掉序号与题型标签", () => {
    const questions = collectFrom(mixedHtml);
    expect(questions[0].stem).toBe("以下哪个是编程语言？");
    expect(questions[3].stem).toContain("HTML 的中文全称是____");
    expect(questions[0].stem).not.toContain("【单选题】");
    expect(questions[0].stem).not.toMatch(/^\d+、/);
  });

  it("采集选项字母与文本", () => {
    const questions = collectFrom(mixedHtml);
    expect(questions[0].options.map((option) => option.key)).toEqual(["A", "B", "C", "D"]);
    expect(questions[0].options.map((option) => option.text)).toEqual([
      "HTML",
      "TypeScript",
      "CSS",
      "JSON",
    ]);
    expect(questions[1].options).toHaveLength(4);
  });

  it("题型默认判定：radio=单选、checkbox=多选", () => {
    const questions = collectFrom(mixedHtml);
    expect(questions[0].type).toBe("single");
    expect(questions[1].type).toBe("multiple");
    expect(questions[5].type).toBe("single");
  });

  it("判断题保留对/错同义选项文本", () => {
    const synonyms = collectFrom(judgeHtml);
    expect(synonyms).toHaveLength(1);
    expect(synonyms[0].type).toBe("judge");
    expect(synonyms[0].options.map((option) => option.text)).toEqual(["×", "√"]);
  });

  it("填空题统计空数并保留 ____ 标记", () => {
    const questions = collectFrom(mixedHtml);
    const fill = questions[3];
    expect(fill.type).toBe("fill");
    expect(fill.blankCount).toBe(2);
    expect(fill.options).toHaveLength(0);
  });

  it("简答题类型不统计空数", () => {
    const questions = collectFrom(mixedHtml);
    expect(questions[4].type).toBe("short");
    expect(questions[4].blankCount).toBeUndefined();
  });

  it("hasImage 标记图片题", () => {
    const questions = collectFrom(mixedHtml);
    expect(questions[5].hasImage).toBe(true);
    expect(questions[0].hasImage).toBe(false);
  });

  it("无原生 input 的文本型选项也能采集", () => {
    const questions = collectFrom(textOptionsHtml);
    expect(questions).toHaveLength(1);
    expect(questions[0].type).toBe("multiple");
    expect(questions[0].options.map((option) => option.key)).toEqual(["A", "B", "C"]);
    expect(questions[0].options.map((option) => option.text)).toEqual(["苹果", "白菜", "香蕉"]);
  });

  it("按题干与选项签名去重并过滤空题干", () => {
    const questions = collectFrom(dedupeHtml);
    expect(questions).toHaveLength(1);
    expect(questions[0].stem).toBe("重复的题目内容是什么？");
  });

  it("id 稳定：frameId-index-8位哈希，index 连续", () => {
    const questions = collectFrom(mixedHtml);
    questions.forEach((question, index) => {
      expect(question.frameId).toBe("top");
      expect(question.index).toBe(index);
      expect(question.id).toMatch(/^top-\d+-[0-9a-f]{8}$/);
      expect(question.id.startsWith(`top-${index}-`)).toBe(true);
    });
  });

  it("同一页面重复采集得到相同 id", () => {
    const first = collectFrom(mixedHtml);
    const second = collectFrom(mixedHtml);
    expect(second.map((question) => question.id)).toEqual(first.map((question) => question.id));
  });
});
