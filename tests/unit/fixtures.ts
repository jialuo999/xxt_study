import type { Option, Question, QuestionType } from "../../src/core/types";
import { DEFAULT_SETTINGS, type Settings } from "../../src/core/settings";

export function letters(count: number): string[] {
  return Array.from({ length: count }, (_, index) => String.fromCharCode(65 + index));
}

export function optionsOf(texts: string[]): Option[] {
  return texts.map((text, index) => ({ key: letters(texts.length)[index], text }));
}

export function makeQuestion(partial: Partial<Question> & { id: string }): Question {
  return {
    id: partial.id,
    type: partial.type ?? "single",
    stem: partial.stem ?? "示例题干",
    options: partial.options ?? [],
    blankCount: partial.blankCount,
    hasImage: partial.hasImage ?? false,
    frameId: partial.frameId ?? "frame-1",
    index: partial.index ?? 0,
  };
}

export function makeChoiceQuestion(
  id: string,
  stem: string,
  texts: string[] = ["甲选项", "乙选项", "丙选项", "丁选项"],
  type: QuestionType = "single",
): Question {
  return makeQuestion({ id, stem, type, options: optionsOf(texts) });
}

export function makeJudgeQuestion(id: string, stem: string): Question {
  return makeQuestion({
    id,
    stem,
    type: "judge",
    options: [
      { key: "A", text: "正确" },
      { key: "B", text: "错误" },
    ],
  });
}

export function makeFillQuestion(id: string, stem: string, blankCount = 2): Question {
  return makeQuestion({ id, stem, type: "fill", blankCount });
}

export function makeShortQuestion(id: string, stem: string): Question {
  return makeQuestion({ id, stem, type: "short" });
}

export function makeSettings(mutator?: (settings: Settings) => void): Settings {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;
  if (mutator) mutator(settings);
  return settings;
}
