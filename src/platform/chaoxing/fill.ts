/**
 * 学习通填答：选择 / 判断 / 填空 / 简答。
 *
 * 选择器思路参考 https://github.com/CodFrm/cxmooc-tools （MIT License），
 * 本项目为独立实现，未复制其源码。
 *
 * 约定：
 * - 选项按 key 优先匹配，匹配不到时再用 textSimilarity 做文本兜底；
 * - 只点击命中项，不按位置盲选；多选会清掉多余的勾选；
 * - 每次点击/输入之间用 jitter 随机间隔（默认 [120, 320]ms）；
 * - 回读校验失败最多重试 2 次，异常一律转成 FillResult，不向页面抛出。
 */
import type { AnswerValue, FillResult, Question } from "../../core/types";
import type { FillOptions, PageContext } from "../types";
import { logger } from "../../core/logger";
import { jitter, sleep } from "../../utils/async";
import { clickElement, clickInputLabel, setNativeValue, textOf } from "../../utils/dom";
import { formatAnswer, splitFillValues, textSimilarity } from "../../utils/text";
import {
  findBlankInputs,
  findQuestionEntry,
  findTextTarget,
  type DomOption,
  type QuestionEntry,
} from "./question";

const DEFAULT_DELAY: [number, number] = [120, 320];
const MAX_RETRIES = 2;
/** 文本兜底匹配阈值：低于该值视为没有命中 */
const TEXT_MATCH_THRESHOLD = 0.72;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameKeySet(left: string[], right: string[]): boolean {
  const a = new Set(left.map((item) => item.trim().toUpperCase()).filter(Boolean));
  const b = new Set(right.map((item) => item.trim().toUpperCase()).filter(Boolean));
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

/** 当前已勾选的选项 key；页面没有原生 input 时返回 null */
function readCheckedKeys(entry: QuestionEntry): string[] | null {
  const withInput = entry.options.filter((option) => option.input);
  if (withInput.length === 0) return null;
  return withInput.filter((option) => option.input?.checked).map((option) => option.key);
}

function pause(delay: readonly [number, number]): Promise<void> {
  return sleep(jitter(delay[0], delay[1]));
}

async function setOptionChecked(
  option: DomOption,
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

function optionKeyFromText(option: DomOption): string {
  const raw = option.text.trim();
  const prefixed = /^\s*[（(]?\s*([A-Ha-h])\s*[)）.．、:：]/.exec(textOf(option.element));
  if (prefixed) return prefixed[1].toUpperCase();
  return option.key;
}

/** 选项匹配：先按 key，再用 answer.texts 做文本相似度兜底 */
function resolveChoiceTargets(entry: QuestionEntry, answer: { keys: string[]; texts?: string[] }): DomOption[] {
  const targets: DomOption[] = [];
  const keys = answer.keys ?? [];
  const byKey = new Map(entry.options.map((option) => [option.key.toUpperCase(), option]));

  for (const rawKey of keys) {
    const key = (rawKey ?? "").trim().toUpperCase();
    if (!key) continue;
    const direct = byKey.get(key);
    if (direct && !targets.includes(direct)) {
      targets.push(direct);
      continue;
    }
    const byTextPrefix = entry.options.find(
      (option) => !targets.includes(option) && optionKeyFromText(option) === key,
    );
    if (byTextPrefix) targets.push(byTextPrefix);
  }

  const texts = (answer.texts ?? []).filter((text) => text.trim());
  if (texts.length > 0) {
    for (const text of texts) {
      if (targets.some((option) => textSimilarity(text, option.text) >= 0.95)) continue;
      let best: DomOption | null = null;
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
  }
  return targets;
}

async function applyChoice(
  entry: QuestionEntry,
  answer: { keys: string[]; texts?: string[] },
  delay: readonly [number, number],
  dryRun: boolean,
): Promise<FillResult> {
  const questionId = entry.question.id;
  const expected =
    answer.keys.length > 0 ? answer.keys.join("") : (answer.texts ?? []).join(" / ");
  const targets = resolveChoiceTargets(entry, answer);

  if (dryRun) {
    return {
      questionId,
      ok: targets.length > 0,
      expected,
      actual: "",
      message:
        targets.length > 0
          ? `dryRun：计划选择 ${targets.map((option) => option.key).join("、")}`
          : "dryRun：未匹配到任何选项",
    };
  }
  if (targets.length === 0) {
    return {
      questionId,
      ok: false,
      expected,
      actual: (readCheckedKeys(entry) ?? []).join(""),
      message: "未匹配到任何选项，请检查答案与页面选项",
    };
  }

  for (const target of targets) {
    await setOptionChecked(target, true, delay);
  }

  if (entry.question.type === "multiple") {
    for (const option of entry.options) {
      if (targets.includes(option) || !option.input) continue;
      if (option.input.checked) await setOptionChecked(option, false, delay);
    }
  }

  const checkedKeys = readCheckedKeys(entry);
  if (checkedKeys === null) {
    return {
      questionId,
      ok: true,
      expected,
      actual: targets.map((option) => option.key).join(""),
      message: "已点击选项（页面无原生 input，无法回读勾选状态）",
    };
  }
  const ok = sameKeySet(checkedKeys, targets.map((option) => option.key));
  const actual = checkedKeys.sort().join("");
  return {
    questionId,
    ok,
    expected,
    actual,
    message: ok
      ? `选项已勾选：${actual}`
      : `选项回读不一致：期望 ${targets.map((option) => option.key).join("")}，实际 ${actual}`,
  };
}

/**
 * 判断题：兼容 对/错/正确/错误/√/×/T/F；也可能是单个 checkbox 表示“正确”。
 * 选项文本无法解析时按位置兜底（判断题一般只有两个选项）。
 */
async function applyJudge(
  entry: QuestionEntry,
  value: boolean,
  delay: readonly [number, number],
  dryRun: boolean,
): Promise<FillResult> {
  const questionId = entry.question.id;
  const expected = value ? "正确" : "错误";
  const inputOptions = entry.options.filter((option) => option.input);
  const singleCheckbox =
    entry.options.length === 1 && entry.options[0].input?.type === "checkbox"
      ? entry.options[0]
      : null;
  const target =
    singleCheckbox ?? entry.options.find((option) => option.judgeValue === value) ?? null;

  if (dryRun) {
    return {
      questionId,
      ok: target !== null,
      expected,
      actual: "",
      message: target
        ? `dryRun：计划点击「${target.text || expected}」`
        : "dryRun：未找到对应判断选项",
    };
  }
  if (!target) {
    return {
      questionId,
      ok: false,
      expected,
      actual: "",
      message: "未找到判断题选项（对/错/正确/错误/√/×）",
    };
  }

  if (singleCheckbox) {
    await setOptionChecked(singleCheckbox, value, delay);
    const state = singleCheckbox.input?.checked === true;
    return {
      questionId,
      ok: state === value,
      expected,
      actual: state ? "正确" : "错误",
      message: state === value ? "判断题已设置" : "判断题勾选状态回读不一致",
    };
  }

  await setOptionChecked(target, true, delay);
  if (target.input?.type === "checkbox") {
    for (const option of entry.options) {
      if (option === target || !option.input) continue;
      if (option.input.checked) await setOptionChecked(option, false, delay);
    }
  }

  if (inputOptions.length === 0) {
    return {
      questionId,
      ok: true,
      expected,
      actual: target.text || expected,
      message: "已点击判断选项（页面无原生 input，无法回读状态）",
    };
  }

  if (target.judgeValue !== null) {
    const checked = entry.options.find((option) => option.input?.checked);
    const checkedValue = checked ? checked.judgeValue : null;
    const ok = checkedValue === value;
    const actual = checkedValue === null ? (checked?.text ?? "未选中") : checkedValue ? "正确" : "错误";
    return {
      questionId,
      ok,
      expected,
      actual,
      message: ok ? "判断题已选择" : `判断题回读不一致：期望 ${expected}，实际 ${actual}`,
    };
  }

  // 文本无法解析时按位置兜底：只能确认目标选项被选中
  const targetChecked = target.input?.checked === true;
  return {
    questionId,
    ok: targetChecked,
    expected,
    actual: targetChecked ? target.text || expected : "未选中",
    message: targetChecked ? "判断题已选择（按位置匹配）" : "判断题选项未能选中",
  };
}

async function applyFill(
  entry: QuestionEntry,
  values: string[],
  delay: readonly [number, number],
  dryRun: boolean,
): Promise<FillResult> {
  const questionId = entry.question.id;
  const blanks = findBlankInputs(entry.element);
  const expected = values.join(" | ");
  // 答案与页面空位数量不一致时一律判失败：少填会静默失分，多出的答案会被丢弃
  const countMismatch = values.length !== blanks.length;
  if (values.length > blanks.length) {
    logger.warn(
      "fill",
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
  if (blanks.length === 0) {
    return { questionId, ok: false, expected, message: "未找到填空输入框" };
  }

  // 即使数量不一致也尽量写入能对应的空，便于用户手动补填；但结果仍判为失败
  const limit = Math.min(values.length, blanks.length);
  for (let index = 0; index < limit; index += 1) {
    setNativeValue(blanks[index], values[index] ?? "");
    await pause(delay);
  }

  // 回读全部空位（含未填项），避免残留旧值被当成已填写
  const actualValues = blanks.map((blank) => blank.value);
  const readbackOk =
    actualValues.length === values.length &&
    actualValues.every((item, index) => item.trim() === (values[index] ?? "").trim());
  return {
    questionId,
    ok: !countMismatch && readbackOk,
    expected,
    actual: actualValues.join(" | "),
    message: countMismatch
      ? `填空数量不一致：答案 ${values.length} 空 / 页面 ${blanks.length} 空`
      : readbackOk
        ? `已填写 ${blanks.length} 个空`
        : "填空回读不一致",
  };
}

async function applyText(
  entry: QuestionEntry,
  text: string,
  delay: readonly [number, number],
  dryRun: boolean,
): Promise<FillResult> {
  const questionId = entry.question.id;
  const target = findTextTarget(entry.element);
  if (dryRun) {
    return {
      questionId,
      ok: target !== null,
      expected: text,
      actual: "",
      message: target ? "dryRun：计划写入简答题文本框" : "dryRun：未找到可填写的文本框",
    };
  }
  if (!target) {
    return {
      questionId,
      ok: false,
      expected: text,
      message: "未找到简答题输入框（可能是富文本 iframe），请手动填写",
    };
  }

  if (target.mode === "value") {
    setNativeValue(target.element as HTMLTextAreaElement | HTMLInputElement, text);
  } else {
    target.element.textContent = text;
    target.element.dispatchEvent(new Event("input", { bubbles: true }));
    target.element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await pause(delay);

  const actual =
    target.mode === "value"
      ? (target.element as HTMLTextAreaElement).value
      : (target.element.textContent ?? "");
  const trimmedExpected = text.trim();
  const ok =
    actual.trim() === trimmedExpected ||
    (trimmedExpected.length > 0 && actual.includes(trimmedExpected));
  return {
    questionId,
    ok,
    expected: text,
    actual,
    message: ok ? "已填写简答题" : "简答题回读不一致",
  };
}

async function applyAnswer(
  entry: QuestionEntry,
  answer: AnswerValue,
  delay: readonly [number, number],
  dryRun: boolean,
): Promise<FillResult> {
  switch (answer.kind) {
    case "choice":
      return applyChoice(entry, answer, delay, dryRun);
    case "judge":
      return applyJudge(entry, answer.value, delay, dryRun);
    case "fill":
      return applyFill(entry, answer.values, delay, dryRun);
    case "text":
      if (entry.question.type === "fill") {
        return applyFill(
          entry,
          splitFillValues(answer.text, entry.question.blankCount),
          delay,
          dryRun,
        );
      }
      return applyText(entry, answer.text, delay, dryRun);
    default:
      return {
        questionId: entry.question.id,
        ok: false,
        message: "不支持的答案类型",
      };
  }
}

export async function fillAnswer(
  ctx: PageContext,
  question: Question,
  answer: AnswerValue,
  options?: FillOptions,
): Promise<FillResult> {
  const delay: [number, number] = options?.delayMs ?? DEFAULT_DELAY;
  const dryRun = options?.dryRun === true;
  const expected = formatAnswer(answer);
  let last: FillResult = { questionId: question.id, ok: false, expected, message: "未执行" };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const entry = findQuestionEntry(ctx.doc, ctx.frameId, question);
      if (!entry) {
        last = {
          questionId: question.id,
          ok: false,
          expected,
          message: "未找到题目容器，页面可能已刷新",
        };
      } else {
        last = await applyAnswer(entry, answer, delay, dryRun);
      }
    } catch (error) {
      last = {
        questionId: question.id,
        ok: false,
        expected,
        message: `填答异常：${errorText(error)}`,
      };
    }

    if (last.ok || dryRun) return last;
    if (attempt < MAX_RETRIES) await pause(delay);
  }

  return {
    ...last,
    message: `${last.message ?? "填答失败"}（已重试 ${MAX_RETRIES} 次）`,
  };
}
