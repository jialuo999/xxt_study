import { gmGet, gmSet } from "./gm";
import { DEFAULT_SETTINGS, SETTINGS_KEY, type DeepPartial, type Settings } from "./settings";

const listeners = new Set<(settings: Settings) => void>();
let cached: Settings | null = null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function merge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base)) {
    if (patch === undefined || patch === null) return base;
    return patch as T;
  }
  if (!isPlainObject(patch)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? merge(current, value) : value;
  }
  return out as T;
}

function normalize(raw: unknown): Settings {
  const merged = merge(structuredClone(DEFAULT_SETTINGS), raw);
  merged.version = 1;
  if (!merged.solving.includeTypes) {
    merged.solving.includeTypes = { ...DEFAULT_SETTINGS.solving.includeTypes };
  }
  if (!merged.bank.remote.headers) {
    merged.bank.remote.headers = { ...DEFAULT_SETTINGS.bank.remote.headers };
  }
  return merged;
}

export function getSettings(): Settings {
  if (!cached) {
    cached = normalize(gmGet<unknown>(SETTINGS_KEY, null));
  }
  return cached;
}

function emit(settings: Settings): void {
  for (const listener of listeners) {
    try {
      listener(settings);
    } catch (error) {
      console.error("[study-helper] settings listener failed", error);
    }
  }
}

function settingsEqual(a: Settings, b: Settings): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * 从 GM 存储重新读取设置，用于跨 frame 同步。
 *
 * 顶层 frame 修改倍速/静音后，子 frame 的 settings-store 缓存不会自动更新；
 * 媒体偏好模块会低频调用本函数，让跨域 iframe 里的播放器也能拿到新设置。
 */
export function refreshSettings(): Settings {
  const current = getSettings();
  const raw = gmGet<unknown>(SETTINGS_KEY, null);
  // 读取失败或存储被清空时保持当前缓存，避免瞬时的空值把设置重置为默认
  if (!isPlainObject(raw)) return current;
  const next = normalize(raw);
  if (settingsEqual(next, current)) return current;
  cached = next;
  emit(next);
  return next;
}

export function updateSettings(patch: DeepPartial<Settings>): Settings {
  const next = normalize(merge(getSettings(), patch));
  cached = next;
  gmSet(SETTINGS_KEY, next);
  emit(next);
  return next;
}

export function replaceSettings(next: Settings): Settings {
  cached = normalize(next);
  gmSet(SETTINGS_KEY, cached);
  emit(cached);
  return cached;
}

export function resetSettings(): Settings {
  return replaceSettings(structuredClone(DEFAULT_SETTINGS));
}

export function subscribeSettings(listener: (settings: Settings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getApiKey(): string {
  return getSettings().ai.apiKey.trim();
}

export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}
