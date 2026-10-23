import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TAB_LOCK_HEARTBEAT_MS,
  TAB_LOCK_TTL_MS,
  acquireLock,
  heartbeatLock,
  lockKeyFromUrl,
  readLock,
  releaseLock,
} from "../../src/app/tab-lock";

const KEY = "123:456";
const T0 = 1_700_000_000_000;

function storedKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key) keys.push(key);
  }
  return keys;
}

/** 绕过模块 API，直接把锁存储改成自定义内容（模拟损坏/旧版本数据） */
function overwriteStoredLock(raw: string): void {
  const keys = storedKeys();
  expect(keys).toHaveLength(1);
  localStorage.setItem(keys[0], raw);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("lockKeyFromUrl", () => {
  it("courseId + clazzid 同时存在时使用组合 key", () => {
    expect(
      lockKeyFromUrl("https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=123&clazzid=456"),
    ).toBe("123:456");
  });

  it("参数名大小写兼容且与参数顺序无关", () => {
    expect(
      lockKeyFromUrl(
        "https://mooc1.chaoxing.com/mycourse/studentstudy?CLAZZID=456&chapterId=9&COURSEID=123",
      ),
    ).toBe("123:456");
    expect(
      lockKeyFromUrl(
        "https://mooc1.chaoxing.com/mycourse/studentstudy?CourseId=123&ClazzId=456",
      ),
    ).toBe("123:456");
  });

  it("query 与 hash 不影响 key", () => {
    const a = lockKeyFromUrl(
      "https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=123&clazzid=456&chapterId=9",
    );
    const b = lockKeyFromUrl(
      "https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=123&clazzid=456#anchor",
    );
    expect(a).toBe("123:456");
    expect(b).toBe("123:456");
  });

  it("缺少 clazzid 时退化为 hostname + pathname 前缀", () => {
    expect(
      lockKeyFromUrl("https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=123"),
    ).toBe("mooc1.chaoxing.com/mycourse/studentstudy");
    expect(
      lockKeyFromUrl("https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=9"),
    ).toBe("mooc1.chaoxing.com/mycourse/studentstudy");
  });

  it("相对 URL 也能稳定生成 key", () => {
    expect(lockKeyFromUrl("/mycourse/studentstudy?courseId=1&clazzid=2")).toBe("1:2");
    expect(lockKeyFromUrl("/mycourse/studentstudy?chapterId=9")).toBe(
      `${location.hostname}/mycourse/studentstudy`,
    );
  });

  it("非法 URL 回退为稳定非空 key", () => {
    const key = lockKeyFromUrl("http://");
    expect(key.length).toBeGreaterThan(0);
    expect(lockKeyFromUrl("http://")).toBe(key);
  });

  it("导出的心跳/TTL 常量符合设计（5s / 15s）", () => {
    expect(TAB_LOCK_TTL_MS).toBe(15_000);
    expect(TAB_LOCK_HEARTBEAT_MS).toBe(5_000);
  });
});

describe("抢锁与冲突", () => {
  it("首次抢锁成功并写入锁", () => {
    expect(acquireLock(KEY, "tab-a", "第 3 章", T0)).toEqual({ ok: true });
    expect(readLock(KEY)).toEqual({ tabId: "tab-a", heartbeatAt: T0, label: "第 3 章" });
  });

  it("有效期内其他标签页抢锁失败并返回持有者信息", () => {
    acquireLock(KEY, "tab-a", "第 3 章", T0);
    const result = acquireLock(KEY, "tab-b", "第 4 章", T0 + 1_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.holder).toEqual({ tabId: "tab-a", heartbeatAt: T0, label: "第 3 章" });
    }
    // 冲突不修改对方的锁
    expect(readLock(KEY)?.tabId).toBe("tab-a");
  });

  it("同一标签页重复抢锁视为续约并更新 label", () => {
    acquireLock(KEY, "tab-a", "第 3 章", T0);
    const result = acquireLock(KEY, "tab-a", "第 3 章（续）", T0 + 2_000);
    expect(result).toEqual({ ok: true });
    expect(readLock(KEY)).toEqual({
      tabId: "tab-a",
      heartbeatAt: T0 + 2_000,
      label: "第 3 章（续）",
    });
  });

  it("心跳未过期不可接管（TTL - 1ms）", () => {
    acquireLock(KEY, "tab-a", "第 3 章", T0);
    expect(acquireLock(KEY, "tab-b", "第 4 章", T0 + TAB_LOCK_TTL_MS - 1).ok).toBe(false);
  });

  it("心跳超过 15s 后可被接管（含边界值）", () => {
    acquireLock(KEY, "tab-a", "第 3 章", T0);
    expect(acquireLock(KEY, "tab-b", "第 4 章", T0 + TAB_LOCK_TTL_MS)).toEqual({ ok: true });
    expect(readLock(KEY)).toEqual({
      tabId: "tab-b",
      heartbeatAt: T0 + TAB_LOCK_TTL_MS,
      label: "第 4 章",
    });
  });

  it("过期锁属于自己时重新抢锁直接成功", () => {
    acquireLock(KEY, "tab-a", "第 3 章", T0);
    expect(acquireLock(KEY, "tab-a", "第 3 章", T0 + TAB_LOCK_TTL_MS * 2)).toEqual({ ok: true });
    expect(readLock(KEY)?.heartbeatAt).toBe(T0 + TAB_LOCK_TTL_MS * 2);
  });

  it("now 早于心跳时间（时钟回拨）时视为有效持有", () => {
    acquireLock(KEY, "tab-a", "第 3 章", T0);
    expect(acquireLock(KEY, "tab-b", "第 4 章", T0 - 5_000).ok).toBe(false);
  });
});

describe("心跳", () => {
  it("锁属于自己时心跳更新 heartbeatAt 并保留 label", () => {
    acquireLock(KEY, "tab-a", "第 3 章", T0);
    expect(heartbeatLock(KEY, "tab-a", T0 + 5_000)).toBe(true);
    expect(readLock(KEY)).toEqual({ tabId: "tab-a", heartbeatAt: T0 + 5_000, label: "第 3 章" });
  });

  it("锁被其他标签页持有时心跳返回 false 且不改写", () => {
    acquireLock(KEY, "tab-a", "第 3 章", T0);
    expect(heartbeatLock(KEY, "tab-b", T0 + 5_000)).toBe(false);
    expect(readLock(KEY)?.heartbeatAt).toBe(T0);
  });

  it("锁被接管后原标签页心跳失败", () => {
    acquireLock(KEY, "tab-a", "第 3 章", T0);
    acquireLock(KEY, "tab-b", "第 4 章", T0 + TAB_LOCK_TTL_MS);
    expect(heartbeatLock(KEY, "tab-a", T0 + TAB_LOCK_TTL_MS + 1_000)).toBe(false);
    expect(readLock(KEY)?.tabId).toBe("tab-b");
  });

  it("无锁时心跳返回 false", () => {
    expect(heartbeatLock(KEY, "tab-a", T0)).toBe(false);
  });
});

describe("释放", () => {
  it("只删除自己的锁", () => {
    acquireLock(KEY, "tab-a", "第 3 章", T0);
    releaseLock(KEY, "tab-b");
    expect(readLock(KEY)?.tabId).toBe("tab-a");
    releaseLock(KEY, "tab-a");
    expect(readLock(KEY)).toBeNull();
  });

  it("释放后其他标签页可立即抢锁", () => {
    acquireLock(KEY, "tab-a", "第 3 章", T0);
    releaseLock(KEY, "tab-a");
    expect(acquireLock(KEY, "tab-b", "第 4 章", T0 + 100)).toEqual({ ok: true });
  });

  it("无锁时释放不抛异常", () => {
    expect(() => releaseLock(KEY, "tab-a")).not.toThrow();
  });
});

describe("存储异常", () => {
  it("读取异常时 readLock 返回 null", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readLock(KEY)).toBeNull();
    expect(heartbeatLock(KEY, "tab-a", T0)).toBe(false);
  });

  it("写入异常时抢锁失败（不假装成功）", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const result = acquireLock(KEY, "tab-a", "第 3 章", T0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.holder.label).toBe("浏览器存储不可用");
  });

  it("删除异常时释放不抛异常", () => {
    acquireLock(KEY, "tab-a", "第 3 章", T0);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => releaseLock(KEY, "tab-a")).not.toThrow();
  });

  it("损坏的 JSON 被忽略，其他标签页可接管", () => {
    acquireLock(KEY, "tab-a", "第 3 章", T0);
    overwriteStoredLock("{broken json");
    expect(readLock(KEY)).toBeNull();
    expect(acquireLock(KEY, "tab-b", "第 4 章", T0 + 100)).toEqual({ ok: true });
    expect(readLock(KEY)?.tabId).toBe("tab-b");
  });

  it("结构不合法（缺 heartbeatAt / 非对象）被忽略", () => {
    acquireLock(KEY, "tab-a", "第 3 章", T0);
    overwriteStoredLock(JSON.stringify({ tabId: "tab-a" }));
    expect(readLock(KEY)).toBeNull();
    overwriteStoredLock(JSON.stringify({ tabId: "tab-a", heartbeatAt: "yesterday" }));
    expect(readLock(KEY)).toBeNull();
    overwriteStoredLock("null");
    expect(readLock(KEY)).toBeNull();
    overwriteStoredLock(JSON.stringify({ tabId: "", heartbeatAt: T0 }));
    expect(readLock(KEY)).toBeNull();
  });
});
