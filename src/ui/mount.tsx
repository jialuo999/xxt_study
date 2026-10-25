import { render } from "preact";
import styles from "./theme.css?inline";
import { App } from "./App";
import type { UiController } from "./contract";
import { registerMenuCommand } from "@/core/gm";
import { applyLanguage, t } from "@/core/i18n";
import { getSettings } from "@/core/settings-store";

const HOST_ID = "study-helper-host";
const SHADOW_ID = "study-helper-shadow";

let mounted = false;
let hostElement: HTMLElement | null = null;
let shadowRootRef: ShadowRoot | null = null;
let rootRef: HTMLElement | null = null;

export function isUiMounted(): boolean {
  return mounted || document.getElementById(HOST_ID) != null;
}

export function mountUi(controller: UiController): void {
  if (isUiMounted()) return;
  applyLanguage(getSettings().ui.language);

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText =
    "all: initial; position: fixed; inset: 0; width: 0; height: 0; overflow: visible; z-index: 2147483647; pointer-events: none;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = styles;
  shadow.appendChild(style);

  const root = document.createElement("div");
  root.id = SHADOW_ID;
  shadow.appendChild(root);

  document.documentElement.appendChild(host);
  hostElement = host;
  shadowRootRef = shadow;
  rootRef = root;
  mounted = true;

  render(<App controller={controller} />, root);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !getSettings().ui.collapsed) {
      controller.setCollapsed(true);
      return;
    }
    if (matchesHotkey(event, getSettings().ui.hotkey)) {
      event.preventDefault();
      event.stopPropagation();
      controller.togglePanel();
    }
  };
  window.addEventListener("keydown", onKeyDown, true);

  registerMenuCommand(t("menu.toggle"), () => controller.togglePanel());
  registerMenuCommand(t("menu.rescan"), () => void controller.refresh());
}

export function unmountUi(): void {
  if (!mounted || !hostElement) return;
  if (rootRef) render(null, rootRef);
  hostElement.remove();
  hostElement = null;
  shadowRootRef = null;
  rootRef = null;
  mounted = false;
}

export function getShadowRoot(): ShadowRoot | null {
  return shadowRootRef;
}

function matchesHotkey(event: KeyboardEvent, hotkey: string): boolean {
  if (!hotkey) return false;
  const parts = hotkey
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return false;
  const key = parts[parts.length - 1];
  const needsAlt = parts.includes("alt");
  const needsCtrl = parts.includes("ctrl") || parts.includes("control");
  const needsMeta = parts.includes("meta") || parts.includes("cmd") || parts.includes("win");
  const needsShift = parts.includes("shift");
  if (event.altKey !== needsAlt) return false;
  if (event.ctrlKey !== needsCtrl) return false;
  if (event.metaKey !== needsMeta) return false;
  if (event.shiftKey !== needsShift) return false;
  return event.key.toLowerCase() === key;
}
