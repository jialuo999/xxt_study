import { afterEach, describe, expect, it } from "vitest";
import type { AiSettings } from "../../src/core/settings";
import { chatCompletion, testAiConnection } from "../../src/ai";
import { makeSettings } from "./fixtures";

interface GmDetails {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  data?: string;
  timeout?: number;
  onload?: (response: { status: number; responseText: string; finalUrl?: string }) => void;
  onerror?: (error: unknown) => void;
}

type GmResult = { status: number; responseText: string } | { error: string };

function aiSettings(patch: Partial<AiSettings> = {}): AiSettings {
  return {
    ...makeSettings().ai,
    enabled: true,
    baseUrl: "https://api.example.com/v1/",
    apiKey: "sk-test-1234567890",
    model: "test-model",
    jsonMode: "off",
    ...patch,
  };
}

function installGmHttp(handler: (details: GmDetails, callIndex: number) => GmResult): GmDetails[] {
  const calls: GmDetails[] = [];
  (globalThis as unknown as Record<string, unknown>).GM_xmlhttpRequest = (
    details: GmDetails,
  ) => {
    calls.push(details);
    const callIndex = calls.length - 1;
    setTimeout(() => {
      const result = handler(details, callIndex);
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

function successBody(content: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    model: "response-model",
    choices: [{ message: { role: "assistant", content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    ...extra,
  });
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).GM_xmlhttpRequest;
});

describe("chatCompletion", () => {
  it("请求 URL / Header / Body 符合 OpenAI 兼容格式", async () => {
    const calls = installGmHttp(() => ({ status: 200, responseText: successBody('{"ok":true}') }));
    const result = await chatCompletion(aiSettings(), [{ role: "user", content: "你好" }]);

    expect(result.text).toBe('{"ok":true}');
    expect(result.model).toBe("response-model");
    expect(result.usage?.totalTokens).toBe(15);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example.com/v1/chat/completions");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers?.Authorization).toBe("Bearer sk-test-1234567890");
    expect(calls[0].headers?.["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(calls[0].data)) as Record<string, unknown>;
    expect(body.model).toBe("test-model");
    expect(body.stream).toBe(false);
    expect(body.temperature).toBe(0);
    expect(body.messages).toEqual([{ role: "user", content: "你好" }]);
    expect(body.response_format).toBeUndefined();
  });

  it("jsonMode=on 时附加 response_format", async () => {
    const calls = installGmHttp(() => ({ status: 200, responseText: successBody('{"ok":true}') }));
    await chatCompletion(aiSettings({ jsonMode: "on" }), [{ role: "user", content: "hi" }]);
    const body = JSON.parse(String(calls[0].data)) as Record<string, unknown>;
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("jsonMode=auto 在服务端拒绝 400 时去掉 response_format 重试", async () => {
    const calls = installGmHttp((_details, index) =>
      index === 0
        ? { status: 400, responseText: '{"error":"response_format is not supported"}' }
        : { status: 200, responseText: successBody('{"ok":true}') },
    );
    const result = await chatCompletion(aiSettings({ jsonMode: "auto" }), [
      { role: "user", content: "hi" },
    ]);
    expect(result.text).toBe('{"ok":true}');
    expect(calls).toHaveLength(2);
    const firstBody = JSON.parse(String(calls[0].data)) as Record<string, unknown>;
    const secondBody = JSON.parse(String(calls[1].data)) as Record<string, unknown>;
    expect(firstBody.response_format).toEqual({ type: "json_object" });
    expect(secondBody.response_format).toBeUndefined();
  });

  it("429 后自动重试并成功", async () => {
    const calls = installGmHttp((_details, index) =>
      index === 0
        ? { status: 429, responseText: "rate limited" }
        : { status: 200, responseText: successBody('{"ok":true}') },
    );
    const result = await chatCompletion(aiSettings({ maxRetries: 1 }), [
      { role: "user", content: "hi" },
    ]);
    expect(result.text).toBe('{"ok":true}');
    expect(calls.length).toBe(2);
  }, 15000);

  it("错误消息脱敏且不提 Authorization", async () => {
    installGmHttp(() => ({
      status: 401,
      responseText: '{"error":"invalid api key sk-test-1234567890"}',
    }));
    await expect(
      chatCompletion(aiSettings(), [{ role: "user", content: "hi" }]),
    ).rejects.toThrow();
    try {
      await chatCompletion(aiSettings(), [{ role: "user", content: "hi" }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("401");
      expect(message).not.toContain("sk-test-1234567890");
      expect(message.toLowerCase()).not.toContain("authorization");
    }
  });

  it("未配置 API Key 时不发起请求", async () => {
    const calls = installGmHttp(() => ({ status: 200, responseText: successBody("{}") }));
    await expect(
      chatCompletion(aiSettings({ apiKey: "" }), [{ role: "user", content: "hi" }]),
    ).rejects.toThrow("未配置 API Key");
    expect(calls).toHaveLength(0);
  });

  it("返回非 JSON 或空内容时报错", async () => {
    installGmHttp(() => ({ status: 200, responseText: "not-json" }));
    await expect(
      chatCompletion(aiSettings(), [{ role: "user", content: "hi" }]),
    ).rejects.toThrow(/JSON/);

    installGmHttp(() => ({ status: 200, responseText: JSON.stringify({ choices: [] }) }));
    await expect(
      chatCompletion(aiSettings(), [{ role: "user", content: "hi" }]),
    ).rejects.toThrow(/为空/);
  });
});

describe("testAiConnection", () => {
  it("成功时返回 model 与延迟", async () => {
    const result = await testAiConnection(aiSettings(), {
      deps: {
        chatCompletion: async () => ({
          text: '{"ok":true,"message":"pong"}',
          model: "fake-model",
          latencyMs: 12,
        }),
      },
    });
    expect(result.ok).toBe(true);
    expect(result.model).toBe("fake-model");
    expect(result.message).toContain("成功");
    expect(result.sample).toContain("pong");
  });

  it("失败时返回脱敏消息且不抛出", async () => {
    const result = await testAiConnection(aiSettings(), {
      deps: {
        chatCompletion: async () => {
          throw new Error("鉴权失败：Bad key sk-test-1234567890");
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("sk-test-1234567890");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("未配置 API Key 时直接返回失败", async () => {
    const result = await testAiConnection(aiSettings({ apiKey: "" }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("API Key");
  });
});
