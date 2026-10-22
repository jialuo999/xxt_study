/**
 * GM_* API 的安全封装：在 Tampermonkey / Violentmonkey 下使用原生 API，
 * 在普通网页（开发调试）下回退到 localStorage / fetch。
 */

type AnyRecord = Record<string, unknown>;
const g = globalThis as unknown as AnyRecord;

export function gmGet<T>(key: string, fallback: T): T {
  const fn = g.GM_getValue as ((k: string, d: T) => T) | undefined;
  if (typeof fn === "function") {
    try {
      return fn(key, fallback);
    } catch {
      /* fall through */
    }
  }
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function gmSet<T>(key: string, value: T): boolean {
  const fn = g.GM_setValue as ((k: string, v: T) => void) | undefined;
  if (typeof fn === "function") {
    try {
      fn(key, value);
      return true;
    } catch {
      /* fall through */
    }
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * 监听 GM 存储变更（跨 frame/tab）。
 * 返回取消监听的函数；环境不支持时返回 no-op。
 */
export function gmAddValueChangeListener(
  key: string,
  onChange: (newValue: unknown, remote: boolean) => void,
): () => void {
  const add = g.GM_addValueChangeListener as
    | ((
        name: string,
        callback: (name: string, oldValue: unknown, newValue: unknown, remote: boolean) => void,
      ) => number)
    | undefined;
  if (typeof add !== "function") return () => undefined;

  let listenerId: number | undefined;
  try {
    listenerId = add(key, (_name, _oldValue, newValue, remote) => onChange(newValue, remote));
  } catch {
    return () => undefined;
  }

  return () => {
    const remove = g.GM_removeValueChangeListener as ((id: number) => void) | undefined;
    if (typeof remove === "function" && typeof listenerId === "number") {
      try {
        remove(listenerId);
      } catch {
        /* ignore */
      }
    }
  };
}

export interface GmRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  data?: string;
  timeoutMs?: number;
}

export interface GmResponse {
  status: number;
  responseText: string;
  finalUrl: string;
}

export function gmRequest(options: GmRequestOptions): Promise<GmResponse> {
  const { method = "GET", url, headers, data, timeoutMs = 60000 } = options;
  const fn = g.GM_xmlhttpRequest as
    | ((details: AnyRecord) => { abort?: () => void })
    | undefined;

  if (typeof fn !== "function") {
    return fetch(url, { method, headers, body: data }).then(async (res) => ({
      status: res.status,
      responseText: await res.text(),
      finalUrl: res.url || url,
    }));
  }

  return new Promise<GmResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const timer = setTimeout(() => {
      try {
        req?.abort?.();
      } catch {
        /* ignore */
      }
      finish(() => reject(new Error(`请求超时（${timeoutMs}ms）`)));
    }, timeoutMs + 1000);

    const req = fn({
      method,
      url,
      headers,
      data,
      timeout: timeoutMs,
      onload: (res: { status: number; responseText: string; finalUrl?: string }) => {
        clearTimeout(timer);
        finish(() =>
          resolve({
            status: res.status,
            responseText: res.responseText ?? "",
            finalUrl: res.finalUrl ?? url,
          }),
        );
      },
      onerror: (err: unknown) => {
        clearTimeout(timer);
        finish(() => reject(new Error(`网络请求失败：${String(err)}`)));
      },
      ontimeout: () => {
        clearTimeout(timer);
        finish(() => reject(new Error(`请求超时（${timeoutMs}ms）`)));
      },
      onabort: () => {
        clearTimeout(timer);
        finish(() => reject(new Error("请求已取消")));
      },
    });
  });
}

export function registerMenuCommand(label: string, fn: () => void): void {
  const register = g.GM_registerMenuCommand as
    | ((name: string, callback: () => void) => void)
    | undefined;
  if (typeof register === "function") {
    try {
      register(label, fn);
    } catch {
      /* ignore */
    }
  }
}

export function notify(text: string, title = "学习助手"): void {
  const fn = g.GM_notification as
    | ((details: { text: string; title: string; timeout?: number }) => void)
    | undefined;
  if (typeof fn === "function") {
    try {
      fn({ text, title, timeout: 4000 });
      return;
    } catch {
      /* fall through */
    }
  }
}

export function unsafeWindowRef(): Window & typeof globalThis {
  const w = g.unsafeWindow as (Window & typeof globalThis) | undefined;
  return w ?? (window as Window & typeof globalThis);
}
