/**
 * OpenAI 兼容 Chat Completions Provider。
 *
 * - POST `${baseUrl.replace(/\/$/,"")}/chat/completions`
 * - Authorization: Bearer <apiKey>
 * - 超时 / 重试（429、5xx、网络错误，指数退避 + 抖动）
 * - 错误消息脱敏：API Key、Authorization 绝不进入日志或异常文本
 */

import { gmRequest } from "../core/gm";
import { logger, redact } from "../core/logger";
import type { AiSettings } from "../core/settings";
import { jitter, sleep } from "../utils/async";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatCompletionResult {
  text: string;
  usage?: ChatUsage;
  model?: string;
  latencyMs: number;
}

export interface ChatCompletionDeps {
  request: typeof gmRequest;
}

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_RETRIES = 3;

class AiRequestError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "AiRequestError";
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 脱敏文本：先走 logger.redact，再兜底替换密钥字面量 */
export function sanitizeText(text: string, apiKey?: string): string {
  let result = redact(String(text ?? ""));
  const key = String(apiKey ?? "").trim();
  if (key.length >= 4) {
    result = result.split(key).join("••••");
  }
  return result.slice(0, 300);
}

/** 把任意异常转成可安全展示/记录的错误消息 */
export function sanitizeAiError(error: unknown, apiKey?: string): string {
  return sanitizeText(errorMessage(error), apiKey);
}

function normalizeBaseUrl(baseUrl: string): string {
  return String(baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function buildEndpoint(settings: AiSettings): string {
  const base = normalizeBaseUrl(settings.baseUrl);
  if (!base) throw new AiRequestError("未配置 AI Base URL");
  return `${base}/chat/completions`;
}

function resolveTimeout(settings: AiSettings): number {
  const value = Number(settings.timeoutMs);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(1000, Math.floor(value)), 300000);
}

function resolveMaxRetries(settings: AiSettings): number {
  const value = Number(settings.maxRetries);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), MAX_RETRIES);
}

function isRetryable(error: unknown): boolean {
  if (error instanceof AiRequestError) {
    if (error.retryable) return true;
    return error.status === 429 || (error.status != null && error.status >= 500);
  }
  // gmRequest 抛出的网络错误 / 超时：可重试
  return true;
}

function extractContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const message = (choices[0] as { message?: unknown })?.message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function extractUsage(payload: unknown): ChatUsage | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>;
  const result: ChatUsage = {
    promptTokens: typeof record.prompt_tokens === "number" ? record.prompt_tokens : undefined,
    completionTokens:
      typeof record.completion_tokens === "number" ? record.completion_tokens : undefined,
    totalTokens: typeof record.total_tokens === "number" ? record.total_tokens : undefined,
  };
  if (
    result.promptTokens === undefined &&
    result.completionTokens === undefined &&
    result.totalTokens === undefined
  ) {
    return undefined;
  }
  return result;
}

interface SendOptions {
  settings: AiSettings;
  messages: ChatMessage[];
  endpoint: string;
  useJsonMode: boolean;
  request: typeof gmRequest;
}

async function sendOnce(options: SendOptions): Promise<ChatCompletionResult> {
  const { settings, messages, endpoint, useJsonMode, request } = options;
  const apiKey = settings.apiKey.trim();
  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    temperature: Number.isFinite(settings.temperature) ? settings.temperature : 0,
    stream: false,
  };
  if (useJsonMode) body.response_format = { type: "json_object" };

  const startedAt = Date.now();
  const response = await request({
    url: endpoint,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    data: JSON.stringify(body),
    timeoutMs: resolveTimeout(settings),
  });
  const latencyMs = Date.now() - startedAt;

  if (response.status < 200 || response.status >= 300) {
    const snippet = sanitizeText(response.responseText ?? "", apiKey).slice(0, 160);
    const message = `AI 服务返回 ${response.status}${snippet ? `：${snippet}` : ""}`;
    throw new AiRequestError(message, {
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.responseText);
  } catch {
    throw new AiRequestError("AI 返回内容不是合法 JSON", { status: response.status });
  }

  const text = extractContent(payload);
  if (!text) throw new AiRequestError("AI 返回内容为空", { status: response.status });

  const model = typeof (payload as { model?: unknown }).model === "string"
    ? ((payload as { model: string }).model)
    : settings.model;
  return { text, usage: extractUsage(payload), model, latencyMs };
}

/**
 * 调用 OpenAI 兼容接口，返回文本与 token 用量。
 * jsonMode:
 * - "on"：强制附加 response_format
 * - "off"：不附加
 * - "auto"：先尝试附加，若服务端以 400/404/422 拒绝则去掉后重试一次
 */
export async function chatCompletion(
  settings: AiSettings,
  messages: ChatMessage[],
  deps?: Partial<ChatCompletionDeps>,
): Promise<ChatCompletionResult> {
  const apiKey = String(settings.apiKey ?? "").trim();
  if (!apiKey) throw new AiRequestError("未配置 API Key");
  const endpoint = buildEndpoint(settings);
  const request = deps?.request ?? gmRequest;
  const maxRetries = resolveMaxRetries(settings);
  const jsonMode = settings.jsonMode ?? "auto";
  let useJsonMode = jsonMode === "on" || jsonMode === "auto";
  let retriesLeft = maxRetries;
  let fallbackUsed = false;

  for (;;) {
    try {
      const result = await sendOnce({ settings, messages, endpoint, useJsonMode, request });
      logger.debug("ai", `AI 请求成功（${result.latencyMs}ms）`, {
        model: result.model,
        tokens: result.usage?.totalTokens,
      });
      return result;
    } catch (error) {
      const message = sanitizeAiError(error, apiKey);
      const status = error instanceof AiRequestError ? error.status : undefined;

      if (
        useJsonMode &&
        jsonMode === "auto" &&
        !fallbackUsed &&
        status != null &&
        [400, 404, 422].includes(status)
      ) {
        fallbackUsed = true;
        useJsonMode = false;
        logger.debug("ai", "服务端不支持 JSON 模式，降级重试");
        continue;
      }

      if (!isRetryable(error) || retriesLeft <= 0) {
        throw new AiRequestError(message, { status, retryable: false });
      }

      retriesLeft--;
      const delay = Math.min(8000, 500 * 2 ** (maxRetries - retriesLeft - 1)) + jitter(0, 400);
      logger.warn("ai", `AI 请求失败，${delay}ms 后重试`, { status, message });
      await sleep(delay);
    }
  }
}
