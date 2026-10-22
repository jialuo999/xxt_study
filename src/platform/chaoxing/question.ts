/**
 * 学习通题目采集：容器、题干、选项、题型识别。
 *
 * 选择器思路参考 https://github.com/CodFrm/cxmooc-tools （MIT License），
 * 本项目为独立实现，未复制其源码。
 *
 * 设计原则：
 * - 每个 DOM 访问都判空，识别过程包在 try/catch 里，绝不把异常抛到页面；
 * - 选择器全部使用候选数组，单个选择器失效不影响其他候选；
 * - 返回的题目顺序即页面顺序，index 从 0 开始。
 */
import type { Option, Question, QuestionType } from "../../core/types";
import { hashString, normalizeOption, normalizeText, parseJudge } from "../../utils/text";
import { queryAll, queryFirst, textOf } from "../../utils/dom";
import {
  BLANK_SELECTORS,
  OPTION_HOLDER_SELECTOR,
  OPTION_INPUT_SELECTORS,
  OPTION_SELECTORS,
  QUESTION_CONTAINER_SELECTOR,
  QUESTION_CONTAINER_SELECTORS,
  STEM_SELECTORS,
  TEXT_INPUT_SELECTORS,
  TITLE_SELECTORS,
  TYPE_LABEL_SELECTORS,
} from "./selectors";

/** 采集阶段识别出的 DOM 选项，fill 阶段直接复用（含元素引用） */
export interface DomOption {
  key: string;
  text: string;
  element: HTMLElement;
  input: HTMLInputElement | null;
  /** 选项文本能判定为“对/错”时给出布尔值，否则 null */
  judgeValue: boolean | null;
  hasImage: boolean;
}

/** 题目 + 原始 DOM 容器，供 fill 阶段重新定位元素 */
export interface QuestionEntry {
  question: Question;
  element: HTMLElement;
  options: DomOption[];
}

/** 简答/富文本输入目标 */
export interface TextTarget {
  element: HTMLElement;
  mode: "value" | "contenteditable";
}

const LEADING_INDEX = /^\s*(?:第\s*)?\d+\s*[、.．)）]\s*/;
const LEADING_TYPE_TAG =
  /^\s*[【\[(（]\s*(?:单项选择|多项选择|不定项选择|单选|多选|判断|填空|简答|论述|名词解释)题?\s*[】\])）]\s*/;

/** 非文本标记的 input 类型，填答/填空时排除 */
const NON_TEXT_INPUT_TYPES = new Set([
  "radio",
  "checkbox",
  "hidden",
  "file",
  "submit",
  "button",
  "reset",
  "image",
  "range",
  "color",
]);

const TYPE_PATTERNS: ReadonlyArray<readonly [QuestionType, RegExp]> = [
  ["multiple", /(多项选择|多选题|多选|不定项)/],
  ["single", /(单项选择|单选题|单选)/],
  ["judge", /(判断题|判断)/],
  ["fill", /(填空题|填空)/],
  ["short", /(简答题|简答|论述题|论述|名词解释|问答题|问答)/],
];

/** 去掉题干开头的序号与题型标签，保留正文 */
export function cleanStem(raw: string): string {
  let text = raw.replace(/\u00a0/g, " ").trim();
  text = text.replace(LEADING_INDEX, "");
  text = text.replace(LEADING_TYPE_TAG, "");
  return text.trim();
}

/** 从任意文本中识别题型（用于题型标签文本） */
export function typeFromText(text: string): QuestionType | null {
  if (!text) return null;
  for (const [type, pattern] of TYPE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return null;
}

function keepInnermost(elements: HTMLElement[]): HTMLElement[] {
  return elements.filter(
    (element) => !elements.some((other) => other !== element && element.contains(other)),
  );
}

function keepOutermost(elements: HTMLElement[]): HTMLElement[] {
  return elements.filter(
    (element) => !elements.some((other) => other !== element && other.contains(element)),
  );
}

/** 按文档顺序排序（queryAll 会按选择器分组返回，需要还原页面顺序） */
function sortByDocumentOrder<T extends Element>(elements: T[]): T[] {
  return [...elements].sort((left, right) => {
    if (left === right) return 0;
    const position = left.compareDocumentPosition(right);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

/** 找出页面上的题目容器，返回文档顺序、最内层容器 */
export function findQuestionContainers(doc: Document): HTMLElement[] {
  let containers = queryAll<HTMLElement>(doc, [QUESTION_CONTAINER_SELECTOR]);
  if (containers.length === 0) {
    containers = queryAll<HTMLElement>(doc, [...QUESTION_CONTAINER_SELECTORS]);
  }
  return keepInnermost(sortByDocumentOrder(containers));
}

function extractStem(container: HTMLElement): string {
  for (const selector of STEM_SELECTORS) {
    const text = cleanStem(textOf(queryFirst<HTMLElement>(container, [selector])));
    if (text) return text;
  }
  const fallback = queryFirst<HTMLElement>(container, [":scope > .clearfix", "h1", "h2", "h3"]);
  return cleanStem(textOf(fallback));
}

function bracketType(text: string): QuestionType | null {
  const match = /[【\[(（]\s*([^】\])）]{1,12}?)\s*[】\])）]/.exec(text);
  return match ? typeFromText(match[1]) : null;
}

/** 题型标签优先判定（单选/多选/判断/填空/简答） */
export function detectTypeLabel(container: HTMLElement): QuestionType | null {
  for (const selector of TYPE_LABEL_SELECTORS) {
    const text = textOf(queryFirst<HTMLElement>(container, [selector]));
    if (!text) continue;
    const type = bracketType(text) ?? typeFromText(text);
    if (type) return type;
  }
  for (const selector of TITLE_SELECTORS) {
    const text = textOf(queryFirst<HTMLElement>(container, [selector]));
    if (!text) continue;
    const type = bracketType(text);
    if (type) return type;
  }
  return null;
}

function cleanOptionText(holder: HTMLElement, input: HTMLInputElement | null): string {
  const own = normalizeOption(textOf(holder));
  if (own) return own;
  const parent = holder.parentElement;
  const fromParent = parent ? normalizeOption(textOf(parent)) : "";
  if (fromParent) return fromParent;
  if (input) {
    const fromSibling = normalizeOption(textOf(input.nextElementSibling));
    if (fromSibling) return fromSibling;
  }
  return "";
}

function deriveOptionKey(input: HTMLInputElement, holder: HTMLElement, index: number): string {
  const value = (input.value ?? "").trim();
  if (/^[A-Ha-h]$/.test(value)) return value.toUpperCase();
  const fromHolder = /^\s*[（(]?\s*([A-Ha-h])\s*[)）.．、:：]/.exec(textOf(holder));
  if (fromHolder) return fromHolder[1].toUpperCase();
  const fromSibling = /^\s*[（(]?\s*([A-Ha-h])\s*[)）.．:：、]/.exec(textOf(input.nextElementSibling));
  if (fromSibling) return fromSibling[1].toUpperCase();
  return String.fromCharCode(65 + index);
}

function deriveTextOptionKey(holder: HTMLElement, index: number): string {
  const match = /^\s*[（(]?\s*([A-Ha-h])\s*[)）.．、:：]/.exec(textOf(holder));
  if (match) return match[1].toUpperCase();
  return String.fromCharCode(65 + index);
}

/** 采集题目选项：优先跟随原生 input，其次退回文本型选项 */
export function extractOptions(container: HTMLElement): DomOption[] {
  const inputs = queryAll<HTMLInputElement>(container, [...OPTION_INPUT_SELECTORS]).filter(
    (input) => input.type === "radio" || input.type === "checkbox",
  );

  if (inputs.length > 0) {
    const options: DomOption[] = [];
    const seenHolders = new Set<Element>();
    inputs.forEach((input, index) => {
      const holder =
        (input.closest(OPTION_HOLDER_SELECTOR) as HTMLElement | null) ?? input.parentElement;
      if (!holder || seenHolders.has(holder)) return;
      seenHolders.add(holder);
      const text = cleanOptionText(holder, input);
      const hasImage = Boolean(holder.querySelector("img"));
      if (!text && !hasImage) return;
      options.push({
        key: deriveOptionKey(input, holder, index),
        text,
        element: holder,
        input,
        judgeValue: parseJudge(text),
        hasImage,
      });
    });
    if (options.length > 0) return options;
  }

  const holders = keepOutermost(
    sortByDocumentOrder(queryAll<HTMLElement>(container, [...OPTION_SELECTORS])),
  );
  const options: DomOption[] = [];
  let index = 0;
  for (const holder of holders) {
    if (holder.querySelector("input[type='radio'], input[type='checkbox']")) continue;
    const hasImage = Boolean(holder.querySelector("img"));
    const text = normalizeOption(textOf(holder));
    if (!text && !hasImage) continue;
    options.push({
      key: deriveTextOptionKey(holder, index),
      text,
      element: holder,
      input: null,
      judgeValue: parseJudge(text),
      hasImage,
    });
    index += 1;
  }
  return options;
}

/** 填空输入框：排除 radio/checkbox/hidden 等非文本控件，按文档顺序返回 */
export function findBlankInputs(
  container: ParentNode,
): Array<HTMLInputElement | HTMLTextAreaElement> {
  const found = queryAll<HTMLInputElement | HTMLTextAreaElement>(container, [...BLANK_SELECTORS]);
  const filtered = found.filter((element) => {
    if (element.disabled) return false;
    if (element instanceof HTMLInputElement) {
      const type = (element.type ?? "text").toLowerCase();
      return !NON_TEXT_INPUT_TYPES.has(type);
    }
    return true;
  });
  return sortByDocumentOrder(filtered);
}

/** 简答/富文本输入目标：contenteditable → textarea → 文本 input → UE iframe */
export function findTextTarget(container: HTMLElement): TextTarget | null {
  const editable = queryFirst<HTMLElement>(container, [...TEXT_INPUT_SELECTORS]);
  if (editable) return { element: editable, mode: "contenteditable" };

  const textarea = queryFirst<HTMLTextAreaElement>(container, ["textarea"]);
  if (textarea) return { element: textarea, mode: "value" };

  const input = queryFirst<HTMLInputElement>(container, ["input[type='text']", "input:not([type])"]);
  if (input && !NON_TEXT_INPUT_TYPES.has((input.type || "text").toLowerCase())) {
    return { element: input, mode: "value" };
  }

  for (const iframe of queryAll<HTMLIFrameElement>(container, ["iframe"])) {
    try {
      const body = iframe.contentDocument?.body;
      if (!body) continue;
      const contentEditable = body.getAttribute("contenteditable");
      if (contentEditable !== null && contentEditable !== "false") {
        return { element: body, mode: "contenteditable" };
      }
      const editableChild = body.querySelector<HTMLElement>("[contenteditable='true']");
      if (editableChild) return { element: editableChild, mode: "contenteditable" };
    } catch {
      /* 跨域 iframe：由 frame agent 处理 */
    }
  }
  return null;
}

function countBlankMarkers(stem: string): number {
  const matches = stem.match(/_{2,}|＿{2,}|（\s{2,}）|\(\s{2,}\)/g);
  return matches ? matches.length : 0;
}

function countBlanks(stem: string, container: HTMLElement): number {
  const fromStem = countBlankMarkers(stem);
  const fromInputs = findBlankInputs(container).length;
  return Math.max(fromStem, fromInputs);
}

/** 题型判定：标签文本优先，input 类型兜底 */
export function classifyType(
  container: HTMLElement,
  options: DomOption[],
  inputs: readonly HTMLInputElement[],
): QuestionType {
  const labelType = detectTypeLabel(container);
  if (labelType) return labelType;

  const radios = inputs.filter((input) => input.type === "radio");
  if (radios.length > 0) {
    const judgeValues = options.map((option) => option.judgeValue).filter((value) => value !== null);
    if (options.length === 2 && judgeValues.length === 2 && judgeValues[0] !== judgeValues[1]) {
      return "judge";
    }
    return "single";
  }
  if (inputs.some((input) => input.type === "checkbox")) return "multiple";
  if (findBlankInputs(container).length > 0) return "fill";
  return "unknown";
}

function buildEntry(
  container: HTMLElement,
  frameId: string,
  index: number,
): QuestionEntry | null {
  const stem = extractStem(container);
  if (!stem) return null;

  const options = extractOptions(container);
  const inputs = queryAll<HTMLInputElement>(container, [...OPTION_INPUT_SELECTORS]);
  const type = classifyType(container, options, inputs);
  const questionOptions: Option[] = options.map((option) => ({ key: option.key, text: option.text }));
  const blankCount = type === "fill" ? countBlanks(stem, container) : 0;
  const question: Question = {
    id: `${frameId}-${index}-${hashString(stem).slice(0, 8)}`,
    type,
    stem,
    options: questionOptions,
    blankCount: blankCount > 0 ? blankCount : undefined,
    hasImage: Boolean(queryFirst(container, ["img"])),
    frameId,
    index,
  };
  return { question, element: container, options };
}

/** 采集当前 frame 的所有题目（含 DOM 引用） */
export function collectQuestionEntries(doc: Document, frameId = "top"): QuestionEntry[] {
  const entries: QuestionEntry[] = [];
  const seen = new Set<string>();
  const containers = findQuestionContainers(doc);
  let index = 0;
  for (const container of containers) {
    try {
      const built = buildEntry(container, frameId, index);
      if (!built) continue;
      const signature = `${normalizeText(built.question.stem)}#${built.options
        .map((option) => normalizeOption(option.text))
        .join("|")}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      entries.push(built);
      index += 1;
    } catch {
      continue;
    }
  }
  return entries;
}

/** 采集当前 frame 的题目并转为纯数据 */
export function collectQuestions(doc: Document, frameId = "top"): Question[] {
  return collectQuestionEntries(doc, frameId).map((entry) => entry.question);
}

/** 填答时重新定位题目容器：优先 id，其次题干归一化文本，最后 index */
export function findQuestionEntry(
  doc: Document,
  frameId: string,
  question: Question,
): QuestionEntry | null {
  const entries = collectQuestionEntries(doc, frameId);
  const byId = entries.find((entry) => entry.question.id === question.id);
  if (byId) return byId;

  const targetStem = normalizeText(question.stem);
  if (targetStem) {
    const byStem = entries.find((entry) => normalizeText(entry.question.stem) === targetStem);
    if (byStem) return byStem;
  }
  return entries[question.index] ?? null;
}
