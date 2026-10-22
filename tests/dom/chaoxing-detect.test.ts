import { describe, expect, it } from "vitest";
import { chaoxingAdapter } from "../../src/platform/chaoxing/index";
import {
  CARDS_URL,
  CHAPTER_URL,
  EXAM_URL,
  HOMEWORK_URL,
  UNKNOWN_URL,
  VIDEO_URL,
  makeContext,
} from "./helpers";
import cardsHtml from "../fixtures/chaoxing/page-cards.html?raw";
import chapterHtml from "../fixtures/chaoxing/page-chapter.html?raw";
import examHtml from "../fixtures/chaoxing/page-exam.html?raw";
import homeworkHtml from "../fixtures/chaoxing/page-homework.html?raw";
import quizHtml from "../fixtures/chaoxing/page-quiz.html?raw";
import singleHtml from "../fixtures/chaoxing/single.html?raw";
import videoHtml from "../fixtures/chaoxing/page-video.html?raw";

describe("chaoxingAdapter.matches", () => {
  it("只认学习通域名", () => {
    expect(chaoxingAdapter.matches(new URL("https://mooc1.chaoxing.com/mycourse/studentstudy"))).toBe(true);
    expect(chaoxingAdapter.matches(new URL("https://chaoxing.com/"))).toBe(true);
    expect(chaoxingAdapter.matches(new URL(UNKNOWN_URL))).toBe(false);
    expect(chaoxingAdapter.matches(new URL("https://example.com/chaoxing.com.evil.io"))).toBe(false);
  });
});

describe("chaoxingAdapter.detectPage 路由识别", () => {
  it("章节页 /mycourse/studentstudy", () => {
    const { page } = makeContext(chapterHtml, CHAPTER_URL);
    expect(page.kind).toBe("chapter");
    expect(page.supported).toBe(true);
    expect(page.reason).toBeTruthy();
  });

  it("知识卡片 /knowledge/cards", () => {
    const { page } = makeContext(cardsHtml, CARDS_URL);
    expect(page.kind).toBe("cards");
    expect(page.supported).toBe(true);
  });

  it("视频页 /ananas/modules/video/", () => {
    const { page } = makeContext(videoHtml, VIDEO_URL);
    expect(page.kind).toBe("video");
    expect(page.supported).toBe(true);
  });

  it("作业页 /work/doHomeWorkNew", () => {
    const { page } = makeContext(homeworkHtml, HOMEWORK_URL);
    expect(page.kind).toBe("homework");
    expect(page.supported).toBe(true);
  });

  it("考试页 reVersionTestStartNew", () => {
    const { page } = makeContext(examHtml, EXAM_URL);
    expect(page.kind).toBe("exam");
    expect(page.supported).toBe(true);
  });

  it("章节测验：作业路由 + 标题“章节测验”", () => {
    const { page } = makeContext(quizHtml, HOMEWORK_URL, "章节测验");
    expect(page.kind).toBe("quiz");
    expect(page.supported).toBe(true);
  });

  it("未知页面标记为 unsupported", () => {
    const { page } = makeContext("<div>普通网页</div>", UNKNOWN_URL);
    expect(page.kind).toBe("unknown");
    expect(page.supported).toBe(false);
    expect(page.reason).toBeTruthy();
  });

  it("无路由命中但有题目容器时按作业处理", () => {
    const { page } = makeContext(singleHtml, UNKNOWN_URL);
    expect(page.kind).toBe("homework");
    expect(page.supported).toBe(true);
  });

  it("返回 URL 与标题", () => {
    const { page } = makeContext(chapterHtml, CHAPTER_URL, "章节学习");
    expect(page.url).toBe(CHAPTER_URL);
    expect(page.title).toBe("章节学习");
  });
});
