/**
 * 答案解析：把导入/远程/AI 得到的原始答案统一成 AnswerValue。
 *
 * 支持：
 * - 选择题：字母（A/C/AC/A,C）、选项全文
 * - 判断题：对/错/正确/错误/√/×/T/F
 * - 填空题：多空（| / ； / ; / 换行 分隔）
 * - 简答题：文本
 */

import type { AnswerValue, Option, QuestionType } from "../core/types";
import {
  normalizeOption,
  normalizeText,
  parseAnswerLetters,
  parseJudge,
  splitFillValues,
  stripHtml,
} from "../utils/text";

export interface AnswerParseContext {
  type: QuestionType;
  /** 原始选项列表，可带 "A." 前缀 */
  options?: string[];
  blankCount?: number;
}

const OPTION_PREFIX =
  /^\s*(?:选项\s*)?[（(]?\s*([A-Ha-h]|\d{1,2})\s*[)）]?\s*[、.．)）:：]\s*/;

function letterAt(index: number): string {
  return String.fromCharCode(65 + (index % 26)) + (index >= 26 ? String(Math.floor(index / 26)) : "");
}

/** 解析选项字母，缺失时按 A/B/C... 顺序补齐；返回带 key/text 的选项 */
export function resolveOptions(options: string[]): Option[] {
  const parsed = options.map((raw) => {
    const text = stripHtml(String(raw)).trim();
    const match = text.match(OPTION_PREFIX);
    const key = match ? match[1].toUpperCase() : "";
    return { key, text: match ? text.slice(match[0].length).trim() : text };
  });
  const keys = parsed.map((item) => item.key);
  const distinct = new Set(keys);
  const usable =
    parsed.length > 0 &&
    keys.every(Boolean) &&
    distinct.size === keys.length &&
    parsed.every((item) => item.text.length > 0);
  if (usable) return parsed;
  return parsed.map((item, index) => ({ key: letterAt(index), text: item.text || item.key }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeKeys(keys: string[]): string[] {
  return [...new Set(keys.map((key) => key.toUpperCase()))].sort();
}

/** 根据 key 列表构造 choice 答案，并按题型/选项范围校验 */
export function choiceFromKeys(
  keys: string[],
  options: Option[],
  type: QuestionType,
): AnswerValue | null {
  if (!options.length) {
    const clean = normalizeKeys(keys.filter((key) => /^[A-H]$/.test(key)));
    if (!clean.length) return null;
    return { kind: "choice", keys: type === "single" ? clean.slice(0, 1) : clean };
  }
  const allowed = options.map((option) => option.key.toUpperCase());
  const filtered = [...new Set(keys.map((key) => key.toUpperCase()))].filter((key) =>
    allowed.includes(key),
  );
  if (!filtered.length) return null;
  // 单选保留模型给出的先后顺序取第一个；多选排序去重
  const clean = type === "single" ? filtered.slice(0, 1) : filtered.slice().sort();
  const texts = clean
    .map((key) => options.find((option) => option.key.toUpperCase() === key)?.text ?? "")
    .filter(Boolean);
  return { kind: "choice", keys: clean, texts: texts.length ? texts : undefined };
}

/**
 * 从原始文本中解析出选项 key（字母或选项全文）。
 * 适用于 "A"、"AC"、"A,C"、"选项 A"、"正确"（选项为 正确/错误 时）等。
 */
export function parseChoiceKeys(
  raw: string,
  options: Option[],
  type: QuestionType,
): string[] {
  const text = stripHtml(raw).trim();
  if (!text) return [];

  if (!options.length) {
    const letters = parseAnswerLetters(text);
    const clean = normalizeKeys(letters);
    return type === "single" ? clean.slice(0, 1) : clean;
  }

  const allowed = options.map((option) => option.key.toUpperCase());
  const letters = normalizeKeys(parseAnswerLetters(text)).filter((key) => allowed.includes(key));
  if (letters.length) return type === "single" ? letters.slice(0, 1) : letters;

  // 直接命中选项 key（数字 key 等）
  const tokens = text
    .split(/[\s,，、;；|/]+/)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
  const direct = normalizeKeys(tokens.filter((token) => allowed.includes(token)));
  if (direct.length) return type === "single" ? direct.slice(0, 1) : direct;

  const optionNorm = options.map((option) => normalizeText(option.text));
  const tokenNorm = text
    .split(/[\s,，、;；|/\n]+/)
    .map((token) => normalizeText(token))
    .filter(Boolean);

  if (tokenNorm.length > 1) {
    const matched: string[] = [];
    for (const token of tokenNorm) {
      const index = optionNorm.findIndex(
        (candidate) =>
          candidate.length > 0 &&
          (candidate === token || candidate.includes(token) || token.includes(candidate)),
      );
      if (index >= 0) matched.push(options[index].key.toUpperCase());
    }
    if (matched.length) {
      const clean = normalizeKeys(matched);
      return type === "single" ? clean.slice(0, 1) : clean;
    }
  }

  // 整段答案与某个选项文本匹配（优先完全相等，其次包含）
  const wholeNorm = normalizeText(text);
  let exact: string | null = null;
  for (let i = 0; i < options.length; i++) {
    if (optionNorm[i] && optionNorm[i] === wholeNorm) {
      exact = options[i].key.toUpperCase();
      break;
    }
  }
  if (exact) return [exact];

  let best: { key: string; length: number } | null = null;
  for (let i = 0; i < options.length; i++) {
    const candidate = optionNorm[i];
    if (!candidate || candidate.length < 2) continue;
    if (wholeNorm.includes(candidate) || candidate.includes(wholeNorm)) {
      if (!best || candidate.length > best.length) {
        best = { key: options[i].key.toUpperCase(), length: candidate.length };
      }
    }
  }
  if (best) return [best.key];
  return [];
}

function parseJudgeAnswer(text: string, options: Option[]): AnswerValue | null {
  if (options.length) {
    const keys = parseChoiceKeys(text, options, "single");
    if (keys.length) {
      const option = options.find((item) => item.key.toUpperCase() === keys[0]);
      const value = option ? parseJudge(option.text) : null;
      if (value != null) return { kind: "judge", value };
    }
  }
  const value = parseJudge(text);
  return value == null ? null : { kind: "judge", value };
}

function inferAnswerValue(
  text: string,
  options: Option[],
  blankCount?: number,
): AnswerValue | null {
  if (options.length) {
    const keys = parseChoiceKeys(text, options, "multiple");
    const choice = choiceFromKeys(keys, options, options.length > 1 ? "multiple" : "single");
    if (choice) return choice;
  }
  const judgeValue = parseJudge(text);
  if (judgeValue != null) return { kind: "judge", value: judgeValue };
  const values = splitFillValues(text, blankCount);
  if (values.length > 1) return { kind: "fill", values };
  const letters = parseAnswerLetters(text);
  if (letters.length) return { kind: "choice", keys: normalizeKeys(letters) };
  if (/[\n；;|｜]/.test(text)) return { kind: "fill", values: values.length ? values : [text] };
  return { kind: "text", text };
}

/** 把纯文本答案解析为 AnswerValue */
export function parseAnswerText(raw: string, context: AnswerParseContext): AnswerValue | null {
  const text = stripHtml(String(raw ?? "")).trim();
  if (!text) return null;
  const options = resolveOptions(context.options ?? []);
  const type = context.type;

  switch (type) {
    case "judge":
      return parseJudgeAnswer(text, options);
    case "fill": {
      const values = splitFillValues(text, context.blankCount);
      return values.length ? { kind: "fill", values } : null;
    }
    case "short":
      return { kind: "text", text };
    case "single":
    case "multiple": {
      const keys = parseChoiceKeys(text, options, type);
      return choiceFromKeys(keys, options, type);
    }
    case "unknown":
    default:
      return inferAnswerValue(text, options, context.blankCount);
  }
}

/**
 * 把任意原始答案（字符串 / 数组 / 布尔 / AnswerValue 对象）解析为 AnswerValue。
 * 用于 JSON 导入、远程题库响应与 AI 返回。
 */
export function answerFromUnknown(raw: unknown, context: AnswerParseContext): AnswerValue | null {
  if (raw == null) return null;
  if (typeof raw === "boolean") {
    if (context.type === "judge" || context.type === "unknown") {
      return { kind: "judge", value: raw };
    }
    return null;
  }
  if (typeof raw === "number") return parseAnswerText(String(raw), context);
  if (typeof raw === "string") return parseAnswerText(raw, context);
  if (Array.isArray(raw)) {
    const items = raw
      .map((item) => (typeof item === "string" || typeof item === "number" ? String(item).trim() : item))
      .filter((item) => item !== "" && item != null);
    if (!items.length) return null;

    if (items.every((item) => typeof item === "string")) {
      const strings = items as string[];
      const options = resolveOptions(context.options ?? []);
      const choiceLike =
        context.type === "single" || context.type === "multiple" || context.type === "unknown";

      if (options.length && choiceLike) {
        const keys: string[] = [];
        for (const item of strings) {
          keys.push(...parseChoiceKeys(item, options, "multiple"));
        }
        const choice = choiceFromKeys(keys, options, context.type);
        if (choice) return choice;
      }
      if (context.type === "judge") {
        for (const item of strings) {
          const value = parseJudge(item);
          if (value != null) return { kind: "judge", value };
        }
        return null;
      }
      if (context.type === "short") return { kind: "text", text: strings.join("\n") };
      if (context.type === "fill") {
        const values = strings.flatMap((item) => splitFillValues(item, context.blankCount));
        if (!values.length) return null;
        return {
          kind: "fill",
          values: context.blankCount ? values.slice(0, context.blankCount) : values,
        };
      }

      const judgeValues = strings.map((item) => parseJudge(item));
      if (judgeValues.length && judgeValues.every((value) => value != null)) {
        return { kind: "judge", value: judgeValues.every(Boolean) };
      }
      const letters = strings.flatMap((item) => parseAnswerLetters(item));
      if (letters.length && letters.length === strings.length) {
        return { kind: "choice", keys: normalizeKeys(letters) };
      }
      if (strings.length > 1) return { kind: "fill", values: strings };
      return parseAnswerText(strings[0], context);
    }

    const objectItem = items.find(isRecord);
    if (objectItem) return normalizeAnswerValue(objectItem, context);
    return null;
  }
  if (isRecord(raw)) return normalizeAnswerValue(raw, context);
  return null;
}

/** 规范化已经是 AnswerValue 形状的对象 */
export function normalizeAnswerValue(
  value: unknown,
  context: AnswerParseContext,
): AnswerValue | null {
  if (!isRecord(value)) return null;
  const kind = String(value.kind ?? "").toLowerCase();
  if (kind === "choice") {
    const rawKeys = value.keys;
    const keys = Array.isArray(rawKeys)
      ? rawKeys.map((key) => String(key))
      : typeof rawKeys === "string"
        ? [rawKeys]
        : [];
    const options = resolveOptions(context.options ?? []);
    if (options.length) {
      const letters = keys.flatMap((key) => parseAnswerLetters(key));
      return choiceFromKeys(letters, options, context.type === "multiple" ? "multiple" : "single");
    }
    const letters = normalizeKeys(keys.flatMap((key) => parseAnswerLetters(key)));
    if (!letters.length) return null;
    return {
      kind: "choice",
      keys: context.type === "single" ? letters.slice(0, 1) : letters,
      texts: Array.isArray(value.texts) ? value.texts.map((text) => String(text)) : undefined,
    };
  }
  if (kind === "judge") {
    const rawValue = value.value;
    if (typeof rawValue === "boolean") return { kind: "judge", value: rawValue };
    const parsed = parseJudge(String(rawValue ?? ""));
    return parsed == null ? null : { kind: "judge", value: parsed };
  }
  if (kind === "fill") {
    const rawValues = value.values;
    const values = Array.isArray(rawValues)
      ? rawValues
          .map((item) => String(item).trim())
          .filter(Boolean)
      : splitFillValues(String(rawValues ?? ""), context.blankCount);
    if (!values.length) return null;
    return {
      kind: "fill",
      values: context.blankCount ? values.slice(0, context.blankCount) : values,
    };
  }
  if (kind === "text") {
    const text = typeof value.text === "string" ? value.text.trim() : "";
    return text ? { kind: "text", text } : null;
  }
  return null;
}

/** AnswerValue → 可读文本（用于 CSV 导出与展示） */
export function formatAnswerText(answer: AnswerValue | null | undefined): string {
  if (!answer) return "";
  switch (answer.kind) {
    case "choice":
      return answer.keys.join(",");
    case "judge":
      return answer.value ? "对" : "错";
    case "fill":
      return answer.values.join("|");
    case "text":
      return answer.text;
    default:
      return "";
  }
}

/** 深拷贝答案，避免缓存/题库条目被外部修改 */
export function cloneAnswer(answer: AnswerValue): AnswerValue {
  switch (answer.kind) {
    case "choice":
      return {
        kind: "choice",
        keys: [...answer.keys],
        texts: answer.texts ? [...answer.texts] : undefined,
      };
    case "judge":
      return { kind: "judge", value: answer.value };
    case "fill":
      return { kind: "fill", values: [...answer.values] };
    case "text":
      return { kind: "text", text: answer.text };
    default:
      return answer;
  }
}
