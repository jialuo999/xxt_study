/**
 * 题库文本解析：JSON / CSV / TSV / TXT → 规范化行。
 *
 * 不读写文件：UI 读取 File 后把文本交给这里。
 * 列名兼容英文（type/question/stem/options/answer/source）与中文表头
 * （题型/题目/题干/选项/答案/来源），也兼容 A/B/C/D 分列选项。
 */

import type { AnswerValue, QuestionType } from "../core/types";
import { normalizeText, stripHtml } from "../utils/text";
import { answerFromUnknown, type AnswerParseContext } from "./answer";

export type BankTextFormat = "json" | "csv" | "tsv" | "txt";

export interface ParsedBankRow {
  type: QuestionType;
  stem: string;
  options: string[];
  answer: AnswerValue | null;
  source: string;
  blankCount?: number;
}

export interface ParsedBankText {
  rows: ParsedBankRow[];
  /** 记录总行数（含被跳过的） */
  total: number;
  /** 被跳过的行数（空行/无法解析） */
  skipped: number;
  errors: string[];
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------ */
/* 题型                                                                */
/* ------------------------------------------------------------------ */

/** 中英文题型名称 → QuestionType */
export function normalizeQuestionType(raw: unknown): QuestionType {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!text) return "unknown";
  const exact: Record<string, QuestionType> = {
    single: "single",
    singlechoice: "single",
    单选: "single",
    单选题: "single",
    单项选择: "single",
    单项选择题: "single",
    单项: "single",
    multiple: "multiple",
    multiplechoice: "multiple",
    多选: "multiple",
    多选题: "multiple",
    多项选择: "multiple",
    多项选择题: "multiple",
    不定项: "multiple",
    不定项选择: "multiple",
    不定项选择题: "multiple",
    judge: "judge",
    truefalse: "judge",
    判断: "judge",
    判断题: "judge",
    是非: "judge",
    是非题: "judge",
    fill: "fill",
    blank: "fill",
    填空: "fill",
    填空题: "fill",
    short: "short",
    essay: "short",
    简答: "short",
    简答题: "short",
    论述: "short",
    论述题: "short",
    问答: "short",
    问答题: "short",
    名词解释: "short",
  };
  const direct = exact[text];
  if (direct) return direct;
  if (text.includes("多选") || text.includes("多项") || text.includes("不定项")) return "multiple";
  if (text.includes("判断") || text.includes("是非")) return "judge";
  if (text.includes("填空")) return "fill";
  if (text.includes("简答") || text.includes("论述") || text.includes("问答") || text.includes("名词解释")) {
    return "short";
  }
  if (text.includes("单选") || text.includes("单项")) return "single";
  return "unknown";
}

/** 缺少题型时按选项/答案推断 */
export function inferQuestionType(
  declared: QuestionType,
  options: string[],
  answer: AnswerValue | null,
): QuestionType {
  if (declared !== "unknown") return declared;
  if (options.length >= 2) {
    if (answer?.kind === "choice") return answer.keys.length > 1 ? "multiple" : "single";
    if (answer?.kind === "judge") return "judge";
    if (answer?.kind === "fill" || answer?.kind === "text") return "unknown";
    return "single";
  }
  if (!answer) return "unknown";
  switch (answer.kind) {
    case "judge":
      return "judge";
    case "fill":
      return "fill";
    case "text":
      return "short";
    case "choice":
      return answer.keys.length > 1 ? "multiple" : "single";
    default:
      return "unknown";
  }
}

/* ------------------------------------------------------------------ */
/* 选项                                                                */
/* ------------------------------------------------------------------ */

function toOptionString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isRecord(value)) {
    const text = value.text ?? value.label ?? value.value ?? value.content;
    const key = value.key ?? value.letter ?? value.value;
    if (text != null) {
      const label = key != null && String(key).trim() ? String(key).trim() : "";
      return label ? `${label}. ${String(text).trim()}` : String(text).trim();
    }
    return "";
  }
  return String(value).trim();
}

/** 把 "A. xx||B. yy" / "A. xx\nB. yy" / "A. xx B. yy" 等拆成选项数组 */
export function splitOptions(raw: string): string[] {
  const text = stripHtml(String(raw ?? "")).trim();
  if (!text) return [];
  let parts: string[];
  if (text.includes("\n")) {
    parts = text.split(/\r?\n/);
  } else if (text.includes("||")) {
    parts = text.split("||");
  } else if (text.includes("|")) {
    parts = text.split("|");
  } else if (text.includes("；")) {
    parts = text.split("；");
  } else if (text.includes(";")) {
    parts = text.split(";");
  } else {
    const withSpace = text.split(/\s+(?=[A-Ha-h]\s*[、.．)）:：]\s*)/);
    if (withSpace.length > 1) {
      parts = withSpace;
    } else {
      const noSpace = text.split(/(?=[A-Ha-h]\s*[、.．)）:：]\s*)/);
      parts = noSpace.length > 1 ? noSpace : [text];
    }
  }
  return parts.map((part) => part.trim()).filter(Boolean);
}

function toOptions(value: unknown): string[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) {
    return value.map(toOptionString).filter(Boolean);
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (!keys.length) return [];
    // 形如 { A: "xx", B: "yy" } 或 { options: [...] } / { list: [...] }
    const nested = value.options ?? value.items ?? value.list;
    if (Array.isArray(nested)) return toOptions(nested);
    const mapped = keys
      .map((key) => {
        const text = toOptionString(value[key]);
        return text ? `${key.toUpperCase()}. ${text}` : "";
      })
      .filter(Boolean);
    if (mapped.length) return mapped;
    return [];
  }
  return splitOptions(String(value));
}

/* ------------------------------------------------------------------ */
/* JSON                                                                */
/* ------------------------------------------------------------------ */

const FIELD_ALIASES: Record<string, string[]> = {
  type: ["type", "questiontype", "qtype", "题型", "类型", "题目类型"],
  stem: ["question", "stem", "title", "content", "题目", "题干", "问题", "标题"],
  options: ["options", "option", "choices", "choice", "选项", "备选项", "选择项"],
  answer: ["answer", "answers", "correctanswer", "正确答案", "答案", "参考答案", "标准答案"],
  source: ["source", "from", "来源", "出处"],
  blankCount: ["blankcount", "blanks", "blank", "空数", "填空数"],
};

function pickField(object: Record<string, unknown>, aliases: string[]): unknown {
  const lowerMap = new Map<string, unknown>();
  for (const [key, value] of Object.entries(object)) {
    lowerMap.set(key.toLowerCase().replace(/[\s_-]/g, ""), value);
  }
  for (const alias of aliases) {
    const value = lowerMap.get(alias.toLowerCase().replace(/[\s_-]/g, ""));
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function pickItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return [];
  for (const key of ["questions", "entries", "data", "list", "items", "results"]) {
    const value = data[key];
    if (Array.isArray(value)) return value;
    if (isRecord(value)) {
      const nested = pickItems(value);
      if (nested.length) return nested;
    }
  }
  // 形如 { "q1": {...}, "q2": {...} }
  const values = Object.values(data);
  if (
    values.length > 0 &&
    values.every(isRecord) &&
    values.some(
      (value) =>
        "stem" in value || "question" in value || "题目" in value || "题干" in value,
    )
  ) {
    return values;
  }
  return [];
}

function rowFromFields(fields: {
  typeRaw?: unknown;
  stem: unknown;
  options: unknown;
  answer: unknown;
  source?: unknown;
  blankCount?: unknown;
}): ParsedBankRow | { error: string } {
  const stem = stripHtml(String(fields.stem ?? "")).trim();
  if (!stem) return { error: "题干为空" };
  const options = toOptions(fields.options);
  const declared = normalizeQuestionType(fields.typeRaw);
  const answerContext: AnswerParseContext = {
    type: declared,
    options,
    blankCount:
      typeof fields.blankCount === "number" && fields.blankCount > 0
        ? Math.floor(fields.blankCount)
        : undefined,
  };
  const answer = answerFromUnknown(fields.answer, answerContext);
  if (!answer) return { error: `无法解析答案：${String(fields.answer ?? "").slice(0, 40)}` };
  const type = inferQuestionType(declared, options, answer);
  const source = String(fields.source ?? "").trim();
  return { type, stem, options, answer, source };
}

function parseJsonRows(text: string): ParsedBankText {
  const errors: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(stripBom(text));
  } catch (error) {
    return {
      rows: [],
      total: 0,
      skipped: 1,
      errors: [`JSON 解析失败：${errorMessage(error).slice(0, 160)}`],
    };
  }
  const items = pickItems(data);
  const rows: ParsedBankRow[] = [];
  let skipped = 0;

  for (const item of items) {
    if (!isRecord(item)) {
      skipped++;
      if (errors.length < 20) errors.push("JSON 条目不是对象");
      continue;
    }
    const fields = {
      typeRaw: pickField(item, FIELD_ALIASES.type),
      stem: pickField(item, FIELD_ALIASES.stem),
      options: pickField(item, FIELD_ALIASES.options),
      answer: pickField(item, FIELD_ALIASES.answer),
      source: pickField(item, FIELD_ALIASES.source),
      blankCount: pickField(item, FIELD_ALIASES.blankCount),
    };
    const result = rowFromFields(fields);
    if ("error" in result) {
      skipped++;
      if (errors.length < 20) errors.push(result.error);
      continue;
    }
    rows.push(result);
  }

  return { rows, total: items.length, skipped, errors };
}

/* ------------------------------------------------------------------ */
/* CSV / TSV                                                           */
/* ------------------------------------------------------------------ */

function normalizeLineEndings(text: string): string {
  return stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** 解析带引号的 CSV/TSV，支持字段内逗号、换行与 "" 转义 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const source = normalizeLineEndings(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function normalizeHeader(cell: string): string {
  return stripBom(String(cell ?? ""))
    .trim()
    .toLowerCase()
    .replace(/[\s*:：()（）【】[\]_-]/g, "");
}

const CSV_HEADER_ALIASES: Record<string, string[]> = {
  type: ["type", "questiontype", "qtype", "题型", "类型", "题目类型"],
  stem: ["question", "stem", "title", "content", "题目", "题干", "问题", "标题"],
  options: ["options", "option", "choices", "choice", "选项", "备选项", "选择项"],
  answer: ["answer", "answers", "correctanswer", "正确答案", "答案", "参考答案", "标准答案"],
  source: ["source", "from", "来源", "出处"],
};

interface CsvColumns {
  type?: number;
  stem?: number;
  options?: number;
  answer?: number;
  source?: number;
  letterColumns: Array<{ index: number; letter: string }>;
}

function detectColumns(header: string[]): CsvColumns {
  const columns: CsvColumns = { letterColumns: [] };
  const normalized = header.map(normalizeHeader);
  for (const [field, aliases] of Object.entries(CSV_HEADER_ALIASES)) {
    const index = normalized.findIndex((cell) => cell !== "" && aliases.includes(cell));
    if (index >= 0) (columns as unknown as Record<string, number>)[field] = index;
  }
  for (let i = 0; i < normalized.length; i++) {
    const match = normalized[i].match(/^(?:选项)?([a-h])$/);
    if (match) columns.letterColumns.push({ index: i, letter: match[1].toUpperCase() });
  }
  columns.letterColumns.sort((a, b) => a.letter.localeCompare(b.letter));
  return columns;
}

function positionalColumns(columnCount: number): CsvColumns {
  // 无表头时按 题目,答案[,选项][,题型][,来源] 顺序猜测
  const columns: CsvColumns = { stem: 0, answer: 1, letterColumns: [] };
  if (columnCount >= 3) columns.options = 2;
  if (columnCount >= 4) columns.type = 3;
  if (columnCount >= 5) columns.source = 4;
  return columns;
}

function cellAt(cells: string[], index: number | undefined): unknown {
  if (index === undefined || index < 0 || index >= cells.length) return undefined;
  return cells[index];
}

function parseCsvRows(text: string, delimiter: string): ParsedBankText {
  const table = parseDelimited(text, delimiter);
  if (!table.length) return { rows: [], total: 0, skipped: 0, errors: [] };

  const columns = detectColumns(table[0]);
  const hasHeader = Boolean(
    columns.type !== undefined ||
      columns.stem !== undefined ||
      columns.options !== undefined ||
      columns.answer !== undefined ||
      columns.source !== undefined ||
      // 单字母数据行（如答案 A）不能误判为表头，至少两列字母选项才算
      columns.letterColumns.length >= 2,
  );
  const effective = hasHeader ? columns : positionalColumns(table[0].length);
  const dataRows = hasHeader ? table.slice(1) : table;
  const rows: ParsedBankRow[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const cells of dataRows) {
    if (!cells.some((cell) => cell.trim() !== "")) continue;
    let optionsRaw: unknown = cellAt(cells, effective.options);
    if (optionsRaw === undefined && effective.letterColumns.length) {
      optionsRaw = effective.letterColumns
        .map((column) => {
          const text = cellAt(cells, column.index);
          const value = text == null ? "" : String(text).trim();
          return value ? `${column.letter}. ${value}` : "";
        })
        .filter(Boolean);
    }
    const result = rowFromFields({
      typeRaw: cellAt(cells, effective.type),
      stem: cellAt(cells, effective.stem),
      options: optionsRaw,
      answer: cellAt(cells, effective.answer),
      source: cellAt(cells, effective.source),
    });
    if ("error" in result) {
      skipped++;
      if (errors.length < 20) errors.push(result.error);
      continue;
    }
    rows.push(result);
  }

  return { rows, total: dataRows.length, skipped, errors };
}

/* ------------------------------------------------------------------ */
/* TXT                                                                 */
/* ------------------------------------------------------------------ */

function parseTxtRows(text: string): ParsedBankText {
  const lines = normalizeLineEndings(text).split("\n");
  const rows: ParsedBankRow[] = [];
  const errors: string[] = [];
  let total = 0;
  let skipped = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    total++;
    let stem = "";
    let answerRaw = "";
    const doubleEquals = line.lastIndexOf("==");
    if (doubleEquals > 0) {
      stem = line.slice(0, doubleEquals).trim();
      answerRaw = line.slice(doubleEquals + 2).trim();
    } else {
      const tabIndex = line.indexOf("\t");
      if (tabIndex > 0) {
        stem = line.slice(0, tabIndex).trim();
        answerRaw = line.slice(tabIndex + 1).trim();
      }
    }
    if (!stem || !answerRaw) {
      skipped++;
      if (errors.length < 20) errors.push(`TXT 行格式无法识别：${line.slice(0, 40)}`);
      continue;
    }
    const result = rowFromFields({ stem, options: undefined, answer: answerRaw });
    if ("error" in result) {
      skipped++;
      if (errors.length < 20) errors.push(result.error);
      continue;
    }
    rows.push(result);
  }
  return { rows, total, skipped, errors };
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

/** 按格式解析题库文本 */
export function parseBankText(
  text: string,
  format: BankTextFormat,
  _filename?: string,
): ParsedBankText {
  const source = typeof text === "string" ? text : String(text ?? "");
  switch (format) {
    case "json":
      return parseJsonRows(source);
    case "csv":
      return parseCsvRows(source, ",");
    case "tsv":
      return parseCsvRows(source, "\t");
    case "txt":
      return parseTxtRows(source);
    default:
      return { rows: [], total: 0, skipped: 0, errors: [`不支持的导入格式：${String(format)}`] };
  }
}

/** 供 UI 展示的行摘要（题干截断），避免 UI 再依赖 normalizeText */
export function summarizeRow(row: ParsedBankRow): string {
  return normalizeText(row.stem).slice(0, 40);
}
