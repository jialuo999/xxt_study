import { describe, expect, it } from "vitest";
import { chaoxingAdapter } from "../../src/platform/chaoxing/index";
import { waitForVideoEnd } from "../../src/platform/chaoxing/video";
import { sleep } from "../../src/utils/async";
import { CHAPTER_URL, VIDEO_URL, makeContext } from "./helpers";
import videoHtml from "../fixtures/chaoxing/page-video.html?raw";

describe("observe", () => {
  it("body 变化防抖后回调一次，disconnect 后停止", async () => {
    const ctx = makeContext('<div id="root"></div>', CHAPTER_URL);
    let calls = 0;
    const disconnect = chaoxingAdapter.observe!(ctx, () => {
      calls += 1;
    });

    document.body.insertAdjacentHTML("beforeend", '<div class="question">新题目</div>');
    await sleep(400);
    expect(calls).toBeGreaterThan(0);

    const afterFirst = calls;
    disconnect();
    document.body.insertAdjacentHTML("beforeend", '<div class="question">再来一题</div>');
    await sleep(400);
    expect(calls).toBe(afterFirst);
  });
});

describe("waitForVideoEnd", () => {
  it("视频 ended 事件后返回 ok:true", async () => {
    makeContext(videoHtml, VIDEO_URL);
    const video = document.querySelector<HTMLVideoElement>("video");
    expect(video).not.toBeNull();
    const resultPromise = waitForVideoEnd(document, 0);
    video?.dispatchEvent(new Event("ended"));
    const result = await resultPromise;
    expect(result.ok).toBe(true);
    expect(result.reason).toContain("ended");
  });

  it("没有视频元素时返回 ok:false", async () => {
    makeContext("<div>没有视频</div>", CHAPTER_URL);
    const result = await waitForVideoEnd(document, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("未找到视频");
  });
});
