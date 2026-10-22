/**
 * AI 批量解题入口。
 *
 * - solveWithAi：按 settings.maxBatch 分批，并发 2，单批失败不影响其他批次
 * - testAiConnection：连接测试（返回 model/延迟/脱敏消息）
 */

import { logger } from "../core/logger";
import type { AiSettings } from "../core/settings";
import type { Question, SolveResult } from "../core/types";
import { parseAiResponse } from "./parse";
import { buildRepairMessages, buildSolveMessages } from "./prompt";
import {
  chatCompletion,
  sanitizeAiError,
  sanitizeText,
  type ChatCompletionResult,
} from "./provider";

export * from "./parse";
export * from "./prompt";
export * from "./provider";

export interface AiSolveDeps {
  chatCompletion: typeof chatCompletion;
}

export interface AiSolveOptions {
  deps?: Partial<AiSolveDeps>;
}

const MAX_BATCH_SIZE = 50;
const CONCURRENCY = 2;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  const actual = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += actual) batches.push(items.slice(i, i + actual));
  return batches;
}

function resolveBatchSize(settings: AiSettings): number {
  const value = Number(settings.maxBatch);
  if (!Number.isFinite(value) || value <= 0) return 6;
  return Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(value)));
}

function resolveApiKey(settings: AiSettings): string {
  return String(settings.apiKey ?? "").trim();
}

function totalTokensOf(result: ChatCompletionResult): number | undefined {
  const total = result.usage?.totalTokens;
  if (typeof total === "number" && Number.isFinite(total) && total > 0) return total;
  const prompt = result.usage?.promptTokens;
  const completion = result.usage?.completionTokens;
  if (typeof prompt === "number" || typeof completion === "number") {
    return (prompt ?? 0) + (completion ?? 0);
  }
  return undefined;
}

/**
 * 批量 AI 解题。
 * 返回 Map<questionId, SolveResult>；缺失的题目由调用方决定后续（通常转人工）。
 */
export async function solveWithAi(
  questions: Question[],
  settings: AiSettings,
  options: AiSolveOptions = {},
): Promise<Map<string, SolveResult>> {
  const results = new Map<string, SolveResult>();
  if (!Array.isArray(questions) || questions.length === 0) return results;
  if (!resolveApiKey(settings)) {
    logger.warn("ai", "未配置 API Key，跳过 AI 解题");
    return results;
  }
  if (!String(settings.baseUrl ?? "").trim()) {
    logger.warn("ai", "未配置 AI Base URL，跳过 AI 解题");
    return results;
  }

  const apiKey = resolveApiKey(settings);
  const call = options.deps?.chatCompletion ?? chatCompletion;
  const batches = chunk(questions, resolveBatchSize(settings));
  let cursor = 0;

  const solveBatch = async (batch: Question[]): Promise<void> => {
    if (!batch.length) return;
    const startedAt = Date.now();
    let response: ChatCompletionResult | null = null;
    let parsed = new Map<string, SolveResult>();
    let tokens: number | undefined;

    try {
      response = await call(settings, buildSolveMessages(batch));
      parsed = parseAiResponse(response.text, batch);
      tokens = totalTokensOf(response);
    } catch (error) {
      logger.warn("ai", "AI 批量解题失败", {
        message: sanitizeAiError(error, apiKey),
      });
      return;
    }

    // 首次解析失败：做一次修复重试（要求模型重新输出合法 JSON）
    if (parsed.size === 0 && response) {
      try {
        const repaired = await call(settings, buildRepairMessages(batch, response.text));
        const repairedParsed = parseAiResponse(repaired.text, batch);
        if (repairedParsed.size > 0) {
          parsed = repairedParsed;
          const repairTokens = totalTokensOf(repaired);
          if (repairTokens != null) tokens = (tokens ?? 0) + repairTokens;
          logger.debug("ai", "AI 修复重试成功");
        }
      } catch (error) {
        logger.warn("ai", "AI 修复重试失败", {
          message: sanitizeAiError(error, apiKey),
        });
      }
    }

    if (parsed.size === 0) {
      logger.warn("ai", "AI 返回无法解析为答案", {
        batchSize: batch.length,
        preview: sanitizeText(response?.text ?? "", apiKey).slice(0, 120),
      });
      return;
    }

    const latencyMs = Date.now() - startedAt;
    const costTokens =
      tokens != null && parsed.size > 0 ? Math.max(1, Math.round(tokens / parsed.size)) : undefined;
    for (const result of parsed.values()) {
      results.set(result.questionId, {
        ...result,
        source: "ai",
        status: "solved",
        latencyMs,
        costTokens,
      });
    }
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= batches.length) return;
      await solveBatch(batches[index]);
    }
  };
  await Promise.all([worker(), worker()]);
  return results;
}

export interface AiConnectionResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  message: string;
  sample?: string;
}

/**
 * 测试 AI 连接。不抛异常，消息与样例均脱敏。
 */
export async function testAiConnection(
  settings: AiSettings,
  options: AiSolveOptions = {},
): Promise<AiConnectionResult> {
  const model = String(settings.model ?? "");
  const apiKey = resolveApiKey(settings);
  const startedAt = Date.now();

  if (!apiKey) {
    return { ok: false, model, latencyMs: 0, message: "未配置 API Key" };
  }
  if (!String(settings.baseUrl ?? "").trim()) {
    return { ok: false, model, latencyMs: 0, message: "未配置 Base URL" };
  }

  const call = options.deps?.chatCompletion ?? chatCompletion;
  try {
    const response = await call(settings, [
      { role: "system", content: "你是连接测试助手，只输出合法 JSON。" },
      { role: "user", content: '请只输出 {"ok":true,"message":"pong"}，不要输出其他内容。' },
    ]);
    const latencyMs = Date.now() - startedAt;
    const sample = sanitizeText(response.text, apiKey).slice(0, 200);
    return {
      ok: true,
      model: response.model || model,
      latencyMs,
      message: `连接成功（${latencyMs}ms）`,
      sample,
    };
  } catch (error) {
    return {
      ok: false,
      model,
      latencyMs: Date.now() - startedAt,
      message: sanitizeAiError(error, apiKey),
    };
  }
}
