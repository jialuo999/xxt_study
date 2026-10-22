/**
 * 题库持久化层：优先使用 IndexedDB，环境不支持时退化为内存存储。
 *
 * 数据库：study-helper（version 1）
 * - entries：keyPath = id，index = hash
 * - cache：keyPath = key（解题结果缓存）
 * - meta：keyPath = key（导入时间等元信息）
 *
 * 不引入第三方依赖，所有操作都包成 Promise，便于在测试环境中替换/退化。
 */

import { logger } from "../core/logger";
import type { AnswerValue, BankEntry, SolveSource, SolveStatus } from "../core/types";

export const DB_NAME = "study-helper";
export const DB_VERSION = 1;
export const STORE_ENTRIES = "entries";
export const STORE_CACHE = "cache";
export const STORE_META = "meta";

export type StoreKind = "indexeddb" | "memory";

/** 解题缓存记录 */
export interface CacheRecord {
  key: string;
  answer: AnswerValue;
  confidence: number;
  source: SolveSource;
  status: SolveStatus;
  explanation?: string;
  latencyMs: number;
  costTokens?: number;
  createdAt: number;
}

export interface MetaRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}

/** 题库存储抽象，索引层只依赖这一层 */
export interface BankStore {
  readonly kind: StoreKind;
  putEntries(entries: BankEntry[]): Promise<void>;
  getByHash(hash: string): Promise<BankEntry[]>;
  getAllEntries(): Promise<BankEntry[]>;
  count(): Promise<number>;
  deleteById(id: string): Promise<void>;
  clearEntries(): Promise<void>;
  /** 按 updatedAt 从旧到新裁剪，保留最新的 limit 条，返回删除数量 */
  prune(limit: number): Promise<number>;
  getCache(key: string): Promise<CacheRecord | null>;
  putCache(record: CacheRecord): Promise<void>;
  deleteCache(key: string): Promise<void>;
  clearCache(): Promise<void>;
  countCache(): Promise<number>;
  clearAll(): Promise<void>;
  getMeta(key: string): Promise<unknown>;
  setMeta(key: string, value: unknown): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* 通用工具                                                            */
/* ------------------------------------------------------------------ */

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 请求失败"));
  });
}

function transactionAsPromise(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 事务失败"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB 事务已中止"));
  });
}

function sortByUpdatedAt(entries: BankEntry[]): BankEntry[] {
  return entries.slice().sort((a, b) => a.updatedAt - b.updatedAt);
}

/* ------------------------------------------------------------------ */
/* IndexedDB 实现                                                      */
/* ------------------------------------------------------------------ */

/** 打开（并按需升级）题库数据库；失败时由调用方决定是否退化。 */
export function openStudyDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        const entries = db.createObjectStore(STORE_ENTRIES, { keyPath: "id" });
        entries.createIndex("hash", "hash", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          /* ignore */
        }
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 打开失败"));
    request.onblocked = () => {
      logger.warn("bank", "IndexedDB 升级被其他标签页阻塞，稍后重试");
    };
  });
}

class IndexedDbBankStore implements BankStore {
  readonly kind = "indexeddb" as const;

  constructor(private readonly db: IDBDatabase) {}

  private async readAll<T>(storeName: string): Promise<T[]> {
    const tx = this.db.transaction(storeName, "readonly");
    const done = transactionAsPromise(tx);
    const request = tx.objectStore(storeName).getAll() as IDBRequest<T[]>;
    const rows = await requestAsPromise(request);
    await done;
    return rows;
  }

  async putEntries(entries: BankEntry[]): Promise<void> {
    if (!entries.length) return;
    const tx = this.db.transaction(STORE_ENTRIES, "readwrite");
    const done = transactionAsPromise(tx);
    const store = tx.objectStore(STORE_ENTRIES);
    for (const entry of entries) store.put(entry);
    await done;
  }

  async getByHash(hash: string): Promise<BankEntry[]> {
    const tx = this.db.transaction(STORE_ENTRIES, "readonly");
    const done = transactionAsPromise(tx);
    const request = tx.objectStore(STORE_ENTRIES).index("hash").getAll(hash) as IDBRequest<
      BankEntry[]
    >;
    const rows = await requestAsPromise(request);
    await done;
    return rows;
  }

  getAllEntries(): Promise<BankEntry[]> {
    return this.readAll<BankEntry>(STORE_ENTRIES);
  }

  async count(): Promise<number> {
    const tx = this.db.transaction(STORE_ENTRIES, "readonly");
    const done = transactionAsPromise(tx);
    const total = await requestAsPromise(tx.objectStore(STORE_ENTRIES).count());
    await done;
    return total;
  }

  async deleteById(id: string): Promise<void> {
    const tx = this.db.transaction(STORE_ENTRIES, "readwrite");
    const done = transactionAsPromise(tx);
    tx.objectStore(STORE_ENTRIES).delete(id);
    await done;
  }

  async clearEntries(): Promise<void> {
    const tx = this.db.transaction(STORE_ENTRIES, "readwrite");
    const done = transactionAsPromise(tx);
    tx.objectStore(STORE_ENTRIES).clear();
    await done;
  }

  async prune(limit: number): Promise<number> {
    if (!Number.isFinite(limit) || limit < 0) return 0;
    const all = await this.getAllEntries();
    if (all.length <= limit) return 0;
    const sorted = sortByUpdatedAt(all);
    const removing = sorted.slice(0, all.length - limit);
    if (!removing.length) return 0;
    const tx = this.db.transaction(STORE_ENTRIES, "readwrite");
    const done = transactionAsPromise(tx);
    const store = tx.objectStore(STORE_ENTRIES);
    for (const entry of removing) store.delete(entry.id);
    await done;
    return removing.length;
  }

  async getCache(key: string): Promise<CacheRecord | null> {
    const tx = this.db.transaction(STORE_CACHE, "readonly");
    const done = transactionAsPromise(tx);
    const record = await requestAsPromise(
      tx.objectStore(STORE_CACHE).get(key) as IDBRequest<CacheRecord | undefined>,
    );
    await done;
    return record ?? null;
  }

  async putCache(record: CacheRecord): Promise<void> {
    const tx = this.db.transaction(STORE_CACHE, "readwrite");
    const done = transactionAsPromise(tx);
    tx.objectStore(STORE_CACHE).put(record);
    await done;
  }

  async deleteCache(key: string): Promise<void> {
    const tx = this.db.transaction(STORE_CACHE, "readwrite");
    const done = transactionAsPromise(tx);
    tx.objectStore(STORE_CACHE).delete(key);
    await done;
  }

  async clearCache(): Promise<void> {
    const tx = this.db.transaction(STORE_CACHE, "readwrite");
    const done = transactionAsPromise(tx);
    tx.objectStore(STORE_CACHE).clear();
    await done;
  }

  async countCache(): Promise<number> {
    const tx = this.db.transaction(STORE_CACHE, "readonly");
    const done = transactionAsPromise(tx);
    const total = await requestAsPromise(tx.objectStore(STORE_CACHE).count());
    await done;
    return total;
  }

  async clearAll(): Promise<void> {
    const tx = this.db.transaction(
      [STORE_ENTRIES, STORE_CACHE, STORE_META],
      "readwrite",
    );
    const done = transactionAsPromise(tx);
    tx.objectStore(STORE_ENTRIES).clear();
    tx.objectStore(STORE_CACHE).clear();
    tx.objectStore(STORE_META).clear();
    await done;
  }

  async getMeta(key: string): Promise<unknown> {
    const tx = this.db.transaction(STORE_META, "readonly");
    const done = transactionAsPromise(tx);
    const record = await requestAsPromise(
      tx.objectStore(STORE_META).get(key) as IDBRequest<MetaRecord | undefined>,
    );
    await done;
    return record ? record.value : undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(STORE_META, "readwrite");
    const done = transactionAsPromise(tx);
    const record: MetaRecord = { key, value, updatedAt: Date.now() };
    tx.objectStore(STORE_META).put(record);
    await done;
  }
}

/* ------------------------------------------------------------------ */
/* 内存实现（IndexedDB 不可用时的退化 / 单元测试）                      */
/* ------------------------------------------------------------------ */

export class MemoryBankStore implements BankStore {
  readonly kind = "memory" as const;
  private entries = new Map<string, BankEntry>();
  private cache = new Map<string, CacheRecord>();
  private meta = new Map<string, MetaRecord>();

  async putEntries(entries: BankEntry[]): Promise<void> {
    for (const entry of entries) this.entries.set(entry.id, entry);
  }

  async getByHash(hash: string): Promise<BankEntry[]> {
    return [...this.entries.values()].filter((entry) => entry.hash === hash);
  }

  async getAllEntries(): Promise<BankEntry[]> {
    return [...this.entries.values()];
  }

  async count(): Promise<number> {
    return this.entries.size;
  }

  async deleteById(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async clearEntries(): Promise<void> {
    this.entries.clear();
  }

  async prune(limit: number): Promise<number> {
    if (!Number.isFinite(limit) || limit < 0) return 0;
    if (this.entries.size <= limit) return 0;
    const sorted = sortByUpdatedAt([...this.entries.values()]);
    const removeCount = sorted.length - limit;
    for (const entry of sorted.slice(0, removeCount)) this.entries.delete(entry.id);
    return removeCount;
  }

  async getCache(key: string): Promise<CacheRecord | null> {
    return this.cache.get(key) ?? null;
  }

  async putCache(record: CacheRecord): Promise<void> {
    this.cache.set(record.key, record);
  }

  async deleteCache(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clearCache(): Promise<void> {
    this.cache.clear();
  }

  async countCache(): Promise<number> {
    return this.cache.size;
  }

  async clearAll(): Promise<void> {
    this.entries.clear();
    this.cache.clear();
    this.meta.clear();
  }

  async getMeta(key: string): Promise<unknown> {
    return this.meta.get(key)?.value;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, { key, value, updatedAt: Date.now() });
  }
}

/* ------------------------------------------------------------------ */
/* 存储选择                                                            */
/* ------------------------------------------------------------------ */

let storePromise: Promise<BankStore> | null = null;

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

/** 获取当前存储实例（懒初始化，失败或超时退化为内存存储） */
export function getBankStore(): Promise<BankStore> {
  if (!storePromise) {
    storePromise = (async (): Promise<BankStore> => {
      if (!isIndexedDbAvailable()) {
        logger.debug("bank", "当前环境无 IndexedDB，使用内存题库");
        return new MemoryBankStore();
      }
      try {
        const opened = await Promise.race([
          openStudyDb(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("IndexedDB 打开超时（3s）")), 3000);
          }),
        ]);
        return new IndexedDbBankStore(opened);
      } catch (error) {
        logger.warn("bank", "IndexedDB 不可用，本次会话使用内存题库", {
          message: errorMessage(error),
        });
        return new MemoryBankStore();
      }
    })();
  }
  return storePromise;
}

/** 仅供测试：丢弃当前存储实例（下次访问重新选择） */
export function resetBankStoreForTests(): void {
  storePromise = null;
}
