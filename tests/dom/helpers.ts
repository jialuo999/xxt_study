import type { PageContext } from "../../src/platform/types";
import { chaoxingAdapter } from "../../src/platform/chaoxing/index";

export const CHAPTER_URL =
  "https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1&courseId=2&clazzid=3";
export const CARDS_URL = "https://mooc1.chaoxing.com/knowledge/cards?clazzid=1&courseid=2";
export const VIDEO_URL = "https://mooc1.chaoxing.com/ananas/modules/video/index.html?objectid=1";
export const HOMEWORK_URL =
  "https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=1&workId=2";
export const EXAM_URL =
  "https://mooc1.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew?courseId=1";
export const UNKNOWN_URL = "https://example.com/foo";

/** 用 fixture HTML 装配 PageContext（document.title 每次都会重置，避免测试间串味） */
export function makeContext(
  html: string,
  url: string = CHAPTER_URL,
  title = "",
): PageContext {
  document.body.innerHTML = html;
  document.title = title;
  const parsed = new URL(url);
  const page = chaoxingAdapter.detectPage(document, parsed);
  return { doc: document, win: window, url: parsed, page, frameId: "top" };
}

export function collectFrom(html: string, url: string = CHAPTER_URL) {
  const ctx = makeContext(html, url);
  return chaoxingAdapter.collectQuestions(ctx);
}
