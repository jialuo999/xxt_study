export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
}

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];
const listeners = new Set<(entries: readonly LogEntry[]) => void>();
let nextId = 1;
let muted = false;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{8,}/g, "sk-••••"],
  [/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1••••"],
  [/("?(?:apiKey|api_key|key|token)"?\s*[:=]\s*"?)[^"\s,}]+/gi, "$1••••"],
];

export function redact(input: string): string {
  let out = input;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function safeData(data: unknown): unknown {
  if (data instanceof Error) {
    return { name: data.name, message: redact(data.message), stack: data.stack };
  }
  if (typeof data === "string") return redact(data);
  if (data == null || typeof data === "number" || typeof data === "boolean") return data;
  try {
    return JSON.parse(redact(JSON.stringify(data))) as unknown;
  } catch {
    return String(data);
  }
}

function push(level: LogLevel, scope: string, message: string, data?: unknown): void {
  if (muted && level === "debug") return;
  const entry: LogEntry = {
    id: nextId++,
    ts: Date.now(),
    level,
    scope,
    message: redact(message),
    data: data === undefined ? undefined : safeData(data),
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  for (const listener of listeners) {
    try {
      listener(entries);
    } catch {
      /* ignore */
    }
  }
  const consoleFn =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (level !== "debug") {
    consoleFn(`[study-helper:${scope}]`, entry.message, entry.data ?? "");
  }
}

export const logger = {
  debug: (scope: string, message: string, data?: unknown) => push("debug", scope, message, data),
  info: (scope: string, message: string, data?: unknown) => push("info", scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => push("warn", scope, message, data),
  error: (scope: string, message: string, data?: unknown) => push("error", scope, message, data),
};

export function getLogs(): readonly LogEntry[] {
  return entries;
}

export function subscribeLogs(listener: (entries: readonly LogEntry[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearLogs(): void {
  entries.length = 0;
  for (const listener of listeners) listener(entries);
}

export function setMuted(value: boolean): void {
  muted = value;
}

export function exportLogs(): string {
  return entries
    .map((entry) => {
      const time = new Date(entry.ts).toISOString();
      const data = entry.data === undefined ? "" : ` ${JSON.stringify(entry.data)}`;
      return `${time} [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}${data}`;
    })
    .join("\n");
}
