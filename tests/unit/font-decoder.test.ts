import { describe, expect, it } from "vitest";
import { decodeObfuscatedText } from "../../src/platform/chaoxing/font/decoder";
import { md5 } from "../../src/platform/chaoxing/font/typr-md5";

describe("学习通字体反爬解码", () => {
  it("内置 Typr/md5 可正常计算 MD5", () => {
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("没有 font-cxsecret 时原样返回文本", () => {
    document.body.innerHTML = '<div class="TiMu">正常题目</div>';
    expect(decodeObfuscatedText("正常题目", document)).toBe("正常题目");
  });

  it("纯 ASCII 文本不做处理", () => {
    expect(decodeObfuscatedText("A. hello 123", document)).toBe("A. hello 123");
  });
});
