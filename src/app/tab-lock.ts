/**
 * 多标签页互斥锁（设计文档 3.3 / P11）。
 *
 * 目的：同一门课程的多个标签页都打开自动翻页时，只允许一个标签页真正翻页，
 * 避免“两个标签页同时点下一节”导致任务点乱序、进度互相覆盖。
 *
 * 实现约定：
 * - 锁 key 由 `lockKeyFromUrl` 从 URL 参数推导（`courseId:clazzid`），
 *   URL 缺少这两个参数时退化为 `hostname + pathname 前缀`，保证不同标签页
 *   在同一个页面上算出同一个 key；
 * - 锁值存在 `localStorage`（同源标签页共享，不使用 GM 存储，避免跨域子
 *   frame 拿到不同视图），JSON 结构 `{ tabId, heartbeatAt, label }`；
 * - 心跳超过 {@link TAB_LOCK_TTL_MS} 视为过期，其他标签页可直接接管，避免
 *   标签页崩溃/被杀后永久死锁；
 * - 所有存储访问都包在 try/catch 里：读写失败不抛异常，读失败返回 `null`，
 *   写失败让抢锁返回 `{ ok: false }`；
 * - 本模块不做定时器、不绑定事件，心跳与释放由 Host 在 startAutoTurn /
 *   stop / pagehide / dispose 时调用，便于单测用可控的 `now` 验证过期逻辑。
 */

/** 锁 key 前缀，避免与设置、题库等存储键冲突 */
const STORAGE_PREFIX = "study-helper.tab-lock.v1";

/** 心跳超过该时长（15s）视为持有者已失联，可被接管 */
export const TAB_LOCK_TTL_MS = 15_000;

/** Host 推荐的心跳间隔（5s，设计要求；小于 TTL 的 1/2 留出重试余量） */
export const TAB_LOCK_HEARTBEAT_MS = 5_000;

/** 锁内容 */
export interface TabLockInfo {
  /** 持有者标签页标识（页面级随机 id） */
  tabId: string;
  /** 最后一次心跳时间戳（毫秒） */
  heartbeatAt: number;
  /** 人类可读的持有者说明，例如“课程 A · 第 3 章” */
  label: string;
}

/** 抢锁结果：成功或返回当前持有者信息 */
export type AcquireTabLockResult = { ok: true } | { ok: false; holder: TabLockInfo };

/** 写失败且没有任何持有者信息时使用的占位 holder */
const STORAGE_UNAVAILABLE_HOLDER: TabLockInfo = {
  tabId: "",
  heartbeatAt: 0,
  label: "浏览器存储不可用",
};

function getStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage as Storage | undefined;
    return storage ?? null;
  } catch {
    // 某些隐私模式 / 禁用 cookie 的环境访问 localStorage 直接抛 SecurityError
    return null;
  }
}

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}:${key}`;
}

function toLockInfo(value: unknown): TabLockInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const tabId = record.tabId;
  const heartbeatAt = record.heartbeatAt;
  if (typeof tabId !== "string" || tabId.length === 0) return null;
  if (typeof heartbeatAt !== "number" || !Number.isFinite(heartbeatAt)) return null;
  const label = typeof record.label === "string" ? record.label : "";
  return { tabId, heartbeatAt, label };
}

/**
 * 从 URL 推导锁 key。
 *
 * - `courseId` / `clazzid` 同时存在 → `courseId:clazzid`（参数名大小写兼容，
 *   与参数顺序无关）；
 * - 任一缺失 → `hostname + pathname 前两段` 作为前缀（例如
 *   `mooc1.chaoxing.com/mycourse/studentstudy`）；
 * - URL 非法时退化为去掉 query/hash 后的原始前缀，保证同一标签页集合内稳定。
 */
export function lockKeyFromUrl(url: string): string {
  const base =
    typeof location !== "undefined" && location.href ? location.href : "https://chaoxing.com/";
  let parsed: URL | null = null;
  try {
    parsed = new URL(url, base);
  } catch {
    parsed = null;
  }
  if (!parsed) return fallbackKeyFromRaw(url);

  const courseId = findParam(parsed.searchParams, "courseid");
  const clazzId = findParam(parsed.searchParams, "clazzid");
  if (courseId && clazzId) return `${courseId}:${clazzId}`;
  return hostPathPrefix(parsed);
}

function findParam(params: URLSearchParams, lowerName: string): string {
  for (const [name, value] of params) {
    if (name.toLowerCase() === lowerName) {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return "";
}

function hostPathPrefix(url: URL): string {
  const segments = url.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .slice(0, 2);
  const parts = [url.hostname, ...segments].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join("/") : "unknown";
}

function fallbackKeyFromRaw(raw: string): string {
  const cleaned = raw
    .split("#")[0]
    .split("?")[0]
    .trim()
    .replace(/\/+$/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "unknown";
}

/**
 * 读取锁；不存在、JSON 损坏、结构不合法或存储不可用时返回 `null`。
 * 不做过期判断：过期与否由调用方结合 `now` 决定（`acquireLock` 内部已处理）。
 */
export function readLock(key: string): TabLockInfo | null {
  const storage = getStorage();
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey(key));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return toLockInfo(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function writeLock(key: string, info: TabLockInfo): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(storageKey(key), JSON.stringify(info));
    return true;
  } catch {
    return false;
  }
}

/**
 * 抢锁。
 *
 * - 无锁、或锁属于自己、或心跳已超过 {@link TAB_LOCK_TTL_MS} → 成功并写入新锁；
 * - 锁被其他标签页持有且心跳未过期 → 返回 `{ ok: false, holder }`，**不修改**
 *   对方的锁（设计要求：冲突只拒绝启动，不停止对方）；
 * - 写入失败（存储不可用/配额已满）→ 返回 `{ ok: false }`，让调用方拒绝启动，
 *   避免“以为抢到了但跨标签页实际没生效”。
 */
export function acquireLock(
  key: string,
  tabId: string,
  label: string,
  now: number,
): AcquireTabLockResult {
  const current = readLock(key);
  const heldByOther =
    current !== null && current.tabId !== tabId && now - current.heartbeatAt < TAB_LOCK_TTL_MS;
  if (heldByOther) return { ok: false, holder: current };

  const info: TabLockInfo = { tabId, heartbeatAt: now, label };
  if (!writeLock(key, info)) {
    return { ok: false, holder: current ?? STORAGE_UNAVAILABLE_HOLDER };
  }
  return { ok: true };
}

/**
 * 心跳：锁仍属于自己时更新 `heartbeatAt` 并返回 `true`，否则返回 `false`
 * （被其他标签页接管 / 锁被释放 / 存储不可用），调用方据此停止本页自动翻页。
 * 保留原有 `label`，避免心跳覆盖持有者说明。
 */
export function heartbeatLock(key: string, tabId: string, now: number): boolean {
  const current = readLock(key);
  if (!current || current.tabId !== tabId) return false;
  return writeLock(key, { ...current, heartbeatAt: now });
}

/** 释放锁：只删除属于 `tabId` 的锁，不误删其他标签页刚接管的锁 */
export function releaseLock(key: string, tabId: string): void {
  const current = readLock(key);
  if (!current || current.tabId !== tabId) return;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(key));
  } catch {
    /* 存储不可用时无法释放，TTL 过期后会自动可接管 */
  }
}
