import { afterEach, describe, expect, it, vi } from "vitest";
import { chaoxingAdapter } from "../../src/platform/chaoxing/index";
import { resetSubmitGuard } from "../../src/platform/chaoxing/submit";
import { waitForVideoEnd } from "../../src/platform/chaoxing/video";
import { CHAPTER_URL, EXAM_URL, HOMEWORK_URL, makeContext } from "./helpers";
import homeworkHtml from "../fixtures/chaoxing/page-homework.html?raw";
import examHtml from "../fixtures/chaoxing/page-exam.html?raw";
import submitHtml from "../fixtures/chaoxing/submit.html?raw";
import textOptionsHtml from "../fixtures/chaoxing/text-options.html?raw";
import videoHtml from "../fixtures/chaoxing/page-video.html?raw";

afterEach(() => {
  vi.useRealTimers();
  resetSubmitGuard(document);
  try {
    window.history.replaceState({}, "", "/");
  } catch {
    /* ignore */
  }
});

describe("detectPage 其余路由变体", () => {
  it("/work/selectWorkQuestionYiPiYue 识别为作业", () => {
    const { page } = makeContext(
      homeworkHtml,
      "https://mooc1.chaoxing.com/work/selectWorkQuestionYiPiYue?courseId=1",
    );
    expect(page.kind).toBe("homework");
    expect(page.supported).toBe(true);
  });

  it("/mooc2/work/dowork 识别为作业", () => {
    const { page } = makeContext(
      homeworkHtml,
      "https://mooc1.chaoxing.com/mooc2/work/dowork?courseId=1",
    );
    expect(page.kind).toBe("homework");
  });

  it("reVersionPaperMarkContentNew 识别为考试", () => {
    const { page } = makeContext(
      examHtml,
      "https://mooc1.chaoxing.com/exam-ans/exam/test/reVersionPaperMarkContentNew?courseId=1",
    );
    expect(page.kind).toBe("exam");
  });

  it("未知路由下视频 DOM 兜底识别为视频", () => {
    const { page } = makeContext(videoHtml, "https://mooc1.chaoxing.com/some-other-page");
    expect(page.kind).toBe("video");
  });
});

describe("collectQuestions 无题型标签时的兜底判定", () => {
  it("radio=单选、checkbox=多选、textarea=填空、两个对错选项=判断", () => {
    document.body.innerHTML = [
      '<div class="TiMu"><div class="Zy_TItle clearfix"><div class="clearfix">无标签单选</div></div>',
      '<ul><li><label><input type="radio" name="u1" value="A"><span>A、甲</span></label></li>',
      '<li><label><input type="radio" name="u1" value="B"><span>B、乙</span></label></li></ul></div>',
      '<div class="TiMu"><div class="Zy_TItle clearfix"><div class="clearfix">无标签多选</div></div>',
      '<ul><li><label><input type="checkbox" name="u2" value="A"><span>A、甲</span></label></li>',
      '<li><label><input type="checkbox" name="u2" value="B"><span>B、乙</span></label></li></ul></div>',
      '<div class="TiMu"><div class="Zy_TItle clearfix"><div class="clearfix">无标签填空____</div></div>',
      '<textarea class="answerText"></textarea></div>',
      '<div class="TiMu"><div class="Zy_TItle clearfix"><div class="clearfix">无标签判断</div></div>',
      '<ul><li><label><input type="radio" name="u4" value="true"><span>对</span></label></li>',
      '<li><label><input type="radio" name="u4" value="false"><span>错</span></label></li></ul></div>',
    ].join("");
    document.title = "";
    const ctx = {
      doc: document,
      win: window,
      url: new URL(CHAPTER_URL),
      page: chaoxingAdapter.detectPage(document, new URL(CHAPTER_URL)),
      frameId: "top" as const,
    };
    const questions = chaoxingAdapter.collectQuestions(ctx);
    expect(questions.map((question) => question.type)).toEqual([
      "single",
      "multiple",
      "fill",
      "judge",
    ]);
  });
});

describe("fillAnswer 无原生 input 的文本型选项", () => {
  it("仍可点击选项并返回 ok:true", async () => {
    const ctx = makeContext(textOptionsHtml);
    const questions = chaoxingAdapter.collectQuestions(ctx);
    const result = await chaoxingAdapter.fillAnswer(ctx, questions[0], {
      kind: "choice",
      keys: ["A", "C"],
    }, { delayMs: [0, 0] });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("无原生 input");
  });
});

describe("submit 超时路径", () => {
  it("15 秒内没有结果时返回 ok:false 并提示人工确认", async () => {
    vi.useFakeTimers();
    const ctx = makeContext(submitHtml, HOMEWORK_URL);
    const button = document.querySelector<HTMLElement>("#tempsave");
    button?.addEventListener("click", (event) => event.preventDefault());

    const promise = chaoxingAdapter.submit!(ctx, {});
    await vi.advanceTimersByTimeAsync(15_500);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.message).toContain("人工确认");
  });
});

describe("waitForVideoEnd 其余分支", () => {
  it("timeupdate 到达结尾时返回 ok:true", async () => {
    makeContext(videoHtml, CHAPTER_URL);
    const video = document.querySelector<HTMLVideoElement>("video");
    expect(video).not.toBeNull();
    if (!video) return;

    Object.defineProperty(video, "duration", { value: 10, configurable: true });
    Object.defineProperty(video, "currentTime", { value: 0, configurable: true });

    const promise = waitForVideoEnd(document, 0);
    Object.defineProperty(video, "currentTime", { value: 9.5, configurable: true });
    video.dispatchEvent(new Event("timeupdate"));

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.reason).toContain("timeupdate");
  });

  it("超时未结束返回 ok:false", async () => {
    vi.useFakeTimers();
    makeContext(videoHtml, CHAPTER_URL);
    const promise = waitForVideoEnd(document, 5000);
    await vi.advanceTimersByTimeAsync(5200);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("超时");
  });
});

describe("nextPage span.currents ~ span 兜底", () => {
  it("命中章节导航的相邻 span", async () => {
    const ctx = makeContext(
      '<div class="chapter"><span class="currents">1.1 第一节</span><span>1.2 第二节</span></div>',
      CHAPTER_URL,
    );
    const result = await chaoxingAdapter.nextPage!(ctx);
    expect(result.ok).toBe(true);
    expect(result.action).toContain("span.currents ~ span");
  });
});
