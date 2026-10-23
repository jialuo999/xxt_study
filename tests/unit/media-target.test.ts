import { describe, expect, it } from "vitest";
import type { MediaState } from "../../src/core/types";
import {
  chapterIdFromUrl,
  findChildForTask,
  selectMediaPlaybackTarget,
  summarizeChildMediaState,
  taskUrlKey,
  type ChildMediaEntry,
} from "../../src/app/media-target";

function state(patch: Partial<MediaState> = {}): MediaState {
  return {
    hasMedia: true,
    allEnded: false,
    anyPaused: false,
    ...patch,
  };
}

function child(frameId: string, url: string, lastSeen = 1) {
  return { frameId, url, lastSeen };
}

function mediaEntry(entryState: MediaState, at = 1000): ChildMediaEntry {
  return { state: entryState, at };
}

describe("media-target", () => {
  it("taskUrlKey 只保留任务点相关参数，忽略缓存参数", () => {
    expect(
      taskUrlKey(
        "https://mooc1-1.chaoxing.com/ananas/modules/video/index.html?jobid=job-1&_dc=123&knowledgeId=k-1",
      ),
    ).toBe(
      "https://mooc1-1.chaoxing.com/ananas/modules/video/index.html?jobid=job-1&knowledgeId=k-1",
    );
    expect(taskUrlKey("not-a-url")).toBe("not-a-url");
  });

  it("chapterIdFromUrl 兼容 knowledgeid / chapterId 两种写法", () => {
    expect(chapterIdFromUrl("https://x/y?knowledgeid=k1")).toBe("k1");
    expect(chapterIdFromUrl("https://x/y?chapterId=c1")).toBe("c1");
    expect(chapterIdFromUrl("https://x/y")).toBe("");
  });

  it("findChildForTask 先按完整 key 匹配，再按 jobid 兜底", () => {
    const children = [
      child("a", "https://x/video?jobid=job-1&knowledgeId=k-1"),
      child("b", "https://x/video?jobid=job-2"),
    ];
    expect(findChildForTask(children, "https://x/video?jobid=job-1&knowledgeId=k-1&_dc=9")?.frameId).toBe(
      "a",
    );
    expect(findChildForTask(children, "https://other/video?jobid=job-2")?.frameId).toBe("b");
    expect(findChildForTask(children, "https://x/video?jobid=missing")).toBeNull();
  });

  it("selectMediaPlaybackTarget 忽略其他章节的 allTasksFinished", () => {
    const children = [child("a", "https://x/content?knowledgeId=k-1")];
    const childMedia = new Map([
      [
        "a",
        mediaEntry(
          state({ allTasksFinished: true, taskTotal: 2, chapterId: "old-chapter" }),
          1000,
        ),
      ],
    ]);
    const target = selectMediaPlaybackTarget({
      children,
      childMedia,
      chapterId: "k-1",
      now: 2000,
    });
    // 旧章节的“全部完成”不能用于新章节；又没有该章节的媒体状态 → 无目标
    expect(target).toBeNull();
  });

  it("selectMediaPlaybackTarget 在当前章节内按任务点顺序返回目标 frame", () => {
    const children = [
      child("a", "https://x/content?knowledgeId=k-1"),
      child("b", "https://x/video?jobid=job-2&knowledgeId=k-1"),
    ];
    const childMedia = new Map([
      [
        "a",
        mediaEntry(state({ taskTotal: 2, nextTaskUrl: children[1].url, nextTaskIndex: 1 })),
      ],
      ["b", mediaEntry(state({ hasMedia: true }))],
    ]);
    const target = selectMediaPlaybackTarget({
      children,
      childMedia,
      chapterId: "k-1",
      now: 2000,
    });
    expect(target?.source).toBe("tasks");
    expect(target?.frameId).toBe("b");
    expect(target?.taskIndex).toBe(1);
    expect(target?.taskTotal).toBe(2);
  });

  it("任务点信息不足时按 children 顺序兜底，而不是按状态上报顺序", () => {
    const children = [
      child("b", "https://x/video?jobid=job-2&knowledgeId=k-1"),
      child("a", "https://x/video?jobid=job-1&knowledgeId=k-1"),
    ];
    // 先上报 a、后上报 b；兜底仍应按 children（页面连接）顺序选 b
    const childMedia = new Map([
      ["a", mediaEntry(state({ hasMedia: true }), 2000)],
      ["b", mediaEntry(state({ hasMedia: true }), 1000)],
    ]);
    const target = selectMediaPlaybackTarget({
      children,
      childMedia,
      chapterId: "k-1",
      now: 2500,
    });
    expect(target?.source).toBe("frames");
    expect(target?.frameId).toBe("b");
  });

  it("summarizeChildMediaState 只汇总当前章节的媒体，旧章节的 allEnded 不生效", () => {
    const children = [
      child("a", "https://x/content?knowledgeId=current"),
      child("b", "https://x/content?knowledgeId=old"),
    ];
    const childMedia = new Map([
      ["a", mediaEntry(state({ allEnded: false, anyPaused: true }), 2000)],
      ["b", mediaEntry(state({ allEnded: true, anyPaused: false }), 2000)],
    ]);
    const summary = summarizeChildMediaState({
      children,
      childMedia,
      chapterId: "current",
      now: 2500,
    });
    expect(summary).not.toBeNull();
    expect(summary?.allEnded).toBe(false);
    expect(summary?.anyPaused).toBe(true);
    // 只有 a 参与统计，b（旧章节）既不贡献 allEnded 也不贡献 anyPaused
  });

  it("summarizeChildMediaState 只有整章任务点完成才报告 allTasksFinished", () => {
    const children = [
      child("a", "https://x/content?knowledgeId=current"),
      child("b", "https://x/content?knowledgeId=old"),
    ];
    const childMedia = new Map([
      ["a", mediaEntry(state({ hasMedia: false, allTasksFinished: true, chapterId: "current" }), 2000)],
      ["b", mediaEntry(state({ hasMedia: false, allTasksFinished: true, chapterId: "old" }), 2000)],
    ]);
    const summary = summarizeChildMediaState({
      children,
      childMedia,
      chapterId: "current",
      now: 2500,
    });
    expect(summary?.allTasksFinished).toBe(true);
    expect(summary?.hasMedia).toBe(false);
  });
});
