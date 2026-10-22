/** 选择 UI Host：最上层可访问（同源）的祖先窗口。 */
export function findUiHost(): Window {
  let current: Window = window;
  while (current.parent && current.parent !== current) {
    try {
      // 访问 document 会在跨域时抛异常，从而停在当前层
      void current.parent.document.documentElement;
      current = current.parent;
    } catch {
      break;
    }
  }
  return current;
}

export function frameId(): string {
  if (findUiHost() === window) return "top";
  const key = "study-helper.frameId";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const next = `frame-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(key, next);
    return next;
  } catch {
    return `frame-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function isSameWindow(left: Window | null, right: Window): boolean {
  if (!left) return false;
  try {
    return left === right;
  } catch {
    return false;
  }
}
