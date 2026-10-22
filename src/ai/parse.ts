/**
 * AI 返回解析：容错提取 JSON、修复常见格式问题、校验并转换为 SolveResult。
 *
 * 容错范围：
 * - ```json 代码块 / 前后夹杂解释文字
 * - 尾逗号 / 单引号 / 未加引号的 key / 智能引号
 * - answers 为数组或按 id 索引的对象
 * - answer 为数组、字符串、布尔
 * - 校验 id 是否存在、选项字母是否在范围内、多选去重
 */

import type { AnswerValue, Question, SolveResult } from "../core/types";
import { clamp } from "../utils/async";
import { answerFromUnknown } from "../bank/answer";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isParseable(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** 从任意文本中提取第一个平衡的 JSON 对象/数组（忽略字符串内的括号） */
function extractBalanced(source: string): string | null {
  const firstObject = source.indexOf("{");
  const firstArray = source.indexOf("[");
  if (firstObject < 0 && firstArray < 0) return null;
  const start =
    firstObject < 0
      ? firstArray
      : firstArray < 0
        ? firstObject
        : Math.min(firstObject, firstArray);
  if (start < 0) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char === "}" || char === "]") {
      const open = stack.pop();
      if (!open) return null;
      const expected = open === "{" ? "}" : "]";
      if (char !== expected) return null;
      if (stack.length === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** 提取 JSON 文本（优先代码块内容，其次第一个平衡结构） */
export function extractJson(text: string): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const source = text.replace(/^\uFEFF/, "");
  const fencePattern = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(source)) !== null) {
    const candidate = extractBalanced(match[1]);
    if (candidate) return candidate;
  }
  return extractBalanced(source);
}

/** 单引号字符串 → 双引号字符串（保持字符串内部内容） */
function convertSingleQuotes(input: string): string {
  let out = "";
  let mode: "none" | "double" | "single" = "none";
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (mode === "double") {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') mode = "none";
      continue;
    }
    if (mode === "single") {
      if (escaped) {
        escaped = false;
        if (char === "'") out += "'";
        else if (char === '"') out += '\\"';
        else out += `\\${char}`;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "'") {
        mode = "none";
        out += '"';
        continue;
      }
      if (char === '"') {
        out += '\\"';
        continue;
      }
      out += char;
      continue;
    }
    if (char === '"') {
      mode = "double";
      out += char;
      continue;
    }
    if (char === "'") {
      mode = "single";
      out += '"';
      continue;
    }
    out += char;
  }
  if (mode === "single") out += '"';
  return out;
}

/** 尝试修复常见 JSON 格式错误，返回可 JSON.parse 的文本；失败返回 null */
export function repairJson(text: string): string | null {
  const extracted = extractJson(text);
  if (!extracted) return null;
  if (isParseable(extracted)) return extracted;

  let candidate = extracted
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,[]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
  candidate = convertSingleQuotes(candidate);
  if (isParseable(candidate)) return candidate;

  // 再退一步：去掉代码块围栏残留与零宽字符
  const cleaned = candidate.replace(/[\u200b-\u200d\ufeff]/g, "").replace(/,\s*([}\]])/g, "$1");
  if (isParseable(cleaned)) return cleaned;
  return null;
}

/** 从答案元素中取出 id（兼容 id/questionId/qid） */
function readItemId(item: Record<string, unknown>): string {
  for (const key of ["id", "questionId", "question_id", "qid"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

/** 提取 answers 数组（兼容 {answers:[...]} / {answers:{id:...}} / 裸数组 / {data:{...}}） */
export function extractAnswerItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  const direct = payload.answers ?? payload.results ?? payload.items;
  if (Array.isArray(direct)) return direct;
  if (isRecord(direct)) {
    const mapped = Object.entries(direct).map(([id, value]) =>
      isRecord(value) ? { id, ...value } : { id, answer: value },
    );
    if (mapped.length) return mapped;
  }
  if (isRecord(payload.data)) {
    const nested = extractAnswerItems(payload.data);
    if (nested.length) return nested;
  }
  return [];
}

function normalizeConfidence(raw: unknown): number {
  const numeric = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(numeric)) return 0.5;
  if (numeric > 1 && numeric <= 100) return clamp(numeric / 100, 0, 1);
  return clamp(numeric, 0, 1);
}

/**
 * 把 AI 返回的 answer 字段转换为经过校验的 AnswerValue。
 * 返回 null 表示答案不可用（选项字母越界、空答案等）。
 */
export function answerItemToValue(raw: unknown, question: Question): AnswerValue | null {
  const optionTexts = question.options.map((option) => `${option.key}. ${option.text}`);
  const answer = answerFromUnknown(raw, {
    type: question.type,
    options: optionTexts,
    blankCount: question.blankCount,
  });
  if (!answer) return null;

  if (answer.kind === "choice") {
    const allowed = question.options.map((option) => option.key.toUpperCase());
    const keys: string[] = [];
    for (const key of answer.keys) {
      const upper = key.toUpperCase();
      const valid = allowed.length ? allowed.includes(upper) : /^[A-H]$/.test(upper);
      if (valid && !keys.includes(upper)) keys.push(upper);
    }
    if (!keys.length) return null;
    // 单选保留模型给出的第一个有效字母；多选排序去重
    const clean = question.type === "single" ? keys.slice(0, 1) : keys.slice().sort();
    const texts = clean
      .map((key) => question.options.find((option) => option.key.toUpperCase() === key)?.text)
      .filter((text): text is string => Boolean(text));
    return { kind: "choice", keys: clean, texts: texts.length ? texts : undefined };
  }

  if (answer.kind === "fill") {
    const values =
      question.blankCount && question.blankCount > 0
        ? answer.values.slice(0, question.blankCount)
        : answer.values;
    return values.length ? { kind: "fill", values } : null;
  }

  return answer;
}

/**
 * 解析 AI 文本为 Map<questionId, SolveResult>。
 * 无法解析时返回空 Map（不抛异常）。
 */
export function parseAiResponse(
  text: string,
  questions: Question[],
): Map<string, SolveResult> {
  const results = new Map<string, SolveResult>();
  if (!Array.isArray(questions) || questions.length === 0) return results;

  const jsonText = repairJson(text) ?? extractJson(text);
  if (!jsonText) return results;

  let payload: unknown;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    return results;
  }

  const byId = new Map(questions.map((question) => [question.id, question]));
  let items = extractAnswerItems(payload);

  // 单题且模型直接返回 {"answer":...,"confidence":...} 时的兼容
  if (!items.length && isRecord(payload) && "answer" in payload && questions.length === 1) {
    items = [payload];
  }

  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = readItemId(item);
    const question = byId.get(id) ?? (questions.length === 1 ? questions[0] : undefined);
    if (!question) continue;
    if (!("answer" in item) || item.answer == null) continue;

    const answer = answerItemToValue(item.answer, question);
    if (!answer) continue;

    const confidence = normalizeConfidence(item.confidence);
    const explanation =
      typeof item.explanation === "string" && item.explanation.trim()
        ? item.explanation.trim().slice(0, 400)
        : undefined;

    results.set(question.id, {
      questionId: question.id,
      answer,
      confidence,
      source: "ai",
      status: "solved",
      explanation,
      latencyMs: 0,
    });
  }

  return results;
}
