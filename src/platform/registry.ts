import type { PlatformAdapter } from "./types";
import { chaoxingAdapter } from "./chaoxing";
import { createConfigAdapter } from "./generic/config-adapter";
import { getSettings } from "@/core/settings-store";

const adapters: PlatformAdapter[] = [chaoxingAdapter];

export function getAdapter(url: URL = new URL(location.href)): PlatformAdapter | null {
  for (const adapter of adapters) {
    try {
      if (adapter.matches(url)) return adapter;
    } catch {
      /* ignore broken adapter */
    }
  }
  const generic = getSettings().advanced.genericConfig;
  if (generic && generic.questionContainer && generic.stem) {
    if (generic.matches.some((pattern) => matchPattern(pattern, url))) {
      try {
        return createConfigAdapter(generic);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function listAdapters(): string[] {
  return adapters.map((adapter) => adapter.id);
}

function matchPattern(pattern: string, url: URL): boolean {
  const value = pattern.trim();
  if (!value) return false;
  if (value.startsWith("*://")) {
    const rest = value.slice(4);
    const host = rest.split("/")[0];
    if (host.startsWith("*.")) return url.hostname.endsWith(host.slice(1));
    return url.hostname === host;
  }
  if (value.includes("*")) {
    try {
      const regex = new RegExp(`^${value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      return regex.test(url.href);
    } catch {
      return false;
    }
  }
  return url.href.startsWith(value) || url.href.includes(value) || url.hostname.endsWith(value);
}
