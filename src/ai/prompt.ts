/**
 * 中文 Prompt 构造：系统提示 + 题目序列化 + JSON 修复重试提示。
 */

import { QUESTION_TYPE_LABEL } from "../core/settings";
import type { Question } from "../core/types";
import type { ChatMessage } from "./provider";

/** 严格的 JSON 输出约束（中文） */
export const AI_SYSTEM_PROMPT = [
  "你是一名严谨的中文答题助手，负责为学习平台的练习题给出答案。",
  "你只能输出一个合法的 JSON 对象，不要输出 Markdown 代码块、解释性文字或任何 JSON 之外的内容。",
  '输出格式固定为：{"answers":[{"id":"题目 id","answer":...,"confidence":0.95,"explanation":"简要依据"}]}',
  "answer 字段规则：",
  '1. 单选题：只包含一个选项字母的数组，例如 ["A"]；',
  '2. 多选题：包含全部正确选项字母的数组，例如 ["A","C"]；',
  '3. 判断题：字符串 "对" 或 "错"；',
  '4. 填空题：按空的先后顺序给出答案数组，例如 ["第一空","第二空"]；',
  '5. 简答题：字符串，给出简洁完整的中文答案。',
  "confidence 为 0 到 1 之间的小数，表示你对答案的把握；不确定时必须给低置信度（如 0.3）。",
  "禁止编造：无法确定时给出你最有把握的答案并降低 confidence，不要虚构选项字母或知识点。",
  "不得遗漏任何题目的 id，也不得输出输入中不存在的 id。",
].join("\n");

export interface SerializedQuestion {
  id: string;
  type: string;
  typeLabel: string;
  stem: string;
  options?: string[];
  blankCount?: number;
}

/** 题目按 id / 题型 / 题干 / 选项（带字母）序列化 */
export function serializeQuestion(question: Question): SerializedQuestion {
  const item: SerializedQuestion = {
    id: question.id,
    type: question.type,
    typeLabel: QUESTION_TYPE_LABEL[question.type] ?? question.type,
    stem: question.stem,
  };
  if (question.options.length) {
    item.options = question.options.map((option) => `${option.key}. ${option.text}`);
  }
  if (question.type === "fill" && question.blankCount && question.blankCount > 0) {
    item.blankCount = question.blankCount;
  }
  return item;
}

/** 构造解题消息 */
export function buildSolveMessages(questions: Question[]): ChatMessage[] {
  const serialized = questions.map(serializeQuestion);
  const user = [
    `请作答下面 ${questions.length} 道题，只输出一个 JSON 对象。`,
    "题目数据（JSON）：",
    JSON.stringify(serialized, null, 2),
    "要求：answers 数组必须覆盖全部题目，每个元素的 id 必须与输入题目 id 一一对应；不要输出 JSON 以外的内容。",
  ].join("\n");
  return [
    { role: "system", content: AI_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/** 首次返回无法解析时，构造一次修复重试消息 */
export function buildRepairMessages(questions: Question[], rawResponse: string): ChatMessage[] {
  const raw = String(rawResponse ?? "");
  const truncated = raw.length > 6000 ? `${raw.slice(0, 6000)}…` : raw;
  const user = [
    "你上一次的回答不是合法的 JSON，无法被程序解析。",
    "请根据下面的题目重新作答，并且只输出一个合法 JSON 对象（不要 Markdown 代码块、不要任何解释文字）。",
    "题目数据（JSON）：",
    JSON.stringify(questions.map(serializeQuestion), null, 2),
    "上一次的回答（可能已被截断）：",
    truncated,
  ].join("\n");
  return [
    { role: "system", content: AI_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
