import { describe, expect, it } from "vitest";
import { detectVerificationChallenge } from "../../src/platform/chaoxing/verification";

function page(html: string, title = "学习通"): Document {
  const doc = document.implementation.createHTMLDocument(title);
  doc.body.innerHTML = html;
  return doc;
}

describe("detectVerificationChallenge", () => {
  it("识别【9010】操作异常验证页", () => {
    const doc = page(
      `<div class="tip">【9010】操作异常，请输入图片中的验证码</div>
       <input placeholder="输入验证码" />
       <img id="captchaImg" src="/captcha.jpg" />`,
      "操作异常",
    );
    const result = detectVerificationChallenge(doc);
    expect(result.detected).toBe(true);
    expect(result.message).toContain("9010");
    expect(result.reason).toBe("9010");
  });

  it("识别带图片验证码输入框的普通验证页", () => {
    const doc = page(
      `<p>请输入验证码</p><input placeholder="输入验证码" /><img src="/captcha.png" />`,
    );
    expect(detectVerificationChallenge(doc).detected).toBe(true);
    expect(detectVerificationChallenge(doc).reason).toBe("captcha-prompt");
  });

  it("普通章节页不误报", () => {
    const doc = page(
      `<div class="chapter">第 3 章 线性表</div>
       <div class="TiMu">在顺序表中插入元素平均需要移动多少个元素？</div>`,
    );
    expect(detectVerificationChallenge(doc).detected).toBe(false);
  });

  it("正文提到验证码但没有验证输入框时不误报", () => {
    const doc = page(`<p>本工具不会绕过验证码或对抗平台检测。</p>`);
    expect(detectVerificationChallenge(doc).detected).toBe(false);
  });

  it("隐藏的登录/验证码弹层不误报", () => {
    const doc = page(
      `<div style="display:none">
         <p>请输入验证码</p>
         <input placeholder="请输入验证码" />
       </div>
       <div class="chapter">第 3 章 线性表</div>`,
    );
    expect(detectVerificationChallenge(doc).detected).toBe(false);
  });

  it("脚本模板里的验证码文案不误报", () => {
    const doc = page(
      `<div class="chapter">第 3 章 线性表</div>
       <script>var tip = "请输入验证码"; var el = '<input placeholder="输入验证码">';</script>`,
    );
    expect(detectVerificationChallenge(doc).detected).toBe(false);
  });

  it("只有隐藏的 9010 文案时不误报", () => {
    const doc = page(
      `<div style="display:none">【9010】操作异常，请输入图片中的验证码</div>
       <div class="chapter">第 3 章 线性表</div>`,
    );
    expect(detectVerificationChallenge(doc).detected).toBe(false);
  });
});
