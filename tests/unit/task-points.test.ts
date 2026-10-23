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

  it("没有任务点标记时返回空状态", () => {
    document.body.innerHTML = "";
    const state = collectTaskPointState(document);
    expect(state.taskTotal).toBeUndefined();
    expect(state.allTasksFinished).toBe(false);
    expect(state.nextTaskUrl).toBeUndefined();
  });
});
