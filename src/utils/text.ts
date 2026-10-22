function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  if (typeof document === "undefined") {
    return text
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"');
  }
  const el = document.createElement("textarea");
  el.innerHTML = text;
  return el.value;
}

export function stripHtml(input: string): string {
  if (!input) return "";
  let text = input;
  if (/<[a-z!/][\s\S]*>/i.test(text)) {
    if (typeof DOMParser !== "undefined") {
      try {
        const doc = new DOMParser().parseFromString(text, "text/html");
        text = doc.body.textContent ?? "";
      } catch {
        text = text.replace(/<[^>]*>/g, " ");
      }
    } else {
      text = text.replace(/<[^>]*>/g, " ");
    }
  }
  return decodeEntities(text);
}

/** 全角转半角（NFKC 之外补充常见标点） */
export function toHalfWidth(input: string): string {
  return input
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ");
}

const LEADING_NUMBER = /^\s*(?:第\s*)?\d+\s*(?:题)?\s*[、.．,，:：)）]\s*/;
const LEADING_TYPE =
  /^\s*[【\[(（]?\s*(?:单项选择|多项选择|不定项选择|单选|多选|判断|填空|简答|论述|名词解释)题?\s*[】\])）]?\s*[、.．,，:：]?\s*/;
const LEADING_SCORE = /^\s*[（(]\s*\d+(?:\.\d+)?\s*分\s*[)）]\s*/;

/** 题干/选项归一化：用于哈希与相似度 */
export function normalizeText(input: string): string {
  if (!input) return "";
  let text = stripHtml(input);
  text = toHalfWidth(text).normalize("NFKC").toLowerCase();
  text = text.replace(/\u00a0/g, " ");
  text = text.replace(LEADING_SCORE, "");
  text = text.replace(LEADING_NUMBER, "");
  text = text.replace(LEADING_TYPE, "");
  text = text.replace(/[\s\p{P}\p{S}]+/gu, "");
  return text;
}

/** 选项文本归一化，去掉 A. / （A） 等前缀 */
export function normalizeOption(input: string): string {
  let text = stripHtml(input);
  text = toHalfWidth(text).trim();
  text = text.replace(/^[\s]*[（(]\s*[A-Ha-h]\s*[)）]\s*[、.．:：]?\s*/, "");
  text = text.replace(/^[\s]*[A-Ha-h]\s*[、.．)）:：]\s*/, "");
  text = text.replace(/^[\s]*选项\s*[A-Ha-h]\s*[、.．)）:：]?\s*/, "");
  return text.trim();
}

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function hashString(text: string): string {
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x9e3779b9);
}

/** 题目的稳定哈希：题型 + 归一化题干 + 排序后的选项 */
export function questionHash(type: string, stem: string, options: string[] = []): string {
  const optionPart = options
    .map((option) => normalizeOption(option))
    .filter(Boolean)
    .sort()
    .join("|");
  return hashString(`${type}#${normalizeText(stem)}#${optionPart}`);
}

function ngrams(text: string, size: number): Map<string, number> {
  const map = new Map<string, number>();
  if (text.length === 0) return map;
  if (text.length <= size) {
    map.set(text, 1);
    return map;
  }
  for (let i = 0; i + size <= text.length; i++) {
    const gram = text.slice(i, i + size);
    map.set(gram, (map.get(gram) ?? 0) + 1);
  }
  return map;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [key, count] of a) {
    na += count * count;
    const other = b.get(key);
    if (other) dot += count * other;
  }
  for (const count of b.values()) nb += count * count;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 文本相似度：2-gram 与 3-gram 余弦平均，并做长度惩罚 */
export function textSimilarity(left: string, right: string): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigram = cosine(ngrams(a, 2), ngrams(b, 2));
  const trigram = cosine(ngrams(a, 3), ngrams(b, 3));
  const lengthRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return Math.min(1, (bigram * 0.45 + trigram * 0.55) * (0.8 + 0.2 * lengthRatio));
}

/** 选项集合相似度（Jaccard） */
export function optionSetSimilarity(left: string[], right: string[]): number {
  const a = new Set(left.map(normalizeOption).filter(Boolean));
  const b = new Set(right.map(normalizeOption).filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** 从 "A、C" / "AC" / "A,C" 中提取选项字母 */
export function parseAnswerLetters(raw: string): string[] {
  const text = toHalfWidth(raw).trim().toUpperCase();
  if (!text || text.length > 24) return [];
  if (!/^[A-H\s,、;；|/]+$/.test(text)) return [];
  const letters = text.match(/[A-H]/g) ?? [];
  return [...new Set(letters)].sort();
}

const TRUE_WORDS = new Set(["对", "正确", "是", "真", "√", "t", "true", "1", "y", "yes"]);
const FALSE_WORDS = new Set(["错", "错误", "否", "假", "×", "x", "f", "false", "0", "n", "no"]);

export function parseJudge(raw: string): boolean | null {
  const text = toHalfWidth(stripHtml(raw)).trim().toLowerCase();
  if (TRUE_WORDS.has(text)) return true;
  if (FALSE_WORDS.has(text)) return false;
  return null;
}

/** 拆分填空题答案 */
export function splitFillValues(raw: string, blankCount?: number): string[] {
  const text = stripHtml(raw).trim();
  if (!text) return [];
  let parts = text
    .split(/\s*(?:\||｜|；|;|\n)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1 && blankCount && blankCount > 1) {
    parts = text
      .split(/[、,，]\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (blankCount && parts.length > blankCount) {
    parts = parts.slice(0, blankCount);
  }
  return parts;
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1))}…`;
}

export function formatAnswer(answer: AnswerValueLike): string {
  if (!answer) return "—";
  switch (answer.kind) {
    case "choice": {
      const keys = (answer.keys ?? []).join("");
      return answer.texts?.length ? `${keys} · ${answer.texts.join(" / ")}` : keys;
    }
    case "judge":
      return answer.value ? "正确" : "错误";
    case "fill":
      return (answer.values ?? []).join(" | ");
    case "text":
      return answer.text ?? "";
    default:
      return "—";
  }
}

interface AnswerValueLike {
  kind: string;
  keys?: string[];
  texts?: string[];
  value?: boolean;
  values?: string[];
  text?: string;
}
