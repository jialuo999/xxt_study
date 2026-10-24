import { afterEach, describe, expect, it } from "vitest";
import { collectTaskPointState } from "../../src/app/task-points";

function attachment(options: {
  jobid?: string;
  mid?: string;
  module: string;
  name: string;
  job?: boolean;
  isPassed?: boolean;
}) {
  return {
    ...(options.jobid ? { jobid: options.jobid } : {}),
    ...(options.job !== undefined ? { job: options.job } : {}),
    ...(options.isPassed !== undefined ? { isPassed: options.isPassed } : {}),
    mid: options.mid,
    property: {
      module: options.module,
      name: options.name,
      ...(options.jobid ? { jobid: options.jobid, _jobid: options.jobid } : {}),
      ...(options.mid ? { mid: options.mid } : {}),
    },
  };
}

function attachItem(options: {
  classes?: string;
  icon?: boolean;
  data?: Record<string, unknown>;
  src?: string;
}): HTMLElement {
  const item = document.createElement("div");
  item.className = `ans-attach-ct ${options.classes ?? ""}`.trim();
  if (options.icon) {
    const icon = document.createElement("div");
    icon.className = "ans-job-icon ans-job-video";
    item.appendChild(icon);
  }
  const iframe = document.createElement("iframe");
  iframe.src =
    options.src ?? "https://mooc1.chaoxing.com/ananas/modules/video/index.html";
  if (options.data) iframe.setAttribute("data", JSON.stringify(options.data));
  item.appendChild(iframe);
  document.body.appendChild(item);
  return item;
}

afterEach(() => {
  delete (window as unknown as { mArg?: unknown }).mArg;
  delete (window as unknown as { attachments?: unknown }).attachments;
});

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

  it("优先用 attachments 判断完成状态，非任务点 PDF 不计入任务点", () => {
    document.body.innerHTML = "";
    (window as unknown as { mArg?: unknown }).mArg = {
      attachments: [
        attachment({ jobid: "job-1", mid: "mid-1", module: "insertvideo", name: "视频一", job: true, isPassed: false }),
        attachment({ jobid: "job-2", mid: "mid-2", module: "insertvideo", name: "视频二", isPassed: true }),
        attachment({ mid: "mid-doc", module: "insertdoc", name: "讲义.pdf" }),
      ],
    };
    attachItem({ icon: true, data: { jobid: "job-1", _jobid: "job-1", mid: "mid-1", name: "视频一" } });
    // 故意不在 DOM 上写 ans-job-finished：以 attachments.isPassed 为准
    attachItem({ icon: true, data: { jobid: "job-2", _jobid: "job-2", mid: "mid-2", name: "视频二" } });
    attachItem({ data: { _jobid: "doc-1", mid: "mid-doc", name: "讲义.pdf" } });

    const state = collectTaskPointState(document);
    expect(state.taskTotal).toBe(2);
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks?.[1].finished).toBe(true);
    expect(state.nextTaskIndex).toBe(0);
    expect(state.nextTaskId).toBe("job-1");
    expect(state.nextTaskKind).toBe("media");
    expect(state.nextTaskName).toBe("视频一");
    expect(state.nextTaskUrl).toContain("/ananas/modules/video/index.html");
    expect(state.allTasksFinished).toBe(false);
  });

  it("阅读/文档任务即使没有 ans-job-icon 也会成为待完成任务", () => {
    document.body.innerHTML = "";
    (window as unknown as { mArg?: unknown }).mArg = {
      attachments: [
        attachment({ jobid: "doc-job", mid: "mid-doc", module: "insertdoc", name: "阅读材料.pdf", job: true }),
      ],
    };
    attachItem({
      src: "https://mooc1.chaoxing.com/ananas/modules/pdf/index.html?jobid=doc-job",
      data: { _jobid: "doc-job", jobid: "doc-job", mid: "mid-doc", name: "阅读材料.pdf" },
    });

    const state = collectTaskPointState(document);
    expect(state.taskTotal).toBe(1);
    expect(state.nextTaskIndex).toBe(0);
    expect(state.nextTaskId).toBe("doc-job");
    expect(state.nextTaskKind).toBe("doc");
    expect(state.nextTaskName).toBe("阅读材料.pdf");
    expect(state.nextTaskUrl).toContain("ananas/modules/pdf/index.html");
    expect(state.allTasksFinished).toBe(false);
  });

  it("阅读/文档任务完成后不再作为 nextTask", () => {
    document.body.innerHTML = "";
    (window as unknown as { mArg?: unknown }).mArg = {
      attachments: [
        attachment({ jobid: "doc-job", mid: "mid-doc", module: "insertdoc", name: "阅读材料.pdf", job: true }),
      ],
    };
    const item = attachItem({
      data: { _jobid: "doc-job", jobid: "doc-job", mid: "mid-doc", name: "阅读材料.pdf" },
    });
    item.classList.add("ans-job-finished");

    const state = collectTaskPointState(document);
    expect(state.taskTotal).toBe(1);
    expect(state.tasks?.[0].finished).toBe(true);
    expect(state.allTasksFinished).toBe(true);
    expect(state.nextTaskIndex).toBeUndefined();
  });
});
