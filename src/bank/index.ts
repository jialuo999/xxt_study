/**
 * 本地题库：导入 / 检索 / 统计 / 导出 / 解题缓存。
 *
 * 对外 API（UI 与 solver 统一从这里引用）：
 * - initBank / importBankText / getBankStats / clearBank / exportBank
 * - searchBank / searchBankByText / putBankEntry
 * - putCache / getCachedSolve / clearCache
 *
 * 性能：内存索引懒加载并缓存，导入/清空后失效；
 * 1 万条目标：精确 <10ms，模糊 <50ms（索引预热后）。
 */

import { logger } from "../core/logger";
import { getSettings } from "../core/settings-store";
import type {
  AnswerValue,
  BankEntry,
  Question,
  QuestionType,
  SolveResult,
  SolveSource,
} from "../core/types";
import {
  normalizeOption,
  normalizeText,
  questionHash,
} from "../utils/text";
import { cloneAnswer, formatAnswerText } from "./answer";
import {
  getBankStore,
  isIndexedDbAvailable,
  resetBankStoreForTests,
  type BankStore,
  type CacheRecord,
} from "./db";
import {
  parseBankText,
  type BankTextFormat,
  type ParsedBankRow,
} from "./parser";

export type {
  BankTextFormat,
  ParsedBankRow,
  ParsedBankText,
} from "./parser";
export {
  normalizeQuestionType,
  inferQuestionType,
  parseBankText,
  parseDelimited,
  splitOptions,
} from "./parser";
export {
  answerFromUnknown,
  formatAnswerText,
  normalizeAnswerValue,
  parseAnswerText,
} from "./answer";
export { queryRemote } from "./remote";
export type { BankStore, CacheRecord, StoreKind } from "./db";

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

export interface ImportResult {
  ok: boolean;
  format: BankTextFormat;
  filename?: string;
  /** 解析出的记录数（含被跳过的行） */
  total: number;
  /** 新增条目数 */
  added: number;
  /** 已存在相同 hash、答案变化后更新的条目数 */
  updated: number;
  /** 已存在且答案相同的重复条目数 */
  duplicates: number;
  /** 因格式/答案无法解析被跳过的行数 */
  skipped: number;
  /** 解析失败的行数（skipped 的别名，UI 兼容字段） */
  failed: number;
  /** 因超过 maxEntries 被裁剪的条目数 */
  pruned: number;
  /** 导入后的题库总条目数 */
  totalEntries: number;
  errors: string[];
  durationMs: number;
}

export interface BankStats {
  total: number;
  byType: Record<QuestionType, number>;
  withOptions: number;
  maxEntries: number;
  cacheCount: number;
  lastImportAt: number | null;
  oldestUpdatedAt: number | null;
  newestUpdatedAt: number | null;
  storage: "indexeddb" | "memory";
  indexedDbAvailable: boolean;
}

export type BankMatchMode = "exact" | "fuzzy";

export interface BankMatch {
  entry: BankEntry;
  score: number;
  mode: BankMatchMode;
}

export interface BankSearchHit {
  entry: BankEntry;
  score: number;
}

/* ------------------------------------------------------------------ */
/* 内存索引                                                            */
/* ------------------------------------------------------------------ */

interface IndexItem {
  entry: BankEntry;
  normStem: string;
  grams2: Map<string, number>;
  grams3: Map<string, number>;
  normOptions: Set<string>;
}

interface BankMemoryIndex {
  items: IndexItem[];
  itemById: Map<string, IndexItem>;
  byHash: Map<string, BankEntry>;
  byId: Map<string, BankEntry>;
}

let indexCache: BankMemoryIndex | null = null;
let indexPromise: Promise<BankMemoryIndex> | null = null;
let indexGeneration = 0;

function ngrams(text: string, size: number): Map<string, number> {
  const map = new Map<string, number>();
  if (!text) return map;
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
  let normA = 0;
  let normB = 0;
  for (const [key, count] of a) {
    normA += count * count;
    const other = b.get(key);
    if (other) dot += count * other;
  }
  for (const count of b.values()) normB += count * count;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 与 utils/text.ts 的 textSimilarity 同公式，但复用预计算的 n-gram */
function preparedTextSimilarity(
  aNorm: string,
  a2: Map<string, number>,
  a3: Map<string, number>,
  bNorm: string,
  b2: Map<string, number>,
  b3: Map<string, number>,
): number {
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1;
  const bigram = cosine(a2, b2);
  const trigram = cosine(a3, b3);
  const lengthRatio = Math.min(aNorm.length, bNorm.length) / Math.max(aNorm.length, bNorm.length);
  return Math.min(1, (bigram * 0.45 + trigram * 0.55) * (0.8 + 0.2 * lengthRatio));
}

function buildIndexItem(entry: BankEntry): IndexItem {
  const normStem = normalizeText(entry.stem);
  return {
    entry,
    normStem,
    grams2: ngrams(normStem, 2),
    grams3: ngrams(normStem, 3),
    normOptions: new Set(
      (entry.options ?? []).map((option) => normalizeOption(option)).filter(Boolean),
    ),
  };
}

function createMemoryIndex(entries: BankEntry[]): BankMemoryIndex {
  const index: BankMemoryIndex = {
    items: [],
    itemById: new Map(),
    byHash: new Map(),
    byId: new Map(),
  };
  for (const entry of entries) {
    const item = buildIndexItem(entry);
    index.items.push(item);
    index.itemById.set(entry.id, item);
    index.byId.set(entry.id, entry);
    const existing = index.byHash.get(entry.hash);
    if (!existing || existing.updatedAt <= entry.updatedAt) index.byHash.set(entry.hash, entry);
  }
  return index;
}

async function buildIndex(): Promise<BankMemoryIndex> {
  const store = await getBankStore();
  const entries = await store.getAllEntries();
  return createMemoryIndex(entries);
}

function ensureIndex(): Promise<BankMemoryIndex> {
  if (indexCache) return Promise.resolve(indexCache);
  if (!indexPromise) {
    const generation = indexGeneration;
    indexPromise = buildIndex()
      .then((index) => {
        if (generation === indexGeneration) indexCache = index;
        indexPromise = null;
        return index;
      })
      .catch((error: unknown) => {
        indexPromise = null;
        throw error;
      });
  }
  return indexPromise;
}

function invalidateIndex(): void {
  indexGeneration++;
  indexCache = null;
  indexPromise = null;
}

function upsertIndexEntry(entry: BankEntry): void {
  if (!indexCache) return;
  const existingItem = indexCache.itemById.get(entry.id);
  if (existingItem) {
    const oldHash = existingItem.entry.hash;
    existingItem.entry = entry;
    existingItem.normStem = normalizeText(entry.stem);
    existingItem.grams2 = ngrams(existingItem.normStem, 2);
    existingItem.grams3 = ngrams(existingItem.normStem, 3);
    existingItem.normOptions = new Set(
      (entry.options ?? []).map((option) => normalizeOption(option)).filter(Boolean),
    );
    indexCache.byId.set(entry.id, entry);
    if (oldHash !== entry.hash) indexCache.byHash.delete(oldHash);
    indexCache.byHash.set(entry.hash, entry);
    return;
  }
  const item = buildIndexItem(entry);
  indexCache.items.push(item);
  indexCache.itemById.set(entry.id, item);
  indexCache.byId.set(entry.id, entry);
  indexCache.byHash.set(entry.hash, entry);
}

/* ------------------------------------------------------------------ */
/* 初始化与统计                                                        */
/* ------------------------------------------------------------------ */

/** 打开题库（IndexedDB 不可用时退化为内存存储） */
export async function initBank(): Promise<void> {
  const store = await getBankStore();
  await store.getMeta("lastImportAt");
  logger.debug("bank", `题库已就绪（${store.kind}）`);
}

function maxEntriesSetting(): number {
  const value = getSettings().bank.maxEntries;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export async function getBankStats(): Promise<BankStats> {
  const store = await getBankStore();
  const entries = await store.getAllEntries();
  const byType: Record<QuestionType, number> = {
    single: 0,
    multiple: 0,
    judge: 0,
    fill: 0,
    short: 0,
    unknown: 0,
  };
  let withOptions = 0;
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const entry of entries) {
    byType[entry.type] = (byType[entry.type] ?? 0) + 1;
    if (entry.options?.length) withOptions++;
    if (oldest == null || entry.updatedAt < oldest) oldest = entry.updatedAt;
    if (newest == null || entry.updatedAt > newest) newest = entry.updatedAt;
  }
  const lastImportAt = await store.getMeta("lastImportAt");
  return {
    total: entries.length,
    byType,
    withOptions,
    maxEntries: maxEntriesSetting(),
    cacheCount: await store.countCache(),
    lastImportAt: typeof lastImportAt === "number" ? lastImportAt : null,
    oldestUpdatedAt: oldest,
    newestUpdatedAt: newest,
    storage: store.kind,
    indexedDbAvailable: isIndexedDbAvailable(),
  };
}

/* ------------------------------------------------------------------ */
/* 导入                                                                */
/* ------------------------------------------------------------------ */

/** 把解析行转换为题库条目（内部使用） */
function rowToEntry(row: ParsedBankRow, source: string): BankEntry {
  const hash = questionHash(row.type, row.stem, row.options);
  return {
    id: `bank-${hash}`,
    hash,
    type: row.type,
    stem: row.stem,
    options: row.options.length ? row.options : undefined,
    answer: row.answer as AnswerValue,
    source,
    updatedAt: Date.now(),
  };
}

function sameAnswer(a: AnswerValue, b: AnswerValue): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * 导入题库文本（UI 读取 File 后调用）。
 * 支持 JSON / CSV / TSV / TXT；按 id + hash 去重，超过 maxEntries 时裁剪最旧条目。
 */
export async function importBankText(
  text: string,
  format: BankTextFormat,
  filename?: string,
): Promise<ImportResult> {
  const startedAt = Date.now();
  const parsed = parseBankText(text, format, filename);
  const store = await getBankStore();
  const existing = await store.getAllEntries();

  const byHash = new Map<string, BankEntry>();
  for (const entry of existing) {
    const previous = byHash.get(entry.hash);
    if (!previous || previous.updatedAt <= entry.updatedAt) byHash.set(entry.hash, entry);
  }
  const byId = new Map<string, BankEntry>();
  for (const entry of existing) byId.set(entry.id, entry);

  const toPut: BankEntry[] = [];
  const errors = [...parsed.errors];
  let added = 0;
  let updated = 0;
  let duplicates = 0;
  let skipped = parsed.skipped;
  const defaultSource = filename || `import:${format}`;

  for (const row of parsed.rows) {
    if (!row.answer || !row.stem) {
      skipped++;
      continue;
    }
    const hash = questionHash(row.type, row.stem, row.options);
    const existingEntry = byHash.get(hash);
    if (existingEntry) {
      const nextAnswer = cloneAnswer(row.answer);
      if (!sameAnswer(existingEntry.answer, nextAnswer)) {
        const next: BankEntry = {
          ...existingEntry,
          answer: nextAnswer,
          source: row.source || defaultSource,
          updatedAt: Date.now(),
        };
        byHash.set(hash, next);
        byId.set(next.id, next);
        toPut.push(next);
        updated++;
      } else {
        duplicates++;
      }
      continue;
    }
    const entry = rowToEntry(row, row.source || defaultSource);
    // id 冲突但 hash 不同：直接覆盖旧 id，避免主键冲突
    const previousById = byId.get(entry.id);
    if (previousById && previousById.hash !== entry.hash) {
      byHash.delete(previousById.hash);
    }
    byHash.set(entry.hash, entry);
    byId.set(entry.id, entry);
    toPut.push(entry);
    added++;
  }

  for (let i = 0; i < toPut.length; i += 500) {
    await store.putEntries(toPut.slice(i, i + 500));
  }

  const maxEntries = maxEntriesSetting();
  const beforeCount = await store.count();
  const pruned =
    maxEntries > 0 && beforeCount > maxEntries ? await store.prune(maxEntries) : 0;
  const totalEntries = pruned > 0 ? await store.count() : beforeCount;

  await store.setMeta("lastImportAt", Date.now());
  if (filename) await store.setMeta("lastImportFile", filename);
  if (added + updated > 0) invalidateIndex();

  const result: ImportResult = {
    ok: parsed.rows.length > 0,
    format,
    filename,
    total: parsed.total,
    added,
    updated,
    duplicates,
    skipped,
    failed: skipped,
    pruned,
    totalEntries,
    errors: errors.slice(0, 20),
    durationMs: Date.now() - startedAt,
  };
  logger.info(
    "bank",
    `题库导入完成：新增 ${added}，更新 ${updated}，重复 ${duplicates}，跳过 ${skipped}`,
    { format, filename, totalEntries },
  );
  return result;
}

/** 根据文件名推断导入格式 */
export function detectBankFormat(filename: string): BankTextFormat {
  const lower = String(filename ?? "").toLowerCase();
  // 只把真正的 JSON 当 json：.jsonl（逐行 JSON）当前解析器不支持，按 txt 处理
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".tsv") || lower.endsWith(".tab")) return "tsv";
  if (lower.endsWith(".csv")) return "csv";
  return "txt";
}

/* ------------------------------------------------------------------ */
/* 检索                                                                */
/* ------------------------------------------------------------------ */

/** 题目稳定哈希（与 toBankEntry 保持一致） */
export function bankQuestionHash(question: Question): string {
  return questionHash(
    question.type,
    question.stem,
    question.options.map((option) => option.text),
  );
}

function isChoiceLike(type: QuestionType): boolean {
  return type === "single" || type === "multiple" || type === "unknown";
}

function typesCompatible(queryType: QuestionType, entryType: QuestionType): boolean {
  if (queryType === entryType) return true;
  const choiceTypes = new Set<QuestionType>(["single", "multiple"]);
  if (choiceTypes.has(queryType) && choiceTypes.has(entryType)) return true;
  return queryType === "unknown" || entryType === "unknown";
}

function optionSetJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface SearchBankOptions {
  /** 模糊匹配阈值，默认取 settings.bank.fuzzyThreshold */
  threshold?: number;
  /** 只做精确匹配（性能更好） */
  exactOnly?: boolean;
}

/**
 * 题库检索：先精确（questionHash，score=0.99），再模糊。
 * 模糊分 = 0.75 * 题干相似度 + 0.25 * 选项集合相似度（选择题），否则只算题干。
 */
export async function searchBank(
  question: Question,
  thresholdOrOptions?: number | SearchBankOptions,
): Promise<BankMatch | null> {
  const options: SearchBankOptions =
    typeof thresholdOrOptions === "number"
      ? { threshold: thresholdOrOptions }
      : (thresholdOrOptions ?? {});
  const threshold =
    typeof options.threshold === "number" && Number.isFinite(options.threshold)
      ? options.threshold
      : getSettings().bank.fuzzyThreshold;

  const index = await ensureIndex();
  const exact = index.byHash.get(bankQuestionHash(question));
  if (exact) return { entry: exact, score: 0.99, mode: "exact" };
  if (options.exactOnly || index.items.length === 0) return null;

  const queryNorm = normalizeText(question.stem);
  if (!queryNorm) return null;
  const queryGrams2 = ngrams(queryNorm, 2);
  const queryGrams3 = ngrams(queryNorm, 3);
  const queryOptions = new Set(
    question.options.map((option) => normalizeOption(option.text)).filter(Boolean),
  );
  const queryChoiceLike = isChoiceLike(question.type) && queryOptions.size > 0;

  let bestItem: IndexItem | null = null;
  let bestScore = 0;

  for (const item of index.items) {
    if (!typesCompatible(question.type, item.entry.type)) continue;
    const textScore = preparedTextSimilarity(
      queryNorm,
      queryGrams2,
      queryGrams3,
      item.normStem,
      item.grams2,
      item.grams3,
    );
    let score = textScore;
    if (queryChoiceLike && isChoiceLike(item.entry.type) && item.normOptions.size > 0) {
      score = 0.75 * textScore + 0.25 * optionSetJaccard(queryOptions, item.normOptions);
    }
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  if (!bestItem || bestScore < threshold) return null;
  return { entry: bestItem.entry, score: Math.min(1, bestScore), mode: "fuzzy" };
}

/** 按题干文本模糊检索（UI 搜索框用），按得分降序 */
export async function searchBankByText(
  text: string,
  limit = 10,
  threshold = 0.2,
): Promise<BankSearchHit[]> {
  const index = await ensureIndex();
  const queryNorm = normalizeText(text);
  if (!queryNorm) return [];
  const queryGrams2 = ngrams(queryNorm, 2);
  const queryGrams3 = ngrams(queryNorm, 3);
  const hits: BankSearchHit[] = [];
  for (const item of index.items) {
    const score = preparedTextSimilarity(
      queryNorm,
      queryGrams2,
      queryGrams3,
      item.normStem,
      item.grams2,
      item.grams3,
    );
    if (score >= threshold) hits.push({ entry: item.entry, score });
  }
  hits.sort((left, right) => right.score - left.score);
  return hits.slice(0, Math.max(1, Math.floor(limit) || 10));
}

/** 写入/覆盖单条题库条目（AI 答案回填用） */
export async function putBankEntry(entry: BankEntry): Promise<void> {
  const store = await getBankStore();
  await store.putEntries([entry]);
  upsertIndexEntry(entry);
}

/** 批量写入题库条目 */
export async function putBankEntries(entries: BankEntry[]): Promise<void> {
  if (!entries.length) return;
  const store = await getBankStore();
  for (let i = 0; i < entries.length; i += 500) {
    await store.putEntries(entries.slice(i, i + 500));
  }
  for (const entry of entries) upsertIndexEntry(entry);
}

/* ------------------------------------------------------------------ */
/* 清空 / 导出                                                         */
/* ------------------------------------------------------------------ */

/** 清空题库条目与解题缓存 */
export async function clearBank(): Promise<void> {
  const store = await getBankStore();
  await store.clearAll();
  invalidateIndex();
  logger.info("bank", "题库与缓存已清空");
}

function csvEscape(value: string): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** 导出题库：json（可再次导入）或 csv */
export async function exportBank(format: "json" | "csv" = "json"): Promise<string> {
  const store = await getBankStore();
  const entries = (await store.getAllEntries()).sort((a, b) => b.updatedAt - a.updatedAt);

  if (format === "csv") {
    const header = ["type", "question", "options", "answer", "source"];
    const lines = [header.join(",")];
    for (const entry of entries) {
      lines.push(
        [
          entry.type,
          entry.stem,
          (entry.options ?? []).join("\n"),
          formatAnswerText(entry.answer),
          entry.source,
        ]
          .map((cell) => csvEscape(cell))
          .join(","),
      );
    }
    return lines.join("\n");
  }

  const payload = entries.map((entry) => ({
    type: entry.type,
    question: entry.stem,
    options: entry.options ?? [],
    answer: entry.answer,
    source: entry.source,
    updatedAt: entry.updatedAt,
    hash: entry.hash,
  }));
  return JSON.stringify(payload, null, 2);
}

/* ------------------------------------------------------------------ */
/* 解题缓存                                                            */
/* ------------------------------------------------------------------ */

function cacheTtlMs(): number {
  const days = getSettings().bank.cacheTtlDays;
  if (!Number.isFinite(days) || days <= 0) return 0;
  return days * 24 * 60 * 60 * 1000;
}

/** 写入解题缓存（key 为题目 hash，TTL 来自 settings.bank.cacheTtlDays） */
export async function putCache(question: Question, result: SolveResult): Promise<void> {
  if (!result.answer) return;
  const ttl = cacheTtlMs();
  if (ttl <= 0) return;
  const store = await getBankStore();
  const record: CacheRecord = {
    key: bankQuestionHash(question),
    answer: cloneAnswer(result.answer),
    confidence: result.confidence,
    source: result.source,
    status: result.status,
    explanation: result.explanation,
    latencyMs: result.latencyMs,
    costTokens: result.costTokens,
    createdAt: Date.now(),
  };
  await store.putCache(record);
}

/** 读取解题缓存，过期自动删除 */
export async function getCachedSolve(question: Question): Promise<SolveResult | null> {
  const ttl = cacheTtlMs();
  if (ttl <= 0) return null;
  const store = await getBankStore();
  const key = bankQuestionHash(question);
  const record = await store.getCache(key);
  if (!record) return null;
  if (Date.now() - record.createdAt > ttl) {
    await store.deleteCache(key);
    return null;
  }
  return {
    questionId: question.id,
    answer: cloneAnswer(record.answer),
    confidence: record.confidence,
    source: record.source as SolveSource,
    status: record.status,
    explanation: record.explanation,
    latencyMs: record.latencyMs,
    costTokens: record.costTokens,
  };
}

/** 仅清空解题缓存 */
export async function clearCache(): Promise<void> {
  const store = await getBankStore();
  await store.clearCache();
}

/** 仅供测试：重置存储选择与内存索引 */
export function resetBankForTests(): void {
  invalidateIndex();
  resetBankStoreForTests();
}

/** 导出存储实例（调试/统计用） */
export async function getBankStorage(): Promise<BankStore> {
  return getBankStore();
}
