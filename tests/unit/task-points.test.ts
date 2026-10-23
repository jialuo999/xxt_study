import { describe, expect, it } from "vitest";
import { collectTaskPointState } from "../../src/app/task-points";

function taskItem(options: { finished: boolean; video?: string }): HTMLElement {
  const item = document.createElement("div");
  item.className = options.finished ? "task ans-job-finished" : "task";
  const icon = document.createElement("i");
  icon.className = "ans-job-icon";
  item.appendChild(icon);
  if (options.video) {
    const iframe = document.createElement("iframe");
    iframe.src = options.video;
    item.appendChild(iframe);
  }
  document.body.appendChild(item);
  return item;
}

describe("collectTaskPointState", () => {
  it("按 DOM 顺序选择第一个未完成任务点的 iframe", () => {
    document.body.innerHTML = "";
    taskItem({ finished: true, video: "/video-1" });
    taskItem({ finished: false, video: "/video-2" });
    taskItem({ finished: false, video: "/video-3" });

    const state = collectTaskPointState(document);
    expect(state.taskTotal).toBe(3);
    expect(state.allTasksFinished).toBe(false);
    expect(state.nextTaskIndex).toBe(1);
    expect(state.nextTaskUrl).toContain("/video-2");
  });

  it("全部任务点完成时没有待播放目标", () => {
    document.body.innerHTML = "";
    taskItem({ finished: true, video: "/video-1" });
    taskItem({ finished: true, video: "/video-2" });

    const state = collectTaskPointState(document);
    expect(state.taskTotal).toBe(2);
    expect(state.allTasksFinished).toBe(true);
    expect(state.nextTaskUrl).toBeUndefined();
  });

  it("跳过没有 iframe 的任务点，继续找可播放任务", () => {
    document.body.innerHTML = "";
    taskItem({ finished: false });
    taskItem({ finished: false, video: "/video-2" });

    const state = collectTaskPointState(document);
    expect(state.nextTaskIndex).toBe(1);
    expect(state.nextTaskUrl).toContain("/video-2");
  });

  it("兼容完成标记在 icon 自身或任务项内部的结构", () => {
    document.body.innerHTML = `
      <div class="task">
        <i class="ans-job-icon ans-job-finished"></i>
        <iframe src="/video-1"></iframe>
      </div>
      <div class="task">
        <i class="ans-job-icon"></i>
        <span class="ans-job-finished"></span>
        <iframe src="/video-2"></iframe>
      </div>
    `;
    const state = collectTaskPointState(document);
    expect(state.tasks).toEqual([
      { index: 0, finished: true, url: expect.stringContaining("/video-1") },
      { index: 1, finished: true, url: expect.stringContaining("/video-2") },
    ]);
    expect(state.allTasksFinished).toBe(true);
    expect(state.nextTaskUrl).toBeUndefined();
  });

  it("返回全部任务点快照，供 Host 跳过已完成任务", () => {
    document.body.innerHTML = "";
    taskItem({ finished: true, video: "/video-1" });
    taskItem({ finished: false, video: "/video-2" });

    const state = collectTaskPointState(document);
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks?.[0].finished).toBe(true);
    expect(state.tasks?.[1].finished).toBe(false);
    expect(state.tasks?.[1].url).toContain("/video-2");
  });

  it("没有任务点标记时返回空状态", () => {
    document.body.innerHTML = "";
    const state = collectTaskPointState(document);
    expect(state.taskTotal).toBeUndefined();
    expect(state.allTasksFinished).toBe(false);
    expect(state.nextTaskUrl).toBeUndefined();
  });
});
