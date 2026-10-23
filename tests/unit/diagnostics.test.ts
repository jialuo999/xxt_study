import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LogEntry } from "../../src/core/logger";
import type { MediaState, PageInfo, Question } from "../../src/core/types";
import {
  DIAGNOSTICS_MAX_LOGS,
  DIAGNOSTICS_MAX_SAMPLES,
  DIAGNOSTICS_MAX_STEM,
  buildDiagnostics,
  formatDiagnostics,
  redactSettings,
  sanitizeUrl,
  type DiagnosticsInput,
  type DiagnosticsReport,
} from "../../src/app/diagnostics";
import { makeQuestion, makeSettings } from "./fixtures";

const T0 = 1_700_000_000_000;
const SECRET_API_KEY = "sk-very-secret-key-1234567890";
const SECRET_HEADER = "Bearer abcdefghijklmnop";
const SECRET_URL_TOKEN = "topsecret";

function makePage(): PageInfo {
  return {
    kind: "chapter",
    url: "https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=123&clazzid=456&chapterId=9&share=deadbeef&token=leak#anchor",
    title: "章节学习",
    supported: true,
    reason: "URL 命中章节学习 /mycourse/studentstudy",
  };
}

function makeQuestions(): Question[] {
  const questions: Question[] = [];
  for (let index = 0; index < 12; index += 1) {
    questions.push(
      makeQuestion({
        id: `q${index}`,
        type: index % 2 === 0 ? "single" : "judge",
        stem:
          index === 0
            ? `${"这是一道非常长的题干，".repeat(8)}尾部不应出现的内容`
            : `题干 ${index}`,
        options: [
          { key: "A", text: "甲" },
          { key: "B", text: "乙" },
        ],
        hasImage: index === 1,
      }),
    );
  }
  return questions;
}

function makeLogs(count = 120): LogEntry[] {
  const entries: LogEntry[] = [];
  for (let index = 1; index <= count; index += 1) {
    entries.push({
      id: index,
      ts: T0 + index,
      level: "info",
      scope: "test",
      message: `普通日志 ${index}`,
    });
  }
  entries[count - 1] = {
    id: count,
    ts: T0 + count,
    level: "error",
    scope: "ai",
    message: `请求失败 apiKey: ${SECRET_API_KEY}`,
    data: { apiKey: SECRET_API_KEY, note: "sk-abcdefghijklmnopqrst" },
  };
  return entries;
}

function makeMedia(): MediaState {
  return {
    hasMedia: true,
    allEnded: false,
    anyPaused: true,
    currentTaskFinished: false,
    nextTaskUrl:
      "https://mooc1.chaoxing.com/ananas/modules/video/index.html?courseId=123&objectId=88&signed=leak",
  };
}

function makeInput(overrides: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  const settings = makeSettings((draft) => {
    draft.ai.apiKey = SECRET_API_KEY;
    draft.bank.remote.url = `https://bank.example.com/api/answers?token=${SECRET_URL_TOKEN}#frag`;
    draft.bank.remote.headers = {
      Authorization: SECRET_HEADER,
      "X-Api-Key": "secret-header-value",
    };
  });
  return {
    page: makePage(),
    frames: [
      {
        frameId: "frame-1",
        url: "https://mooc1.chaoxing.com/knowledge/cards?courseId=123&clazzid=456&jobid=77&secret=xyz",
        title: "知识卡片",
        pageKind: "cards",
        questionCount: 2,
        isTop: false,
      },
    ],
    questions: makeQuestions(),
    settings,
    logs: makeLogs(),
    media: makeMedia(),
    autoTurn: { running: true, steps: 3, maxSteps: 200, message: "等待视频结束", nextAt: 1234 },
    verification: { detected: false, message: "" },
    ...overrides,
  };
}

function mountFixture(): void {
  document.body.innerHTML = `
    <div class="TiMu" data-questionid="q1">
      <div class="Zy_TItle"><div class="clearfix">示例题干</div></div>
      <ul><li>A. 甲</li><li>B. 乙</li></ul>
    </div>
    <div class="TiMu" data-questionid="q2"><div class="Zy_TItle"><div class="clearfix">第二题</div></div></div>
    <a id="prevNextFocusNext">下一节</a>
    <button class="Btn_blue_1">提交</button>
    <video id="video_html5_api"></video>
    <iframe id="iframe" src="https://mooc1.chaoxing.com/knowledge/cards?courseId=1"></iframe>
    <div id="chapterList"></div>
    <div class="knowledge-card"></div>
  `;
}

function findSelector(report: DiagnosticsReport, selector: string) {
  return report.selectors.find((row) => row.selector === selector);
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  localStorage.clear();
});

describe("报告字段", () => {
  it("包含版本、时间、页面、状态等完整字段", () => {
    mountFixture();
    const report = buildDiagnostics(makeInput(), document, "9.9.9");

    expect(report.scriptVersion).toBe("9.9.9");
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
    expect(typeof report.userAgent).toBe("string");
    expect(report.page).toMatchObject({
      kind: "chapter",
      supported: true,
      reason: "URL 命中章节学习 /mycourse/studentstudy",
    });
    expect(report.frames).toHaveLength(1);
    expect(report.frames[0].frameId).toBe("frame-1");
    expect(report.questions.total).toBe(12);
    expect(report.autoTurn).toEqual({
      running: true,
      steps: 3,
      maxSteps: 200,
      message: "等待视频结束",
      nextAt: 1234,
    });
    // 未传 tabLock 时使用“未持有”默认值
    expect(report.tabLock).toEqual({ holder: false, heartbeatAt: null });
    expect(report.verification).toEqual({ detected: false, message: "" });
    expect(Array.isArray(report.logs)).toBe(true);
    expect(report.selectors.length).toBeGreaterThan(20);
  });

  it("未注入版本号时回退为 dev（不依赖全局 __APP_VERSION__）", () => {
    const report = buildDiagnostics(makeInput(), document);
    expect(typeof report.scriptVersion).toBe("string");
    expect(report.scriptVersion.length).toBeGreaterThan(0);
    expect(report.scriptVersion).not.toBe("undefined");
  });

  it("透传 tabLock 与 verification", () => {
    const report = buildDiagnostics(
      makeInput({
        tabLock: { holder: true, heartbeatAt: T0 },
        verification: { detected: true, message: "需要完成人机验证" },
      }),
      document,
      "1.0.0",
    );
    expect(report.tabLock).toEqual({ holder: true, heartbeatAt: T0 });
    expect(report.verification).toEqual({ detected: true, message: "需要完成人机验证" });
  });

  it("media 为空时报告为 null", () => {
    const report = buildDiagnostics(makeInput({ media: null }), document, "1.0.0");
    expect(report.media).toBeNull();
  });
});

describe("选择器命中矩阵", () => {
  it("统计命中数，未命中的选择器为 0", () => {
    mountFixture();
    const report = buildDiagnostics(makeInput(), document, "1.0.0");

    expect(findSelector(report, ".TiMu, .questionLi, [data-questionid]")?.hits).toBe(2);
    expect(findSelector(report, "#video_html5_api")?.hits).toBe(1);
    expect(findSelector(report, ".Btn_blue_1")?.hits).toBe(1);
    expect(findSelector(report, "#prevNextFocusNext")?.hits).toBe(1);
    expect(findSelector(report, ".knowledge-card")?.hits).toBe(1);
    expect(findSelector(report, "#chapterList")?.hits).toBe(1);
    expect(findSelector(report, "iframe#iframe")?.hits).toBe(1);
    expect(findSelector(report, ".mark_name")?.hits).toBe(0);
    expect(findSelector(report, ".edui_body [contenteditable='true']")?.hits).toBe(0);

    for (const row of report.selectors) {
      expect(row.name.length).toBeGreaterThan(0);
      expect(row.selector.length).toBeGreaterThan(0);
      expect(row.hits).toBeGreaterThanOrEqual(0);
    }
  });

  it("选择器查询抛异常时记 0 且不中断构建", () => {
    const brokenDoc = {
      querySelectorAll: () => {
        throw new Error("boom");
      },
    } as unknown as Document;

    const report = buildDiagnostics(makeInput(), brokenDoc, "1.0.0");
    expect(report.selectors.length).toBeGreaterThan(0);
    expect(report.selectors.every((row) => row.hits === 0)).toBe(true);
  });
});

describe("题目样本", () => {
  it("统计题型/图片题，样本最多 10 条且题干截断 40 字", () => {
    const report = buildDiagnostics(makeInput(), document, "1.0.0");
    const { questions } = report;

    expect(questions.total).toBe(12);
    expect(questions.byType.single).toBe(6);
    expect(questions.byType.judge).toBe(6);
    expect(questions.withImage).toBe(1);
    expect(questions.samples).toHaveLength(DIAGNOSTICS_MAX_SAMPLES);
    expect(questions.samples[0].stem.length).toBeLessThanOrEqual(DIAGNOSTICS_MAX_STEM);
    expect(questions.samples[0].stem.endsWith("…")).toBe(true);
    expect(questions.samples[0].options).toBe(2);
    // 样本只有 type/stem/options，不含答案字段
    expect(Object.keys(questions.samples[0])).toEqual(["type", "stem", "options"]);
    expect(JSON.stringify(report)).not.toContain("尾部不应出现的内容");
  });
});

describe("脱敏", () => {
  it("apiKey 只显示是否已设置", () => {
    const report = buildDiagnostics(makeInput(), document, "1.0.0");
    const settings = report.settings as {
      ai: { apiKey: string };
      bank: { remote: { url: string; headers: Record<string, string> } };
    };
    expect(settings.ai.apiKey).toBe("已设置");
    expect(JSON.stringify(report)).not.toContain(SECRET_API_KEY);

    const empty = buildDiagnostics(
      makeInput({ settings: makeSettings() }),
      document,
      "1.0.0",
    );
    expect((empty.settings as { ai: { apiKey: string } }).ai.apiKey).toBe("未设置");
  });

  it("远程题库 headers 值全部替换为 <redacted>，url 只保留 origin+pathname", () => {
    const report = buildDiagnostics(makeInput(), document, "1.0.0");
    const remote = (
      report.settings as {
        bank: { remote: { url: string; headers: Record<string, string> } };
      }
    ).bank.remote;

    expect(remote.url).toBe("https://bank.example.com/api/answers");
    expect(remote.headers).toEqual({
      Authorization: "<redacted>",
      "X-Api-Key": "<redacted>",
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(SECRET_HEADER);
    expect(serialized).not.toContain("secret-header-value");
    expect(serialized).not.toContain(SECRET_URL_TOKEN);
  });

  it("脱敏不修改调用方传入的 settings（深拷贝）", () => {
    const input = makeInput();
    buildDiagnostics(input, document, "1.0.0");
    expect(input.settings.ai.apiKey).toBe(SECRET_API_KEY);
    expect(input.settings.bank.remote.headers.Authorization).toBe(SECRET_HEADER);
    expect(input.settings.bank.remote.url).toContain(SECRET_URL_TOKEN);
  });

  it("页面 URL / frame URL / 媒体 URL 只保留 pathname + 白名单参数", () => {
    const report = buildDiagnostics(makeInput(), document, "1.0.0");

    expect(report.url).toBe("/mycourse/studentstudy?courseId=123&clazzid=456&chapterId=9");
    expect(report.frames[0].url).toBe("/knowledge/cards?courseId=123&clazzid=456&jobid=77");
    expect(report.media?.nextTaskUrl).toBe(
      "/ananas/modules/video/index.html?courseId=123&objectId=88",
    );

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("deadbeef");
    expect(serialized).not.toContain("token=leak");
    expect(serialized).not.toContain("secret=xyz");
    expect(serialized).not.toContain("signed=leak");
  });

  it("日志只保留最近 100 条并再次脱敏", () => {
    const report = buildDiagnostics(makeInput(), document, "1.0.0");

    expect(report.logs).toHaveLength(DIAGNOSTICS_MAX_LOGS);
    // 120 条取最后 100 条 → 第一条 id 为 21
    expect(report.logs[0].id).toBe(21);
    expect(report.logs[report.logs.length - 1].message).toContain("••••");

    const serialized = JSON.stringify(report.logs);
    expect(serialized).not.toContain("sk-abcdefghijklmnopqrst");
    expect(serialized).not.toContain(SECRET_API_KEY);
    // data 里的 apiKey 也被替换
    expect(JSON.stringify(report.logs[report.logs.length - 1].data)).toContain("••••");
  });
});

describe("formatDiagnostics", () => {
  it("输出 2 空格缩进 JSON，可被解析回同样的报告", () => {
    const report = buildDiagnostics(makeInput(), document, "2.0.0");
    const text = formatDiagnostics(report);
    expect(text).toBe(JSON.stringify(report, null, 2));
    expect(text.split("\n")[1]).toMatch(/^ {2}"/);
    expect(JSON.parse(text)).toEqual(report);
  });
});

describe("工具函数", () => {
  it("sanitizeUrl 去掉非白名单参数与 hash", () => {
    expect(sanitizeUrl("/a/b?courseId=1&x=2&token=secret#frag")).toBe("/a/b?courseId=1");
    expect(sanitizeUrl("https://mooc1.chaoxing.com/x")).toBe("/x");
    expect(() => sanitizeUrl("http://")).not.toThrow();
  });

  it("redactSettings 对空字符串返回空 endpoint", () => {
    const settings = makeSettings();
    settings.bank.remote.url = "";
    settings.ai.apiKey = "   ";
    const redacted = redactSettings(settings) as {
      ai: { apiKey: string };
      bank: { remote: { url: string } };
    };
    expect(redacted.ai.apiKey).toBe("未设置");
    expect(redacted.bank.remote.url).toBe("");
  });
});
