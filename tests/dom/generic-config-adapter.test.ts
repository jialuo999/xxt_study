import { describe, expect, it } from "vitest";
import type { GenericAdapterConfig } from "../../src/core/settings";
import { createConfigAdapter } from "../../src/platform/generic/config-adapter";
import type { PageContext } from "../../src/platform/types";

const CONFIG: GenericAdapterConfig = {
  name: "示例作业",
  matches: ["example.com"],
  questionContainer: ".q",
  stem: ".stem",
  options: ".opt",
  optionText: ".opt-text",
  typeLabel: ".type",
  nextButton: ".next",
  submitButton: ".submit",
};

const HTML = `
  <div class="q">
    <div class="type">【单选题】</div>
    <div class="stem">1 + 1 = ?</div>
    <div class="opt"><input type="radio" name="gq" value="A"><span class="opt-text">A、1</span></div>
    <div class="opt"><input type="radio" name="gq" value="B"><span class="opt-text">B、2</span></div>
  </div>
  <a class="next" href="#next">下一节</a>
  <button class="submit">提交作业</button>
`;

function makeContext(url = "https://example.com/homework"): PageContext {
  document.body.innerHTML = HTML;
  document.title = "示例";
  const parsed = new URL(url);
  const adapter = createConfigAdapter(CONFIG);
  return {
    doc: document,
    win: window,
    url: parsed,
    page: adapter.detectPage(document, parsed),
    frameId: "top",
  };
}

describe("createConfigAdapter 最小可用配置适配器", () => {
  it("按 URL 规则匹配并推断页面类型", () => {
    const adapter = createConfigAdapter(CONFIG);
    const ctx = makeContext();
    expect(adapter.matches(ctx.url)).toBe(true);
    expect(ctx.page.supported).toBe(true);
    expect(ctx.page.kind).toBe("homework");
    expect(adapter.matches(new URL("https://other.com/x"))).toBe(false);
  });

  it("用配置的选择器采集题目与选项", () => {
    const adapter = createConfigAdapter(CONFIG);
    const ctx = makeContext();
    const questions = adapter.collectQuestions(ctx);
    expect(questions).toHaveLength(1);
    expect(questions[0].type).toBe("single");
    expect(questions[0].stem).toBe("1 + 1 = ?");
    expect(questions[0].options).toEqual([
      { key: "A", text: "1" },
      { key: "B", text: "2" },
    ]);
  });

  it("按 key 填答并回读，nextPage 命中配置按钮", async () => {
    const adapter = createConfigAdapter(CONFIG);
    const ctx = makeContext();
    const question = adapter.collectQuestions(ctx)[0];
    const fill = await adapter.fillAnswer(ctx, question, { kind: "choice", keys: ["B"] }, { delayMs: [0, 0] });
    expect(fill.ok).toBe(true);
    expect(document.querySelector<HTMLInputElement>("input[value='B']")?.checked).toBe(true);

    const next = await adapter.nextPage!(ctx);
    expect(next.ok).toBe(true);
    expect(next.action).toContain(".next");
  });
});
