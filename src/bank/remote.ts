/**
 * 远程题库查询：bodyTemplate 替换 + gmRequest + 点路径取值。
 *
 * 安全约定：
 * - URL / headers 中可能含有 API Key，绝不写入日志或错误消息；
 * - 仅在失败时用 logger.warn 记录脱敏后的状态/原因，不抛出到 UI。
 */

import { gmRequest } from "../core/gm";
import { logger, redact } from "../core/logger";
import type { RemoteBankSettings } from "../core/settings";
import type { AnswerValue, Question, RemoteAnswer } from "../core/types";
import { answerFromUnknown } from "./answer";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 脱敏：去掉日志中可能出现的密钥片段 */
function sanitize(text: string): string {
  return redact(String(text)).slice(0, 300);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON 字符串内容转义（不包含外层引号），用于模板 {{question}} */
export function jsonEscapeContent(text: string): string {
  return JSON.stringify(String(text ?? "")).slice(1, -1);
}

/** 单次替换模板变量，避免替换结果被二次展开 */
export function replaceTemplate(template: string, variables: Record<string, string>): string {
  return String(template ?? "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, name: string) => {
    const key = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : whole;
  });
}

/** 题干/选项 → 远程题库请求体 */
export function buildRemoteBody(question: Question, config: RemoteBankSettings): string {
  const options = question.options.map((option) => option.text);
  const variables: Record<string, string> = {
    question: jsonEscapeContent(question.stem),
    type: jsonEscapeContent(question.type),
    options: JSON.stringify(options),
    id: jsonEscapeContent(question.id),
    blankcount: String(question.blankCount ?? ""),
  };
  const template = config.bodyTemplate?.trim() ? config.bodyTemplate : "{{question}}";
  return replaceTemplate(template, variables);
}

/** 读取点路径：支持 a.b[0].c / a.0.c */
export function getByPath(source: unknown, path: string): unknown {
  const trimmed = String(path ?? "").trim();
  if (!trimmed) return source;
  const tokens = trimmed
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((token) => token.trim())
    .filter(Boolean);
  let current: unknown = source;
  for (const token of tokens) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (isRecord(current)) {
      current = current[token];
      continue;
    }
    return undefined;
  }
  return current;
}

function clampConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0.7;
  if (numeric > 1 && numeric <= 100) return Math.min(1, Math.max(0, numeric / 100));
  return Math.min(1, Math.max(0, numeric));
}

/**
 * 查询远程题库。
 * 任何失败（网络/状态码/JSON/路径）都返回 null，只记录 warn 日志。
 */
export async function queryRemote(
  question: Question,
  config: RemoteBankSettings,
): Promise<RemoteAnswer | null> {
  if (!config || !config.enabled) return null;
  const url = String(config.url ?? "").trim();
  if (!url) {
    logger.warn("bank.remote", "远程题库已启用但未配置 URL");
    return null;
  }

  let response: Awaited<ReturnType<typeof gmRequest>>;
  try {
    response = await gmRequest({
      url,
      method: config.method === "POST" ? "POST" : "GET",
      headers: config.headers ?? {},
      data: buildRemoteBody(question, config),
      timeoutMs: 15000,
    });
  } catch (error) {
    logger.warn("bank.remote", "远程题库请求失败", { message: sanitize(errorMessage(error)) });
    return null;
  }

  if (response.status < 200 || response.status >= 300) {
    logger.warn("bank.remote", `远程题库返回异常状态 ${response.status}`);
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.responseText);
  } catch (error) {
    logger.warn("bank.remote", "远程题库返回非 JSON", {
      message: sanitize(errorMessage(error)),
    });
    return null;
  }

  const answerPath = config.answerPath?.trim() || "answer";
  const rawAnswer = getByPath(payload, answerPath);
  if (rawAnswer == null || rawAnswer === "") {
    logger.debug("bank.remote", "远程题库未命中", { path: answerPath });
    return null;
  }

  const options = question.options.map((option) => `${option.key}. ${option.text}`);
  const answer: AnswerValue | null = answerFromUnknown(rawAnswer, {
    type: question.type,
    options,
    blankCount: question.blankCount,
  });
  if (!answer) {
    logger.warn("bank.remote", "远程题库答案无法解析");
    return null;
  }

  const confidence = clampConfidence(
    config.confidencePath?.trim() ? getByPath(payload, config.confidencePath) : undefined,
  );

  return { answer, confidence, raw: payload };
}
