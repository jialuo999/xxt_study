/**
 * 学习通人机验证 / 【9010】操作异常识别。
 *
 * 只读取顶层文档的 light DOM 文本与输入框，不读取 Shadow DOM 中的面板 UI，
 * 避免把面板自己的“验证码”提示误判成平台验证页。
 * 脚本不识别、不绕过验证码；识别到之后只负责暂停自动流程并提示用户手动处理。
 */

export interface VerificationChallenge {
  detected: boolean;
  message: string;
}

const MAX_TEXT_LENGTH = 20000;

const CAPTCHA_INPUT_SELECTOR = [
  'input[placeholder*="验证码"]',
  'input[name*="captcha" i]',
  'input[id*="captcha" i]',
].join(", ");

export function detectVerificationChallenge(doc: Document): VerificationChallenge {
  try {
    const body = doc.body;
    if (!body) return { detected: false, message: "" };
    const text = (body.textContent ?? "").replace(/\s+/g, " ").slice(0, MAX_TEXT_LENGTH);
    const title = doc.title ?? "";
    const hasCaptchaInput = Boolean(doc.querySelector<HTMLElement>(CAPTCHA_INPUT_SELECTOR));

    const has9010 = /【\s*9010\s*】/.test(text) || /【\s*9010\s*】/.test(title);
    const hasAbnormal = /操作异常/.test(text) || /操作异常/.test(title);
    const hasCaptchaPrompt = /请输入图片中的验证码|请输入验证码|输入验证码/.test(text);
    const mentionsCaptcha = /验证码/.test(text);

    const detected =
      has9010 ||
      hasCaptchaPrompt ||
      (hasAbnormal && mentionsCaptcha) ||
      (hasCaptchaInput && mentionsCaptcha);

    if (!detected) return { detected: false, message: "" };
    return {
      detected: true,
      message: has9010
        ? "平台返回【9010】操作异常，需要手动输入图片验证码"
        : "平台要求人机验证，需要手动输入图片验证码",
    };
  } catch {
    return { detected: false, message: "" };
  }
}
