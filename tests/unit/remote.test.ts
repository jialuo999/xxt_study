import { afterEach, describe, expect, it } from "vitest";
import type { RemoteBankSettings } from "../../src/core/settings";
import {
  buildRemoteBody,
  getByPath,
  jsonEscapeContent,
  queryRemote,
  replaceTemplate,
} from "../../src/bank/remote";
import { makeChoiceQuestion, makeJudgeQuestion, makeSettings } from "./fixtures";

interface GmDetails {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  data?: string;
  onload?: (response: { status: number; responseText: string; finalUrl?: string }) => void;
  onerror?: (error: unknown) => void;
}

function remoteConfig(patch: Partial<RemoteBankSettings> = {}): RemoteBankSettings {
  return {
    ...makeSettings().bank.remote,
    enabled: true,
    url: "https://bank.example.com/query",
    answerPath: "answer",
    confidencePath: "confidence",
    ...patch,
  };
}

function installGmHttp(
  respond: () => { status: number; responseText: string } | { error: string },
): GmDetails[] {
  const calls: GmDetails[] = [];
  (globalThis as unknown as Record<string, unknown>).GM_xmlhttpRequest = (
    details: GmDetails,
  ) => {
    calls.push(details);
    setTimeout(() => {
      const result = respond();
      if ("error" in result) {
        details.onerror?.(result.error);
        return;
      }
      details.onload?.({
        status: result.status,
        responseText: result.responseText,
        finalUrl: details.url,
      });
    }, 0);
    return { abort: () => undefined };
  };
  return calls;
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).GM_xmlhttpRequest;
});

describe("模板替换", () => {
  it("{{question}} 做 JSON 转义", () => {
    expect(jsonEscapeContent('含"引号"\n换行')).toBe('含\\"引号\\"\\n换行');
    const body = buildRemoteBody(
      makeChoiceQuestion("q1", '含"引号"和\n换行的题干', ["甲", "乙"]),
      remoteConfig(),
    );
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed.question).toBe('含"引号"和\n换行的题干');
    expect(parsed.type).toBe("single");
    expect(parsed.options).toEqual(["甲", "乙"]);
  });

  it("单次替换不会二次展开", () => {
    expect(
      replaceTemplate("{{question}} / {{type}}", { question: "{{type}}", type: "judge" }),
    ).toBe("{{type}} / judge");
  });

  it("未提供的变量原样保留", () => {
    expect(replaceTemplate("{{question}} {{unknown}}", { question: "x" })).toBe(
      "x {{unknown}}",
    );
  });

  it("自定义模板", () => {
    expect(
      replaceTemplate('{"q":"{{question}}","t":"{{type}}","o":{{options}}}', {
        question: "题目",
        type: "single",
        options: '["A. 甲"]',
      }),
    ).toBe('{"q":"题目","t":"single","o":["A. 甲"]}');
  });
});

describe("getByPath", () => {
  const payload = {
    answer: "A",
    data: { list: [{ answer: "对", confidence: 0.8 }], nested: { value: 1 } },
  };

  it("支持点路径", () => {
    expect(getByPath(payload, "answer")).toBe("A");
    expect(getByPath(payload, "data.nested.value")).toBe(1);
  });

  it("支持数组下标", () => {
    expect(getByPath(payload, "data.list[0].answer")).toBe("对");
    expect(getByPath(payload, "data.list.0.confidence")).toBe(0.8);
  });

  it("路径不存在返回 undefined", () => {
    expect(getByPath(payload, "missing.path")).toBeUndefined();
    expect(getByPath(null, "a")).toBeUndefined();
  });

  it("空路径返回原始数据", () => {
    expect(getByPath(payload, "")).toBe(payload);
  });
});

describe("queryRemote", () => {
  it("按 answerPath / confidencePath 取值并解析为 AnswerValue", async () => {
    const calls = installGmHttp(() => ({
      status: 200,
      responseText: JSON.stringify({ data: { answer: "AC", confidence: 0.9 } }),
    }));
    const config = remoteConfig({
      answerPath: "data.answer",
      confidencePath: "data.confidence",
      headers: { "Content-Type": "application/json", Authorization: "Bearer remote-secret" },
    });
    const question = makeChoiceQuestion("q1", "多选题干", ["甲", "乙", "丙"], "multiple");
    const result = await queryRemote(question, config);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBe(0.9);
    expect(result?.answer).toEqual({
      kind: "choice",
      keys: ["A", "C"],
      texts: ["甲", "丙"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://bank.example.com/query");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers?.Authorization).toBe("Bearer remote-secret");
    const body = JSON.parse(String(calls[0].data)) as Record<string, unknown>;
    expect(body.question).toBe("多选题干");
    expect(body.type).toBe("multiple");
    expect(body.options).toEqual(["甲", "乙", "丙"]);
  });

  it("判断题文本答案", async () => {
    installGmHttp(() => ({
      status: 200,
      responseText: JSON.stringify({ answer: "对", confidence: 0.8 }),
    }));
    const result = await queryRemote(makeJudgeQuestion("q2", "判断题干"), remoteConfig());
    expect(result?.answer).toEqual({ kind: "judge", value: true });
  });

  it("confidencePath 缺失时使用默认置信度", async () => {
    installGmHttp(() => ({ status: 200, responseText: JSON.stringify({ answer: "A" }) }));
    const result = await queryRemote(
      makeChoiceQuestion("q3", "题目", ["甲", "乙"]),
      remoteConfig({ confidencePath: "" }),
    );
    expect(result?.confidence).toBe(0.7);
  });

  it("未命中答案返回 null", async () => {
    installGmHttp(() => ({ status: 200, responseText: JSON.stringify({ data: {} }) }));
    expect(
      await queryRemote(makeChoiceQuestion("q4", "题目", ["甲", "乙"]), remoteConfig()),
    ).toBeNull();
  });

  it("服务端错误返回 null 且不抛出", async () => {
    installGmHttp(() => ({ status: 500, responseText: "server error" }));
    await expect(
      queryRemote(makeChoiceQuestion("q5", "题目", ["甲", "乙"]), remoteConfig()),
    ).resolves.toBeNull();
  });

  it("网络错误返回 null 且不抛出", async () => {
    installGmHttp(() => ({ error: "network down" }));
    await expect(
      queryRemote(makeChoiceQuestion("q6", "题目", ["甲", "乙"]), remoteConfig()),
    ).resolves.toBeNull();
  });

  it("非 JSON 响应返回 null", async () => {
    installGmHttp(() => ({ status: 200, responseText: "<html>oops</html>" }));
    await expect(
      queryRemote(makeChoiceQuestion("q7", "题目", ["甲", "乙"]), remoteConfig()),
    ).resolves.toBeNull();
  });

  it("未启用或未配置 URL 时不发请求", async () => {
    const calls = installGmHttp(() => ({ status: 200, responseText: "{}" }));
    const question = makeChoiceQuestion("q8", "题目", ["甲", "乙"]);
    expect(await queryRemote(question, remoteConfig({ enabled: false }))).toBeNull();
    expect(await queryRemote(question, remoteConfig({ url: "" }))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("远程返回布尔/数组也能解析", async () => {
    installGmHttp(() => ({
      status: 200,
      responseText: JSON.stringify({ answer: ["A", "B"], confidence: 0.75 }),
    }));
    const result = await queryRemote(
      makeChoiceQuestion("q9", "多选", ["甲", "乙", "丙"], "multiple"),
      remoteConfig(),
    );
    expect(result?.answer).toMatchObject({ kind: "choice", keys: ["A", "B"] });
  });
});
