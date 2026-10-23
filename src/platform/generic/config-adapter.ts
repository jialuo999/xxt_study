/**
 * 通用配置适配器：用户通过设置里的 GenericAdapterConfig 自定义选择器，
 * 适配学习通之外的平台（或学习通改版后的临时方案）。
 *
 * 选择器思路参考 https://github.com/CodFrm/cxmooc-tools （MIT License），
 * 本项目为独立实现，未复制其源码。
 *
 * 这是“最小可用”实现：只做选择器驱动的采集/填答/翻页/提交，
 * 不做平台特有的复杂结构推断；任何异常都转成返回值，不向页面抛出。
 */
import type {
  AnswerValue,
  FillResult,
  NextResult,
  PageInfo,
  PageKind,
  Question,
  QuestionType,
  SubmitResult,
} from "../../core/types";
import type { GenericAdapterConfig } from "../../core/settings";
import type { FillOptions, PageContext, PlatformAdapter, SubmitOptions } from "../types";
import { logger } from "../../core/logger";
import { jitter, sleep } from "../../utils/async";
import {
  clickElement,
  clickInputLabel,
  queryAll,
  queryFirst,
  setNativeValue,
  textOf,
} from "../../utils/dom";
import {
  formatAnswer,
  hashString,
  normalizeOption,
  parseJudge,
  splitFillValues,
  textSimilarity,
} from "../../utils/text";

const DEFAULT_DELAY: [number, number] = [120, 320];
const TEXT_MATCH_THRESHOLD = 0.72;
const MAX_RETRIES = 1;
const SUBMIT_TIMEOUT_MS = 3000;

const NAME_KIND_HINTS: ReadonlyArray<readonly [PageKind, RegExp]> = [
  ["homework", /作业|homework/i],
  ["exam", /考试|exam/i],
  ["quiz", /测验|quiz/i],
  ["video", /视频|video/i],
  ["chapter", /章节|chapter/i],
  ["cards", /卡片|cards?/i],
];

const TYPE_PATTERNS: ReadonlyArray<readonly [QuestionType, RegExp]> = [
  ["multiple", /(多项选择|多选题|多选|不定项)/],
  ["single", /(单项选择|单选题|单选)/],
  ["judge", /(判断题|判断)/],
  ["fill", /(填空题|填空)/],
  ["short", /(简答题|简答|论述|名词解释|问答)/],
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function typeFromText(text: string): QuestionType | null {
  for (const [type, pattern] of TYPE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return null;
}

function currentUrl(ctx: PageContext): string {
  try {
    return ctx.win.location?.href ?? ctx.doc.URL ?? "";
  } catch {
    return "";
  }
}

function letterFromText(text: string, fallbackIndex: number): string {
  const match = /^\s*[（(]?\s*([A-Ha-h])\s*[)）.．、:：]/.exec(text);
  if (match) return match[1].toUpperCase();
  return String.fromCharCode(65 + fallbackIndex);
}

interface GenericOption {
  key: string;
  text: string;
  element: HTMLElement;
  input: HTMLInputElement | null;
}

interface GenericEntry {
  question: Question;
  element: HTMLElement;
  options: GenericOption[];
}

/** 判断 URL 是否命中配置中的匹配规则 */
function createMatcher(config: GenericAdapterConfig): (url: URL) => boolean {
  return (url: URL): boolean => {
    try {
      const href = url.href;
      const path = url.pathname;
      return config.matches.some((pattern) => {
        const rule = (pattern ?? "").trim();
        if (!rule) return false;
        if (rule.startsWith("re:")) {
          try {
            return new RegExp(rule.slice(3)).test(href);
          } catch {
            return false;
          }
        }
        return href.includes(rule) || path.includes(rule);
      });
    } catch {
      return false;
    }
  };
}

function kindFromName(name: string): PageKind {
  for (const [kind, pattern] of NAME_KIND_HINTS) {
    if (pattern.test(name)) return kind;
  }
  return "unknown";
}

function collectEntries(doc: Document, frameId: string, config: GenericAdapterConfig): GenericEntry[] {
  const entries: GenericEntry[] = [];
  if (!config.questionContainer) return entries;

  const containers = queryAll<HTMLElement>(doc, [config.questionContainer]);
  let index = 0;
  for (const container of containers) {
    try {
      const stemElement = config.stem ? queryFirst<HTMLElement>(container, [config.stem]) : null;
      const stem = (textOf(stemElement) || textOf(container)).trim();
      if (!stem) continue;

      const options: GenericOption[] = [];
      if (config.options) {
        const optionElements = queryAll<HTMLElement>(container, [config.options]);
        optionElements.forEach((element, optionIndex) => {
          const input = element.querySelector<HTMLInputElement>(
            "input[type='radio'], input[type='checkbox']",
          );
          const textElement = config.optionText
            ? queryFirst<HTMLElement>(element, [config.optionText])
            : null;
          const rawText = textOf(textElement) || textOf(element);
          const text = normalizeOption(rawText);
          if (!text) return;
          options.push({
            key: letterFromText(rawText, optionIndex),
            text,
            element,
            input,
          });
        });
      }

      const typeLabelText = config.typeLabel
        ? textOf(queryFirst<HTMLElement>(container, [config.typeLabel]))
        : "";
      const inputs = queryAll<HTMLInputElement>(container, [
        "input[type='radio']",
        "input[type='checkbox']",
      ]);
      const type =
        typeFromText(typeLabelText) ??
        typeFromText(stem) ??
        (inputs.some((input) => input.type === "checkbox")
          ? "multiple"
          : inputs.length > 0
            ? "single"
            : queryAll(container, ["textarea", "input[type='text']"]).length > 0
              ? "fill"
              : "unknown");

      const question: Question = {
        id: `${frameId}-${index}-${hashString(stem).slice(0, 8)}`,
        type,
        stem,
        options: options.map((option) => ({ key: option.key, text: option.text })),
        hasImage: Boolean(queryFirst(container, ["img"])),
        frameId,
        index,
      };
      entries.push({ question, element: container, options });
      index += 1;
    } catch {
      continue;
    }
  }
  return entries;
}

function findEntry(
  ctx: PageContext,
  question: Question,
  config: GenericAdapterConfig,
): GenericEntry | null {
  const entries = collectEntries(ctx.doc, ctx.frameId, config);
  return entries.find((entry) => entry.question.id === question.id) ?? entries[question.index] ?? null;
}

function readCheckedKeys(entry: GenericEntry): string[] | null {
  const withInput = entry.options.filter((option) => option.input);
  if (withInput.length === 0) return null;
  return withInput.filter((option) => option.input?.checked).map((option) => option.key);
}

function sameKeySet(left: string[], right: string[]): boolean {
  const a = new Set(left.map((item) => item.toUpperCase()));
  const b = new Set(right.map((item) => item.toUpperCase()));
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

async function pause(delay: readonly [number, number]): Promise<void> {
  await sleep(jitter(delay[0], delay[1]));
}

async function setChecked(
  option: GenericOption,
  checked: boolean,
  delay: readonly [number, number],
): Promise<void> {
  const input = option.input;
  if (!input) {
    if (checked) {
      clickElement(option.element);
      await pause(delay);
    }
    return;
  }
  if (input.checked === checked) return;
  clickInputLabel(input, option.element);
  if (input.checked !== checked) clickElement(input);
  if (input.checked !== checked) clickElement(option.element);
  await pause(delay);
}

async function applyChoice(
  entry: GenericEntry,
  answer: { keys: string[]; texts?: string[] },
  delay: readonly [number, number],
  dryRun: boolean,
): Promise<FillResult> {
  const questionId = entry.question.id;
  const expected = answer.keys.length > 0 ? answer.keys.join("") : (answer.texts ?? []).join(" / ");
  const targets: GenericOption[] = [];
  for (const key of answer.keys) {
    const matched = entry.options.find(
      (option) => option.key.toUpperCase() === key.trim().toUpperCase(),
    );
    if (matched && !targets.includes(matched)) targets.push(matched);
  }
  for (const text of answer.texts ?? []) {
    if (!text.trim()) continue;
    let best: GenericOption | null = null;
    let bestScore = 0;
    for (const option of entry.options) {
      if (targets.includes(option)) continue;
      const score = textSimilarity(text, option.text);
      if (score > bestScore) {
        bestScore = score;
        best = option;
      }
    }
    if (best && bestScore >= TEXT_MATCH_THRESHOLD) targets.push(best);
  }

  if (dryRun) {
    return {
      questionId,
      ok: targets.length > 0,
      expected,
      actual: "",
      message: targets.length > 0 ? `dryRun：计划选择 ${targets.map((o) => o.key).join("、")}` : "dryRun：未匹配到选项",
    };
  }
  if (targets.length === 0) {
    return { questionId, ok: false, expected, message: "未匹配到任何选项" };
  }

  for (const target of targets) await setChecked(target, true, delay);
  if (entry.question.type === "multiple") {
    for (const option of entry.options) {
      if (targets.includes(option) || !option.input) continue;
      if (option.input.checked) await setChecked(option, false, delay);
    }
  }

  const checked = readCheckedKeys(entry);
  if (checked === null) {
    return {
      questionId,
      ok: true,
      expected,
      actual: targets.map((o) => o.key).join(""),
      message: "已点击选项（无原生 input，无法回读）",
    };
  }
  return {
    questionId,
    ok: sameKeySet(checked, targets.map((o) => o.key)),
    expected,
    actual: checked.join(""),
    message: "选项已勾选",
  };
}

async function applyJudge(
  entry: GenericEntry,
  value: boolean,
  delay: readonly [number, number],
  dryRun: boolean,
): Promise<FillResult> {
  const questionId = entry.question.id;
  const expected = value ? "正确" : "错误";
  const target = entry.options.find((option) => parseJudge(option.text) === value) ?? null;
  if (dryRun) {
    return { questionId, ok: target !== null, expected, actual: "", message: "dryRun：判断题计划" };
  }
  if (!target) return { questionId, ok: false, expected, message: "未找到对应判断选项" };
  await setChecked(target, true, delay);
  const checked = readCheckedKeys(entry);
  if (checked === null) {
    return { questionId, ok: true, expected, actual: target.text, message: "已点击判断选项" };
  }
  const ok = checked.includes(target.key);
  return {
    questionId,
    ok,
    expected,
    actual: checked.join(""),
    message: ok ? "判断题已选择" : "判断题回读不一致",
  };
}

async function applyFill(
  entry: GenericEntry,
  values: string[],
  delay: readonly [number, number],
  dryRun: boolean,
): Promise<FillResult> {
  const questionId = entry.question.id;
  const expected = values.join(" | ");
  const blanks = queryAll<HTMLInputElement | HTMLTextAreaElement>(entry.element, [
    "input[type='text']",
    "input:not([type])",
    "textarea",
  ]);
  // 与学习通适配器保持一致：数量不一致不再静默成功
  const countMismatch = values.length !== blanks.length;
  if (values.length > blanks.length) {
    logger.warn(
      "generic",
      `填空题答案多于页面空数：答案 ${values.length} 空 / 页面 ${blanks.length} 空，多余答案被忽略`,
      { questionId },
    );
  }
  if (dryRun) {
    return {
      questionId,
      ok: blanks.length > 0 && values.length > 0 && !countMismatch,
      expected,
      actual: "",
      message:
        blanks.length === 0
          ? "dryRun：未找到填空输入框"
          : countMismatch
            ? `dryRun：答案 ${values.length} 空 / 页面 ${blanks.length} 空，数量不一致`
            : `dryRun：计划填写 ${values.length} 个空`,
    };
  }
  if (blanks.length === 0) return { questionId, ok: false, expected, message: "未找到填空输入框" };
  const limit = Math.min(values.length, blanks.length);
  for (let index = 0; index < limit; index += 1) {
    setNativeValue(blanks[index], values[index] ?? "");
    await pause(delay);
  }
  // 回读全部空位（含未填项）
  const actual = blanks.map((blank) => blank.value);
  const readbackOk =
    actual.length === values.length &&
    actual.every((item, index) => item.trim() === (values[index] ?? "").trim());
  return {
    questionId,
    ok: !countMismatch && readbackOk,
    expected,
    actual: actual.join(" | "),
    message: countMismatch
      ? `填空数量不一致：答案 ${values.length} 空 / 页面 ${blanks.length} 空`
      : readbackOk
        ? "已填写填空"
        : "填空回读不一致",
  };
}

async function applyText(
  entry: GenericEntry,
  text: string,
  delay: readonly [number, number],
  dryRun: boolean,
): Promise<FillResult> {
  const questionId = entry.question.id;
  const target =
    queryFirst<HTMLElement>(entry.element, ["[contenteditable='true']", "textarea", "input[type='text']"]) ??
    null;
  if (dryRun) {
    return { questionId, ok: target !== null, expected: text, actual: "", message: "dryRun：简答计划" };
  }
  if (!target) return { questionId, ok: false, expected: text, message: "未找到简答输入框" };

  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    setNativeValue(target, text);
    await pause(delay);
    return {
      questionId,
      ok: target.value.trim() === text.trim(),
      expected: text,
      actual: target.value,
      message: "已填写简答题",
    };
  }
  target.textContent = text;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  await pause(delay);
  return {
    questionId,
    ok: (target.textContent ?? "").trim() === text.trim(),
    expected: text,
    actual: target.textContent ?? "",
    message: "已填写简答题",
  };
}

/* ------------------------------------------------------------------ */
/* 提交结果判定（URL 判定口径与学习通适配器一致；验证码 DOM 检测       */
/* 属于平台特有逻辑，由具体平台适配器负责）                            */
/* ------------------------------------------------------------------ */

/** 登录/风控页 URL 特征：命中时即使 URL 变化也不能判提交成功 */
const AUTH_URL_PATTERN =
  /(?:^|[/._-])(?:passport|login|logon|sso|cas|captcha|verify)(?:[/._-]|$)/i;

/** 结果页 URL 特征：只看 pathname，query 里的 success=0 之类不能当成成功信号 */
const RESULT_URL_PATTERN =
  /(?:^|[/._-])(?:result|results|score|scores|finish|finished|complete|completed|success|submitted)(?:[/._-]|$)|\/work\/(?:selectWorkQuestionYiPiYue|selectWorkQuestion|dowork\/result)|\/exam-ans\/exam\/(?:test\/)?(?:reVersionPaperMarkContentNew|result)/i;

/** 提交后结果文本关键字（与学习通侧措辞保持一致，供通用平台复用） */
const RESULT_TEXT_KEYWORDS = ["提交成功", "交卷成功", "成绩", "已完成", "已提交"] as const;

/** URL 比较忽略 hash：页面里的 #anchor 跳转不代表提交成功 */
function comparableUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url;
  }
}

/** 日志用 URL：只保留 origin + pathname，去掉 query/hash 等可能含敏感信息的参数 */
function sanitizedUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split("?")[0].split("#")[0];
  }
}

function isAuthUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return AUTH_URL_PATTERN.test(`${parsed.hostname}${parsed.pathname}`);
  } catch {
    return AUTH_URL_PATTERN.test(url);
  }
}

function isResultPageUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return RESULT_URL_PATTERN.test(parsed.pathname);
  } catch {
    return RESULT_URL_PATTERN.test(url);
  }
}

function findNewResultKeyword(beforeText: string, currentText: string): string | null {
  for (const keyword of RESULT_TEXT_KEYWORDS) {
    if (currentText.includes(keyword) && !beforeText.includes(keyword)) return keyword;
  }
  return null;
}

function createAdapter(config: GenericAdapterConfig): PlatformAdapter {
  const label = config.name?.trim() || "通用适配器";
  const matches = createMatcher(config);

  const detectPage = (doc: Document, url?: URL): PageInfo => {
    try {
      const href = url?.href ?? doc.location?.href ?? doc.URL ?? "";
      const resolved = url ?? new URL(href);
      const matched = matches(resolved);
      const kind = matched ? kindFromName(label) : "unknown";
      return {
        kind,
        url: href,
        title: doc.title ?? "",
        supported: matched,
        reason: matched ? `命中通用配置「${label}」` : "未命中通用配置的 URL 规则",
      };
    } catch {
      return { kind: "unknown", url: "", title: "", supported: false, reason: "通用适配器识别异常" };
    }
  };

  const collectQuestions = (ctx: PageContext): Question[] =>
    collectEntries(ctx.doc, ctx.frameId, config).map((entry) => entry.question);

  const fillAnswer = async (
    ctx: PageContext,
    question: Question,
    answer: AnswerValue,
    options?: FillOptions,
  ): Promise<FillResult> => {
    const delay: [number, number] = options?.delayMs ?? DEFAULT_DELAY;
    const dryRun = options?.dryRun === true;
    let last: FillResult = {
      questionId: question.id,
      ok: false,
      expected: formatAnswer(answer),
      message: "未执行",
    };
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const entry = findEntry(ctx, question, config);
        if (!entry) {
          last = { questionId: question.id, ok: false, message: "未找到题目容器" };
        } else if (answer.kind === "choice") {
          last = await applyChoice(entry, answer, delay, dryRun);
        } else if (answer.kind === "judge") {
          last = await applyJudge(entry, answer.value, delay, dryRun);
        } else if (answer.kind === "fill") {
          last = await applyFill(entry, answer.values, delay, dryRun);
        } else if (answer.kind === "text") {
          last =
            entry.question.type === "fill"
              ? await applyFill(entry, splitFillValues(answer.text, entry.question.blankCount), delay, dryRun)
              : await applyText(entry, answer.text, delay, dryRun);
        } else {
          last = { questionId: question.id, ok: false, message: "不支持的答案类型" };
        }
      } catch (error) {
        last = { questionId: question.id, ok: false, message: `填答异常：${errorText(error)}` };
      }
      if (last.ok || dryRun) return last;
      if (attempt < MAX_RETRIES) await pause(delay);
    }
    return last;
  };

  const submit = async (ctx: PageContext, _options?: SubmitOptions): Promise<SubmitResult> => {
    try {
      if (!config.submitButton) return { ok: false, message: "未配置提交按钮选择器" };
      const button = queryFirst<HTMLElement>(ctx.doc, [config.submitButton]);
      if (!button) return { ok: false, message: "未找到提交按钮，请手动提交" };
      const beforeUrl = currentUrl(ctx);
      const beforeText = textOf(ctx.doc.body);
      if (!clickElement(button)) return { ok: false, message: "点击提交按钮失败" };

      const startedAt = Date.now();
      // 记录“已跳转但无法确认结果”的 URL：超时时优先返回该地址
      let redirectedTo: string | null = null;
      while (Date.now() - startedAt < SUBMIT_TIMEOUT_MS) {
        const url = currentUrl(ctx);
        const changed = Boolean(
          url && beforeUrl && comparableUrl(url) !== comparableUrl(beforeUrl),
        );
        if (changed) {
          redirectedTo = url;
          // 登录/验证码跳转：明确不代表提交成功
          if (isAuthUrl(url)) {
            logger.debug(
              "generic",
              `提交后跳转到登录/验证页，不判成功：${sanitizedUrl(beforeUrl)} → ${sanitizedUrl(url)}`,
            );
            return {
              ok: false,
              message: "提交后页面跳转到登录/验证页，提交状态未知，请人工确认",
              url,
            };
          }
          // 只有命中结果页特征才按“跳转”判成功
          if (isResultPageUrl(url)) {
            logger.debug(
              "generic",
              `提交后跳转到结果页：${sanitizedUrl(beforeUrl)} → ${sanitizedUrl(url)}`,
            );
            return { ok: true, message: "已提交（页面已跳转至结果页）", url };
          }
          logger.debug(
            "generic",
            `提交后 URL 变化但未命中结果页特征：${sanitizedUrl(beforeUrl)} → ${sanitizedUrl(url)}`,
          );
        }
        const currentText = textOf(ctx.doc.body);
        const keyword = findNewResultKeyword(beforeText, currentText);
        if (keyword) {
          return { ok: true, message: `检测到提交结果：${keyword}`, url: currentUrl(ctx) };
        }
        await sleep(250);
      }
      if (redirectedTo) {
        return {
          ok: false,
          message: "页面已跳转但未检测到提交结果，提交状态未知，请人工确认",
          url: redirectedTo,
        };
      }
      return {
        ok: false,
        message: "已点击提交按钮，提交状态未知，请人工确认",
        url: currentUrl(ctx),
      };
    } catch (error) {
      return { ok: false, message: `提交异常：${errorText(error)}`, url: currentUrl(ctx) };
    }
  };

  const nextPage = async (ctx: PageContext): Promise<NextResult> => {
    try {
      if (!config.nextButton) {
        return { ok: false, action: "none", message: "未配置下一节按钮选择器", url: currentUrl(ctx) };
      }
      const button = queryFirst<HTMLElement>(ctx.doc, [config.nextButton]);
      if (!button) return { ok: false, action: "none", message: "未找到下一节按钮", url: currentUrl(ctx) };
      if (!clickElement(button)) return { ok: false, action: "none", message: "点击下一节按钮失败", url: currentUrl(ctx) };
      return { ok: true, action: `click:${config.nextButton}`, message: "已点击下一节", url: currentUrl(ctx) };
    } catch (error) {
      return { ok: false, action: "none", message: `翻页异常：${errorText(error)}`, url: currentUrl(ctx) };
    }
  };

  return {
    id: "generic",
    label,
    matches,
    detectPage,
    collectQuestions,
    fillAnswer,
    submit,
    nextPage,
  };
}

export function createConfigAdapter(config: GenericAdapterConfig): PlatformAdapter {
  return createAdapter(config);
}
