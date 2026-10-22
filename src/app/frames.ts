/**
 * 顶层帧判定：只有真正的 top frame 挂载 UI。
 *
 * 学习通常见 mooc1.chaoxing.com 主页面 + mooc1-1.chaoxing.com 内容 iframe，
 * 两者是不同 origin；如果按“同源祖先”判断，子 frame 会误以为自己也是 Host，
 * 结果一个页面出现两个悬浮球。这里直接用跨域安全的 window.top 比较。
 */
export function isTopFrame(): boolean {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

export function findUiHost(): Window {
  try {
    return window.top ?? window;
  } catch {
    return window;
  }
}

export function frameId(): string {
  if (isTopFrame()) return "top";
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
