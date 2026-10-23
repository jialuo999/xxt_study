import { afterEach, describe, expect, it, vi } from "vitest";
import { chaoxingAdapter } from "../../src/platform/chaoxing/index";
import { findSubmitButton, resetSubmitGuard } from "../../src/platform/chaoxing/submit";
import { CHAPTER_URL, HOMEWORK_URL, makeContext } from "./helpers";
import nextHtml from "../fixtures/chaoxing/next.html?raw";
import submitHtml from "../fixtures/chaoxing/submit.html?raw";

afterEach(() => {
  resetSubmitGuard(document);
  try {
    window.history.replaceState({}, "", "/");
  } catch {
    /* ignore */
  }
});

function listenClick(handler: (event: MouseEvent) => void): void {
  const button = document.querySelector<HTMLElement>("#tempsave");
  if (!button) throw new Error("fixture 缺少提交按钮");
  button.addEventListener("click", handler as EventListener);
}

describe("提交按钮探测", () => {
  it("优先命中 .Btn_blue_1 / #tempsave 选择器", () => {
    makeContext(submitHtml, HOMEWORK_URL);
    const button = findSubmitButton(document);
    expect(button?.id).toBe("tempsave");
  });

  it("选择器失效时按文本“提交答案”兜底", () => {
    makeContext('<div class="bar"><a href="#go">提交答案</a></div>', HOMEWORK_URL);
    const button = findSubmitButton(document);
    expect(button?.textContent?.trim()).toBe("提交答案");
  });

  it("没有提交按钮时返回 null", () => {
    makeContext("<div>空白页面</div>", HOMEWORK_URL);
    expect(findSubmitButton(document)).toBeNull();
  });
});

describe("submitAnswers", () => {
  it("点击后检测到“提交成功”文本", async () => {
    const ctx = makeContext(submitHtml, HOMEWORK_URL);
    listenClick((event) => {
      event.preventDefault();
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div class="result">提交成功，成绩：90分</div>',
      );
    });

    const result = await chaoxingAdapter.submit!(ctx, {});
    expect(result.ok).toBe(true);
    expect(result.message).toContain("提交成功");
    expect(result.score).toBe("90");
  });

  it("点击后跳转到结果页时判成功", async () => {
    const ctx = makeContext(submitHtml, HOMEWORK_URL);
    listenClick((event) => {
      event.preventDefault();
      window.history.pushState({}, "", "/mooc-ans/work/result");
    });

    const result = await chaoxingAdapter.submit!(ctx, {});
    expect(result.ok).toBe(true);
    expect(result.message).toContain("跳转");
    expect(result.message).toContain("结果页");
    expect(result.url).toContain("/mooc-ans/work/result");
  });

  it("跳转到登录页时不判成功", async () => {
    const ctx = makeContext(submitHtml, HOMEWORK_URL);
    listenClick((event) => {
      event.preventDefault();
      window.history.pushState({}, "", "/passport/login?refer=work");
    });

    const result = await chaoxingAdapter.submit!(ctx, {});
    expect(result.ok).toBe(false);
    expect(result.message).toContain("请人工确认");
    expect(result.url).toContain("/passport/login");
  });

  it("URL 变化但未命中结果页特征时超时判未知", async () => {
    vi.useFakeTimers();
    try {
      const ctx = makeContext(submitHtml, HOMEWORK_URL);
      listenClick((event) => {
        event.preventDefault();
        window.history.pushState({}, "", "/mooc-ans/work/doHomeWorkNew?step=2");
      });

      const pending = chaoxingAdapter.submit!(ctx, {});
      await vi.advanceTimersByTimeAsync(16_000);
      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.message).toContain("页面已跳转");
      expect(result.message).toContain("请人工确认");
    } finally {
      vi.useRealTimers();
    }
  });

  it("15 秒内无任何变化时保持原有超时语义", async () => {
    vi.useFakeTimers();
    try {
      const ctx = makeContext(submitHtml, HOMEWORK_URL);
      listenClick((event) => event.preventDefault());

      const pending = chaoxingAdapter.submit!(ctx, {});
      await vi.advanceTimersByTimeAsync(16_000);
      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.message).toContain("15 秒");
      expect(result.message).toContain("请人工确认");
    } finally {
      vi.useRealTimers();
    }
  });

  it("autoConfirm 只在点击期间返回 true 并恢复 confirm", async () => {
    const ctx = makeContext(submitHtml, HOMEWORK_URL);
    const originalConfirm = window.confirm;
    const spy = vi.fn(() => false);
    window.confirm = spy;
    let confirmed: boolean | null = null;
    listenClick((event) => {
      event.preventDefault();
      confirmed = window.confirm("确定提交作业吗？");
      document.body.insertAdjacentHTML("beforeend", '<div class="result">提交成功</div>');
    });

    try {
      const result = await chaoxingAdapter.submit!(ctx, { autoConfirm: true });
      expect(result.ok).toBe(true);
      expect(confirmed).toBe(true);
      expect(window.confirm).toBe(spy);
    } finally {
      window.confirm = originalConfirm;
    }
  });

  it("未找到提交按钮时返回 ok:false，不抛异常", async () => {
    const ctx = makeContext("<div>没有按钮</div>", HOMEWORK_URL);
    const result = await chaoxingAdapter.submit!(ctx, {});
    expect(result.ok).toBe(false);
    expect(result.message).toContain("提交按钮");
  });

  it("同一页面不会重复提交", async () => {
    const ctx = makeContext(submitHtml, HOMEWORK_URL);
    let clicks = 0;
    listenClick((event) => {
      event.preventDefault();
      clicks += 1;
      document.body.insertAdjacentHTML("beforeend", '<div class="result">提交成功</div>');
    });

    const first = await chaoxingAdapter.submit!(ctx, {});
    const second = await chaoxingAdapter.submit!(ctx, {});
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.message).toContain("重复提交");
    expect(clicks).toBe(1);
  });
});

describe("nextPage", () => {
  it("优先点击 #prevNextFocusNext", async () => {
    const ctx = makeContext(nextHtml, CHAPTER_URL);
    const result = await chaoxingAdapter.nextPage!(ctx);
    expect(result.ok).toBe(true);
    expect(result.action).toContain("#prevNextFocusNext");
    expect(result.url).toBeTruthy();
  });

  it("选择器失效时按文本“下一章”兜底", async () => {
    const ctx = makeContext('<div class="nav"><a href="#a">下一章</a></div>', CHAPTER_URL);
    const result = await chaoxingAdapter.nextPage!(ctx);
    expect(result.ok).toBe(true);
    expect(result.action).toContain("text:下一章");
  });

  it("重复尝试会跳过已点击且未产生变化的候选", async () => {
    const ctx = makeContext(nextHtml, CHAPTER_URL);
    const first = await chaoxingAdapter.nextPage!(ctx);
    expect(first.ok).toBe(true);
    expect(first.action).toContain("#prevNextFocusNext");

    const second = await chaoxingAdapter.nextPage!(ctx);
    expect(second.ok).toBe(true);
    expect(second.action).toContain(".nextChapter");
  });

  it("没有下一节时返回 ok:false", async () => {
    const ctx = makeContext("<div>没有导航</div>", CHAPTER_URL);
    const result = await chaoxingAdapter.nextPage!(ctx);
    expect(result.ok).toBe(false);
    expect(result.action).toBe("none");
    expect(result.message).toContain("未找到");
  });
});
