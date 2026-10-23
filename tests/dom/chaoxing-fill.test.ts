import { describe, expect, it } from "vitest";
import { chaoxingAdapter } from "../../src/platform/chaoxing/index";
import { makeContext } from "./helpers";
import fillHtml from "../fixtures/chaoxing/fill.html?raw";
import judgeHtml from "../fixtures/chaoxing/judge.html?raw";
import mixedHtml from "../fixtures/chaoxing/mixed.html?raw";
import multipleHtml from "../fixtures/chaoxing/multiple.html?raw";
import shuffledHtml from "../fixtures/chaoxing/shuffled.html?raw";
import shortHtml from "../fixtures/chaoxing/short.html?raw";
import singleHtml from "../fixtures/chaoxing/single.html?raw";

const FAST: [number, number] = [0, 0];

function setup(html: string) {
  const ctx = makeContext(html);
  const questions = chaoxingAdapter.collectQuestions(ctx);
  return { ctx, questions };
}

function checkedValues(name: string): string[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`))
    .filter((input) => input.checked)
    .map((input) => input.value);
}

describe("fillAnswer 单选题", () => {
  it("按 key 勾选正确选项", async () => {
    const { ctx, questions } = setup(singleHtml);
    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "choice",
      keys: ["B"],
    }, { delayMs: FAST });
    expect(result.ok).toBe(true);
    expect(result.questionId).toBe(questions[0].id);
    expect(checkedValues("single-q1")).toEqual(["B"]);
  });

  it("选项乱序时仍按 key 映射，而不是按位置", async () => {
    const { ctx, questions } = setup(shuffledHtml);
    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "choice",
      keys: ["B"],
    }, { delayMs: FAST });
    expect(result.ok).toBe(true);
    expect(checkedValues("shuffled-q1")).toEqual(["B"]);
    expect(document.querySelector<HTMLInputElement>("input[value='B']")?.checked).toBe(true);
  });

  it("key 未命中时按 answer.texts 做文本兜底", async () => {
    const { ctx, questions } = setup(shuffledHtml);
    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "choice",
      keys: ["H"],
      texts: ["北京"],
    }, { delayMs: FAST });
    expect(result.ok).toBe(true);
    expect(checkedValues("shuffled-q1")).toEqual(["B"]);
  });

  it("完全匹配不到选项时返回 ok:false", async () => {
    const { ctx, questions } = setup(singleHtml);
    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "choice",
      keys: ["H"],
      texts: ["完全不存在的内容"],
    }, { delayMs: FAST });
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });

  it("dryRun 只返回计划，不点击页面", async () => {
    const { ctx, questions } = setup(singleHtml);
    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "choice",
      keys: ["A"],
    }, { delayMs: FAST, dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("dryRun");
    expect(checkedValues("single-q1")).toEqual([]);
  });
});

describe("fillAnswer 多选题", () => {
  it("勾选多个选项并取消多余勾选", async () => {
    const { ctx, questions } = setup(multipleHtml);
    const stale = document.querySelector<HTMLInputElement>("input[name='multiple-q1'][value='B']");
    stale?.click();
    expect(checkedValues("multiple-q1")).toEqual(["B"]);

    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "choice",
      keys: ["A", "C"],
    }, { delayMs: FAST });
    expect(result.ok).toBe(true);
    expect(checkedValues("multiple-q1").sort()).toEqual(["A", "C"]);
  });
});

describe("fillAnswer 判断题", () => {
  it("判断题同义词：正确 → 点击 √", async () => {
    const { ctx, questions } = setup(judgeHtml);
    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "judge",
      value: true,
    }, { delayMs: FAST });
    expect(result.ok).toBe(true);
    expect(checkedValues("judge-q1")).toEqual(["true"]);
  });

  it("判断题同义词：错误 → 点击 ×", async () => {
    const { ctx, questions } = setup(judgeHtml);
    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "judge",
      value: false,
    }, { delayMs: FAST });
    expect(result.ok).toBe(true);
    expect(checkedValues("judge-q1")).toEqual(["false"]);
  });

  it("混合页里的“正确/错误”判断题", async () => {
    const { ctx, questions } = setup(mixedHtml);
    const judge = questions[2];
    const result = await chaoxingAdapter.fillAnswer(ctx, judge, {
      kind: "judge",
      value: true,
    }, { delayMs: FAST });
    expect(result.ok).toBe(true);
    expect(questions[2].type).toBe("judge");
    expect(checkedValues("mix-q3")).toEqual(["true"]);
  });
});

describe("fillAnswer 填空题", () => {
  it("多空填空按顺序写入", async () => {
    const { ctx, questions } = setup(fillHtml);
    const inputs = document.querySelectorAll<HTMLInputElement>("input.inp");
    expect(questions[0].blankCount).toBe(2);

    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "fill",
      values: ["北京", "上海"],
    }, { delayMs: FAST });
    expect(result.ok).toBe(true);
    expect(inputs[0].value).toBe("北京");
    expect(inputs[1].value).toBe("上海");
  });

  it("答案数量少于空数时判失败，但仍填入能对应的空", async () => {
    const { ctx, questions } = setup(fillHtml);
    const inputs = document.querySelectorAll<HTMLInputElement>("input.inp");
    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "fill",
      values: ["北京"],
    }, { delayMs: FAST });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("答案 1 空");
    expect(result.message).toContain("页面 2 空");
    expect(inputs[0].value).toBe("北京");
    expect(inputs[1].value).toBe("");
  });

  it("答案数量多于空数时判失败并忽略多余答案", async () => {
    const { ctx, questions } = setup(fillHtml);
    const inputs = document.querySelectorAll<HTMLInputElement>("input.inp");
    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "fill",
      values: ["北京", "上海", "广州"],
    }, { delayMs: FAST });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("答案 3 空");
    expect(result.message).toContain("页面 2 空");
    expect(inputs[0].value).toBe("北京");
    expect(inputs[1].value).toBe("上海");
  });

  it("kind:text 的填空题按 | 拆分", async () => {
    const { ctx, questions } = setup(fillHtml);
    const inputs = document.querySelectorAll<HTMLInputElement>("input.inp");
    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "text",
      text: "北京 | 上海",
    }, { delayMs: FAST });
    expect(result.ok).toBe(true);
    expect(inputs[0].value).toBe("北京");
    expect(inputs[1].value).toBe("上海");
  });
});

describe("fillAnswer 简答题", () => {
  it("写入 textarea 并回读", async () => {
    const { ctx, questions } = setup(shortHtml);
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "text",
      text: "吸收光能，把二氧化碳和水合成有机物。",
    }, { delayMs: FAST });
    expect(result.ok).toBe(true);
    expect(textarea?.value).toBe("吸收光能，把二氧化碳和水合成有机物。");
  });

  it("找不到输入框时返回 ok:false 且不抛异常", async () => {
    const { ctx, questions } = setup(
      '<div class="TiMu"><div class="mark_name">【简答题】</div>' +
        '<div class="Zy_TItle clearfix"><div class="clearfix">没有输入框的简答题</div></div></div>',
    );
    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "text",
      text: "答案",
    }, { delayMs: FAST });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("简答");
  });
});
