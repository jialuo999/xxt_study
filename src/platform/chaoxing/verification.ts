/**
 * 学习通人机验证 / 【9010】操作异常识别。
 *
 * 只读取“可见的 light DOM”文本与输入框：
 * - 不读取 <script>/<style>/<template> 里的模板字符串（学习通常见登录/验证码模板，
 *   其中可能出现“请输入验证码”，这是旧版本误报的来源）；
 * - 不读取 display:none / visibility:hidden / aria-hidden 的隐藏弹层；
 * - 不读取 Shadow DOM 中的面板 UI。
 *
 * 脚本不识别、不绕过验证码；识别到之后只负责暂停自动流程并提示用户手动处理。
 */

export interface VerificationChallenge {
  detected: boolean;
  message: string;
  /** 命中特征，仅用于日志排查 */
  reason?: "9010" | "captcha-prompt" | "abnormal-captcha";
}

const MAX_TEXT_LENGTH = 20000;

const CAPTCHA_INPUT_SELECTOR = [
  'input[placeholder*="验证码"]',
  'input[name*="captcha" i]',
  'input[id*="captcha" i]',
].join(", ");

const CAPTCHA_IMAGE_SELECTOR = [
  'img[src*="captcha" i]',
  'img[id*="captcha" i]',
  "#captchaImg",
  ".captcha img",
].join(", ");

export function detectVerificationChallenge(doc: Document): VerificationChallenge {
  try {
    const body = doc.body;
    if (!body) return { detected: false, message: "" };

    const text = readVisibleText(doc);
    const title = doc.title ?? "";
    const has9010 = /【\s*9010\s*】/.test(text) || /【\s*9010\s*】/.test(title);
    const hasAbnormal = /操作异常/.test(text) || /操作异常/.test(title);
    const hasCaptchaPrompt = /请输入图片中的验证码|请输入验证码|输入验证码/.test(text);
    const mentionsCaptcha = /验证码/.test(text);
    const hasCaptchaInput = hasVisibleElement(doc, CAPTCHA_INPUT_SELECTOR);
    const hasCaptchaImage = hasVisibleElement(doc, CAPTCHA_IMAGE_SELECTOR);
    const hasCaptchaWidget = hasCaptchaInput || hasCaptchaImage;

    // 9010 是强特征；其余情况必须同时看到可见的验证码输入框/图片，
    // 避免把隐藏弹层或脚本模板里的“验证码”文案当成真实验证页。
    const detected =
      has9010 || ((hasCaptchaPrompt || (hasAbnormal && mentionsCaptcha)) && hasCaptchaWidget);

    if (!detected) return { detected: false, message: "" };
    return {
      detected: true,
      message: has9010
        ? "平台返回【9010】操作异常，需要手动输入图片验证码"
        : "平台要求人机验证，需要手动输入图片验证码",
      reason: has9010 ? "9010" : hasCaptchaPrompt ? "captcha-prompt" : "abnormal-captcha",
    };
  } catch {
    return { detected: false, message: "" };
  }
}

function hasVisibleElement(doc: Document, selector: string): boolean {
  try {
    return Array.from(doc.querySelectorAll<HTMLElement>(selector)).some((element) =>
      isVisible(element),
    );
  } catch {
    return false;
  }
}

function isVisible(element: Element): boolean {
  try {
    let current: Element | null = element;
    while (current) {
      if (current.hasAttribute("hidden")) return false;
      if (current.getAttribute("aria-hidden") === "true") return false;
      const inline = (current as HTMLElement).style;
      if (
        inline &&
        (inline.display === "none" || inline.visibility === "hidden" || inline.opacity === "0")
      ) {
        return false;
      }
      const style = current.ownerDocument.defaultView?.getComputedStyle(current);
      if (
        style &&
        (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
      ) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  } catch {
    return false;
  }
}

function readVisibleText(doc: Document): string {
  const body = doc.body;
  if (!body) return "";
  try {
    // 浏览器里 innerText 只包含渲染出来的文本，天然排除隐藏元素、script/style 和 Shadow DOM
    const inner = body.innerText;
    if (typeof inner === "string" && inner.trim()) {
      return inner.replace(/\s+/g, " ").slice(0, MAX_TEXT_LENGTH);
    }
  } catch {
    /* 回退到 light DOM 遍历 */
  }
  return readLightDomText(doc, body);
}

/** jsdom 等没有布局的环境回退：遍历 light DOM，跳过脚本/样式/隐藏元素 */
function readLightDomText(doc: Document, body: HTMLElement): string {
  const parts: string[] = [];
  let size = 0;
  try {
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent) continue;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE" || tag === "NOSCRIPT") continue;
      if (!isVisible(parent)) continue;
      const value = node.nodeValue?.replace(/\s+/g, " ").trim();
      if (!value) continue;
      parts.push(value);
      size += value.length;
      if (size >= MAX_TEXT_LENGTH) break;
    }
  } catch {
    return (body.textContent ?? "").slice(0, MAX_TEXT_LENGTH);
  }
  return parts.join(" ");
}
