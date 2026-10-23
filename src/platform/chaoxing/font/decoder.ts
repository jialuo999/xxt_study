/**
 * 学习通 font-cxsecret 字体反爬解码。
 *
 * 学习通会给题目文字换一套自定义字体：页面显示正常，但 DOM textContent 是
 * 伪字符。这里解析页面里内嵌的 base64 字体，按字形轮廓 MD5 在映射表中查回
 * 真实 Unicode 字符。
 *
 * 参考公开脚本“超星复制粘贴助手 / 字体解密.js”的思路；
 * Typr.js、blueimp-md5 与映射表来源见 THIRD_PARTY_NOTICES.md。
 */
import { logger } from "../../../core/logger";
import { Typr, md5 } from "./typr-md5";
import table from "./table.json";

type GlyphTable = Record<string, number | string>;
type FontLike = unknown;

const FontApi = Typr as unknown as {
  U: {
    codeToGlyph: (font: FontLike, code: number) => number;
    glyphToPath: (font: FontLike, glyph: number) => unknown;
  };
};

const glyphTable = table as unknown as GlyphTable;
const FONT_RETRY_MS = 2000;
const CACHE_LIMIT = 4000;

interface FontCacheEntry {
  font: FontLike | null;
  at: number;
}

const fontCache = new WeakMap<Document, FontCacheEntry>();
const decodedCache = new WeakMap<Document, Map<string, string>>();

function parsePageFont(doc: Document): FontLike | null {
  let font: FontLike | null = null;
  try {
    const styles = doc.getElementsByTagName("style");
    for (const style of Array.from(styles)) {
      const content = style.textContent ?? "";
      if (!content.includes("font-cxsecret") || !content.includes("base64,")) continue;
      const match = /base64,([A-Za-z0-9+/=\s]+)/.exec(content);
      if (!match?.[1]) continue;
      try {
        const binary = atob(match[1].replace(/\s+/g, ""));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) {
          bytes[index] = binary.charCodeAt(index);
        }
        const parsed = Typr.parse(bytes) as FontLike[] | undefined;
        font = parsed?.[0] ?? null;
        if (font) {
          logger.debug("font", "已解析学习通加密字体");
          break;
        }
      } catch (error) {
        logger.debug("font", "解析加密字体失败", error);
      }
    }
  } catch {
    /* ignore */
  }
  return font;
}

function findFont(doc: Document): FontLike | null {
  const cached = fontCache.get(doc);
  if (cached && (cached.font || Date.now() - cached.at < FONT_RETRY_MS)) {
    return cached.font;
  }
  const font = parsePageFont(doc);
  fontCache.set(doc, { font, at: Date.now() });
  return font;
}

function lookupGlyph(path: unknown): string | null {
  try {
    const hash = md5(JSON.stringify(path)).slice(24);
    const value = glyphTable[hash] ?? glyphTable[String(parseInt(hash, 16))];
    if (value === undefined) return null;
    if (typeof value === "number") {
      try {
        return String.fromCodePoint(value);
      } catch {
        return String.fromCharCode(value);
      }
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * 解码一段从 DOM 取出的文本；没有检测到 font-cxsecret 时原样返回。
 * 必须在包含题目的 Document 上调用。
 */
export function decodeObfuscatedText(text: string, doc: Document = document): string {
  if (!text || !/[^\x00-\x7f]/.test(text)) return text;
  const font = findFont(doc);
  if (!font) return text;

  let cache = decodedCache.get(doc);
  if (!cache) {
    cache = new Map<string, string>();
    decodedCache.set(doc, cache);
  }
  const cached = cache.get(text);
  if (cached !== undefined) return cached;

  let result = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      result += char;
      continue;
    }
    let decoded: string | null = null;
    try {
      const glyphIndex = FontApi.U.codeToGlyph(font, code);
      if (glyphIndex > 0) {
        const path = FontApi.U.glyphToPath(font, glyphIndex);
        if (path) decoded = lookupGlyph(path);
      }
    } catch {
      /* ignore */
    }
    result += decoded ?? char;
  }

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(text, result);
  return result;
}
