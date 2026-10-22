import { sleep } from "./async";

export function queryFirst<T extends Element = HTMLElement>(
  root: ParentNode,
  selectors: readonly string[],
): T | null {
  for (const selector of selectors) {
    try {
      const element = root.querySelector<T>(selector);
      if (element) return element;
    } catch {
      /* invalid selector: skip */
    }
  }
  return null;
}

export function queryAll<T extends Element = HTMLElement>(
  root: ParentNode,
  selectors: readonly string[],
): T[] {
  const seen = new Set<Element>();
  const result: T[] = [];
  for (const selector of selectors) {
    try {
      for (const element of root.querySelectorAll<T>(selector)) {
        if (!seen.has(element)) {
          seen.add(element);
          result.push(element);
        }
      }
    } catch {
      /* invalid selector: skip */
    }
  }
  return result;
}

export function textOf(element: Element | null | undefined): string {
  if (!element) return "";
  const raw = (element as HTMLElement).innerText ?? element.textContent ?? "";
  return raw.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function isVisible(element: Element | null | undefined): boolean {
  if (!element) return false;
  const el = element as HTMLElement;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0 && el.offsetParent === null) {
    // jsdom 的布局信息不可靠；只要在文档里就认为是可见的
    return document.body.contains(el);
  }
  return true;
}

export function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function clickElement(element: Element | null | undefined): boolean {
  if (!element) return false;
  const el = element as HTMLElement;
  try {
    el.scrollIntoView?.({ block: "center", inline: "nearest" });
  } catch {
    /* ignore */
  }
  try {
    if (typeof el.click === "function") {
      el.click();
    } else {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
    return true;
  } catch {
    return false;
  }
}

export function clickInputLabel(input: HTMLInputElement, container?: Element | null): boolean {
  if (input.checked) return true;
  const label = input.closest("label") ?? container?.querySelector("label") ?? null;
  if (label) {
    clickElement(label);
    if (input.checked) return true;
  }
  return clickElement(input);
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (predicate()) return true;
    } catch {
      /* ignore */
    }
    await sleep(intervalMs);
  }
  return false;
}

export function isChecked(input: HTMLInputElement): boolean {
  return input.checked;
}

export function formatFrameId(): string {
  if (window.top === window) return "top";
  const random = Math.random().toString(36).slice(2, 8);
  return `frame-${random}`;
}
